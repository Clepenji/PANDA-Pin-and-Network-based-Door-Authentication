"""ESP32 WROOM Hardware Communication and Ingestion Endpoints.

Handles:
1. Polling fallback synchronization: GET /api/esp32/{space_id}/sync
2. Keypad hardware event ingestion: POST /api/esp32/events
"""

import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.db.session import get_db
from backend.app.db.base import utc_now
from backend.app.models.active_pin import ActivePin
from backend.app.models.user import User
from backend.app.models.superuser import SuperUser
from backend.app.models.entry_log import EntryEventType
from backend.app.models.esp32_device import ESP32Device
from backend.app.models.esp32_firmware import ESP32FirmwareRelease
from backend.app.models.space import Space
from backend.app.api.deps import require_superuser_or_admin, require_root_admin
from backend.app.config.settings import settings
from backend.app.schemas.pin import (
    ESP32SyncResponse,
    ESP32SyncPinItem,
    ESP32EventRequest,
    ESP32EventResponse,
)
from backend.app.services.pin_service import PinService
from backend.app.services.log_service import LogService
from backend.app.services.websocket_service import ws_manager
from backend.app.services.esp32_service import ESP32Service, esp32_manager
from backend.app.services.totp_service import TotpService

router = APIRouter(tags=["ESP32 Communication"])
logger = logging.getLogger(__name__)


@router.get("/{space_id}/sync", response_model=ESP32SyncResponse)
async def sync_esp32_pins(
    space_id: str,
    session: AsyncSession = Depends(get_db)
) -> ESP32SyncResponse:
    """Resilience polling fallback endpoint: fetches current valid unrevoked PINs for a facility space.

    Called by physical ESP32 WROOM nodes on boot or network reconnection, and by the virtual simulator.
    """
    now = utc_now()
    active_records = await PinService.list_active_pins_for_space(session, space_id)

    items = [
        ESP32SyncPinItem(
            pin=pin.pin_code,
            expires_at=pin.expires_at,
            holder_name=user.name,
            holder_email=user.email,
        )
        for pin, user in active_records
    ]

    return ESP32SyncResponse(
        space_id=space_id,
        synced_at=now,
        pins=items,
    )


