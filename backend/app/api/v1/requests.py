"""Access Requests API Endpoints.

Handles submission, listing, and SuperUser adjudication of access requests
with strict attribution preservation.
"""

import uuid
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.db.session import get_db
from backend.app.db.base import utc_now
from backend.app.api.deps import get_current_actor, require_superuser_or_admin
from backend.app.models.user import User
from backend.app.models.superuser import SuperUser
from backend.app.models.club import Club
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.models.access_request import AccessRequest, RequestStatus
from backend.app.models.active_pin import ActivePin
from backend.app.models.entry_log import EntryEventType
from backend.app.schemas.access_request import (
    AccessRequestCreate,
    AccessRequestDecision,
    AccessRequestResponse,
)
from backend.app.services.pin_service import PinService
from backend.app.services.log_service import LogService
from backend.app.services.websocket_service import ws_manager
from backend.app.services.notification_service import NotificationService
from backend.app.services.request_cleanup_service import RequestCleanupService

router = APIRouter(prefix="/requests", tags=["Access Requests"])


@router.post("", response_model=AccessRequestResponse)
async def create_access_request(
    payload: AccessRequestCreate,
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> AccessRequestResponse:
    """Submit a formal justification for room access to a designated Facility Space."""
    # 1. Resolve User entity
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
            await session.flush()
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Entrant profile not found. Please log in first."
            )

    # 2. Check for assigned SuperUser (either explicit payload or from user_space_assignments)
    assign_stmt = select(UserSpaceAssignment).where(
        and_(
            UserSpaceAssignment.user_id == user.id,
            UserSpaceAssignment.space_id == payload.space_slug
        )
    )
    assign_res = await session.execute(assign_stmt)
    assignment = assign_res.scalar_one_or_none()
    if actor.get("role") == "user":
        if not assignment:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not registered for this Facility Space."
            )
        if assignment.status == "PENDING":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Your registration for this Facility Space is awaiting approval from your space lead."
            )
        if assignment.status == "REJECTED":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your registration for this Facility Space was declined."
            )
    elif assignment and assignment.status == "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your registration for this Facility Space is awaiting approval from your space lead."
        )

    # Resolve and strictly validate target SuperUser: must exist, be active, have authority
    # over payload.space_slug, and MUST NOT be the requester themselves.
    target_su_id: Optional[uuid.UUID] = None
    requester_email_clean = user.email.lower().strip()

    if payload.target_superuser_id:
        su_res = await session.execute(select(SuperUser).where(SuperUser.id == payload.target_superuser_id))
        cand_su = su_res.scalar_one_or_none()
        if (
            not cand_su
            or not cand_su.is_active
            or cand_su.email.lower().strip() == requester_email_clean
            or payload.space_slug not in (cand_su.allowed_spaces or [])
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selected Supervising Lead does not have authority over this Facility Space."
            )
        target_su_id = cand_su.id
        if assignment and assignment.superuser_id != cand_su.id:
            assignment.superuser_id = cand_su.id
    elif assignment and assignment.superuser_id:
        su_res = await session.execute(select(SuperUser).where(SuperUser.id == assignment.superuser_id))
        assigned_su = su_res.scalar_one_or_none()
        if (
            assigned_su
            and assigned_su.is_active
            and assigned_su.email.lower().strip() != requester_email_clean
            and payload.space_slug in (assigned_su.allowed_spaces or [])
        ):
            target_su_id = assigned_su.id
        else:
            # Stale assignment (SuperUser lost authority or points to self) -> heal to another active authorized lead or None
            all_sus = (await session.execute(select(SuperUser).where(SuperUser.is_active.is_(True)))).scalars().all()
            fallback_su = next(
                (s for s in all_sus if s.email.lower().strip() != requester_email_clean and payload.space_slug in (s.allowed_spaces or [])),
                None
            )
            target_su_id = fallback_su.id if fallback_su else None
            assignment.superuser_id = target_su_id

    # 3. Immediately disable any current active PIN for this user & space when regenerating
    now_ts = utc_now()
    active_pins_res = await session.execute(
        select(ActivePin).where(
            and_(
                ActivePin.holder_user_id == user.id,
                ActivePin.space_id == payload.space_slug,
                ActivePin.revoked_at.is_(None),
                ActivePin.expires_at > now_ts,
            )
        )
    )
    existing_active_pins = active_pins_res.scalars().all()
    if existing_active_pins:
        from backend.app.services.esp32_service import ESP32Service
        for old_pin in existing_active_pins:
            old_pin.revoked_at = now_ts
            await ws_manager.broadcast(f"esp32:{payload.space_slug}", {
                "action": "REVOKE_PIN",
                "space_id": payload.space_slug,
                "pin": old_pin.pin_code,
            })
            await ESP32Service.enqueue_command(
                session=session,
                space_id=payload.space_slug,
                command_type="REVOKE_PIN",
                payload={"pin": old_pin.pin_code},
            )
            await LogService.create_entry_log(
                session=session,
                event_type=EntryEventType.PIN_REVOKED,
                space_id=payload.space_slug,
                actor_name=user.name,
                actor_email=user.email,
                authority_name=user.name,
                authority_email=user.email,
                pin_used=old_pin.pin_code,
                justification_snapshot="PIN disabled: user requested PIN regeneration",
            )
        revoke_ui_payload = {
            "action": "PIN_REVOKED_UI",
            "type": "PIN_REVOKED",
            "space_id": payload.space_slug,
            "holder_email": user.email,
        }
        await ws_manager.broadcast(f"space:{payload.space_slug}", revoke_ui_payload)
        await ws_manager.broadcast("global", revoke_ui_payload)

    # 4. Create request record
    access_req = AccessRequest(
        requester_user_id=user.id,
        space_id=payload.space_slug,
        superuser_id=target_su_id,
        justification=payload.justification,
        status=RequestStatus.PENDING,
        request_type="ACCESS",
    )
    session.add(access_req)
    await session.commit()
    await session.refresh(access_req)

    target_su_email = None
    if target_su_id:
        su_row = (await session.execute(select(SuperUser.email).where(SuperUser.id == target_su_id))).scalar_one_or_none()
        if su_row:
            target_su_email = su_row.lower().strip()

    # Broadcast notification to SuperUsers on WebSocket
    await ws_manager.broadcast_space_event(
        space_slug=payload.space_slug,
        event_type="ACCESS_REQUEST_SUBMITTED",
        data={
            "id": str(access_req.id),
            "space_id": payload.space_slug,
            "target_superuser_id": str(target_su_id) if target_su_id else None,
            "target_superuser_email": target_su_email,
            "requester_email": user.email,
            "requester_name": user.name,
            "justification": payload.justification,
            "created_at": access_req.created_at.isoformat(),
        }
    )

    # Dispatch background Web Push notification to assigned SuperUsers
    try:
        await NotificationService.notify_superusers_new_request(
            session=session,
            space_id=payload.space_slug,
            requester_name=user.name,
            justification=payload.justification,
            target_su_id=target_su_id,
        )
    except Exception:
        # Non-fatal: Push delivery issues should never fail request submission
        pass

    return AccessRequestResponse(
        id=access_req.id,
        requester_user_id=user.id,
        requester_email=user.email,
        requester_name=user.name,
        requester_phone=user.phone,
        requester_college_year=getattr(user, "college_year", "Not Applicable"),
        space_id=access_req.space_id,
        superuser_id=access_req.superuser_id,
        justification=access_req.justification,
        status=access_req.status,
        request_type=access_req.request_type,
        created_at=access_req.created_at,
        resolved_at=access_req.resolved_at,
    )


