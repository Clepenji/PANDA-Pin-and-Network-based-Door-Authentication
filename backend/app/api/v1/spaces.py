"""Facility Spaces API Endpoints.

Provides dynamic space registry listing and operational status queries.
Never hardcodes floors; all views iterate dynamically over the central space registry.
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.db.session import get_db
from backend.app.db.base import utc_now
from backend.app.api.deps import get_current_actor, require_root_admin
from backend.app.services.space_service import SpaceService
from backend.app.config.spaces import get_space_by_slug
from backend.app.models.user import User
from backend.app.models.superuser import SuperUser
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.models.active_pin import ActivePin
from backend.app.models.access_request import AccessRequest, RequestStatus
from backend.app.schemas.space import SpaceResponse, SpaceStatusResponse, SpaceCreate, SpaceUpdate
from backend.app.schemas.auth import (
    UserSpaceCardResponse,
    ActivePinSummary,
    PendingRequestSummary,
    UserSpaceAssignmentCreate,
    UserSpaceAssignmentUpdate,
)
from backend.app.services.websocket_service import ws_manager
from backend.app.services.notification_service import NotificationService
from backend.app.services.request_cleanup_service import RequestCleanupService

router = APIRouter(prefix="/spaces", tags=["Facility Spaces"])


@router.get("", response_model=List[SpaceResponse])
async def list_facility_spaces(
    session: AsyncSession = Depends(get_db)
) -> List[SpaceResponse]:
    """Retrieve all operational Facility Spaces configured in the system."""
    return await SpaceService.get_all_spaces(session)


@router.get("/status", response_model=List[SpaceStatusResponse])
async def list_spaces_status(
    session: AsyncSession = Depends(get_db)
) -> List[SpaceStatusResponse]:
    """Retrieve dynamic real-time operational status for each facility space.

    Calculates active valid PINs and pending request counts dynamically.
    """
    return await SpaceService.get_all_spaces_status(session)


@router.get("/{slug}", response_model=SpaceResponse)
async def get_facility_space(
    slug: str,
    session: AsyncSession = Depends(get_db)
) -> SpaceResponse:
    """Retrieve details of a single Facility Space by slug."""
    space = await SpaceService.get_space_by_slug(session, slug)
    if not space:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Facility Space '{slug}' not found."
        )
    return space


@router.post("", response_model=SpaceResponse, status_code=status.HTTP_201_CREATED)
async def create_facility_space(
    payload: SpaceCreate,
    current_root_admin: Dict[str, Any] = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db),
) -> SpaceResponse:
    """Register a new Facility Space and its ESP32 controller.

    RESTRICTED: Strictly only the Master Root Administrator (is_root=True) can register new facility spaces.
    Secondary administrators and all other roles are rejected with 403 Forbidden.
    """
    return await SpaceService.create_space(
        session=session,
        slug=payload.slug,
        name=payload.name,
        esp32_device_id=payload.esp32_device_id,
        lock_name=getattr(payload, 'lock_name', None) or "Main Door",
        is_active=payload.is_active,
    )


@router.put("/{slug}", response_model=SpaceResponse, status_code=status.HTTP_200_OK)
async def update_facility_space(
    slug: str,
    payload: SpaceUpdate,
    current_root_admin: Dict[str, Any] = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db),
) -> SpaceResponse:
    """Update properties of an existing Facility Space (Root Admin only).

    RESTRICTED: Strictly only the Master Root Administrator (is_root=True) can edit facility spaces.
    """
    return await SpaceService.update_space(
        session=session,
        slug=slug,
        name=payload.name,
        is_active=payload.is_active,
        esp32_device_id=payload.esp32_device_id,
    )


@router.delete("/{slug}", status_code=status.HTTP_200_OK)
async def delete_facility_space(
    slug: str,
    current_root_admin: Dict[str, Any] = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Remove a Facility Space and its associated ESP32 controller.

    RESTRICTED: Strictly only the Master Root Administrator (is_root=True) can remove facility spaces.
    """
    admin_email = current_root_admin["email"]
    await SpaceService.remove_space(session, slug, admin_email)
    return {
        "status": "success",
        "message": f"Facility Space '{slug}' and its associated ESP32 controller removed successfully.",
        "space_slug": slug,
    }