@router.post("/events", response_model=ESP32EventResponse)
async def ingest_esp32_event(
    payload: ESP32EventRequest,
    session: AsyncSession = Depends(get_db)
) -> ESP32EventResponse:
    """Ingest physical keypad entry events transmitted from ESP32 WROOM nodes.

    - Validates matching PIN against active unrevoked keys in this facility space.
    - If valid and unlocked: logs DOOR_UNLOCKED attributing the entrant and authorizing SuperUser.
    - If invalid or expired: logs INVALID_PIN_ATTEMPT for CSV audit ledger only.
    - Broadcasts real-time hardware status updates to WebSockets.
    """
    now = utc_now()

    # Look up matching active unrevoked PIN for target space
    stmt = select(ActivePin, User).join(
        User, User.id == ActivePin.holder_user_id
    ).where(
        and_(
            ActivePin.pin_code == payload.pin_entered,
            ActivePin.space_id == payload.space_id,
            ActivePin.revoked_at.is_(None),
            ActivePin.expires_at > now,
        )
    )
    result = await session.execute(stmt)
    row = result.first()

    # Resolve specific lock device for door attribution and per-lock TOTP verification
    dev = None
    if payload.device_id:
        dev_res = await session.execute(select(ESP32Device).where(ESP32Device.device_id == payload.device_id))
        dev = dev_res.scalar_one_or_none()
    elif payload.space_id:
        dev_res = await session.execute(select(ESP32Device).where(ESP32Device.space_id == payload.space_id))
        dev = dev_res.scalars().first()

    lock_device_id = dev.device_id if dev else payload.device_id
    lock_name = dev.name if dev else "Main Door"

    if row and payload.door_unlocked:
        active_pin, user = row

        # Write DOOR_UNLOCKED record to entry_logs with permanent immutable snapshots
        await LogService.create_entry_log(
            session=session,
            event_type=EntryEventType.DOOR_UNLOCKED,
            space_id=payload.space_id,
            device_id=lock_device_id,
            door_name=lock_name,
            actor_name=user.name,
            actor_email=user.email,
            authority_name=active_pin.issued_by_name_snapshot,
            authority_email=active_pin.issued_by_email_snapshot,
            pin_used=payload.pin_entered,
            justification_snapshot=f"ESP32 hardware event: door [{lock_name}] unlocked at {payload.timestamp or now.isoformat()}"
        )

        # Broadcast door unlock pulse over WebSockets
        await ws_manager.broadcast_space_event(
            space_slug=payload.space_id,
            event_type="DOOR_UNLOCKED",
            data={
                "space_slug": payload.space_id,
                "device_id": lock_device_id,
                "door_name": lock_name,
                "actor_name": user.name,
                "actor_email": user.email,
                "pin_used": payload.pin_entered,
                "duration_seconds": 5
            }
        )

        await session.commit()

        return ESP32EventResponse(
            status="success",
            event_recorded="DOOR_UNLOCKED",
            granted=True,
            message=f"Access Granted: Door [{lock_name}] Unlocked",
            space_id=payload.space_id,
        )

    else:
        # Check if entered PIN matches the Emergency Master TOTP PIN for this space (fixed 24h window)
        time_step = TotpService.EMERGENCY_TOTP_TIME_STEP_SECONDS
        is_totp_valid = False
        if dev and dev.device_secret:
            is_totp_valid = TotpService.verify_totp(dev.device_secret, payload.pin_entered, time_step=time_step)

        if is_totp_valid:
            await LogService.create_entry_log(
                session=session,
                event_type=EntryEventType.DOOR_UNLOCKED,
                space_id=payload.space_id,
                device_id=lock_device_id,
                door_name=lock_name,
                actor_name="Root Administrator (Emergency TOTP)",
                actor_email=settings.ROOT_ADMIN_EMAIL,
                authority_name="Emergency Offline TOTP Master Key",
                authority_email=settings.ROOT_ADMIN_EMAIL,
                pin_used=payload.pin_entered,
                justification_snapshot=f"Door [{lock_name}] unlocked via Emergency Master TOTP verification at {payload.timestamp or now.isoformat()}"
            )

            await ws_manager.broadcast_space_event(
                space_slug=payload.space_id,
                event_type="DOOR_UNLOCKED",
                data={
                    "space_slug": payload.space_id,
                    "device_id": lock_device_id,
                    "door_name": lock_name,
                    "actor_name": "Root Administrator (Emergency TOTP)",
                    "actor_email": settings.ROOT_ADMIN_EMAIL,
                    "pin_used": payload.pin_entered,
                    "duration_seconds": 5
                }
            )

            await session.commit()

            return ESP32EventResponse(
                status="success",
                event_recorded="DOOR_UNLOCKED",
                granted=True,
                message=f"Access Granted: Emergency Master TOTP Verified [{lock_name}]",
                space_id=payload.space_id,
            )

        # Invalid or expired PIN entry: write INVALID_PIN_ATTEMPT to entry_logs
        # (Stored for CSV audit export only; never shown in the portal UI)
        await LogService.create_entry_log(
            session=session,
            event_type=EntryEventType.INVALID_PIN_ATTEMPT,
            space_id=payload.space_id,
            device_id=lock_device_id,
            door_name=lock_name,
            actor_name="Unknown Keypad Entrant",
            actor_email="keypad@facility.local",
            authority_name="ESP32 Security Controller",
            authority_email="controller@facility.local",
            pin_used=payload.pin_entered,
            justification_snapshot=f"Keypad rejection [{lock_name}] at {payload.timestamp or now.isoformat()}"
        )

        # Broadcast access denied event over WebSockets
        await ws_manager.broadcast_space_event(
            space_slug=payload.space_id,
            event_type="INVALID_PIN_ATTEMPT",
            data={
                "space_slug": payload.space_id,
                "device_id": lock_device_id,
                "door_name": lock_name,
                "pin_entered": payload.pin_entered,
                "message": f"Access Denied: Invalid or expired PIN on [{lock_name}]"
            }
        )

        await session.commit()

        return ESP32EventResponse(
            status="denied",
            event_recorded="INVALID_PIN_ATTEMPT",
            granted=False,
            message="Access Denied: Invalid or expired PIN",
            space_id=payload.space_id,
        )


