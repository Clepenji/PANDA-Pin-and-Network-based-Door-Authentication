"""Active PINs and Keypad Verification API Endpoints.

Handles retrieval of active user PIN tokens and IoT hardware keypad authentication.
"""

from typing import Optional, List, Dict, Any
import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.db.session import get_db
from backend.app.db.base import utc_now
from backend.app.api.deps import get_current_actor, require_superuser_or_admin
from backend.app.models.user import User
from backend.app.models.superuser import SuperUser
from backend.app.models.active_pin import ActivePin
from backend.app.schemas.pin import (
    ActivePinResponse,
    KeypadAttemptRequest,
    KeypadAttemptResponse,
    DirectPinCreateRequest,
    RevokePinResponse,
)
from backend.app.schemas.auth import ActiveKeySummaryResponse
from backend.app.services.pin_service import PinService
from backend.app.services.lifecycle_service import get_account_tag
from backend.app.config.spaces import get_space_by_slug

router = APIRouter(prefix="/pins", tags=["Active PINs & Keypad"])


@router.get("/active", response_model=Optional[ActivePinResponse])
async def get_active_pin(
    space_slug: str = Query(..., description="Target facility space slug"),
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> Optional[ActivePinResponse]:
    """Retrieve the current entrant's valid active PIN for a specific space."""
    now = utc_now()

    user_stmt = select(User).where(User.email == actor["email"])
    user_res = await session.execute(user_stmt)
    user = user_res.scalar_one_or_none()

    if not user:
        su_res = await session.execute(select(SuperUser).where(SuperUser.email == actor["email"]))
        su = su_res.scalar_one_or_none()
        if su:
            user = User(
                email=su.email,
                name=su.name,
                phone=su.phone or "0000000000",
                club_id=su.club_id
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
        else:
            return None

    stmt = select(ActivePin).where(
        and_(
            ActivePin.holder_user_id == user.id,
            ActivePin.space_id == space_slug,
            ActivePin.revoked_at.is_(None),
            ActivePin.expires_at > now
        )
    ).order_by(ActivePin.expires_at.desc())

    result = await session.execute(stmt)
    pin = result.scalars().first()

    if not pin:
        return None

    remaining = max(0, int((pin.expires_at - now).total_seconds()))

    return ActivePinResponse(
        id=pin.id,
        pin_code=pin.pin_code,
        space_id=pin.space_id,
        holder_user_id=pin.holder_user_id,
        holder_name=user.name,
        holder_email=user.email,
        issued_by_name=pin.issued_by_name_snapshot,
        issued_by_email=pin.issued_by_email_snapshot,
        issued_at=pin.created_at,
        expires_at=pin.expires_at,
        is_revoked=pin.revoked_at is not None,
        remaining_seconds=remaining,
    )


@router.post("/verify-keypad", response_model=KeypadAttemptResponse)
async def verify_keypad_entry(
    payload: KeypadAttemptRequest,
    session: AsyncSession = Depends(get_db)
) -> KeypadAttemptResponse:
    """Hardware controller endpoint: validates 6-digit PIN submitted by door keypad."""
    granted, message, space_id = await PinService.verify_keypad_attempt(
        session=session,
        device_id=payload.device_id,
        pin_code=payload.pin_code
    )
    await session.commit()

    return KeypadAttemptResponse(
        granted=granted,
        message=message,
        space_slug=space_id,
        unlock_duration_seconds=5 if granted else 0
    )


@router.post("/{pin_id}/revoke", response_model=RevokePinResponse)
async def revoke_active_pin(
    pin_id: uuid.UUID,
    actor: Dict[str, Any] = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> RevokePinResponse:
    """Immediate Revocation Flow:
    
    Allows Admins (for any space) or SuperUsers (for spaces within their authority)
    to revoke an active key early. Marks revoked_at = NOW() and broadcasts REVOKE_PIN
    to the target ESP32 channel immediately.
    """
    revoked_pin = await PinService.revoke_pin(
        session=session,
        pin_id=pin_id,
        actor=actor,
    )
    await session.commit()

    return RevokePinResponse(
        id=revoked_pin.id,
        pin_code=revoked_pin.pin_code,
        space_id=revoked_pin.space_id,
        revoked_at=revoked_pin.revoked_at,
        message=f"PIN {revoked_pin.pin_code} for space {revoked_pin.space_id} successfully revoked."
    )


@router.post("/direct", response_model=ActivePinResponse)
async def create_direct_pin(
    payload: DirectPinCreateRequest,
    actor: Dict[str, Any] = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> ActivePinResponse:
    """Direct PIN issuance by SuperUser or Admin.

    Allows authorized authorities to generate a 6-digit numeric access PIN directly
    for an entrant, automatically enforcing unrevoked global uniqueness, setting TTL,
    logging ACCESS_GRANTED, and broadcasting ADD_PIN to ESP32.
    """
    active_pin = await PinService.direct_issue_pin(
        session=session,
        space_id=payload.space_id,
        entrant_email=payload.entrant_email,
        actor=actor,
        justification=payload.justification or "Direct access grant",
    )
    await session.commit()
    await session.refresh(active_pin)

    # Fetch entrant user
    user_stmt = select(User).where(User.id == active_pin.holder_user_id)
    user_res = await session.execute(user_stmt)
    user = user_res.scalar_one()

    now = utc_now()
    remaining = max(0, int((active_pin.expires_at - now).total_seconds()))

    is_self_pass = (user.email.lower().strip() == actor.get("email", "").lower().strip())
    can_view_raw = (actor.get("role") == "admin") or is_self_pass
    return ActivePinResponse(
        id=active_pin.id,
        pin_code=active_pin.pin_code if can_view_raw else "******",
        space_id=active_pin.space_id,
        holder_user_id=active_pin.holder_user_id,
        holder_name=user.name,
        holder_email=user.email,
        issued_by_name=active_pin.issued_by_name_snapshot,
        issued_by_email=active_pin.issued_by_email_snapshot,
        issued_at=active_pin.created_at,
        expires_at=active_pin.expires_at,
        is_revoked=False,
        remaining_seconds=remaining,
    )


@router.get("/active-list", response_model=List[ActivePinResponse])
async def list_active_pins_for_management(
    space_slug: str = Query(..., description="Target facility space slug"),
    actor: Dict[str, Any] = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> List[ActivePinResponse]:
    """Retrieve all current active, unrevoked PINs for a facility space (SuperUser/Admin view)."""
    role = actor.get("role")
    if role != "admin":
        su_stmt = select(SuperUser).where(SuperUser.email == actor.get("email"))
        su_res = await session.execute(su_stmt)
        su = su_res.scalar_one_or_none()
        if not su or not su.is_active or space_slug not in (su.allowed_spaces or []):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to inspect PINs for this facility space."
            )

    now = utc_now()
    records = await PinService.list_active_pins_for_space(session, space_slug)

    caller_email = actor.get("email", "").lower().strip()
    response = []
    for pin, user in records:
        remaining = max(0, int((pin.expires_at - now).total_seconds()))
        can_view_raw_pin = (role == "admin") or (user.email.lower().strip() == caller_email)
        response.append(
            ActivePinResponse(
                id=pin.id,
                pin_code=pin.pin_code if can_view_raw_pin else "******",
                space_id=pin.space_id,
                holder_user_id=pin.holder_user_id,
                holder_name=user.name,
                holder_email=user.email,
                issued_by_name=pin.issued_by_name_snapshot,
                issued_by_email=pin.issued_by_email_snapshot,
                issued_at=pin.created_at,
                expires_at=pin.expires_at,
                is_revoked=pin.revoked_at is not None,
                remaining_seconds=remaining,
            )
        )
    return response


@router.get("/active-keys", response_model=List[ActiveKeySummaryResponse])
async def list_active_keys_privacy(
    actor: Dict[str, Any] = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> List[ActiveKeySummaryResponse]:
    """SuperUser Active Keys Tab:
    
    Lists all users who currently hold active PINs across spaces.
    Scoped strictly to the caller's real-time facility authority:
    SuperUsers ONLY see active keys for spaces currently authorized in their database record.
    If authority is reduced or removed, unauthorized space keys are excluded immediately.
    PRIVACY RULE: Does NOT return the actual 6-digit PIN values!
    """
    now = utc_now()
    role = actor.get("role")
    auth_spaces: List[str] = []

    stmt = (
        select(ActivePin, User)
        .join(User, User.id == ActivePin.holder_user_id)
        .where(
            and_(
                ActivePin.revoked_at.is_(None),
                ActivePin.expires_at > now,
            )
        )
        .order_by(ActivePin.expires_at.asc())
    )

    if role != "admin":
        # Strictly verify real-time SuperUser authority against database
        su_stmt = select(SuperUser).where(SuperUser.email == actor.get("email"))
        su_res = await session.execute(su_stmt)
        su = su_res.scalar_one_or_none()
        if not su or not su.is_active or not su.allowed_spaces:
            return []
        auth_spaces = su.allowed_spaces or []
        stmt = stmt.where(ActivePin.space_id.in_(auth_spaces))

    res = await session.execute(stmt)
    records = res.all()

    results = []
    for pin, user in records:
        space_def = get_space_by_slug(pin.space_id)
        space_name = space_def.name if space_def else pin.space_id
        valid_till_str = f"{pin.expires_at.strftime('%a, ')}{pin.expires_at.strftime('%I:%M %p').lstrip('0')}"
        can_revoke = (role == "admin") or (pin.space_id in auth_spaces)

        results.append(
            ActiveKeySummaryResponse(
                id=pin.id,
                holder_name=user.name,
                holder_email=user.email,
                space_id=pin.space_id,
                space_name=space_name,
                expires_at=pin.expires_at,
                valid_till=valid_till_str,
                account_tag=get_account_tag(user.created_at),
                can_revoke=can_revoke,
            )
        )
    return results


@router.post("/revoke-all")
async def revoke_all_active_pins(
    space_slug: Optional[str] = Query(None, description="Optional facility space slug filter"),
    actor: Dict[str, Any] = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Revoke all currently active PINs within the caller's authorized spaces."""
    from backend.app.models.entry_log import EntryEventType
    from backend.app.services.log_service import LogService
    from backend.app.services.websocket_service import ws_manager
    from backend.app.services.esp32_service import ESP32Service

    now = utc_now()
    role = actor.get("role")
    allowed_spaces: Optional[List[str]] = None

    if role != "admin":
        su = (await session.execute(select(SuperUser).where(SuperUser.email == actor.get("email")))).scalar_one_or_none()
        if not su or not su.is_active or not su.allowed_spaces:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to revoke PINs."
            )
        allowed_spaces = list(su.allowed_spaces or [])
        if space_slug and space_slug not in allowed_spaces:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to revoke PINs for this facility space."
            )

    stmt = (
        select(ActivePin, User)
        .join(User, User.id == ActivePin.holder_user_id)
        .where(
            and_(
                ActivePin.revoked_at.is_(None),
                ActivePin.expires_at > now,
            )
        )
    )
    if space_slug:
        stmt = stmt.where(ActivePin.space_id == space_slug)
    elif allowed_spaces is not None:
        stmt = stmt.where(ActivePin.space_id.in_(allowed_spaces))

    rows = (await session.execute(stmt)).all()
    revoked_count = 0
    touched_spaces = set()

    for pin, user in rows:
        pin.revoked_at = now
        revoked_count += 1
        touched_spaces.add(pin.space_id)
        await ws_manager.broadcast(f"esp32:{pin.space_id}", {
            "action": "REVOKE_PIN",
            "space_id": pin.space_id,
            "pin": pin.pin_code,
        })
        await ESP32Service.enqueue_command(
            session=session,
            space_id=pin.space_id,
            command_type="REVOKE_PIN",
            payload={"pin": pin.pin_code},
        )
        await LogService.create_entry_log(
            session=session,
            event_type=EntryEventType.PIN_REVOKED,
            space_id=pin.space_id,
            actor_name=user.name,
            actor_email=user.email,
            authority_name=actor.get("name", "Authority"),
            authority_email=actor.get("email", "system"),
            pin_used=pin.pin_code,
            justification_snapshot="Bulk PIN revocation by authority",
        )

    await session.commit()

    for sp_id in touched_spaces:
        payload = {
            "action": "PIN_REVOKED_UI",
            "type": "PIN_REVOKED",
            "space_id": sp_id,
        }
        await ws_manager.broadcast(f"space:{sp_id}", payload)
    if touched_spaces:
        await ws_manager.broadcast("global", {
            "action": "PIN_LIST_UPDATED",
            "type": "PIN_LIST_UPDATED",
        })

    return {
        "status": "success",
        "revoked_count": revoked_count,
        "message": f"Revoked {revoked_count} active PIN(s).",
    }