@router.get("", response_model=List[AccessRequestResponse])
async def list_access_requests(
    space_slug: Optional[str] = Query(None, description="Filter by space slug"),
    status_filter: Optional[RequestStatus] = Query(None, description="Filter by status"),
    scope: Optional[str] = Query(None, description="'own' for entrant's requests, 'supervised' for review"),
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> List[AccessRequestResponse]:
    """List access requests visible to the caller (own requests or supervised requests)."""
    # 0. Prune any expired requests exceeding dynamic PIN validity lifespan
    await RequestCleanupService.cleanup_expired_requests(session)

    stmt = (
        select(AccessRequest, User, Club)
        .join(User, User.id == AccessRequest.requester_user_id)
        .outerjoin(Club, Club.id == User.club_id)
    )

    # If actor is user, or explicitly requesting 'own' scope, filter by own email
    if actor["role"] == "user" or scope == "own":
        stmt = stmt.where(User.email == actor["email"])
    elif actor["role"] == "superuser":
        # SuperUser reviewing incoming requests: filter to requests explicitly designated to this SuperUser
        su_res = await session.execute(select(SuperUser).where(SuperUser.email == actor["email"]))
        su = su_res.scalar_one_or_none()
        if su and su.allowed_spaces:
            stmt = stmt.where(
                and_(
                    User.email != actor["email"],
                    AccessRequest.space_id.in_(su.allowed_spaces),
                    or_(
                        AccessRequest.superuser_id == su.id,
                        AccessRequest.superuser_id.is_(None),
                    )
                )
            )
        else:
            # Inactive superuser or zero spaces -> cannot review requests
            stmt = stmt.where(AccessRequest.id == uuid.UUID(int=0))

    if space_slug:
        stmt = stmt.where(AccessRequest.space_id == space_slug)

    if status_filter:
        stmt = stmt.where(AccessRequest.status == status_filter)

    stmt = stmt.order_by(AccessRequest.created_at.desc())
    result = await session.execute(stmt)
    records = result.all()

    response = []
    for req, u, club in records:
        response.append(
            AccessRequestResponse(
                id=req.id,
                requester_user_id=u.id,
                requester_email=u.email,
                requester_name=u.name,
                requester_phone=u.phone,
                requester_college_year=getattr(u, "college_year", "Not Applicable"),
                club_name=club.name if club else None,
                space_id=req.space_id,
                superuser_id=req.superuser_id,
                justification=req.justification,
                status=req.status,
                request_type=getattr(req, "request_type", "ACCESS") or "ACCESS",
                created_at=req.created_at,
                resolved_at=req.resolved_at,
            )
        )
    return response


@router.post("/{request_id}/decision", response_model=AccessRequestResponse)
async def adjudicate_access_request(
    request_id: uuid.UUID,
    decision: AccessRequestDecision,
    actor: Dict[str, Any] = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> AccessRequestResponse:
    """SuperUser or Admin adjudicates a pending access request (APPROVE or REJECT).

    Attribution Bug Prevention:
    Always preserves immutable authority snapshots (authority_name, authority_email)
    derived strictly from the reviewing SuperUser's credentials. A user request
    never appears as self-approved.
    """
    stmt = select(AccessRequest, User).join(
        User, User.id == AccessRequest.requester_user_id
    ).where(AccessRequest.id == request_id)
    result = await session.execute(stmt)
    row = result.first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access request not found."
        )

    req, user = row

    if req.status != RequestStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot resolve request already marked {req.status.value}."
        )

    now = utc_now()
    req.status = decision.status
    req.resolved_at = now

    # Resolve approving superuser ID if actor is superuser and verify real-time space authority
    su_stmt = select(SuperUser).where(SuperUser.email == actor["email"])
    su_res = await session.execute(su_stmt)
    su = su_res.scalar_one_or_none()
    if actor.get("role") == "superuser":
        if not su or not su.is_active or req.space_id not in (su.allowed_spaces or []):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to adjudicate requests for this Facility Space."
            )
        if user.email.lower().strip() == actor["email"].lower().strip():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot self-approve your own access request."
            )
    approver_id = su.id if su else None
    req.superuser_id = approver_id

    if getattr(req, "request_type", "ACCESS") == "REGISTRATION":
        # Handle New Entrant Registration / Space Membership Adjudication
        assign_stmt = select(UserSpaceAssignment).where(
            and_(
                UserSpaceAssignment.user_id == user.id,
                UserSpaceAssignment.space_id == req.space_id,
            )
        )
        assign_res = await session.execute(assign_stmt)
        assignment = assign_res.scalar_one_or_none()

        if decision.status == RequestStatus.APPROVED:
            if assignment:
                assignment.status = "APPROVED"
                if approver_id:
                    assignment.superuser_id = approver_id

            # Log registration acceptance
            await LogService.create_entry_log(
                session=session,
                event_type=EntryEventType.REG_ACCEPTED,
                space_id=req.space_id,
                actor_name=user.name,
                actor_email=user.email,
                authority_name=actor["name"],
                authority_email=actor["email"],
                pin_used=None,
                justification_snapshot=f"Registration Accepted: {req.justification}",
            )

            # Broadcast approval event
            await ws_manager.broadcast_space_event(
                space_slug=req.space_id,
                event_type="REGISTRATION_APPROVED",
                data={
                    "request_id": str(req.id),
                    "user_id": str(user.id),
                    "holder_email": user.email,
                    "space_id": req.space_id,
                }
            )
        elif decision.status == RequestStatus.REJECTED:
            if assignment:
                await session.delete(assignment)

            # Log registration rejection
            await LogService.create_entry_log(
                session=session,
                event_type=EntryEventType.REQUEST_REJECTED,
                space_id=req.space_id,
                actor_name=user.name,
                actor_email=user.email,
                authority_name=actor["name"],
                authority_email=actor["email"],
                justification_snapshot=f"Registration Rejected: {req.justification}",
            )

            # Broadcast rejection event
            await ws_manager.broadcast_space_event(
                space_slug=req.space_id,
                event_type="REGISTRATION_REJECTED",
                data={
                    "request_id": str(req.id),
                    "user_id": str(user.id),
                    "holder_email": user.email,
                    "space_id": req.space_id,
                }
            )

    elif decision.status == RequestStatus.APPROVED:
        # Standard ACCESS pass request: Issue 6-digit PIN with guaranteed global unrevoked uniqueness
        active_pin = await PinService.issue_pin_for_grant(
            session=session,
            space_id=req.space_id,
            holder_user_id=user.id,
            issued_by_superuser_id=approver_id,
            issued_by_name=actor["name"],
            issued_by_email=actor["email"],
        )

        # Log ACCESS_GRANTED in entry_logs with permanent immutable snapshots
        await LogService.create_entry_log(
            session=session,
            event_type=EntryEventType.ACCESS_GRANTED,
            space_id=req.space_id,
            actor_name=user.name,
            actor_email=user.email,
            authority_name=actor["name"],
            authority_email=actor["email"],
            pin_used=active_pin.pin_code,
            justification_snapshot=req.justification,
        )

        # Broadcast approval notification (PRIVACY: never expose raw PIN over space/global broadcast)
        await ws_manager.broadcast_space_event(
            space_slug=req.space_id,
            event_type="ACCESS_REQUEST_APPROVED",
            data={
                "request_id": str(req.id),
                "holder_email": user.email,
                "space_id": req.space_id,
                "expires_at": active_pin.expires_at.isoformat(),
            }
        )

    elif decision.status == RequestStatus.REJECTED:
        # Log REQUEST_REJECTED in entry_logs with permanent immutable snapshots
        await LogService.create_entry_log(
            session=session,
            event_type=EntryEventType.REQUEST_REJECTED,
            space_id=req.space_id,
            actor_name=user.name,
            actor_email=user.email,
            authority_name=actor["name"],
            authority_email=actor["email"],
            justification_snapshot=req.justification,
        )

        # Broadcast rejection event
        await ws_manager.broadcast_space_event(
            space_slug=req.space_id,
            event_type="ACCESS_REQUEST_REJECTED",
            data={
                "request_id": str(req.id),
                "holder_email": user.email,
                "space_id": req.space_id,
            }
        )

    await session.commit()
    await session.refresh(req)

    # Dispatch targeted Web Push notification only to the requester
    try:
        from backend.app.config.spaces import get_space_by_slug
        sp_obj = get_space_by_slug(req.space_id)
        sp_name = sp_obj.name if sp_obj else req.space_id
        is_reg = getattr(req, "request_type", "ACCESS") == "REGISTRATION"
        if decision.status == RequestStatus.APPROVED:
            await NotificationService.notify_user_event(
                session=session,
                target_email=user.email,
                title=f"{'Registration' if is_reg else 'Access'} Approved: {sp_name}",
                body="Your space registration has been approved." if is_reg else "Your 6-digit door PIN is now active.",
                tag="request-approved",
            )
        elif decision.status == RequestStatus.REJECTED:
            await NotificationService.notify_user_event(
                session=session,
                target_email=user.email,
                title=f"{'Registration' if is_reg else 'Access'} Denied: {sp_name}",
                body=f"Your {'registration' if is_reg else 'access request'} was declined.",
                tag="request-rejected",
            )
    except Exception:
        pass

    return AccessRequestResponse(
        id=req.id,
        requester_user_id=user.id,
        requester_email=user.email,
        requester_name=user.name,
        requester_phone=user.phone,
        requester_college_year=getattr(user, "college_year", "Not Applicable"),
        space_id=req.space_id,
        superuser_id=req.superuser_id,
        justification=req.justification,
        status=req.status,
        request_type=getattr(req, "request_type", "ACCESS") or "ACCESS",
        created_at=req.created_at,
        resolved_at=req.resolved_at,
    )