@router.get("/status")
async def get_esp32_devices_status(
    actor: Dict[str, Any] = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> List[Dict[str, Any]]:
    """Return live ESP32 hardware status per space and lock.

    Strictly forbidden for regular Users.
    Admins see all spaces; SuperUsers see spaces in their authority.
    """
    role = actor["role"]
    res = await session.execute(select(ESP32Device).order_by(ESP32Device.space_id.asc(), ESP32Device.device_id.asc()))
    devices = res.scalars().all()

    spaces_res = await session.execute(select(Space))
    spaces_list = spaces_res.scalars().all()
    space_names = {s.slug.lower(): s.name for s in spaces_list}
    existing_space_slugs = set(space_names.keys())

    # Auto-prune any orphaned devices from previously deleted spaces
    orphans = [d for d in devices if not d.space_id or d.space_id.lower() not in existing_space_slugs]
    if orphans:
        for o in orphans:
            logger.info(f"Auto-pruning orphaned ESP32 device '{o.device_id}' (space: '{o.space_id}')")
            esp32_manager.disconnect_and_unregister(o.device_id, o.space_id)
            await session.delete(o)
        await session.commit()
        devices = [d for d in devices if d.space_id and d.space_id.lower() in existing_space_slugs]

    if role == "admin":
        allowed = None
    else:
        su_res = await session.execute(select(SuperUser).where(SuperUser.email == actor["email"]))
        su = su_res.scalar_one_or_none()
        allowed = set(su.allowed_spaces) if (su and su.allowed_spaces) else set(actor.get("authorized_spaces", []))

    result = []
    for d in devices:
        if allowed is not None and (not d.space_id or d.space_id not in allowed):
            continue
        is_live = esp32_manager.is_device_online(d.device_id)
        result.append({
            "id": str(d.id),
            "device_id": d.device_id,
            "name": d.name or "Door Lock",
            "space_id": d.space_id,
            "space_name": space_names.get(d.space_id.lower() if d.space_id else "", (d.space_id or "").replace("_", " ").title()),
            "is_online": is_live or d.is_online,
            "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None,
            "last_ping_ms": d.last_ping_ms,
            "firmware_version": d.firmware_version,
            "ip_address": d.ip_address,
            "mac_address": d.mac_address if role == "admin" else None,
            "is_disabled": d.is_disabled,
        })
    return result


@router.post("/{identifier}/ping")
async def ping_esp32_device(
    identifier: str,
    actor: Dict[str, Any] = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Manual ping endpoint for SuperUser or Admin.

    Accepts either device_id or space_id.
    Sends PING frame over WebSocket and awaits PONG (up to 5s timeout).
    """
    role = actor["role"]
    space_id_for_perm = identifier
    dev_chk = await session.execute(select(ESP32Device).where(ESP32Device.device_id == identifier))
    dev_row = dev_chk.scalar_one_or_none()
    if dev_row:
        space_id_for_perm = dev_row.space_id

    if role != "admin":
        su_res = await session.execute(select(SuperUser).where(SuperUser.email == actor["email"]))
        su = su_res.scalar_one_or_none()
        allowed = (su.allowed_spaces or []) if su else actor.get("authorized_spaces", [])
        if space_id_for_perm not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Not authorized to monitor ESP32 hardware for space '{space_id_for_perm}'."
            )

    is_online, ping_ms = await ESP32Service.ping_device(identifier, timeout_seconds=5.0)

    res = await session.execute(
        select(ESP32Device).where(
            or_(ESP32Device.space_id == identifier, ESP32Device.device_id == identifier)
        )
    )
    dev = res.scalars().first()
    last_seen = None
    if dev:
        dev.last_ping_ms = ping_ms
        if is_online:
            dev.is_online = True
            dev.last_seen_at = utc_now()
        await session.commit()
        last_seen = dev.last_seen_at.isoformat() if dev.last_seen_at else None

    return {
        "identifier": identifier,
        "device_id": dev.device_id if dev else identifier,
        "space_id": dev.space_id if dev else identifier,
        "is_online": is_online,
        "ping_ms": ping_ms,
        "last_seen_at": last_seen,
        "message": f"Ping success: {ping_ms}ms" if is_online else "Device offline or ping timed out"
    }


@router.get("/firmware/{release_id}/download")
async def download_firmware_binary(
    release_id: uuid.UUID,
    session: AsyncSession = Depends(get_db)
):
    """Download compiled firmware binary for ESP32 OTA updates."""
    res = await session.execute(
        select(ESP32FirmwareRelease).where(ESP32FirmwareRelease.id == release_id)
    )
    rel = res.scalar_one_or_none()
    if not rel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Firmware release not found."
        )

    from backend.app.config.settings import settings
    bin_path = Path(settings.BASE_DIR) / "backend" / "firmware_bins" / rel.filename
    if not bin_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Firmware binary file missing on disk."
        )

    return FileResponse(
        path=str(bin_path),
        filename=rel.filename,
        media_type="application/octet-stream"
    )


@router.get("/devices")
async def list_all_lock_devices(
    actor: Dict[str, Any] = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> List[Dict[str, Any]]:
    """List all registered ESP32 door locks and their operational status."""
    res = await session.execute(select(ESP32Device).order_by(ESP32Device.space_id.asc(), ESP32Device.device_id.asc()))
    devices = res.scalars().all()
    spaces_res = await session.execute(select(Space))
    spaces_map = {s.slug: s.name for s in spaces_res.scalars().all()}
    out = []
    for d in devices:
        is_live = esp32_manager.is_device_online(d.device_id) or d.is_online
        out.append({
            "id": str(d.id),
            "device_id": d.device_id,
            "name": d.name,
            "space_id": d.space_id,
            "space_name": spaces_map.get(d.space_id, (d.space_id or "").replace("_", " ").title()),
            "is_online": is_live,
            "is_disabled": d.is_disabled,
            "disabled_by_email": d.disabled_by_email,
            "disabled_reason": d.disabled_reason,
            "firmware_version": d.firmware_version,
            "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None,
            "last_ping_ms": d.last_ping_ms,
            "ip_address": d.ip_address,
            "mac_address": d.mac_address,
        })
    return out


@router.post("/devices/{device_id}/disable")
async def disable_lock_device(
    device_id: str,
    payload: Optional[Dict[str, Any]] = None,
    current_root_admin: Dict[str, Any] = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Disable an ESP32 door lock (Root Admin only).

    When disabled, the lock accepts NO pins (except the Emergency Master TOTP PIN).
    The lock's screen prints out that it is disabled by Root Admin along with their email.
    The exit door button remains functional to allow people to exit safely.
    """
    admin_email = current_root_admin["email"]
    reason = (payload or {}).get("reason", "Disabled by Root Administrator")
    dev = await ESP32Service.disable_device(session, device_id, admin_email, reason)
    return {
        "status": "success",
        "message": f"Lock '{dev.device_id}' has been disabled.",
        "device_id": dev.device_id,
        "is_disabled": True,
        "disabled_by_email": admin_email,
    }


@router.post("/devices/{device_id}/enable")
async def enable_lock_device(
    device_id: str,
    current_root_admin: Dict[str, Any] = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Re-enable an ESP32 door lock (Root Admin only)."""
    dev = await ESP32Service.enable_device(session, device_id)
    return {
        "status": "success",
        "message": f"Lock '{dev.device_id}' has been re-enabled.",
        "device_id": dev.device_id,
        "is_disabled": False,
    }


@router.post("/devices", status_code=status.HTTP_201_CREATED)
async def create_lock_device(
    payload: Dict[str, Any],
    current_root_admin: Dict[str, Any] = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Register a new ESP32 lock / door controller (Root Admin only).

    Allows adding multiple doors to a single Facility Space.
    Generates a secure 32-character hexadecimal secret.
    """
    import hashlib
    import secrets
    device_id = str(payload.get("device_id", "")).strip()
    name = str(payload.get("name", "Door Lock")).strip()
    space_id = payload.get("space_id")
    if not space_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="space_id is required.")
    space_id = str(space_id).strip().lower()

    sp_chk = await session.execute(select(Space).where(Space.slug == space_id))
    sp_obj = sp_chk.scalar_one_or_none()
    if not sp_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Facility Space '{space_id}' does not exist.")

    if not device_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="device_id is required.")

    # Check duplicate
    existing = await session.execute(select(ESP32Device).where(ESP32Device.device_id == device_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Device with ID '{device_id}' already exists.")

    seed_secret = hashlib.sha256(f"panda_esp32_{device_id}_{secrets.token_hex(8)}".encode()).hexdigest()[:32]
    new_dev = ESP32Device(
        device_id=device_id,
        name=name,
        space_id=space_id,
        device_secret=seed_secret,
        device_secret_hash=hashlib.sha256(seed_secret.encode()).hexdigest(),
        is_disabled=False,
        is_online=False,
        firmware_version="1.0.0",
    )
    session.add(new_dev)
    await session.commit()
    await session.refresh(new_dev)

    # Broadcast lock creation across WebSocket
    try:
        from backend.app.services.websocket_service import ws_manager
        await ws_manager.broadcast("global", {
            "type": "SPACE_UPDATED",
            "event_type": "SPACE_UPDATED",
            "space_slug": space_id,
            "device_id": new_dev.device_id,
            "action": "lock_created",
        })
        await ws_manager.broadcast("global", {
            "type": "ESP_DEVICE_REGISTERED",
            "event_type": "ESP_DEVICE_REGISTERED",
            "device": {
                "device_id": new_dev.device_id,
                "name": new_dev.name,
                "space_id": new_dev.space_id,
                "space_name": sp_obj.name,
                "is_disabled": new_dev.is_disabled,
                "is_online": False,
            }
        })
    except Exception as e:
        logger.warning(f"Failed to broadcast lock creation: {e}")

    return {
        "id": str(new_dev.id),
        "device_id": new_dev.device_id,
        "name": new_dev.name,
        "space_id": new_dev.space_id,
        "space_name": sp_obj.name,
        "device_secret": seed_secret,
        "is_disabled": new_dev.is_disabled,
        "is_online": False,
        "message": f"Lock '{name}' ({device_id}) registered successfully for space '{sp_obj.name}'.",
    }


@router.put("/devices/{device_id}", status_code=status.HTTP_200_OK)
async def update_lock_device(
    device_id: str,
    payload: Dict[str, Any],
    current_root_admin: Dict[str, Any] = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Update details of an ESP32 door lock controller (Root Admin only).

    Allows editing friendly lock name, reassigning to another facility space,
    and toggling administrative disabled status.
    """
    device_id_clean = device_id.strip()
    res = await session.execute(select(ESP32Device).where(ESP32Device.device_id == device_id_clean))
    dev = res.scalar_one_or_none()
    if not dev:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ESP32 door lock '{device_id_clean}' not found."
        )

    if "name" in payload and payload["name"] is not None:
        name_val = str(payload["name"]).strip()
        if name_val:
            dev.name = name_val

    if "space_id" in payload and payload["space_id"] is not None:
        new_space_slug = str(payload["space_id"]).strip().lower()
        if new_space_slug and new_space_slug != dev.space_id:
            sp_chk = await session.execute(select(Space).where(Space.slug == new_space_slug))
            sp_obj = sp_chk.scalar_one_or_none()
            if not sp_obj:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Facility Space '{new_space_slug}' does not exist."
                )
            old_space = dev.space_id
            dev.space_id = new_space_slug
            esp32_manager.update_device_space(dev.device_id, new_space_slug)

            # If old space pointed to this device as primary, point it to another if available
            old_sp_res = await session.execute(select(Space).where(Space.slug == old_space))
            old_sp_obj = old_sp_res.scalar_one_or_none()
            if old_sp_obj and old_sp_obj.esp32_device_id == device_id_clean:
                rem_dev = (await session.execute(
                    select(ESP32Device).where(ESP32Device.space_id == old_space, ESP32Device.device_id != device_id_clean)
                )).scalars().first()
                old_sp_obj.esp32_device_id = rem_dev.device_id if rem_dev else None

    if "is_disabled" in payload:
        dev.is_disabled = bool(payload["is_disabled"])
        if dev.is_disabled:
            dev.disabled_by_email = current_root_admin.get("email") or current_root_admin.get("sub")
            dev.disabled_reason = str(payload.get("disabled_reason") or "Disabled by Administrator").strip()
        else:
            dev.disabled_by_email = None
            dev.disabled_reason = None

    await session.commit()
    await session.refresh(dev)

    # Fetch space name for response
    sp_res = await session.execute(select(Space).where(Space.slug == dev.space_id))
    sp_obj = sp_res.scalar_one_or_none()
    space_name = sp_obj.name if sp_obj else dev.space_id

    # Broadcast device status update
    try:
        from backend.app.services.websocket_service import ws_manager
        await ws_manager.broadcast("global", {
            "type": "ESP32_STATUS_UPDATE",
            "event_type": "ESP32_STATUS_UPDATE",
            "device": {
                "device_id": dev.device_id,
                "name": dev.name,
                "space_id": dev.space_id,
                "space_name": space_name,
                "is_disabled": dev.is_disabled,
                "is_online": esp32_manager.is_device_online(dev.device_id) or dev.is_online,
            }
        })
        await ws_manager.broadcast("global", {
            "type": "SPACE_UPDATED",
            "event_type": "SPACE_UPDATED",
            "space_slug": dev.space_id,
            "device_id": dev.device_id,
            "action": "lock_updated",
        })
    except Exception as e:
        logger.warning(f"Failed to broadcast lock update: {e}")

    logger.info(f"Lock '{device_id_clean}' updated by {current_root_admin.get('email')}: name='{dev.name}', space='{dev.space_id}', disabled={dev.is_disabled}")
    return {
        "id": str(dev.id),
        "device_id": dev.device_id,
        "name": dev.name,
        "space_id": dev.space_id,
        "space_name": space_name,
        "is_disabled": dev.is_disabled,
        "disabled_reason": dev.disabled_reason,
        "is_online": esp32_manager.is_device_online(dev.device_id) or dev.is_online,
        "message": f"Lock '{dev.name}' ({dev.device_id}) updated successfully.",
    }


@router.delete("/devices/{device_id}", status_code=status.HTTP_200_OK)
async def delete_lock_device(
    device_id: str,
    current_root_admin: Dict[str, Any] = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Permanently remove an ESP32 door lock controller (Root Admin only)."""
    device_id_clean = device_id.strip()

    # 1. Query by exact device_id
    res = await session.execute(select(ESP32Device).where(ESP32Device.device_id == device_id_clean))
    dev = res.scalar_one_or_none()

    # 2. Query by UUID if device_id_clean is a valid UUID
    if not dev:
        try:
            val_uuid = uuid.UUID(device_id_clean)
            res = await session.execute(select(ESP32Device).where(ESP32Device.id == val_uuid))
            dev = res.scalar_one_or_none()
        except (ValueError, TypeError):
            pass

    # 3. Query by space_id (if orphaned lock for this space)
    if not dev:
        res = await session.execute(select(ESP32Device).where(func.lower(ESP32Device.space_id) == device_id_clean.lower()))
        dev = res.scalars().first()

    if not dev:
        # Clean up any lingering in-memory sockets
        esp32_manager.disconnect_and_unregister(device_id_clean, device_id_clean)
        # Idempotent deletion: if already deleted from database, broadcast update and return success
        try:
            from backend.app.services.websocket_service import ws_manager
            await ws_manager.broadcast("global", {
                "type": "SPACE_UPDATED",
                "event_type": "SPACE_UPDATED",
                "device_id": device_id_clean,
                "action": "lock_deleted",
            })
            await ws_manager.broadcast("global", {
                "type": "ESP_DEVICE_DELETED",
                "event_type": "ESP_DEVICE_DELETED",
                "device_id": device_id_clean,
            })
        except Exception:
            pass
        return {
            "status": "success",
            "message": f"Lock '{device_id_clean}' was already removed from the system.",
            "device_id": device_id_clean,
        }

    actual_device_id = dev.device_id
    space_slug = dev.space_id
    lock_name = dev.name

    # Check if this is the LAST remaining lock for its Facility Space
    other_locks_count = 0
    if space_slug:
        other_locks_count = (await session.execute(
            select(func.count(ESP32Device.id)).where(
                and_(
                    func.lower(ESP32Device.space_id) == space_slug.lower(),
                    ESP32Device.id != dev.id,
                )
            )
        )).scalar_one()

    if space_slug and other_locks_count == 0:
        # Deleting the last lock deletes the Facility Space along with it (cascading SuperUsers/tabs, preserving immutable logs)
        from backend.app.services.space_service import SpaceService
        sp_res = await session.execute(select(Space).where(func.lower(Space.slug) == space_slug.lower()))
        space_obj = sp_res.scalar_one_or_none()
        if space_obj:
            space_display_name = space_obj.name
            await SpaceService.remove_space(session, space_slug, current_root_admin["email"])
            return {
                "status": "success",
                "space_deleted": True,
                "space_slug": space_slug,
                "device_id": actual_device_id,
                "message": (
                    f"Last lock '{lock_name}' ({actual_device_id}) removed, and its Facility Space "
                    f"'{space_display_name}' was deleted along with single-space SuperUsers and space tabs."
                ),
            }

    # Multiple locks exist (or orphaned lock): disconnect ONLY this lock and promote next remaining lock
    esp32_manager.disconnect_device_only(actual_device_id)

    await session.delete(dev)
    await session.flush()

    # If the space was pointing to this lock as primary, update to another remaining lock
    if space_slug:
        sp_res = await session.execute(select(Space).where(func.lower(Space.slug) == space_slug.lower()))
        space_obj = sp_res.scalar_one_or_none()
        if space_obj and space_obj.esp32_device_id == actual_device_id:
            remaining_dev_res = await session.execute(
                select(ESP32Device).where(func.lower(ESP32Device.space_id) == space_slug.lower())
            )
            rem_dev = remaining_dev_res.scalars().first()
            space_obj.esp32_device_id = rem_dev.device_id if rem_dev else None

    await session.commit()
    logger.info(f"Lock '{actual_device_id}' ({lock_name}) removed by Root Admin {current_root_admin['email']}")

    try:
        from backend.app.services.websocket_service import ws_manager
        await ws_manager.broadcast("global", {
            "type": "SPACE_UPDATED",
            "event_type": "SPACE_UPDATED",
            "space_slug": space_slug,
            "device_id": actual_device_id,
            "action": "lock_deleted",
        })
        await ws_manager.broadcast("global", {
            "type": "ESP_DEVICE_DELETED",
            "event_type": "ESP_DEVICE_DELETED",
            "device_id": actual_device_id,
            "space_slug": space_slug,
        })
    except Exception as e:
        logger.warning(f"Failed to broadcast lock deletion: {e}")

    return {
        "status": "success",
        "space_deleted": False,
        "space_slug": space_slug,
        "message": f"Lock '{lock_name}' ({actual_device_id}) permanently removed.",
        "device_id": actual_device_id,
    }


@router.post("/devices/{device_id}/unbind", status_code=status.HTTP_200_OK)
async def unbind_lock_hardware(
    device_id: str,
    current_root_admin: Dict[str, Any] = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Forget previously bound IP and MAC address for a lock so replacement hardware can connect seamlessly.

    Preserves device_id and device_secret; disconnects active WebSocket and clears IP/MAC telemetry.
    """
    device_id_clean = device_id.strip()
    res = await session.execute(select(ESP32Device).where(ESP32Device.device_id == device_id_clean))
    dev = res.scalar_one_or_none()
    if not dev:
        try:
            val_uuid = uuid.UUID(device_id_clean)
            res = await session.execute(select(ESP32Device).where(ESP32Device.id == val_uuid))
            dev = res.scalar_one_or_none()
        except (ValueError, TypeError):
            pass

    if not dev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Door lock '{device_id_clean}' not found.")

    # Disconnect only this device socket
    esp32_manager.disconnect_device_only(dev.device_id)

    dev.ip_address = None
    dev.mac_address = None
    dev.is_online = False
    dev.last_seen_at = None
    dev.last_ping_ms = None
    await session.commit()
    await session.refresh(dev)

    logger.info(f"Hardware IP/MAC unbound for lock '{dev.device_id}' ({dev.name}) by {current_root_admin['email']}")

    try:
        from backend.app.services.websocket_service import ws_manager
        await ws_manager.broadcast("global", {
            "type": "ESP_DEVICE_STATUS",
            "event_type": "ESP_DEVICE_STATUS",
            "data": {
                "id": str(dev.id),
                "device_id": dev.device_id,
                "space_id": dev.space_id,
                "is_online": False,
                "ip_address": None,
                "mac_address": None,
                "last_seen_at": None,
                "last_ping_ms": None,
                "firmware_version": dev.firmware_version,
            }
        })
        await ws_manager.broadcast("global", {
            "type": "SPACE_UPDATED",
            "event_type": "SPACE_UPDATED",
            "space_slug": dev.space_id,
            "device_id": dev.device_id,
            "action": "lock_hardware_unbound",
        })
    except Exception as e:
        logger.warning(f"Failed to broadcast lock unbind: {e}")

    return {
        "status": "success",
        "device_id": dev.device_id,
        "name": dev.name,
        "ip_address": None,
        "mac_address": None,
        "is_online": False,
        "message": f"Hardware binding cleared for '{dev.name}' ({dev.device_id}). Ready for new ESP32 connection.",
    }
