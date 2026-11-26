"""ESP32 Hardware Interface, Device Registry, and Real-Time WebSocket Service.

Implements:
1. Challenge-Response Anti-Spoofing Handshake (HMAC-SHA256 with 32-byte nonces & replay detection).
2. Bidirectional persistent outbox queue with mandatory ACKs (ADD_PIN, REVOKE_PIN, PING, OTA_UPDATE).
3. Inbound hardware event ingestion (PIN_ATTEMPT, EXIT_BUTTON, NETWORK_RECOVERED, BATCH_LOGS).
4. Live health tracking, ping latency measurements, and 5-minute background heartbeat checks.
5. Secure credential rotation and OTA firmware update broadcasting.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, Tuple, List, Set

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select, and_, or_, update, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config.spaces import get_registered_spaces, get_space_by_slug
from backend.app.db.base import utc_now
from backend.app.db.session import AsyncSessionLocal
from backend.app.models.esp32_device import ESP32Device
from backend.app.models.esp32_outbox import ESP32CommandOutbox
from backend.app.models.esp32_firmware import ESP32FirmwareRelease
from backend.app.models.active_pin import ActivePin
from backend.app.models.user import User
from backend.app.models.superuser import SuperUser
from backend.app.models.entry_log import EntryLog, EntryEventType
from backend.app.models.system_setting import SystemSetting
from backend.app.config.settings import settings
from backend.app.services.log_service import LogService
from backend.app.services.websocket_service import ws_manager
from backend.app.services.totp_service import TotpService

logger = logging.getLogger("panda.esp32_service")

# Server boot time marker for startup synchronization and log reconciliation
SERVER_BOOT_TIME = utc_now()


class ESP32ConnectionManager:
    """Manages active authenticated physical ESP32 WebSocket connections."""

    def __init__(self) -> None:
        # device_id -> WebSocket
        self.device_sockets: Dict[str, WebSocket] = {}
        # device_id -> space_id
        self.device_spaces: Dict[str, Optional[str]] = {}
        # space_id -> WebSocket (convenience alias)
        self.active_sockets: Dict[str, WebSocket] = {}
        # msg_id -> asyncio.Future for awaiting PONG responses
        self.pending_pings: Dict[str, asyncio.Future] = {}
        # Processed incoming msg_ids for idempotency deduplication (in-memory LRU set)
        self.processed_msg_ids: Set[str] = set()
        # Lock for thread/coroutine safety during state updates
        self._lock = asyncio.Lock()

    def register_socket(self, device_id: str, websocket: WebSocket, space_id: Optional[str] = None) -> None:
        """Associate an authenticated WebSocket connection with a device and space."""
        norm_space = space_id.strip().lower() if space_id else None
        self.device_sockets[device_id] = websocket
        self.device_spaces[device_id] = norm_space
        if norm_space:
            self.active_sockets[norm_space] = websocket
        logger.info(f"ESP32 hardware lock '{device_id}' registered online (space: '{norm_space}')")

    def update_device_space(self, device_id: str, new_space_id: Optional[str]) -> None:
        """Update in-memory space mapping when a lock is reassigned to another space."""
        old_space = self.device_spaces.get(device_id)
        norm_new = new_space_id.strip().lower() if new_space_id else None
        if device_id in self.device_sockets:
            self.device_spaces[device_id] = norm_new
            ws = self.device_sockets[device_id]
            if old_space and self.active_sockets.get(old_space) == ws:
                self.active_sockets.pop(old_space, None)
                for d, d_sp in list(self.device_spaces.items()):
                    if d_sp == old_space and d in self.device_sockets:
                        self.active_sockets[old_space] = self.device_sockets[d]
                        break
            if norm_new:
                self.active_sockets[norm_new] = ws

    def unregister_socket(self, device_id: str, websocket: WebSocket) -> None:
        """Remove an active WebSocket connection if it matches the current socket."""
        if self.device_sockets.get(device_id) == websocket:
            del self.device_sockets[device_id]
            space_id = self.device_spaces.pop(device_id, None)
            if space_id and self.active_sockets.get(space_id) == websocket:
                del self.active_sockets[space_id]
                for d, d_sp in list(self.device_spaces.items()):
                    if d_sp == space_id and d in self.device_sockets:
                        self.active_sockets[space_id] = self.device_sockets[d]
                        break
            logger.info(f"ESP32 hardware lock '{device_id}' disconnected")

    def disconnect_and_unregister(self, device_id: Optional[str] = None, space_id: Optional[str] = None) -> None:
        """Force unregister and close socket for a device or space, removing all memory mappings."""
        # 1. Clean up by device_id
        if device_id:
            ws = self.device_sockets.pop(device_id, None)
            sp = self.device_spaces.pop(device_id, None)
            if ws:
                try:
                    asyncio.create_task(ws.close(code=1000))
                except Exception:
                    pass
            if sp and self.active_sockets.get(sp) == ws:
                self.active_sockets.pop(sp, None)

        # 2. Clean up by space_id
        target_space = space_id or (device_id if not self.is_device_online(device_id or "") else None)
        if target_space:
            ws_sp = self.active_sockets.pop(target_space, None)
            if ws_sp:
                try:
                    asyncio.create_task(ws_sp.close(code=1000))
                except Exception:
                    pass
            devs_to_remove = [d for d, s in self.device_spaces.items() if s == target_space]
            for d in devs_to_remove:
                self.device_spaces.pop(d, None)
                ws_d = self.device_sockets.pop(d, None)
                if ws_d:
                    try:
                        asyncio.create_task(ws_d.close(code=1000))
                    except Exception:
                        pass

    def disconnect_device_only(self, device_id: str) -> None:
        """Close and unregister only the specified device's socket without disrupting sibling locks in the space."""
        ws = self.device_sockets.pop(device_id, None)
        sp = self.device_spaces.pop(device_id, None)
        if ws:
            try:
                asyncio.create_task(ws.close(code=1000))
            except Exception:
                pass
        if sp and self.active_sockets.get(sp) == ws:
            self.active_sockets.pop(sp, None)
            # Re-point active_sockets[sp] to any sibling online device in the same space
            for d, d_sp in self.device_spaces.items():
                if d_sp == sp and d in self.device_sockets:
                    self.active_sockets[sp] = self.device_sockets[d]
                    break

    def is_device_online(self, device_id: str) -> bool:
        """Check whether an active WebSocket connection exists for the specific device."""
        return device_id in self.device_sockets

    def is_online(self, identifier: str) -> bool:
        """Check whether any active WebSocket connection exists for the space or device."""
        if not identifier:
            return False
        norm = identifier.strip().lower()
        return (
            identifier in self.device_sockets
            or norm in self.active_sockets
            or identifier in self.active_sockets
            or any((s or "").lower() == norm for s in self.device_spaces.values())
        )

    async def send_frame_to_device(self, device_id: str, frame: Dict[str, Any]) -> bool:
        """Send a JSON payload directly to a specific physical ESP32 lock."""
        ws = self.device_sockets.get(device_id)
        if not ws:
            return False
        try:
            await ws.send_text(json.dumps(frame))
            return True
        except Exception as e:
            logger.warning(f"Failed to dispatch frame to ESP32 [{device_id}]: {e}")
            return False

    async def send_frame(self, identifier: str, frame: Dict[str, Any]) -> bool:
        """Send a JSON payload to active ESP32 connection(s) associated with a space or device."""
        if identifier in self.device_sockets:
            return await self.send_frame_to_device(identifier, frame)

        norm = identifier.strip().lower()
        target_device_ids = [
            d_id for d_id, s_id in list(self.device_spaces.items())
            if (s_id or "").lower() == norm
        ]
        if not target_device_ids and (norm in self.active_sockets or identifier in self.active_sockets):
            # Fallback for direct socket mapping
            ws = self.active_sockets.get(norm) or self.active_sockets.get(identifier)
            if ws:
                try:
                    await ws.send_text(json.dumps(frame))
                    return True
                except Exception as e:
                    logger.warning(f"Failed to dispatch frame to ESP32 [{identifier}]: {e}")
                    return False

        dispatched_any = False
        for d_id in target_device_ids:
            if await self.send_frame_to_device(d_id, frame):
                dispatched_any = True
        return dispatched_any

    def is_duplicate_msg(self, msg_id: str) -> bool:
        """Check if an incoming msg_id was already processed (idempotency guard)."""
        if not msg_id:
            return False
        if msg_id in self.processed_msg_ids:
            return True
        self.processed_msg_ids.add(msg_id)
        if len(self.processed_msg_ids) > 10000:
            # Prevent unbounded memory growth by clearing older half
            self.processed_msg_ids = set(list(self.processed_msg_ids)[5000:])
        return False

    def resolve_ping(self, ack_id: str, ping_ms: int) -> None:
        """Resolve a pending manual or heartbeat ping future."""
        future = self.pending_pings.pop(ack_id, None)
        if future and not future.done():
            future.set_result(ping_ms)