@router.delete("/{request_id}")
async def delete_access_request(
    request_id: uuid.UUID,
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Delete an access request submitted by mistake.

    Allowed callers:
    1. The requester themselves (User or SuperUser entrant).
    2. The designated supervising SuperUser (or a SuperUser with authority in that space).
    3. An Admin.
    """
    stmt = select(AccessRequest).where(AccessRequest.id == request_id)
    res = await session.execute(stmt)
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access request not found."
        )

    # Check authorization
    is_authorized = False
    if actor["role"] == "admin":
        is_authorized = True
    elif actor["role"] == "superuser":
        su_res = await session.execute(select(SuperUser).where(SuperUser.email == actor["email"]))
        su = su_res.scalar_one_or_none()
        if su:
            if (
                req.superuser_id == su.id
                or req.space_id in (su.allowed_spaces or [])
                or req.requester_user_id == su.id
            ):
                is_authorized = True
    elif actor["role"] == "user":
        u_res = await session.execute(select(User).where(User.email == actor["email"]))
        user = u_res.scalar_one_or_none()
        if user and req.requester_user_id == user.id:
            is_authorized = True

    if not is_authorized:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to delete this access request."
        )

    space_id = req.space_id
    req_type = getattr(req, "request_type", "ACCESS") or "ACCESS"
    requester_uid = req.requester_user_id
    await session.delete(req)

    # If deleting a REGISTRATION request, also remove the pending/rejected space assignment
    if req_type == "REGISTRATION":
        await session.execute(
            delete(UserSpaceAssignment).where(
                and_(
                    UserSpaceAssignment.user_id == requester_uid,
                    UserSpaceAssignment.space_id == space_id,
                    UserSpaceAssignment.status.in_([AssignmentStatus.PENDING, AssignmentStatus.REJECTED]),
                )
            )
        )

    await session.commit()

    # Broadcast cancellation/deletion event
    await ws_manager.broadcast_space_event(
        space_slug=space_id,
        event_type="ACCESS_REQUEST_DELETED",
        data={"request_id": str(request_id), "space_id": space_id, "request_type": req_type}
    )
    if req_type == "REGISTRATION":
        await ws_manager.broadcast("global", {
            "event_type": "USER_DIRECTORY_UPDATED",
            "type": "USER_DIRECTORY_UPDATED",
        })

    return {
        "status": "success",
        "message": "Access request deleted successfully.",
        "request_id": str(request_id)
    }