@router.get("/user/assignments", response_model=List[UserSpaceCardResponse])
async def list_user_space_assignments(
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> List[UserSpaceCardResponse]:
    """Retrieve all Facility Spaces the authenticated user is registered for with active PINs and pending requests."""
    # 0. Prune expired requests exceeding dynamic PIN validity lifespan
    await RequestCleanupService.cleanup_expired_requests(session)

    email = actor["email"]
    now = utc_now()

    user_res = await session.execute(select(User).where(User.email == email))
    user = user_res.scalar_one_or_none()

    # If actor is a SuperUser, auto-sync their User record if missing
    su_stmt = select(SuperUser).where(SuperUser.email == email)
    su_res = await session.execute(su_stmt)
    su = su_res.scalar_one_or_none()

    if not user and su:
        user = User(
            email=su.email,
            name=su.name,
            phone=su.phone or "0000000000",
            club_id=su.club_id,
        )
        session.add(user)
        await session.flush()

    if not user:
        return []

    # If SuperUser, ensure UserSpaceAssignment exists for each space in allowed_spaces
    if su and su.allowed_spaces:
        for s_slug in su.allowed_spaces:
            check_stmt = select(UserSpaceAssignment).where(
                and_(
                    UserSpaceAssignment.user_id == user.id,
                    UserSpaceAssignment.space_id == s_slug,
                )
            )
            c_res = await session.execute(check_stmt)
            if not c_res.scalar_one_or_none():
                session.add(
                    UserSpaceAssignment(
                        user_id=user.id,
                        space_id=s_slug,
                        superuser_id=su.id,
                    )
                )
        await session.commit()

    # Query all space assignments for this user
    assign_stmt = (
        select(UserSpaceAssignment, SuperUser)
        .outerjoin(SuperUser, SuperUser.id == UserSpaceAssignment.superuser_id)
        .where(UserSpaceAssignment.user_id == user.id)
        .order_by(UserSpaceAssignment.created_at.asc())
    )
    assign_res = await session.execute(assign_stmt)
    records = assign_res.all()

    cards: List[UserSpaceCardResponse] = []
    for assignment, superuser in records:
        space_def = get_space_by_slug(assignment.space_id)
        space_name = space_def.name if space_def else assignment.space_id

        # Check for active valid PIN for this space
        pin_stmt = select(ActivePin).where(
            and_(
                ActivePin.holder_user_id == user.id,
                ActivePin.space_id == assignment.space_id,
                ActivePin.revoked_at.is_(None),
                ActivePin.expires_at > now,
            )
        ).order_by(ActivePin.expires_at.desc())
        pin_res = await session.execute(pin_stmt)
        active_pin = pin_res.scalars().first()

        active_pin_summary = None
        if active_pin:
            valid_till_str = f"{active_pin.expires_at.strftime('%a, ')}{active_pin.expires_at.strftime('%I:%M %p').lstrip('0')}"
            active_pin_summary = ActivePinSummary(
                id=active_pin.id,
                pin_code=active_pin.pin_code,
                expires_at=active_pin.expires_at,
                valid_till=valid_till_str,
            )

        # Check for pending request for this space
        req_stmt = select(AccessRequest).where(
            and_(
                AccessRequest.requester_user_id == user.id,
                AccessRequest.space_id == assignment.space_id,
                AccessRequest.status == RequestStatus.PENDING,
            )
        ).order_by(AccessRequest.created_at.desc())
        req_res = await session.execute(req_stmt)
        pending_req = req_res.scalars().first()

        pending_summary = None
        if pending_req:
            pending_summary = PendingRequestSummary(
                id=pending_req.id,
                justification=pending_req.justification,
                created_at=pending_req.created_at,
            )

        cards.append(
            UserSpaceCardResponse(
                space_id=assignment.space_id,
                space_name=space_name,
                assigned_superuser_id=superuser.id if superuser else None,
                assigned_superuser_name=superuser.name if superuser else "No Lead Assigned",
                assigned_superuser_phone=superuser.phone if superuser else None,
                active_pin=active_pin_summary,
                pending_request=pending_summary,
                status=getattr(assignment, "status", "APPROVED") or "APPROVED",
            )
        )

    return cards


@router.post("/user/assignments", response_model=UserSpaceCardResponse)
async def create_user_space_assignment(
    payload: UserSpaceAssignmentCreate,
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> UserSpaceCardResponse:
    """Register for an additional Facility Space one by one from dashboard."""
    email = actor["email"]
    user_res = await session.execute(select(User).where(User.email == email))
    user = user_res.scalar_one_or_none()
    if not user:
        su_res = await session.execute(select(SuperUser).where(SuperUser.email == email))
        su = su_res.scalar_one_or_none()
        if su:
            user = User(
                email=su.email,
                name=su.name,
                phone=su.phone or "0000000000",
                club_id=su.club_id
            )
            session.add(user)
            await session.flush()
        else:
            raise HTTPException(status_code=404, detail="User account not found.")

    # Check if already registered for this space
    existing_stmt = select(UserSpaceAssignment).where(
        and_(
            UserSpaceAssignment.user_id == user.id,
            UserSpaceAssignment.space_id == payload.space_id,
        )
    )
    existing_res = await session.execute(existing_stmt)
    if existing_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already registered for this Facility Space."
        )

    assignment = UserSpaceAssignment(
        user_id=user.id,
        space_id=payload.space_id,
        superuser_id=payload.assigned_superuser_id,
        status="PENDING",
    )
    session.add(assignment)

    # Create Registration AccessRequest for SuperUser review in Requests Tab
    reg_req = AccessRequest(
        requester_user_id=user.id,
        space_id=payload.space_id,
        superuser_id=payload.assigned_superuser_id,
        justification=f"Space Membership Registration: {user.name} ({user.college_year})",
        request_type="REGISTRATION",
        status=RequestStatus.PENDING,
    )
    session.add(reg_req)
    await session.commit()
    await session.refresh(assignment)
    await session.refresh(reg_req)

    target_su_email = None
    if payload.assigned_superuser_id:
        su_em_row = (await session.execute(
            select(SuperUser.email).where(SuperUser.id == payload.assigned_superuser_id)
        )).scalar_one_or_none()
        if su_em_row:
            target_su_email = su_em_row.lower().strip()

    # Broadcast notification to SuperUsers on WebSocket
    await ws_manager.broadcast_space_event(
        space_slug=payload.space_id,
        event_type="ACCESS_REQUEST_SUBMITTED",
        data={
            "id": str(reg_req.id),
            "space_id": payload.space_id,
            "target_superuser_id": str(payload.assigned_superuser_id) if payload.assigned_superuser_id else None,
            "target_superuser_email": target_su_email,
            "requester_email": user.email,
            "requester_name": user.name,
            "justification": reg_req.justification,
            "request_type": "REGISTRATION",
            "created_at": reg_req.created_at.isoformat(),
        }
    )

    try:
        await NotificationService.notify_superusers_new_request(
            session=session,
            space_id=payload.space_id,
            requester_name=user.name,
            justification=f"Space Registration: {user.name} requesting access",
            target_su_id=payload.assigned_superuser_id,
        )
    except Exception:
        pass

    space_def = get_space_by_slug(payload.space_id)
    space_name = space_def.name if space_def else payload.space_id

    su_name = None
    su_phone = None
    if payload.assigned_superuser_id:
        su_res = await session.execute(select(SuperUser).where(SuperUser.id == payload.assigned_superuser_id))
        su = su_res.scalar_one_or_none()
        if su:
            su_name = su.name
            su_phone = su.phone

    pending_summary = PendingRequestSummary(
        id=reg_req.id,
        justification=reg_req.justification,
        created_at=reg_req.created_at,
    )

    return UserSpaceCardResponse(
        space_id=assignment.space_id,
        space_name=space_name,
        assigned_superuser_id=assignment.superuser_id,
        assigned_superuser_name=su_name or "No Lead Assigned",
        assigned_superuser_phone=su_phone,
        active_pin=None,
        pending_request=pending_summary,
        status="PENDING",
    )


@router.put("/user/assignments/{space_id}", response_model=UserSpaceCardResponse)
async def update_user_space_assignment(
    space_id: str,
    payload: UserSpaceAssignmentUpdate,
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> UserSpaceCardResponse:
    """Switch assigned SuperUser for a Facility Space without creating duplicate assignments."""
    email = actor["email"]
    user_res = await session.execute(select(User).where(User.email == email))
    user = user_res.scalar_one_or_none()
    if not user:
        su_res = await session.execute(select(SuperUser).where(SuperUser.email == email))
        su = su_res.scalar_one_or_none()
        if su:
            user = User(
                email=su.email,
                name=su.name,
                phone=su.phone or "0000000000",
                club_id=su.club_id
            )
            session.add(user)
            await session.flush()
        else:
            raise HTTPException(status_code=404, detail="User account not found.")

    assign_stmt = select(UserSpaceAssignment).where(
        and_(
            UserSpaceAssignment.user_id == user.id,
            UserSpaceAssignment.space_id == space_id,
        )
    )
    assign_res = await session.execute(assign_stmt)
    assignment = assign_res.scalar_one_or_none()

    if not assignment:
        raise HTTPException(status_code=404, detail="Space assignment not found.")

    lead_changed = assignment.superuser_id != payload.assigned_superuser_id
    assignment.superuser_id = payload.assigned_superuser_id

    now = utc_now()
    if lead_changed:
        # Invalidate all active PINs for this user in this space
        pins_res = await session.execute(
            select(ActivePin).where(
                and_(
                    ActivePin.holder_user_id == user.id,
                    ActivePin.space_id == space_id,
                    ActivePin.revoked_at.is_(None),
                    ActivePin.expires_at > now,
                )
            )
        )
        old_pins = pins_res.scalars().all()
        if old_pins:
            from backend.app.services.esp32_service import ESP32Service
            from backend.app.services.log_service import LogService
            from backend.app.models.entry_log import EntryEventType
            for p in old_pins:
                p.revoked_at = now
                await ws_manager.broadcast(f"esp32:{space_id}", {
                    "action": "REVOKE_PIN",
                    "space_id": space_id,
                    "pin": p.pin_code,
                })
                await ESP32Service.enqueue_command(
                    session=session,
                    space_id=space_id,
                    command_type="REVOKE_PIN",
                    payload={"pin": p.pin_code},
                )
                await LogService.create_entry_log(
                    session=session,
                    event_type=EntryEventType.PIN_REVOKED,
                    space_id=space_id,
                    actor_name=user.name,
                    actor_email=user.email,
                    authority_name=user.name,
                    authority_email=user.email,
                    pin_used=p.pin_code,
                    justification_snapshot="PIN invalidated: supervising lead changed",
                )

        # Remove any pending ACCESS requests so the user must submit a fresh request to the new lead
        await session.execute(
            delete(AccessRequest).where(
                and_(
                    AccessRequest.requester_user_id == user.id,
                    AccessRequest.space_id == space_id,
                    AccessRequest.status == RequestStatus.PENDING,
                    AccessRequest.request_type == "ACCESS",
                )
            )
        )
        # Re-route any pending REGISTRATION request to the new lead
        pending_regs = (await session.execute(
            select(AccessRequest).where(
                and_(
                    AccessRequest.requester_user_id == user.id,
                    AccessRequest.space_id == space_id,
                    AccessRequest.status == RequestStatus.PENDING,
                    AccessRequest.request_type == "REGISTRATION",
                )
            )
        )).scalars().all()
        for reg_r in pending_regs:
            reg_r.superuser_id = payload.assigned_superuser_id

    await session.commit()
    await session.refresh(assignment)

    if lead_changed:
        await ws_manager.broadcast("global", {
            "event_type": "PIN_LIST_UPDATED",
            "type": "PIN_LIST_UPDATED",
            "space_id": space_id,
        })
        await ws_manager.broadcast("global", {
            "event_type": "USER_DIRECTORY_UPDATED",
            "type": "USER_DIRECTORY_UPDATED",
        })

    space_def = get_space_by_slug(space_id)
    space_name = space_def.name if space_def else space_id

    su_name = None
    su_phone = None
    if payload.assigned_superuser_id:
        su_res = await session.execute(select(SuperUser).where(SuperUser.id == payload.assigned_superuser_id))
        su = su_res.scalar_one_or_none()
        if su:
            su_name = su.name
            su_phone = su.phone

    # Check active PIN (will be None if lead_changed)
    pin_stmt = select(ActivePin).where(
        and_(
            ActivePin.holder_user_id == user.id,
            ActivePin.space_id == space_id,
            ActivePin.revoked_at.is_(None),
            ActivePin.expires_at > now,
        )
    ).order_by(ActivePin.expires_at.desc())
    pin_res = await session.execute(pin_stmt)
    active_pin = pin_res.scalar_one_or_none()

    active_pin_summary = None
    if active_pin:
        active_pin_summary = ActivePinSummary(
            id=active_pin.id,
            pin_code=active_pin.pin_code,
            expires_at=active_pin.expires_at,
            valid_till=f"{active_pin.expires_at.strftime('%a, ')}{active_pin.expires_at.strftime('%I:%M %p').lstrip('0')}",
        )

    return UserSpaceCardResponse(
        space_id=assignment.space_id,
        space_name=space_name,
        assigned_superuser_id=assignment.superuser_id,
        assigned_superuser_name=su_name or "No Lead Assigned",
        assigned_superuser_phone=su_phone,
        active_pin=active_pin_summary,
        pending_request=None,
    )