# Global connection manager instance
esp32_manager = ESP32ConnectionManager()


class ESP32Service:
    """Core business logic for ESP32 hardware security, outbox, and event processing."""

    @staticmethod
    async def get_or_create_device(session: AsyncSession, space_id: str) -> ESP32Device:
        """Retrieve the device record for a Facility Space, creating one with high-entropy secret if missing."""
        res = await session.execute(select(ESP32Device).where(ESP32Device.space_id == space_id))
        dev = res.scalar_one_or_none()
        if not dev:
            secret = secrets.token_hex(16)
            dev = ESP32Device(
                space_id=space_id,
                device_secret=secret,
                device_secret_hash=hashlib.sha256(secret.encode()).hexdigest(),
                is_online=False,
                firmware_version="1.0.0",
            )
            session.add(dev)
            await session.commit()
            await session.refresh(dev)
        return dev

    @staticmethod
    async def rotate_device_secret(session: AsyncSession, identifier: str) -> str:
        """Generate and save a new compact 32-char hex device secret for flashing onto the ESP32."""
        dev = await ESP32Service.get_device_by_identifier(session, identifier)
        if not dev:
            dev = await ESP32Service.get_or_create_device(session, identifier)
        new_secret = secrets.token_hex(16)
        dev.device_secret = new_secret
        dev.device_secret_hash = hashlib.sha256(new_secret.encode()).hexdigest()
        await session.commit()
        await session.refresh(dev)
        logger.info(f"Rotated device secret for '{identifier}' (32-char hex)")
        return new_secret

    @staticmethod
    async def list_devices(session: AsyncSession) -> List[ESP32Device]:
        """List all registered ESP32 devices ordered by space slug."""
        res = await session.execute(select(ESP32Device).order_by(ESP32Device.device_id.asc()))
        return list(res.scalars().all())

    @staticmethod
    async def get_device_by_identifier(session: AsyncSession, identifier: str) -> Optional[ESP32Device]:
        """Fetch ESP32 lock device by exact device_id first, then fallback to space_id."""
        res = await session.execute(
            select(ESP32Device).where(ESP32Device.device_id == identifier)
        )
        dev = res.scalar_one_or_none()
        if dev:
            return dev
        fallback_res = await session.execute(
            select(ESP32Device).where(ESP32Device.space_id == identifier)
        )
        return fallback_res.scalars().first()

    @staticmethod
    async def notify_lock_disabled(device_id: str, admin_email: str, reason: str = "") -> bool:
        """Send LOCK_DISABLED frame over WebSocket to physical ESP32."""
        frame = {
            "type": "LOCK_DISABLED",
            "msg_id": str(uuid.uuid4()),
            "disabled": True,
            "admin_email": admin_email,
            "reason": reason,
        }
        return await esp32_manager.send_frame_to_device(device_id, frame)

    @staticmethod
    async def notify_lock_enabled(device_id: str) -> bool:
        """Send LOCK_ENABLED frame over WebSocket to physical ESP32."""
        frame = {
            "type": "LOCK_ENABLED",
            "msg_id": str(uuid.uuid4()),
            "disabled": False,
        }
        return await esp32_manager.send_frame_to_device(device_id, frame)

    @staticmethod
    async def disable_device(session: AsyncSession, device_id: str, admin_email: str, reason: str = "Disabled by Root Admin") -> ESP32Device:
        """Set an ESP32 lock to disabled state and notify the hardware."""
        dev = await ESP32Service.get_device_by_identifier(session, device_id)
        if not dev:
            from fastapi import HTTPException, status
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Device '{device_id}' not found.")

        dev.is_disabled = True
        dev.disabled_by_email = admin_email
        dev.disabled_reason = reason
        await session.commit()
        await session.refresh(dev)

        await ESP32Service.notify_lock_disabled(dev.device_id, admin_email, reason)
        logger.info(f"ESP32 lock '{dev.device_id}' disabled by Root Admin {admin_email}: {reason}")
        return dev

    @staticmethod
    async def enable_device(session: AsyncSession, device_id: str) -> ESP32Device:
        """Re-enable an ESP32 lock from disabled state and notify the hardware."""
        dev = await ESP32Service.get_device_by_identifier(session, device_id)
        if not dev:
            from fastapi import HTTPException, status
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Device '{device_id}' not found.")

        dev.is_disabled = False
        dev.disabled_by_email = None
        dev.disabled_reason = None
        await session.commit()
        await session.refresh(dev)

        await ESP32Service.notify_lock_enabled(dev.device_id)
        logger.info(f"ESP32 lock '{dev.device_id}' re-enabled by Root Admin.")
        return dev

    # =========================================================================
    # PERSISTENT OUTBOX QUEUE
    # =========================================================================

    @staticmethod
    async def enqueue_command(
        session: AsyncSession,
        space_id: str,
        command_type: str,
        payload: Dict[str, Any]
    ) -> ESP32CommandOutbox:
        """Enqueue outbound command(s) per registered door lock in the space and push immediately if online."""
        norm_space = space_id.strip().lower()
        explicit_target = payload.get("target_device_id") or payload.get("device_id")
        if explicit_target:
            target_device_ids = [str(explicit_target)]
        else:
            dev_res = await session.execute(
                select(ESP32Device.device_id)
                .where(ESP32Device.space_id == norm_space)
                .order_by(ESP32Device.created_at.asc())
            )
            target_device_ids = list(dev_res.scalars().all())

        created_cmds: List[ESP32CommandOutbox] = []
        if target_device_ids:
            for dev_id in target_device_ids:
                msg_id = uuid.uuid4()
                cmd_payload = {**payload, "target_device_id": dev_id}
                cmd = ESP32CommandOutbox(
                    msg_id=msg_id,
                    space_id=norm_space,
                    command_type=command_type,
                    payload=cmd_payload,
                    status="PENDING",
                    retry_count=0,
                )
                session.add(cmd)
                created_cmds.append(cmd)

            await session.commit()
            for cmd in created_cmds:
                await session.refresh(cmd)

            any_sent = False
            for cmd in created_cmds:
                dev_id = cmd.payload["target_device_id"]
                if esp32_manager.is_device_online(dev_id):
                    frame = {
                        "type": command_type,
                        "msg_id": str(cmd.msg_id),
                        **cmd.payload,
                    }
                    if await esp32_manager.send_frame_to_device(dev_id, frame):
                        cmd.status = "SENT"
                        cmd.retry_count += 1
                        any_sent = True

            if any_sent:
                await session.commit()

            return created_cmds[0]

        # Fallback if space has no registered ESP32Device rows yet
        msg_id = uuid.uuid4()
        cmd = ESP32CommandOutbox(
            msg_id=msg_id,
            space_id=norm_space,
            command_type=command_type,
            payload=payload,
            status="PENDING",
            retry_count=0,
        )
        session.add(cmd)
        await session.commit()
        await session.refresh(cmd)

        if esp32_manager.is_online(norm_space):
            frame = {
                "type": command_type,
                "msg_id": str(msg_id),
                **payload,
            }
            if await esp32_manager.send_frame(norm_space, frame):
                cmd.status = "SENT"
                cmd.retry_count += 1
                await session.commit()

        return cmd

    @staticmethod
    async def ack_command(session: AsyncSession, msg_id_str: str) -> bool:
        """Mark an outbox command as ACKED upon receiving hardware confirmation."""
        try:
            msg_uuid = uuid.UUID(msg_id_str)
        except (ValueError, TypeError):
            return False

        res = await session.execute(
            select(ESP32CommandOutbox).where(ESP32CommandOutbox.msg_id == msg_uuid)
        )
        cmd = res.scalar_one_or_none()
        if cmd:
            cmd.status = "ACKED"
            cmd.acked_at = utc_now()
            await session.commit()
            logger.info(f"Outbox command {msg_id_str} ({cmd.command_type}) ACKed by ESP32 [{cmd.space_id}]")
            return True
        return False

    @staticmethod
    async def flush_outbox(
        session: AsyncSession,
        space_id: str,
        device_id: Optional[str] = None,
    ) -> int:
        """Push all un-ACKed (PENDING or SENT) commands to the ESP32(s) upon reconnection."""
        if device_id:
            if not esp32_manager.is_device_online(device_id):
                return 0
        elif not esp32_manager.is_online(space_id):
            return 0

        res = await session.execute(
            select(ESP32CommandOutbox)
            .where(
                and_(
                    ESP32CommandOutbox.space_id == space_id,
                    ESP32CommandOutbox.status.in_(["PENDING", "SENT"])
                )
            )
            .order_by(ESP32CommandOutbox.created_at.asc())
        )
        pending_cmds = res.scalars().all()
        flushed_count = 0

        for cmd in pending_cmds:
            cmd_payload = cmd.payload if isinstance(cmd.payload, dict) else {}
            target_dev = cmd_payload.get("target_device_id")

            if device_id:
                if target_dev and target_dev != device_id:
                    continue
                frame = {
                    "type": cmd.command_type,
                    "msg_id": str(cmd.msg_id),
                    **cmd_payload,
                }
                sent = await esp32_manager.send_frame_to_device(device_id, frame)
            else:
                frame = {
                    "type": cmd.command_type,
                    "msg_id": str(cmd.msg_id),
                    **cmd_payload,
                }
                if target_dev:
                    sent = await esp32_manager.send_frame_to_device(target_dev, frame)
                else:
                    sent = await esp32_manager.send_frame(space_id, frame)

            if sent:
                cmd.status = "SENT"
                cmd.retry_count += 1
                flushed_count += 1

        if flushed_count > 0:
            await session.commit()
            logger.info(f"Flushed {flushed_count} outbox commands to ESP32 [{device_id or space_id}]")

        return flushed_count

    # =========================================================================
    # STARTUP SYNCHRONIZATION & FRESH SETUP RECONCILIATION
    # =========================================================================

    @staticmethod
    async def is_fresh_setup(session: AsyncSession) -> bool:
        """Check whether the system is in a fresh setup state where historical ESP logs must be disregarded.

        A setup is considered 'fresh' if:
        1. Explicit 'fresh_setup_pending' system setting is 'true', OR
        2. If setting is absent, there are 0 regular users, 0 superusers, and 0 active logs in the database.
        """
        setting_res = await session.execute(
            select(SystemSetting).where(SystemSetting.key == "fresh_setup_pending")
        )
        setting = setting_res.scalar_one_or_none()
        if setting:
            return setting.value.lower() == "true"

        # Check user and superuser counts when setting is not present
        user_cnt = (await session.execute(select(func.count(User.id)))).scalar() or 0
        su_cnt = (await session.execute(select(func.count(SuperUser.id)))).scalar() or 0
        log_cnt = (await session.execute(
            select(func.count(EntryLog.id)).where(EntryLog.is_archived.is_(False))
        )).scalar() or 0

        if user_cnt == 0 and su_cnt == 0 and log_cnt == 0:
            return True

        return False

    @staticmethod
    async def clear_fresh_setup(session: AsyncSession) -> None:
        """Clear fresh setup flag once initial reconciliation is complete."""
        setting_res = await session.execute(
            select(SystemSetting).where(SystemSetting.key == "fresh_setup_pending")
        )
        setting = setting_res.scalar_one_or_none()
        if setting:
            setting.value = "false"
            await session.commit()

    @staticmethod
    async def purge_all_space_pins(session: AsyncSession, space_id: str) -> bool:
        """Instruct the ESP32 lock for a facility space to purge all cached PINs immediately from RAM and Flash."""
        msg_id = str(uuid.uuid4())
        frame = {
            "type": "PURGE_PINS",
            "msg_id": msg_id,
            "space_id": space_id,
            "server_epoch": int(time.time()),
        }
        dispatched = False
        if esp32_manager.is_online(space_id):
            dispatched = await esp32_manager.send_frame(space_id, frame)
            logger.info(f"[PURGE_PINS] Dispatched PURGE_PINS directly to online ESP [{space_id}]")

        # Also enqueue as a persistent outbox command so offline ESPs purge on reconnection
        await ESP32Service.enqueue_command(
            session=session,
            space_id=space_id,
            command_type="PURGE_PINS",
            payload={"action": "PURGE_ALL_PINS", "timestamp": int(time.time())}
        )

        # Broadcast PURGE_PINS to virtual simulators and observers
        await ws_manager.broadcast_space_event(
            space_slug=space_id,
            event_type="PURGE_PINS",
            data={
                "action": "PURGE_PINS",
                "space_id": space_id,
                "message": "All cached PINs purged from memory and flash.",
            }
        )
        return dispatched

    @staticmethod
    async def sync_space_pins(session: AsyncSession, space_id: str) -> Dict[str, Any]:
        """Fetch all currently valid, unrevoked PINs for a facility space and dispatch SYNC_PINS frame."""
        from backend.app.services.pin_service import PinService
        active_records = await PinService.list_active_pins_for_space(session, space_id)
        pin_items = [
            {
                "pin": pin.pin_code,
                "valid_till": int(pin.expires_at.timestamp()),
                "holder_name": user.name,
                "holder_email": user.email,
            }
            for pin, user in active_records
        ]
        msg_id = str(uuid.uuid4())
        frame = {
            "type": "SYNC_PINS",
            "msg_id": msg_id,
            "space_id": space_id,
            "server_epoch": int(time.time()),
            "pins": pin_items,
            "count": len(pin_items),
        }
        dispatched = False
        if esp32_manager.is_online(space_id):
            dispatched = await esp32_manager.send_frame(space_id, frame)

        # Broadcast over WebSocket for virtual simulators and UI clients
        await ws_manager.broadcast_space_event(
            space_slug=space_id,
            event_type="SYNC_PINS",
            data={
                "action": "SYNC_PINS",
                "space_id": space_id,
                "pins": [
                    {
                        "pin": item["pin"],
                        "expires_at": datetime.fromtimestamp(item["valid_till"], tz=timezone.utc).isoformat(),
                        "holder_name": item["holder_name"],
                        "holder_email": item["holder_email"],
                    }
                    for item in pin_items
                ],
                "count": len(pin_items),
            }
        )

        return {
            "space_id": space_id,
            "pins_count": len(pin_items),
            "dispatched": dispatched,
            "pins": pin_items,
        }

    @staticmethod
    async def on_server_startup_sync() -> None:
        """Executed on FastAPI application startup to synchronize PINs and reconcile logs with all ESPs."""
        logger.info("[STARTUP SYNC] Initiating startup ESP32 synchronization & log reconciliation...")
        try:
            async with AsyncSessionLocal() as session:
                is_fresh = await ESP32Service.is_fresh_setup(session)
                spaces = get_registered_spaces()
                logger.info(
                    f"[STARTUP SYNC] Mode: {'FRESH SETUP (disregarding legacy logs)' if is_fresh else 'NORMAL REBOOT (reconciling offline logs)'}. "
                    f"Registered spaces: {[s.slug for s in spaces]}"
                )

                for space in spaces:
                    # 1. First purge all cached PINs from the ESP to ensure no stale/legacy keys remain
                    await ESP32Service.purge_all_space_pins(session, space.slug)

                    # 2. Then synchronize only the currently valid unrevoked PINs from the database
                    res = await ESP32Service.sync_space_pins(session, space.slug)

                    # 3. Request buffered offline logs
                    if res.get("dispatched") or esp32_manager.is_online(space.slug):
                        req_logs = {
                            "type": "REQUEST_LOGS",
                            "msg_id": str(uuid.uuid4()),
                            "space_id": space.slug,
                        }
                        await esp32_manager.send_frame(space.slug, req_logs)
                        logger.info(f"[STARTUP SYNC] Dispatched PURGE_PINS, SYNC_PINS ({res.get('pins_count', 0)} pins), and REQUEST_LOGS to ESP [{space.slug}]")
        except Exception as e:
            logger.error(f"[STARTUP SYNC] Error during startup ESP sync: {e}", exc_info=True)

    # =========================================================================
    # PING / HEALTH MONITORING
    # =========================================================================

    @staticmethod
    async def ping_device(space_id: str, timeout_seconds: float = 5.0) -> Tuple[bool, Optional[int]]:
        """Dispatch a real-time PING frame to an ESP32 and await PONG response."""
        # Resolve actual device record from DB if possible
        actual_device_id = None
        actual_space_id = space_id
        async with AsyncSessionLocal() as session:
            res = await session.execute(
                select(ESP32Device).where(
                    or_(
                        ESP32Device.device_id == space_id,
                        ESP32Device.space_id == space_id,
                    )
                )
            )
            dev = res.scalars().first()
            if dev:
                actual_device_id = dev.device_id
                actual_space_id = dev.space_id

        target_ident = actual_device_id or space_id
        if not esp32_manager.is_online(target_ident) and not esp32_manager.is_online(actual_space_id):
            return False, None

        msg_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        esp32_manager.pending_pings[msg_id] = future

        start_time = time.time()
        frame = {
            "type": "PING",
            "msg_id": msg_id,
            "timestamp": int(start_time),
        }

        sent = await esp32_manager.send_frame(target_ident, frame)
        if not sent and actual_space_id != target_ident:
            sent = await esp32_manager.send_frame(actual_space_id, frame)

        if not sent:
            esp32_manager.pending_pings.pop(msg_id, None)
            return False, None

        try:
            await asyncio.wait_for(future, timeout=timeout_seconds)
            elapsed_ms = int((time.time() - start_time) * 1000)

            # Update DB with latest latency and last_seen
            async with AsyncSessionLocal() as session:
                dev = await ESP32Service.get_device_by_identifier(session, target_ident)
                if not dev and actual_space_id != target_ident:
                    dev = await ESP32Service.get_device_by_identifier(session, actual_space_id)
                if dev:
                    dev.is_online = True
                    dev.last_ping_ms = elapsed_ms
                    dev.last_seen_at = utc_now()
                    actual_device_id = dev.device_id
                    actual_space_id = dev.space_id
                    await session.commit()

            # Broadcast updated latency to portal clients on global and space channels
            payload = {
                "device_id": actual_device_id,
                "space_id": actual_space_id,
                "is_online": True,
                "last_ping_ms": elapsed_ms,
                "last_seen_at": utc_now().isoformat(),
            }
            await ws_manager.broadcast("global", {
                "type": "ESP_DEVICE_STATUS",
                "event_type": "ESP_DEVICE_STATUS",
                "data": payload,
            })
            if actual_space_id:
                await ws_manager.broadcast_space_event(
                    space_slug=actual_space_id,
                    event_type="ESP_DEVICE_STATUS",
                    data=payload
                )

            return True, elapsed_ms
        except asyncio.TimeoutError:
            esp32_manager.pending_pings.pop(msg_id, None)
            logger.warning(f"PING timed out for ESP32 [{target_ident}] after {timeout_seconds}s")
            return False, None

    # =========================================================================
    # INBOUND HARDWARE EVENT PROCESSOR
    # =========================================================================

    @staticmethod
    async def process_inbound_event(
        session: AsyncSession,
        space_id: str,
        payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Process an inbound ESP32 event (PIN_ATTEMPT, EXIT_BUTTON, NETWORK_RECOVERED)."""
        msg_id = payload.get("msg_id", str(uuid.uuid4()))
        event_type = payload.get("type")
        timestamp_sec = payload.get("timestamp")
        event_time = (
            datetime.fromtimestamp(timestamp_sec, tz=timezone.utc)
            if timestamp_sec
            else utc_now()
        )

        # Idempotency deduplication
        if esp32_manager.is_duplicate_msg(msg_id):
            logger.info(f"Duplicate frame ignored (msg_id={msg_id})")
            return {"type": "ACK", "ack_id": msg_id, "status": "duplicate_ignored"}

        # Check device record to see if lock is disabled and resolve door name/id
        inbound_dev_id = payload.get("device_id")
        dev = None
        if inbound_dev_id:
            dev_res = await session.execute(
                select(ESP32Device).where(ESP32Device.device_id == inbound_dev_id)
            )
            dev = dev_res.scalar_one_or_none()
        if not dev and not inbound_dev_id:
            dev_res = await session.execute(
                select(ESP32Device).where(
                    or_(
                        ESP32Device.device_id == space_id,
                        ESP32Device.space_id == space_id,
                    )
                )
            )
            dev = dev_res.scalars().first()

        lock_device_id = dev.device_id if dev else inbound_dev_id
        lock_name = dev.name if dev else (payload.get("door_name") or "Main Door")

        # Disregard legacy offline events on fresh setups
        if timestamp_sec and event_time < (SERVER_BOOT_TIME - timedelta(seconds=15)):
            if await ESP32Service.is_fresh_setup(session):
                logger.info(
                    f"[FRESH SETUP] Disregarding legacy offline event '{event_type}' at {event_time.isoformat()} from ESP [{space_id}] (fresh setup active)."
                )
                return {"type": "ACK", "ack_id": msg_id, "status": "disregarded_fresh_setup"}

        # 1. PIN ATTEMPT EVENT
        if event_type == "PIN_ATTEMPT":
            pin_code = str(payload.get("pin", "")).strip()
            door_unlocked = bool(payload.get("door_unlocked", False))

            # If lock is disabled by Root Admin: it accepts NO PINs except Emergency TOTP (fixed 24h window)!
            if dev and dev.is_disabled:
                time_step = TotpService.EMERGENCY_TOTP_TIME_STEP_SECONDS
                is_totp_valid = False
                if dev.device_secret:
                    is_totp_valid = TotpService.verify_totp(dev.device_secret, pin_code, time_step=time_step)

                if is_totp_valid:
                    # Emergency Master Key Entry
                    await LogService.create_entry_log(
                        session=session,
                        event_type=EntryEventType.DOOR_UNLOCKED,
                        space_id=dev.space_id or "unassigned",
                        device_id=lock_device_id,
                        door_name=lock_name,
                        actor_name="Root Administrator (Emergency TOTP)",
                        actor_email=settings.ROOT_ADMIN_EMAIL,
                        authority_name="Emergency Offline TOTP Master Key",
                        authority_email=settings.ROOT_ADMIN_EMAIL,
                        pin_used=pin_code,
                        justification_snapshot=f"Emergency Master TOTP entry on disabled lock [{lock_name}] at {event_time.strftime('%Y-%m-%d %H:%M:%S UTC')}",
                    )

                    await ws_manager.broadcast_space_event(
                        space_slug=dev.space_id or "global",
                        event_type="DOOR_UNLOCKED",
                        data={
                            "space_slug": dev.space_id or "global",
                            "device_id": lock_device_id,
                            "door_name": lock_name,
                            "actor_name": "Root Administrator (Emergency TOTP)",
                            "actor_email": settings.ROOT_ADMIN_EMAIL,
                            "pin_used": pin_code,
                            "duration_seconds": 5,
                        }
                    )
                    await session.commit()
                    return {"type": "ACK", "ack_id": msg_id, "result": "DOOR_UNLOCKED"}

                # Normal PINs rejected when disabled
                await LogService.create_entry_log(
                    session=session,
                    event_type=EntryEventType.INVALID_PIN_ATTEMPT,
                    space_id=dev.space_id or "unassigned",
                    device_id=lock_device_id,
                    door_name=lock_name,
                    actor_name="Unknown Keypad Entrant",
                    actor_email="keypad@facility.local",
                    authority_name="ESP32 Security Controller",
                    authority_email=dev.disabled_by_email or settings.ROOT_ADMIN_EMAIL,
                    pin_used=pin_code,
                    justification_snapshot=f"Keypad rejection: Lock [{lock_name}] disabled by Root Admin ({dev.disabled_by_email}) at {event_time.strftime('%Y-%m-%d %H:%M:%S UTC')}",
                )

                await ws_manager.broadcast_space_event(
                    space_slug=dev.space_id or "global",
                    event_type="INVALID_PIN_ATTEMPT",
                    data={
                        "space_slug": dev.space_id or "global",
                        "device_id": lock_device_id,
                        "door_name": lock_name,
                        "pin_entered": pin_code,
                        "message": f"Access Denied: Lock [{lock_name}] disabled by Root Admin ({dev.disabled_by_email})",
                    }
                )
                await session.commit()
                return {"type": "ACK", "ack_id": msg_id, "result": "LOCK_DISABLED"}

            # Normal PIN check
            now = utc_now()
            stmt = select(ActivePin, User).join(
                User, User.id == ActivePin.holder_user_id
            ).where(
                and_(
                    ActivePin.pin_code == pin_code,
                    ActivePin.space_id == space_id,
                    ActivePin.revoked_at.is_(None),
                    or_(
                        ActivePin.expires_at > now,
                        and_(ActivePin.expires_at >= event_time, ActivePin.created_at <= event_time),
                    ),
                )
            ).order_by(ActivePin.expires_at.desc())
            res = await session.execute(stmt)
            match = res.first()

            if match and door_unlocked:
                active_pin, user = match
                await LogService.create_entry_log(
                    session=session,
                    event_type=EntryEventType.DOOR_UNLOCKED,
                    space_id=space_id,
                    device_id=lock_device_id,
                    door_name=lock_name,
                    actor_name=user.name,
                    actor_email=user.email,
                    authority_name=active_pin.issued_by_name_snapshot,
                    authority_email=active_pin.issued_by_email_snapshot,
                    pin_used=pin_code,
                    justification_snapshot=f"ESP32 hardware entry [{lock_name}] at {event_time.strftime('%Y-%m-%d %H:%M:%S UTC')}",
                )

                await ws_manager.broadcast_space_event(
                    space_slug=space_id,
                    event_type="DOOR_UNLOCKED",
                    data={
                        "space_slug": space_id,
                        "device_id": lock_device_id,
                        "door_name": lock_name,
                        "actor_name": user.name,
                        "actor_email": user.email,
                        "pin_used": pin_code,
                        "duration_seconds": 5,
                    }
                )
                await session.commit()
                return {"type": "ACK", "ack_id": msg_id, "result": "DOOR_UNLOCKED"}

            else:
                # Check if entered PIN matches the Emergency Master TOTP PIN for this space / device (fixed 24h window)
                totp_secret = dev.device_secret if dev else None
                time_step = TotpService.EMERGENCY_TOTP_TIME_STEP_SECONDS
                is_totp_valid = False
                if totp_secret:
                    is_totp_valid = TotpService.verify_totp(totp_secret, pin_code, time_step=time_step)

                if is_totp_valid:
                    # Emergency Master Key Entry
                    await LogService.create_entry_log(
                        session=session,
                        event_type=EntryEventType.DOOR_UNLOCKED,
                        space_id=space_id,
                        device_id=lock_device_id,
                        door_name=lock_name,
                        actor_name="Root Administrator (Emergency TOTP)",
                        actor_email=settings.ROOT_ADMIN_EMAIL,
                        authority_name="Emergency Offline TOTP Master Key",
                        authority_email=settings.ROOT_ADMIN_EMAIL,
                        pin_used=pin_code,
                        justification_snapshot=f"Emergency Master TOTP entry [{lock_name}] at {event_time.strftime('%Y-%m-%d %H:%M:%S UTC')}",
                    )

                    await ws_manager.broadcast_space_event(
                        space_slug=space_id,
                        event_type="DOOR_UNLOCKED",
                        data={
                            "space_slug": space_id,
                            "device_id": lock_device_id,
                            "door_name": lock_name,
                            "actor_name": "Root Administrator (Emergency TOTP)",
                            "actor_email": settings.ROOT_ADMIN_EMAIL,
                            "pin_used": pin_code,
                            "duration_seconds": 5,
                        }
                    )
                    await session.commit()
                    return {"type": "ACK", "ack_id": msg_id, "result": "DOOR_UNLOCKED"}

                # Invalid or expired PIN attempt
                await LogService.create_entry_log(
                    session=session,
                    event_type=EntryEventType.INVALID_PIN_ATTEMPT,
                    space_id=space_id,
                    device_id=lock_device_id,
                    door_name=lock_name,
                    actor_name="Unknown Keypad Entrant",
                    actor_email="keypad@facility.local",
                    authority_name="ESP32 Security Controller",
                    authority_email="controller@facility.local",
                    pin_used=pin_code,
                    justification_snapshot=f"Keypad rejection [{lock_name}] at {event_time.strftime('%Y-%m-%d %H:%M:%S UTC')}",
                )

                await ws_manager.broadcast_space_event(
                    space_slug=space_id,
                    event_type="INVALID_PIN_ATTEMPT",
                    data={
                        "space_slug": space_id,
                        "device_id": lock_device_id,
                        "door_name": lock_name,
                        "pin_entered": pin_code,
                        "message": f"Access Denied: Invalid or expired PIN on {lock_name}",
                    }
                )
                await session.commit()
                return {"type": "ACK", "ack_id": msg_id, "result": "INVALID_PIN_ATTEMPT"}

        # 2. EXIT BUTTON EVENT
        elif event_type == "EXIT_BUTTON":
            await LogService.create_entry_log(
                session=session,
                event_type=EntryEventType.EXIT_BUTTON_UNLOCKED,
                space_id=space_id,
                device_id=lock_device_id,
                door_name=lock_name,
                actor_name="Internal Exit Button",
                actor_email="exit_sensor@facility.local",
                authority_name="Hardware Fail-Safe Relay",
                authority_email="relay@facility.local",
                pin_used=None,
                justification_snapshot=f"Indoor exit button actuated fail-safe release for {lock_name}",
            )

            await ws_manager.broadcast_space_event(
                space_slug=space_id,
                event_type="DOOR_UNLOCKED",
                data={
                    "space_slug": space_id,
                    "device_id": lock_device_id,
                    "door_name": lock_name,
                    "actor_name": "Internal Exit Button",
                    "actor_email": "exit_sensor@facility.local",
                    "trigger": "EXIT_BUTTON",
                    "duration_seconds": 5,
                }
            )
            await session.commit()
            return {"type": "ACK", "ack_id": msg_id, "result": "EXIT_BUTTON_UNLOCKED"}

        # 3. NETWORK RECOVERED EVENT
        elif event_type == "NETWORK_RECOVERED":
            offline_sec = payload.get("offline_duration_sec", 0)
            await LogService.create_entry_log(
                session=session,
                event_type=EntryEventType.ESP_NETWORK_RECOVERED,
                space_id=space_id,
                actor_name=f"ESP32 [{space_id}]",
                actor_email=f"esp32_{space_id}@facility.local",
                authority_name="Network Watchdog",
                authority_email="watchdog@facility.local",
                pin_used=None,
                justification_snapshot=f"ESP32 reconnected after network drop. Offline duration: {offline_sec} seconds.",
            )

            # Flush outbox commands for this specific lock
            flushed = await ESP32Service.flush_outbox(
                session,
                space_id,
                device_id=dev.device_id if dev else None,
            )
            await session.commit()
            return {"type": "ACK", "ack_id": msg_id, "flushed_commands": flushed}

        # 4. BATCH LOGS EVENT (Offline recovery)
        elif event_type == "BATCH_LOGS":
            events = payload.get("events", [])
            is_fresh = await ESP32Service.is_fresh_setup(session)
            if is_fresh:
                logger.info(
                    f"[FRESH SETUP] Disregarding {len(events)} legacy offline logs from ESP [{space_id}] (purging ESP cache)."
                )
                return {
                    "type": "ACK",
                    "ack_id": msg_id,
                    "status": "disregarded_fresh_setup",
                    "processed_batch_count": 0,
                    "detail": "Fresh setup detected. Legacy logs disregarded to maintain pristine state.",
                }
            else:
                processed_count = 0
                for item in sorted(events, key=lambda x: x.get("timestamp", 0)):
                    await ESP32Service.process_inbound_event(session, space_id, item)
                    processed_count += 1
                logger.info(
                    f"[LOG RECONCILIATION] Processed and made use of {processed_count} logs from ESP [{space_id}]."
                )
                return {
                    "type": "ACK",
                    "ack_id": msg_id,
                    "status": "success",
                    "processed_batch_count": processed_count,
                }

        return {"type": "ACK", "ack_id": msg_id}


# =============================================================================
# WEBSOCKET PROTOCOL HANDLER WITH HMAC CHALLENGE-RESPONSE
# =============================================================================

async def handle_esp32_websocket_connection(websocket: WebSocket, space_id: str) -> None:
    """Handles an incoming physical ESP32 WebSocket connection.

    Protocol Sequence:
    1. Validate device or space identity (NACK with ERR_UNKNOWN_DEVICE / 4004 on failure).
    2. Accept socket & send AUTH_CHALLENGE with 32-byte cryptographic nonce.
    3. Receive AUTH_HELLO, compute expected HMAC-SHA256, verify constant time.
    4. On failure: send NACK with ERR_INVALID_SIGNATURE / close 4001.
    5. On success: send AUTH_ACK, mark is_online=True, log ESP_ONLINE, flush outbox.
    6. Transmit current disabled state and root admin email in AUTH_ACK.
    7. Process continuous bi-directional frames (ACKs, PING/PONG, hardware events).
    """
    # 1. Validate device or space
    async with AsyncSessionLocal() as session:
        dev = await ESP32Service.get_device_by_identifier(session, space_id)

    if not dev:
        registered_space = get_space_by_slug(space_id)
        if not registered_space:
            await websocket.accept()
            await websocket.send_text(json.dumps({
                "type": "NACK",
                "error_code": "ERR_UNKNOWN_SPACE",
                "detail": f"Hardware identifier '{space_id}' does not exist in registry.",
            }))
            await websocket.close(code=4004)
            return

    # Accept connection and begin authentication challenge
    await websocket.accept()
    client_ip = websocket.client.host if websocket.client else "unknown"
    nonce = secrets.token_hex(32)
    challenge_msg_id = str(uuid.uuid4())
    current_epoch = int(time.time())

    await websocket.send_text(json.dumps({
        "type": "AUTH_CHALLENGE",
        "msg_id": challenge_msg_id,
        "nonce": nonce,
        "server_epoch": current_epoch,
    }))

    # 2. Wait for AUTH_HELLO (with 10-second timeout)
    try:
        raw_msg = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
        hello_data = json.loads(raw_msg)
    except (asyncio.TimeoutError, json.JSONDecodeError, Exception) as e:
        logger.warning(f"ESP32 [{space_id}] failed initial handshake reception from {client_ip}: {e}")
        try:
            await websocket.send_text(json.dumps({
                "type": "NACK",
                "error_code": "ERR_MALFORMED_PAYLOAD",
                "detail": "Did not receive valid AUTH_HELLO JSON within 10s.",
            }))
            await asyncio.sleep(0.05)
            await websocket.close(code=4003)
        except Exception:
            pass
        return

    if hello_data.get("type") != "AUTH_HELLO":
        await websocket.send_text(json.dumps({
            "type": "NACK",
            "error_code": "ERR_MALFORMED_PAYLOAD",
            "detail": "Expected type AUTH_HELLO.",
        }))
        await asyncio.sleep(0.05)
        await websocket.close(code=4003)
        return

    hello_space = hello_data.get("space_id", space_id)
    hello_device_id = hello_data.get("device_id")
    hello_timestamp = hello_data.get("timestamp", 0)
    current_epoch = int(time.time())

    # Replay protection: within 300 seconds allowable clock skew
    if abs(current_epoch - hello_timestamp) > 300:
        logger.warning(
            f"ESP32 [{space_id}] replay drift: server_epoch={current_epoch}, "
            f"hello_timestamp={hello_timestamp}, diff={abs(current_epoch - hello_timestamp)}s > 300s limit. "
            f"Client IP: {client_ip}"
        )
        await websocket.send_text(json.dumps({
            "type": "NACK",
            "error_code": "ERR_REPLAY_DETECTED",
            "detail": f"Timestamp drift excessive: {abs(current_epoch - hello_timestamp)}s > 300s allowable limit.",
        }))
        await asyncio.sleep(0.05)
        await websocket.close(code=4002)
        return

    # Fetch candidate devices from PostgreSQL
    async with AsyncSessionLocal() as session:
        norm_space_id = space_id.strip().lower()
        cand_filters = [
            ESP32Device.device_id == space_id,
            func.lower(ESP32Device.space_id) == norm_space_id,
        ]
        if hello_device_id:
            cand_filters.append(ESP32Device.device_id == str(hello_device_id).strip())
        cand_res = await session.execute(
            select(ESP32Device).where(or_(*cand_filters))
        )
        candidate_devices = list(cand_res.scalars().all())
        if hello_device_id:
            candidate_devices.sort(key=lambda c: 0 if c.device_id == str(hello_device_id).strip() else 1)

        if not candidate_devices:
            dev = await ESP32Service.get_or_create_device(session, space_id)
            candidate_devices = [dev]

    # Verify HMAC-SHA256 signature against candidate devices
    received_signature = str(hello_data.get("signature", "")).lower()
    expected_payload = f"{hello_space}:{nonce}:{hello_timestamp}".encode("utf-8")

    matched_device = None
    for cand in candidate_devices:
        cand_sig = hmac.new(
            cand.device_secret.encode("utf-8"),
            expected_payload,
            hashlib.sha256
        ).hexdigest().lower()
        if hmac.compare_digest(received_signature, cand_sig):
            matched_device = cand
            break

    if not matched_device:
        logger.warning(
            f"ESP32 [{space_id}] authentication failed: HMAC mismatch from {client_ip}. "
            f"Expected sig over '{hello_space}:{nonce}:{hello_timestamp}'"
        )
        await websocket.send_text(json.dumps({
            "type": "NACK",
            "error_code": "ERR_INVALID_SIGNATURE",
            "detail": "Cryptographic HMAC signature verification failed. Ensure device_secret matches server.",
        }))
        await asyncio.sleep(0.05)
        await websocket.close(code=4001)
        return

    dev = matched_device

    # =========================================================================
    # AUTHENTICATION SUCCESSFUL
    # =========================================================================
    firmware_ver = str(hello_data.get("firmware_version", "1.0.0"))[:32]
    boot_reason = str(hello_data.get("boot_reason", "normal_power_on"))[:64]
    mac_addr = hello_data.get("mac_address") or hello_data.get("mac")

    async with AsyncSessionLocal() as session:
        res = await session.execute(select(ESP32Device).where(ESP32Device.id == dev.id))
        dev = res.scalar_one()
        dev.is_online = True
        dev.last_seen_at = utc_now()
        dev.firmware_version = firmware_ver
        dev.ip_address = client_ip
        if mac_addr:
            dev.mac_address = str(mac_addr).strip()[:32]
        await session.commit()

        # Log ESP_ONLINE event
        await LogService.create_entry_log(
            session=session,
            event_type=EntryEventType.ESP_ONLINE,
            space_id=dev.space_id or "unassigned",
            actor_name=f"ESP32 [{dev.device_id}]",
            actor_email=f"esp32_{dev.device_id.lower()}@facility.local",
            authority_name="Hardware Security Gateway",
            authority_email="security@facility.local",
            pin_used=None,
            justification_snapshot=f"ESP32 authenticated online (fw: {firmware_ver}, boot: {boot_reason}, ip: {client_ip})",
        )
        await session.commit()

    # Register in active socket manager
    esp32_manager.register_socket(dev.device_id, websocket, dev.space_id)

    # Synchronize currently valid unrevoked PINs and request logs
    async with AsyncSessionLocal() as session:
        from backend.app.services.pin_service import PinService
        active_records = []
        if dev.space_id:
            active_records = await PinService.list_active_pins_for_space(session, dev.space_id)

        pin_items = [
            {
                "pin": pin.pin_code,
                "valid_till": int(pin.expires_at.timestamp()),
                "holder_name": user.name,
                "holder_email": user.email,
            }
            for pin, user in active_records
        ]

        # Reply with AUTH_ACK including current disabled state, root admin contact, and valid PINs
        await websocket.send_text(json.dumps({
            "type": "AUTH_ACK",
            "ack_id": hello_data.get("msg_id", challenge_msg_id),
            "server_epoch": int(time.time()),
            "is_disabled": dev.is_disabled,
            "disabled_by_email": dev.disabled_by_email or settings.ROOT_ADMIN_EMAIL,
            "admin_email": dev.disabled_by_email or settings.ROOT_ADMIN_EMAIL,
            "pins": pin_items,
        }))

        # 1. First purge all cached PINs on the ESP to ensure no stale/legacy keys remain from previous iterations
        purge_frame = {
            "type": "PURGE_PINS",
            "msg_id": str(uuid.uuid4()),
            "space_id": dev.space_id or dev.device_id,
            "server_epoch": int(time.time()),
        }
        await websocket.send_text(json.dumps(purge_frame))

        # 2. Immediately dispatch explicit SYNC_PINS frame with ONLY currently valid PINs
        sync_frame = {
            "type": "SYNC_PINS",
            "msg_id": str(uuid.uuid4()),
            "space_id": dev.space_id or dev.device_id,
            "server_epoch": int(time.time()),
            "pins": pin_items,
            "count": len(pin_items),
        }
        await websocket.send_text(json.dumps(sync_frame))

        # Request buffered offline logs from the ESP
        req_logs_frame = {
            "type": "REQUEST_LOGS",
            "msg_id": str(uuid.uuid4()),
            "space_id": dev.space_id or dev.device_id,
        }
        await websocket.send_text(json.dumps(req_logs_frame))

        # Broadcast online status to portal subscribers
        await ws_manager.broadcast_space_event(
            space_slug=dev.space_id or "global",
            event_type="ESP_DEVICE_STATUS",
            data={
                "device_id": dev.device_id,
                "space_id": dev.space_id,
                "is_online": True,
                "is_disabled": dev.is_disabled,
                "firmware_version": firmware_ver,
                "last_seen_at": utc_now().isoformat(),
                "ip_address": client_ip,
            }
        )

        if dev.space_id:
            # Broadcast SYNC_PINS for virtual simulators and UI observers
            await ws_manager.broadcast_space_event(
                space_slug=dev.space_id,
                event_type="SYNC_PINS",
                data={
                    "action": "SYNC_PINS",
                    "space_id": dev.space_id,
                    "pins": [
                        {
                            "pin": item["pin"],
                            "expires_at": datetime.fromtimestamp(item["valid_till"], tz=timezone.utc).isoformat(),
                            "holder_name": item["holder_name"],
                            "holder_email": item["holder_email"],
                        }
                        for item in pin_items
                    ],
                    "count": len(pin_items),
                }
            )

            # Flush all persistent outbox commands targeting this specific door lock
            await ESP32Service.flush_outbox(session, dev.space_id, device_id=dev.device_id)

    # =========================================================================
    # CONTINUOUS INBOUND MESSAGE LOOP
    # =========================================================================
    try:
        while True:
            text = await websocket.receive_text()
            try:
                frame = json.loads(text)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({
                    "type": "NACK",
                    "error_code": "ERR_MALFORMED_PAYLOAD",
                    "detail": "JSON parse error.",
                }))
                continue

            frame_type = frame.get("type")

            # 1. ACK reception from ESP32
            if frame_type == "ACK":
                ack_id = frame.get("ack_id")
                if ack_id:
                    async with AsyncSessionLocal() as session:
                        await ESP32Service.ack_command(session, ack_id)

            # 2. PONG reception from ESP32
            elif frame_type == "PONG":
                ack_id = frame.get("ack_id")
                if ack_id:
                    esp32_manager.resolve_ping(ack_id, 0)

            # 3. Hardware Events (PIN_ATTEMPT, EXIT_BUTTON, NETWORK_RECOVERED, BATCH_LOGS)
            elif frame_type in ["PIN_ATTEMPT", "EXIT_BUTTON", "NETWORK_RECOVERED", "BATCH_LOGS"]:
                async with AsyncSessionLocal() as session:
                    frame_with_dev = frame if frame.get("device_id") else {**frame, "device_id": dev.device_id}
                    ack_reply = await ESP32Service.process_inbound_event(session, dev.space_id or dev.device_id, frame_with_dev)
                    await websocket.send_text(json.dumps(ack_reply))

            # Update device last_seen_at
            async with AsyncSessionLocal() as session:
                await session.execute(
                    update(ESP32Device)
                    .where(ESP32Device.id == dev.id)
                    .values(last_seen_at=utc_now())
                )
                await session.commit()

    except WebSocketDisconnect:
        logger.info(f"ESP32 [{dev.device_id}] socket disconnected.")
    except Exception as e:
        logger.warning(f"ESP32 [{dev.device_id}] socket error: {e}")
    finally:
        esp32_manager.unregister_socket(dev.device_id, websocket)

        # Mark offline in DB
        async with AsyncSessionLocal() as session:
            await session.execute(
                update(ESP32Device)
                .where(ESP32Device.id == dev.id)
                .values(is_online=False, last_seen_at=utc_now())
            )
            await session.commit()

        # Broadcast offline status
        await ws_manager.broadcast_space_event(
            space_slug=dev.space_id or "global",
            event_type="ESP_DEVICE_STATUS",
            data={
                "device_id": dev.device_id,
                "space_id": dev.space_id,
                "is_online": False,
                "last_seen_at": utc_now().isoformat(),
            }
        )
