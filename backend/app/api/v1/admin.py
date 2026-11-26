"""Admin Portal, Analytics, Directory and Cluster Graph API Endpoints.

Provides administrative APIs for:
1. Operational metrics strip (Total Users, Weekly Entries per Space, Avg Requests/Day)
2. Admin account management with strict Root Admin protection (rehankuriance@gmail.com)
3. SuperUser registration, space authority modification, and revocation
4. Sortable User & SuperUser Directory with July 15-Sept 1 cohort tags
5. Interactive Affiliation Cluster Graph data (strictly excluding Admins)
"""

import uuid
import hashlib
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy import select, func, and_, or_, delete
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.db.session import get_db
from backend.app.db.base import utc_now
from backend.app.api.deps import require_admin, require_root_admin, require_superuser_or_admin
from backend.app.api.v1.auth import validate_email_domain
from backend.app.models.admin import Admin
from backend.app.models.superuser import SuperUser
from backend.app.models.user import User
from backend.app.models.club import Club
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.models.entry_log import EntryLog, EntryEventType
from backend.app.models.access_request import AccessRequest
from backend.app.models.active_pin import ActivePin
from backend.app.models.esp32_device import ESP32Device
from backend.app.models.esp32_firmware import ESP32FirmwareRelease
from backend.app.services.esp32_service import ESP32Service, esp32_manager
from backend.app.schemas.admin import (
    AdminAccountResponse,
    AdminCreateRequest,
    SuperUserCreateRequest,
    SuperUserUpdateRequest,
    AdminSuperUserResponse,
    AdminMetricsResponse,
    DirectoryMemberResponse,
    ClusterGraphNode,
    ClusterGraphLink,
    ClusterGraphResponse,
)
from backend.app.config.spaces import get_registered_spaces, get_space_by_slug
from backend.app.services.lifecycle_service import (
    get_account_tag,
    execute_admin_system_reset,
    execute_factory_reset,
    purge_person_by_identifier,
)

from pydantic import BaseModel, Field
from backend.app.services.totp_service import TotpService
from backend.app.services.system_setting_service import SystemSettingService
from backend.app.services.request_cleanup_service import RequestCleanupService

router = APIRouter(prefix="/admin", tags=["Admin Portal"])

ROOT_ADMIN_EMAIL = "rehankuriance@gmail.com"


class PinValidityUpdateRequest(BaseModel):
    pin_validity_seconds: int = Field(ge=30, le=86400, description="Validity lifespan of PINs in seconds")


@router.get("/metrics", response_model=AdminMetricsResponse)
async def get_admin_metrics(
    _user: dict = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> AdminMetricsResponse:
    """Retrieve operational analytics cards for SuperUser and Admin dashboards.

    Metrics:
    1. Total Registered Users
    2. Daily Request Average calculated over the past week (last 7 days / 7.0)
    """
    now = utc_now()
    seven_days_ago = now - timedelta(days=7)

    # 1. Total Registered Users
    user_count_res = await session.execute(select(func.count(User.id)))
    total_users = user_count_res.scalar_one() or 0

    # 2. Weekly entries per Facility Space (DOOR_UNLOCKED events within last 7 days)
    registered_spaces = get_registered_spaces()
    weekly_entries_per_space: Dict[str, int] = {}
    weekly_entries_space_names: Dict[str, str] = {}

    for sp in registered_spaces:
        weekly_entries_space_names[sp.slug] = sp.name
        stmt = select(func.count(EntryLog.id)).where(
            and_(
                EntryLog.space_id == sp.slug,
                EntryLog.event_type == EntryEventType.DOOR_UNLOCKED,
                EntryLog.created_at >= seven_days_ago,
                EntryLog.is_archived.is_(False),
            )
        )
        res = await session.execute(stmt)
        weekly_entries_per_space[sp.slug] = res.scalar_one() or 0

    # 3. Average access requests per day (calculated over the week / past 7 days)
    req_count_res = await session.execute(
        select(func.count(AccessRequest.id)).where(AccessRequest.created_at >= seven_days_ago)
    )
    req_count_7d = req_count_res.scalar_one() or 0
    avg_req_per_day = round(req_count_7d / 7.0, 1)

    return AdminMetricsResponse(
        total_registered_users=total_users,
        weekly_entries_per_space=weekly_entries_per_space,
        weekly_entries_space_names=weekly_entries_space_names,
        avg_access_requests_per_day=avg_req_per_day,
    )


# ==========================================
# Admin Account Management (Source Admin Protected)
# ==========================================

@router.get("/admins", response_model=List[AdminAccountResponse])
async def list_secondary_admins(
    _admin: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db)
) -> List[AdminAccountResponse]:
    """List all Admin accounts (both root and standard), excluding the hidden Source Admin.

    Source Admin (rehankuriance@gmail.com) is not listed anywhere and cannot be deleted.
    """
    stmt = (
        select(Admin)
        .where(Admin.email != ROOT_ADMIN_EMAIL)
        .order_by(Admin.created_at.desc())
    )
    res = await session.execute(stmt)
    records = res.scalars().all()
    return [AdminAccountResponse.model_validate(r) for r in records]


@router.post("/admins", response_model=AdminAccountResponse)
async def create_secondary_admin(
    payload: AdminCreateRequest,
    admin: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db)
) -> AdminAccountResponse:
    """Create an Admin account (Root or Standard).

    When created by a Root Admin, the new admin can be granted Root Admin status.
    """
    email_clean = payload.email.lower().strip()
    validate_email_domain(email_clean)
    if email_clean == ROOT_ADMIN_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source administrator already exists and is immutable."
        )

    # Check if admin already exists
    existing = await session.execute(select(Admin).where(Admin.email == email_clean))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An administrator with this email already exists."
        )

    # If creator is a root admin, allow granting is_root; otherwise False
    is_root_granted = payload.is_root and admin.get("is_root", False)

    # Resolve & safely remove any previous SuperUser or User account for this email
    existing_su = (await session.execute(
        select(SuperUser).where(func.lower(SuperUser.email) == email_clean)
    )).scalar_one_or_none()
    if existing_su:
        await _delete_superuser_and_revoke_members(session, str(existing_su.id), admin)
    else:
        existing_user = (await session.execute(
            select(User).where(func.lower(User.email) == email_clean)
        )).scalar_one_or_none()
        if existing_user:
            from backend.app.services.websocket_service import ws_manager
            now = utc_now()
            user_pins = (await session.execute(
                select(ActivePin).where(
                    and_(
                        ActivePin.holder_user_id == existing_user.id,
                        ActivePin.revoked_at.is_(None),
                        ActivePin.expires_at > now,
                    )
                )
            )).scalars().all()
            for p in user_pins:
                await ws_manager.broadcast(f"esp32:{p.space_id}", {
                    "action": "REVOKE_PIN",
                    "space_id": p.space_id,
                    "pin": p.pin_code,
                })
                await ESP32Service.enqueue_command(
                    session=session,
                    space_id=p.space_id,
                    command_type="REVOKE_PIN",
                    payload={"pin": p.pin_code},
                )
            await purge_person_by_identifier(session, email_clean)
            await ws_manager.broadcast("global", {
                "event_type": "FORCE_LOGOUT",
                "type": "FORCE_LOGOUT",
                "email": email_clean,
                "reason": "Your account was upgraded to Administrator. Please log in again.",
            })
            await ws_manager.broadcast("global", {
                "event_type": "USER_DIRECTORY_UPDATED",
                "type": "USER_DIRECTORY_UPDATED",
            })
            await ws_manager.broadcast("global", {
                "event_type": "PIN_LIST_UPDATED",
                "type": "PIN_LIST_UPDATED",
            })

    new_admin = Admin(
        name=payload.name.strip()[:25],
        email=email_clean[:255],
        is_root=is_root_granted,
    )
    session.add(new_admin)
    await session.commit()
    await session.refresh(new_admin)
    return AdminAccountResponse.model_validate(new_admin)


@router.delete("/admins/{admin_id}")
async def delete_secondary_admin(
    admin_id: uuid.UUID,
    admin: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Delete an Admin account.

    Source Admin (rehankuriance@gmail.com) cannot be deleted.
    All other admins (Root or Standard) can mutually delete each other.
    """
    admin_res = await session.execute(select(Admin).where(Admin.id == admin_id))
    admin_record = admin_res.scalar_one_or_none()

    if not admin_record:
        raise HTTPException(status_code=404, detail="Admin account not found.")

    if admin_record.email.lower().strip() == ROOT_ADMIN_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The Source Administrator cannot be deleted."
        )

    if admin_record.email.lower().strip() == admin.get("email", "").lower().strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Administrators cannot delete their own active account."
        )

    await session.delete(admin_record)
    await session.commit()
    from backend.app.services.websocket_service import ws_manager
    await ws_manager.broadcast("global", {
        "event_type": "FORCE_LOGOUT",
        "type": "FORCE_LOGOUT",
        "email": admin_record.email.lower().strip(),
        "reason": "Administrator account was deleted.",
    })
    return {"status": "success", "message": f"Admin {admin_record.email} deleted successfully."}


# ==========================================
# SuperUser Management & Revocation
# ==========================================

@router.get("/superusers", response_model=List[AdminSuperUserResponse])
async def list_admin_superusers(
    _admin: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db)
) -> List[AdminSuperUserResponse]:
    """List all active SuperUsers with club and space authority metadata."""
    stmt = (
        select(SuperUser, Club)
        .outerjoin(Club, Club.id == SuperUser.club_id)
        .where(SuperUser.is_active.is_(True))
        .order_by(SuperUser.created_at.desc())
    )
    res = await session.execute(stmt)
    records = res.all()

    output = []
    for su, club in records:
        output.append(
            AdminSuperUserResponse(
                id=su.id,
                email=su.email,
                name=su.name,
                phone=su.phone,
                college_year=su.college_year,
                club_id=su.club_id,
                club_name=club.name if club else None,
                allowed_spaces=su.allowed_spaces or [],
                is_active=su.is_active,
                account_tag=get_account_tag(su.created_at, updated_at=su.updated_at),
                created_at=su.created_at,
                note=getattr(su, "note", None),
            )
        )
    return output


@router.get("/users/lookup")
async def lookup_registered_user(
    email: str,
    _admin: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Lookup an existing registered user to autofill details when promoting to SuperUser."""
    email_clean = email.strip().lower()
    res = await session.execute(
        select(User, Club)
        .outerjoin(Club, Club.id == User.club_id)
        .where(User.email == email_clean)
    )
    row = res.first()
    if not row:
        return {"found": False}
    user, club = row
    return {
        "found": True,
        "name": user.name,
        "email": user.email,
        "phone": user.phone,
        "college_year": user.college_year,
        "club_name": club.name if club else None,
        "note": getattr(user, "note", None),
    }


@router.post("/superusers", response_model=AdminSuperUserResponse)
async def create_superuser(
    payload: SuperUserCreateRequest,
    _admin: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db)
) -> AdminSuperUserResponse:
    """Register a new SuperUser or re-appoint a revoked SuperUser with Club and Facility Space authority."""
    email_clean = payload.email.lower().strip()
    validate_email_domain(email_clean)

    if not payload.allowed_spaces or len(payload.allowed_spaces) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A SuperUser must be assigned authority over at least one Facility Space."
        )

    existing_admin = (await session.execute(
        select(Admin).where(func.lower(Admin.email) == email_clean)
    )).scalar_one_or_none()
    if email_clean == ROOT_ADMIN_EMAIL or existing_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An Administrator with this email already exists. Delete the Admin account first before registering as a SuperUser."
        )

    existing = await session.execute(select(SuperUser).where(SuperUser.email == email_clean))
    existing_su = existing.scalar_one_or_none()
    if existing_su and existing_su.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A SuperUser with this email already exists."
        )

    # Safely purge any previous standalone User account & its ties before creating SuperUser
    had_prior_user = False
    if not existing_su:
        prior_user = (await session.execute(
            select(User).where(func.lower(User.email) == email_clean)
        )).scalar_one_or_none()
        if prior_user:
            had_prior_user = True
            from backend.app.services.websocket_service import ws_manager
            now = utc_now()
            user_pins = (await session.execute(
                select(ActivePin).where(
                    and_(
                        ActivePin.holder_user_id == prior_user.id,
                        ActivePin.revoked_at.is_(None),
                        ActivePin.expires_at > now,
                    )
                )
            )).scalars().all()
            for p in user_pins:
                await ws_manager.broadcast(f"esp32:{p.space_id}", {
                    "action": "REVOKE_PIN",
                    "space_id": p.space_id,
                    "pin": p.pin_code,
                })
                await ESP32Service.enqueue_command(
                    session=session,
                    space_id=p.space_id,
                    command_type="REVOKE_PIN",
                    payload={"pin": p.pin_code},
                )
            await purge_person_by_identifier(session, email_clean)

    # Resolve or create club
    club_id = None
    club_name = None
    if payload.club_name and payload.club_name.strip():
        c_name = payload.club_name.strip()[:25]
        c_res = await session.execute(select(Club).where(Club.name == c_name))
        c = c_res.scalar_one_or_none()
        if not c:
            c = Club(name=c_name)
            session.add(c)
            await session.flush()
        club_id = c.id
        club_name = c.name

    note_val = payload.note.strip()[:255] if payload.note and payload.note.strip() else None

    if existing_su:
        # Re-appointing a previously revoked SuperUser
        existing_su.is_active = True
        existing_su.name = payload.name.strip()[:25]
        existing_su.phone = payload.phone.strip()[:20]
        existing_su.college_year = payload.college_year or "Not Applicable"
        existing_su.club_id = club_id
        existing_su.allowed_spaces = payload.allowed_spaces
        if payload.note is not None:
            existing_su.note = note_val
        existing_su.updated_at = utc_now()
        su = existing_su
    else:
        new_su = SuperUser(
            email=email_clean,
            name=payload.name.strip()[:25],
            phone=payload.phone.strip()[:20],
            college_year=payload.college_year or "Not Applicable",
            club_id=club_id,
            allowed_spaces=payload.allowed_spaces,
            note=note_val,
            is_active=True,
        )
        session.add(new_su)
        await session.flush()
        su = new_su

    # Sync corresponding User record (every SuperUser must have a synced User entity)
    existing_user_res = await session.execute(select(User).where(User.email == email_clean))
    existing_user = existing_user_res.scalar_one_or_none()
    if existing_user:
        existing_user.name = su.name
        existing_user.phone = su.phone
        existing_user.college_year = su.college_year
        existing_user.club_id = su.club_id
        if payload.note is not None:
            existing_user.note = note_val
        synced_user = existing_user
    else:
        synced_user = User(
            email=su.email,
            name=su.name,
            phone=su.phone,
            college_year=su.college_year,
            club_id=su.club_id,
            note=note_val,
        )
        session.add(synced_user)
        await session.flush()

    # Ensure UserSpaceAssignment exists with status APPROVED for all allowed spaces
    for s_slug in (su.allowed_spaces or []):
        assign_res = await session.execute(
            select(UserSpaceAssignment).where(
                and_(
                    UserSpaceAssignment.user_id == synced_user.id,
                    UserSpaceAssignment.space_id == s_slug,
                )
            )
        )
        assign = assign_res.scalar_one_or_none()
        if assign:
            assign.superuser_id = su.id
            assign.status = "APPROVED"
        else:
            session.add(
                UserSpaceAssignment(
                    user_id=synced_user.id,
                    space_id=s_slug,
                    superuser_id=su.id,
                    status="APPROVED",
                )
            )

    await session.commit()
    await session.refresh(su)

    if had_prior_user:
        from backend.app.services.websocket_service import ws_manager
        await ws_manager.broadcast("global", {
            "event_type": "FORCE_LOGOUT",
            "type": "FORCE_LOGOUT",
            "email": email_clean,
            "reason": "Your account was registered as a SuperUser. Please log in again.",
        })
        await ws_manager.broadcast("global", {
            "event_type": "USER_DIRECTORY_UPDATED",
            "type": "USER_DIRECTORY_UPDATED",
        })

    return AdminSuperUserResponse(
        id=su.id,
        email=su.email,
        name=su.name,
        phone=su.phone,
        college_year=su.college_year,
        club_id=su.club_id,
        club_name=club_name,
        allowed_spaces=su.allowed_spaces or [],
        is_active=su.is_active,
        account_tag=get_account_tag(su.created_at, updated_at=su.updated_at),
        created_at=su.created_at,
        note=getattr(su, "note", None),
    )


async def _revoke_superuser_space_assignments(
    session: AsyncSession,
    su: SuperUser,
    spaces_to_revoke: Optional[List[str]] = None,
    su_own_user_id: Optional[uuid.UUID] = None,
    force_logout_only_if_zero_spaces: bool = True,
) -> tuple[int, List[str]]:
    """Shared cleanup whenever a SuperUser loses authority over one or more spaces.

    Revokes active PINs in those spaces, deletes pending/historical requests and
    UserSpaceAssignments mapped to `su` (never auto-remapping), and returns
    `(revoked_assignment_count, forced_logout_emails)`.
    """
    from backend.app.services.websocket_service import ws_manager
    from backend.app.services.log_service import LogService

    now = utc_now()
    mapped_stmt = select(UserSpaceAssignment).where(UserSpaceAssignment.superuser_id == su.id)
    if spaces_to_revoke is not None:
        if not spaces_to_revoke:
            return 0, []
        mapped_stmt = mapped_stmt.where(UserSpaceAssignment.space_id.in_(spaces_to_revoke))
    mapped_assigns = (await session.execute(mapped_stmt)).scalars().all()

    affected_user_ids = set()
    for assign in mapped_assigns:
        if not su_own_user_id or assign.user_id != su_own_user_id:
            affected_user_ids.add(assign.user_id)

        # Revoke any active PINs for this holder in this space
        pins = (await session.execute(
            select(ActivePin).where(
                and_(
                    ActivePin.holder_user_id == assign.user_id,
                    ActivePin.space_id == assign.space_id,
                    ActivePin.revoked_at.is_(None),
                    ActivePin.expires_at > now,
                )
            )
        )).scalars().all()
        if pins:
            u_holder = (await session.execute(select(User).where(User.id == assign.user_id))).scalar_one_or_none()
            for p in pins:
                p.revoked_at = now
                await ws_manager.broadcast(f"esp32:{p.space_id}", {
                    "action": "REVOKE_PIN",
                    "space_id": p.space_id,
                    "pin": p.pin_code,
                })
                await ESP32Service.enqueue_command(
                    session=session,
                    space_id=p.space_id,
                    command_type="REVOKE_PIN",
                    payload={"pin": p.pin_code},
                )
                if u_holder:
                    await LogService.create_entry_log(
                        session=session,
                        event_type=EntryEventType.PIN_REVOKED,
                        space_id=p.space_id,
                        actor_name=u_holder.name,
                        actor_email=u_holder.email,
                        authority_name=su.name,
                        authority_email=su.email,
                        pin_used=p.pin_code,
                        justification_snapshot="PIN invalidated: SuperUser space authority removed",
                    )

        # Delete access requests for this user in this space
        await session.execute(
            delete(AccessRequest).where(
                and_(
                    AccessRequest.requester_user_id == assign.user_id,
                    AccessRequest.space_id == assign.space_id,
                )
            )
        )
        await session.delete(assign)

    await session.flush()

    forced_logout_emails: List[str] = []
    for uid in affected_user_ids:
        if force_logout_only_if_zero_spaces:
            rem = (await session.execute(
                select(UserSpaceAssignment).where(UserSpaceAssignment.user_id == uid)
            )).scalars().first()
            if rem is not None:
                continue
        u_rec = (await session.execute(select(User).where(User.id == uid))).scalar_one_or_none()
        if u_rec:
            u_rec.token_version = (getattr(u_rec, "token_version", 1) or 1) + 1
            forced_logout_emails.append(u_rec.email.lower().strip())

    return len(mapped_assigns), forced_logout_emails


@router.put("/superusers/{su_id}", response_model=AdminSuperUserResponse)
async def update_superuser(
    su_id: uuid.UUID,
    payload: SuperUserUpdateRequest,
    _admin: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db)
) -> AdminSuperUserResponse:
    """Modify SuperUser profile, Facility Space authority, or active status."""
    res = await session.execute(select(SuperUser).where(SuperUser.id == su_id))
    su = res.scalar_one_or_none()
    if not su:
        raise HTTPException(status_code=404, detail="SuperUser not found.")

    # Find synced User record if it exists
    user_res = await session.execute(select(User).where(User.email == su.email))
    synced_user = user_res.scalar_one_or_none()

    if payload.name is not None:
        su.name = payload.name.strip()[:25]
        if synced_user:
            synced_user.name = su.name
    if payload.phone is not None:
        su.phone = payload.phone.strip()[:20]
        if synced_user:
            synced_user.phone = su.phone
    if payload.college_year is not None:
        su.college_year = payload.college_year
        if synced_user:
            synced_user.college_year = su.college_year
    if payload.note is not None:
        su.note = payload.note.strip()[:255] if payload.note.strip() else None
        if synced_user:
            synced_user.note = su.note
    old_allowed_spaces = list(su.allowed_spaces or [])
    if payload.allowed_spaces is not None:
        if len(payload.allowed_spaces) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A SuperUser must retain authority over at least one Facility Space."
            )
        su.allowed_spaces = payload.allowed_spaces
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(su, "allowed_spaces")
    if payload.is_active is not None:
        su.is_active = payload.is_active

    if payload.club_name is not None:
        if payload.club_name.strip():
            c_name = payload.club_name.strip()[:25]
            c_res = await session.execute(select(Club).where(Club.name == c_name))
            c = c_res.scalar_one_or_none()
            if not c:
                c = Club(name=c_name)
                session.add(c)
                await session.flush()
            su.club_id = c.id
        else:
            su.club_id = None
        if synced_user:
            synced_user.club_id = su.club_id

    # If allowed_spaces changed and synced_user exists, ensure assignments exist and are approved
    if synced_user and su.allowed_spaces:
        for s_slug in su.allowed_spaces:
            assign_res = await session.execute(
                select(UserSpaceAssignment).where(
                    and_(
                        UserSpaceAssignment.user_id == synced_user.id,
                        UserSpaceAssignment.space_id == s_slug,
                    )
                )
            )
            assign = assign_res.scalar_one_or_none()
            if assign:
                assign.superuser_id = su.id
                assign.status = "APPROVED"
            else:
                session.add(
                    UserSpaceAssignment(
                        user_id=synced_user.id,
                        space_id=s_slug,
                        superuser_id=su.id,
                        status="APPROVED",
                    )
                )

    # Cascade authority reduction: revoke PINs and delete assignments/requests for removed spaces
    removed_spaces: List[str] = []
    forced_logout_emails: List[str] = []
    if payload.allowed_spaces is not None:
        new_allowed_set = set(su.allowed_spaces or [])
        removed_spaces = [sp for sp in old_allowed_spaces if sp not in new_allowed_set]
        if removed_spaces:
            _, forced_logout_emails = await _revoke_superuser_space_assignments(
                session=session,
                su=su,
                spaces_to_revoke=removed_spaces,
                su_own_user_id=synced_user.id if synced_user else None,
                force_logout_only_if_zero_spaces=True,
            )

    su.updated_at = utc_now()
    su.token_version = (getattr(su, "token_version", 1) or 1) + 1
    if synced_user:
        synced_user.token_version = (getattr(synced_user, "token_version", 1) or 1) + 1
    await session.commit()
    await session.refresh(su)

    from backend.app.services.websocket_service import ws_manager
    await ws_manager.broadcast("global", {
        "event_type": "FORCE_LOGOUT",
        "type": "FORCE_LOGOUT",
        "email": su.email.lower().strip(),
        "reason": "Account details or authority spaces were modified by an administrator.",
    })
    for u_email in forced_logout_emails:
        await ws_manager.broadcast("global", {
            "event_type": "FORCE_LOGOUT",
            "type": "FORCE_LOGOUT",
            "email": u_email,
            "reason": "Your space registration was revoked because your SuperUser's space authority was removed.",
        })
    if removed_spaces:
        await ws_manager.broadcast("global", {
            "event_type": "PIN_LIST_UPDATED",
            "type": "PIN_LIST_UPDATED",
        })
    await ws_manager.broadcast("global", {
        "event_type": "USER_DIRECTORY_UPDATED",
        "type": "USER_DIRECTORY_UPDATED",
    })

    club_name = None
    if su.club_id:
        c_res = await session.execute(select(Club).where(Club.id == su.club_id))
        c = c_res.scalar_one_or_none()
        club_name = c.name if c else None

    return AdminSuperUserResponse(
        id=su.id,
        email=su.email,
        name=su.name,
        phone=su.phone,
        college_year=su.college_year,
        club_id=su.club_id,
        club_name=club_name,
        allowed_spaces=su.allowed_spaces or [],
        is_active=su.is_active,
        account_tag=get_account_tag(su.created_at, updated_at=su.updated_at),
        created_at=su.created_at,
        note=getattr(su, "note", None),
    )


async def _delete_superuser_and_revoke_members(
    session: AsyncSession,
    identifier: str,
    actor: dict,
) -> Dict[str, Any]:
    """Delete a SuperUser account, revoke space registrations of users mapped to them, and log."""
    from backend.app.services.log_service import LogService
    from backend.app.services.websocket_service import ws_manager

    ident_clean = identifier.strip()
    su = None
    try:
        uid = uuid.UUID(ident_clean)
        su = (await session.execute(select(SuperUser).where(SuperUser.id == uid))).scalar_one_or_none()
    except ValueError:
        su = (await session.execute(
            select(SuperUser).where(func.lower(SuperUser.email) == ident_clean.lower())
        )).scalar_one_or_none()

    if not su:
        raise HTTPException(status_code=404, detail="SuperUser not found.")

    su_email = su.email.lower().strip()
    su_name = su.name
    su_spaces = list(su.allowed_spaces or [])
    now = utc_now()

    # Find SuperUser's own synced User ID (if any) so we distinguish their own cards from mapped users
    su_own_user = (await session.execute(
        select(User).where(func.lower(User.email) == su_email)
    )).scalar_one_or_none()

    # 1. Revoke registrations and active PINs of all users mapped to this SuperUser
    mapped_count, forced_logout_emails = await _revoke_superuser_space_assignments(
        session=session,
        su=su,
        spaces_to_revoke=None,
        su_own_user_id=su_own_user.id if su_own_user else None,
        force_logout_only_if_zero_spaces=False,
    )

    # 2. Revoke any active PINs held by the SuperUser themselves on ESP32 before purge
    if su_own_user:
        su_pins = (await session.execute(
            select(ActivePin).where(
                and_(
                    ActivePin.holder_user_id == su_own_user.id,
                    ActivePin.revoked_at.is_(None),
                    ActivePin.expires_at > now,
                )
            )
        )).scalars().all()
        for p in su_pins:
            await ws_manager.broadcast(f"esp32:{p.space_id}", {
                "action": "REVOKE_PIN",
                "space_id": p.space_id,
                "pin": p.pin_code,
            })
            await ESP32Service.enqueue_command(
                session=session,
                space_id=p.space_id,
                command_type="REVOKE_PIN",
                payload={"pin": p.pin_code},
            )

    # 3. Record visible audit log entry
    log_space = su_spaces[0] if su_spaces else "system"
    await LogService.create_entry_log(
        session=session,
        event_type=EntryEventType.SUPERUSER_DELETED,
        space_id=log_space,
        actor_name=su_name,
        actor_email=su_email,
        authority_name=actor.get("name", "Admin"),
        authority_email=actor.get("email", "admin"),
        pin_used=None,
        justification_snapshot=f"SuperUser account deleted and {mapped_count} space registration(s) revoked",
    )

    # 4. Completely delete the SuperUser and their own records
    result = await purge_person_by_identifier(session, su_email)

    # 5. Broadcast immediate logouts and directory refresh
    await ws_manager.broadcast("global", {
        "event_type": "FORCE_LOGOUT",
        "type": "FORCE_LOGOUT",
        "email": su_email,
        "reason": "SuperUser account was deleted.",
    })
    for u_email in forced_logout_emails:
        await ws_manager.broadcast("global", {
            "event_type": "FORCE_LOGOUT",
            "type": "FORCE_LOGOUT",
            "email": u_email,
            "reason": "Your space registration was revoked because your SuperUser was deleted.",
        })
    await ws_manager.broadcast("global", {
        "event_type": "USER_DIRECTORY_UPDATED",
        "type": "USER_DIRECTORY_UPDATED",
    })
    await ws_manager.broadcast("global", {
        "event_type": "PIN_LIST_UPDATED",
        "type": "PIN_LIST_UPDATED",
    })
    return result


@router.post("/superusers/{su_id}/revoke")
async def revoke_superuser(
    su_id: uuid.UUID,
    admin: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Revoke and delete a SuperUser immediately, revoking their users' space registrations."""
    return await _delete_superuser_and_revoke_members(session, str(su_id), admin)


@router.delete("/superusers/{su_id}")
async def delete_superuser(
    su_id: str,
    admin: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Permanently delete a SuperUser, revoke their users' space registrations, and log."""
    return await _delete_superuser_and_revoke_members(session, su_id, admin)


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    actor: dict = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Permanently delete a User (student) and all associated access credentials.

    SuperUsers can delete users assigned to spaces they govern.
    Admins can delete any user. Creates a visible USER_DELETED log entry.
    """
    from backend.app.services.log_service import LogService
    from backend.app.services.websocket_service import ws_manager

    ident_clean = user_id.strip()
    target_user = None
    try:
        uid = uuid.UUID(ident_clean)
        target_user = (await session.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    except ValueError:
        target_user = (await session.execute(
            select(User).where(func.lower(User.email) == ident_clean.lower())
        )).scalar_one_or_none()

    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")

    target_email = target_user.email.lower().strip()
    target_name = target_user.name

    # Prevent SuperUsers from deleting Admins, SuperUsers, or users outside their spaces
    assigns = (await session.execute(
        select(UserSpaceAssignment).where(UserSpaceAssignment.user_id == target_user.id)
    )).scalars().all()
    user_spaces = [a.space_id for a in assigns]

    if actor.get("role") != "admin":
        su = (await session.execute(
            select(SuperUser).where(SuperUser.email == actor.get("email"))
        )).scalar_one_or_none()
        if not su or not su.is_active:
            raise HTTPException(status_code=403, detail="SuperUser authority inactive.")
        # Check target is not an admin or active superuser
        is_su = (await session.execute(
            select(SuperUser).where(func.lower(SuperUser.email) == target_email, SuperUser.is_active.is_(True))
        )).scalar_one_or_none()
        is_adm = (await session.execute(
            select(Admin).where(func.lower(Admin.email) == target_email)
        )).scalar_one_or_none()
        if is_su or is_adm:
            raise HTTPException(status_code=403, detail="SuperUsers cannot delete SuperUser or Admin accounts.")
        su_spaces = set(su.allowed_spaces or [])
        if not any(sp in su_spaces for sp in user_spaces):
            raise HTTPException(
                status_code=403,
                detail="You can only delete users registered in your authorized Facility Spaces."
            )

    # Revoke any active hardware PINs on ESP32 before purging
    now = utc_now()
    active_pins = (await session.execute(
        select(ActivePin).where(
            and_(
                ActivePin.holder_user_id == target_user.id,
                ActivePin.revoked_at.is_(None),
                ActivePin.expires_at > now,
            )
        )
    )).scalars().all()
    for p in active_pins:
        await ws_manager.broadcast(f"esp32:{p.space_id}", {
            "action": "REVOKE_PIN",
            "space_id": p.space_id,
            "pin": p.pin_code,
        })
        await ESP32Service.enqueue_command(
            session=session,
            space_id=p.space_id,
            command_type="REVOKE_PIN",
            payload={"pin": p.pin_code},
        )

    # Create visible audit log
    log_space = user_spaces[0] if user_spaces else "system"
    await LogService.create_entry_log(
        session=session,
        event_type=EntryEventType.USER_DELETED,
        space_id=log_space,
        actor_name=target_name,
        actor_email=target_email,
        authority_name=actor.get("name", "Authority"),
        authority_email=actor.get("email", "system"),
        pin_used=None,
        justification_snapshot=f"User deleted from directory by {actor.get('role', 'authority')} ({actor.get('email', '')})",
    )

    result = await purge_person_by_identifier(session, target_email)

    await ws_manager.broadcast("global", {
        "event_type": "FORCE_LOGOUT",
        "type": "FORCE_LOGOUT",
        "email": target_email,
        "reason": "Your account was deleted by an administrator or space lead.",
    })
    await ws_manager.broadcast("global", {
        "event_type": "USER_DIRECTORY_UPDATED",
        "type": "USER_DIRECTORY_UPDATED",
    })
    await ws_manager.broadcast("global", {
        "event_type": "PIN_LIST_UPDATED",
        "type": "PIN_LIST_UPDATED",
    })
    return result


# ==========================================
# User & SuperUser Directory (Excludes Admins)
# ==========================================

@router.get("/directory", response_model=List[DirectoryMemberResponse])
async def get_user_directory(
    _actor: dict = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> List[DirectoryMemberResponse]:
    """Retrieve full directory of Users and SuperUsers sortable by Club and Facility Space.

    Exclusion Rule: Strictly excludes Admin accounts.
    Cohort Tags: Shows 'New' or 'Old' only between July 15 and Sept 1.
    """
    directory: List[DirectoryMemberResponse] = []

    # 1. Active SuperUsers only
    su_stmt = (
        select(SuperUser, Club)
        .outerjoin(Club, Club.id == SuperUser.club_id)
        .where(SuperUser.is_active.is_(True))
        .order_by(SuperUser.name.asc())
    )
    su_res = await session.execute(su_stmt)
    su_rows = su_res.all()
    su_name_map = {su.id: su.name for su, _ in su_rows}

    for su, club in su_rows:
        directory.append(
            DirectoryMemberResponse(
                id=su.id,
                name=su.name,
                email=su.email,
                phone=su.phone,
                role="superuser",
                college_year=su.college_year,
                club_id=su.club_id,
                club_name=club.name if club else None,
                spaces=su.allowed_spaces or [],
                assigned_superuser_ids=[],
                assigned_superusers=[],
                is_active=su.is_active,
                account_tag=get_account_tag(su.created_at, updated_at=su.updated_at),
                created_at=su.created_at,
                note=getattr(su, "note", None),
            )
        )

    # 2. Entrant Users (strictly exclude any email that is already an active superuser; people are unique by email ID)
    active_su_emails = {su.email.lower().strip() for su, _ in su_rows}
    u_stmt = (
        select(User, Club)
        .outerjoin(Club, Club.id == User.club_id)
        .where(User.email.not_in(active_su_emails) if active_su_emails else True)
        .order_by(User.name.asc())
    )
    u_res = await session.execute(u_stmt)
    users = u_res.all()

    # Batch query assignments for entrant users
    user_ids = [u.id for u, _ in users]
    assignments_by_user: Dict[uuid.UUID, List[str]] = {uid: [] for uid in user_ids}
    assigned_su_ids_by_user: Dict[uuid.UUID, List[str]] = {uid: [] for uid in user_ids}
    assigned_su_details_by_user: Dict[uuid.UUID, List[Dict[str, Any]]] = {uid: [] for uid in user_ids}

    if user_ids:
        assign_stmt = select(UserSpaceAssignment).where(
            and_(
                UserSpaceAssignment.user_id.in_(user_ids),
                UserSpaceAssignment.status == "APPROVED",
            )
        )
        assign_res = await session.execute(assign_stmt)
        for a in assign_res.scalars().all():
            assignments_by_user[a.user_id].append(a.space_id)
            if a.superuser_id:
                su_id_str = str(a.superuser_id)
                if su_id_str not in assigned_su_ids_by_user[a.user_id]:
                    assigned_su_ids_by_user[a.user_id].append(su_id_str)
                assigned_su_details_by_user[a.user_id].append({
                    "space_id": a.space_id,
                    "superuser_id": su_id_str,
                    "superuser_name": su_name_map.get(a.superuser_id, "SuperUser"),
                })

    for u, club in users:
        if not assignments_by_user.get(u.id):
            continue
        directory.append(
            DirectoryMemberResponse(
                id=u.id,
                name=u.name,
                email=u.email,
                phone=u.phone,
                role="user",
                college_year=u.college_year,
                club_id=u.club_id,
                club_name=club.name if club else None,
                spaces=assignments_by_user.get(u.id, []),
                assigned_superuser_ids=assigned_su_ids_by_user.get(u.id, []),
                assigned_superusers=assigned_su_details_by_user.get(u.id, []),
                is_active=True,
                account_tag=get_account_tag(u.created_at),
                created_at=u.created_at,
                note=getattr(u, "note", None),
            )
        )

    return directory


# ==========================================
# Interactive Affiliation Cluster Graph
# ==========================================

@router.get("/cluster-graph", response_model=ClusterGraphResponse)
async def get_cluster_graph_data(
    _actor: dict = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> ClusterGraphResponse:
    """Retrieve data for D3/Canvas interactive affiliation cluster graph.

    Clusters Users and SuperUsers visually around their Club affiliations,
    highlighting SuperUser leads and connected student members.
    Exclusion Rule: Strictly excludes Admin accounts.
    """
    nodes: List[ClusterGraphNode] = []
    links: List[ClusterGraphLink] = []

    # 1. Fetch all Clubs
    club_res = await session.execute(select(Club).order_by(Club.name.asc()))
    clubs = club_res.scalars().all()
    club_dict = {c.id: c.name for c in clubs}

    # Count members per club
    member_counts: Dict[str, int] = {str(c.id): 0 for c in clubs}

    # 2. Fetch Active SuperUsers only
    su_stmt = select(SuperUser).where(SuperUser.is_active.is_(True)).order_by(SuperUser.name.asc())
    su_res = await session.execute(su_stmt)
    superusers = su_res.scalars().all()

    # 3. Fetch Users (excluding any duplicate email that is already an active superuser)
    active_su_emails = {su.email for su in superusers}
    user_stmt = select(User).where(User.email.not_in(active_su_emails) if active_su_emails else True).order_by(User.name.asc())
    user_res = await session.execute(user_stmt)
    users = user_res.scalars().all()

    # Query user assignments
    user_ids = [u.id for u in users]
    assignments_by_user: Dict[uuid.UUID, List[str]] = {uid: [] for uid in user_ids}
    assigned_su_ids_by_user: Dict[uuid.UUID, List[str]] = {uid: [] for uid in user_ids}
    assigned_su_details_by_user: Dict[uuid.UUID, List[Dict[str, Any]]] = {uid: [] for uid in user_ids}
    su_name_map = {su.id: su.name for su in superusers}

    if user_ids:
        assign_res = await session.execute(
            select(UserSpaceAssignment).where(
                and_(
                    UserSpaceAssignment.user_id.in_(user_ids),
                    UserSpaceAssignment.status == "APPROVED",
                )
            )
        )
        for a in assign_res.scalars().all():
            assignments_by_user[a.user_id].append(a.space_id)
            if a.superuser_id:
                su_id_str = str(a.superuser_id)
                if su_id_str not in assigned_su_ids_by_user[a.user_id]:
                    assigned_su_ids_by_user[a.user_id].append(su_id_str)
                assigned_su_details_by_user[a.user_id].append({
                    "space_id": a.space_id,
                    "superuser_id": su_id_str,
                    "superuser_name": su_name_map.get(a.superuser_id, "SuperUser"),
                })

    # Add SuperUser nodes & links
    for su in superusers:
        su_id_str = f"su_{su.id}"
        c_name = club_dict.get(su.club_id) if su.club_id else "General / Unaffiliated"
        if su.club_id:
            member_counts[str(su.club_id)] = member_counts.get(str(su.club_id), 0) + 1

        nodes.append(
            ClusterGraphNode(
                id=su_id_str,
                name=su.name,
                role="superuser",
                college_year=su.college_year,
                club_id=str(su.club_id) if su.club_id else None,
                club_name=c_name,
                phone=su.phone,
                email=su.email,
                spaces=su.allowed_spaces or [],
                assigned_superuser_ids=[],
                assigned_superusers=[],
                is_active=su.is_active,
                note=getattr(su, "note", None),
            )
        )
        if su.club_id:
            links.append(
                ClusterGraphLink(
                    source=su_id_str,
                    target=f"club_{su.club_id}",
                    relation="leads",
                )
            )

    # Add User nodes & links (exclude waiting-room / unapproved users)
    for u in users:
        if not assignments_by_user.get(u.id):
            continue
        u_id_str = f"user_{u.id}"
        c_name = club_dict.get(u.club_id) if u.club_id else "General / Unaffiliated"
        if u.club_id:
            member_counts[str(u.club_id)] = member_counts.get(str(u.club_id), 0) + 1

        nodes.append(
            ClusterGraphNode(
                id=u_id_str,
                name=u.name,
                role="user",
                college_year=u.college_year,
                club_id=str(u.club_id) if u.club_id else None,
                club_name=c_name,
                phone=u.phone,
                email=u.email,
                spaces=assignments_by_user.get(u.id, []),
                assigned_superuser_ids=assigned_su_ids_by_user.get(u.id, []),
                assigned_superusers=assigned_su_details_by_user.get(u.id, []),
                is_active=True,
                note=getattr(u, "note", None),
            )
        )
        if u.club_id:
            links.append(
                ClusterGraphLink(
                    source=u_id_str,
                    target=f"club_{u.club_id}",
                    relation="member_of",
                )
            )
        # Multi-space supervising lead links
        for su_id in assigned_su_ids_by_user.get(u.id, []):
            links.append(
                ClusterGraphLink(
                    source=u_id_str,
                    target=f"su_{su_id}",
                    relation="supervised_by",
                )
            )

    # Add Club centroid nodes
    for c in clubs:
        nodes.append(
            ClusterGraphNode(
                id=f"club_{c.id}",
                name=c.name,
                role="club",
                club_id=str(c.id),
                club_name=c.name,
                member_count=member_counts.get(str(c.id), 0),
            )
        )

    return ClusterGraphResponse(nodes=nodes, links=links)


@router.get("/esp32/devices")
async def list_admin_esp32_devices(
    _admin: dict = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    """List all registered ESP32 devices, compact secrets, and live Emergency Master TOTP PINs.

    Strictly restricted to the Root Administrator.
    """
    devices = await ESP32Service.list_devices(session)
    time_step = TotpService.EMERGENCY_TOTP_TIME_STEP_SECONDS
    result = []
    for d in devices:
        totp_data = TotpService.compute_totp(d.device_secret, time_step=time_step)
        result.append({
            "id": str(d.id),
            "device_id": d.device_id,
            "name": d.name,
            "space_id": d.space_id,
            "device_secret": d.device_secret,
            "is_disabled": d.is_disabled,
            "disabled_by_email": d.disabled_by_email,
            "disabled_reason": d.disabled_reason,
            "totp_pin": totp_data["pin"],
            "totp_remaining_seconds": totp_data["remaining_seconds"],
            "totp_time_step": time_step,
            "totp_valid_till": totp_data["valid_till"],
            "is_online": esp32_manager.is_device_online(d.device_id) or d.is_online,
            "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None,
            "last_ping_ms": d.last_ping_ms,
            "firmware_version": d.firmware_version,
            "ip_address": d.ip_address,
            "mac_address": d.mac_address,
            "created_at": d.created_at.isoformat(),
        })
    return result


@router.get("/esp32/totp")
async def get_emergency_totp_keys(
    _admin: dict = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Return live Emergency Master TOTP PINs for all registered spaces.

    Strictly restricted to the Root Administrator.
    """
    time_step = TotpService.EMERGENCY_TOTP_TIME_STEP_SECONDS
    devices = await ESP32Service.list_devices(session)
    result = {}
    for d in devices:
        totp_data = TotpService.compute_totp(d.device_secret, time_step=time_step)
        item = {
            "device_id": d.device_id,
            "space_id": d.space_id or "",
            "pin": totp_data["pin"],
            "remaining_seconds": totp_data["remaining_seconds"],
            "time_step": time_step,
            "valid_till": totp_data["valid_till"],
        }
        result[d.device_id] = item
        if d.space_id and d.space_id not in result:
            result[d.space_id] = item
    return result


@router.post("/esp32/devices/{space_id}/rotate-secret")
async def rotate_admin_esp32_secret(
    space_id: str,
    _admin: dict = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Rotate the compact 32-char hex device secret for a specific ESP32 door lock (or space fallback).

    Strictly restricted to the Root Administrator.
    """
    new_secret = await ESP32Service.rotate_device_secret(session, space_id)
    dev = await ESP32Service.get_device_by_identifier(session, space_id)
    time_step = TotpService.EMERGENCY_TOTP_TIME_STEP_SECONDS
    totp_data = TotpService.compute_totp(new_secret, time_step=time_step)
    return {
        "status": "success",
        "device_id": dev.device_id if dev else space_id,
        "space_id": dev.space_id if dev else space_id,
        "new_device_secret": new_secret,
        "totp_pin": totp_data["pin"],
        "totp_remaining_seconds": totp_data["remaining_seconds"],
        "totp_time_step": time_step,
        "totp_valid_till": totp_data["valid_till"],
        "message": "Device secret rotated successfully (32-char hex). Update the ESP32 node configuration with this token."
    }


@router.get("/settings/pin-validity")
async def get_pin_validity_setting(
    _admin: dict = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Retrieve the current dynamic PIN validity lifespan in seconds.

    Strictly restricted to the Root Administrator.
    """
    seconds = await SystemSettingService.get_pin_validity_seconds(session)
    return {
        "pin_validity_seconds": seconds,
        "pin_validity_minutes": round(seconds / 60.0, 2),
    }


@router.put("/settings/pin-validity")
async def update_pin_validity_setting(
    payload: PinValidityUpdateRequest,
    _admin: dict = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Update dynamic user PIN validity lifespan in seconds.

    Controls user keypad access pass lifespan only; Emergency Master TOTP always
    uses a fixed 24-hour (86400s) window. Strictly restricted to Root Admin.
    """
    updated_sec = await SystemSettingService.set_pin_validity_seconds(session, payload.pin_validity_seconds)
    # Immediately purge requests exceeding the newly configured lifespan
    await RequestCleanupService.cleanup_expired_requests(session)
    return {
        "status": "success",
        "pin_validity_seconds": updated_sec,
        "pin_validity_minutes": round(updated_sec / 60.0, 2),
        "message": f"Access PIN validity duration updated to {updated_sec} seconds ({round(updated_sec/60.0, 1)} min)."
    }


@router.post("/esp32/firmware")
async def upload_firmware_binary(
    version: str = Form(...),
    target_space_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
    admin: dict = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Upload compiled .bin firmware release, compute SHA-256, store on disk, and dispatch OTA_UPDATE.

    Strictly restricted to the Root Administrator.
    """
    from backend.app.core.sql_shield import (
        SAFE_SLUG_RE,
        SAFE_VERSION_RE,
        assert_safe_identifier,
        detect_sql_injection,
    )

    try:
        clean_version = assert_safe_identifier(version, SAFE_VERSION_RE, "firmware version")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    clean_target = (
        target_space_id.strip()
        if target_space_id and target_space_id.strip() and target_space_id.strip() != "all"
        else None
    )
    if clean_target:
        try:
            clean_target = assert_safe_identifier(clean_target, SAFE_SLUG_RE, "target facility space ID")
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    raw_filename = Path(file.filename or "firmware.bin").name
    if detect_sql_injection(raw_filename):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid firmware filename."
        )

    # Check version uniqueness
    res = await session.execute(
        select(ESP32FirmwareRelease).where(ESP32FirmwareRelease.version == clean_version)
    )
    if res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Firmware release version '{clean_version}' already exists."
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded firmware file is empty."
        )

    sha256_hash = hashlib.sha256(content).hexdigest()
    safe_filename = f"{clean_version}_{raw_filename}"
    from backend.app.config.settings import settings
    firmware_dir = Path(settings.BASE_DIR) / "backend" / "firmware_bins"
    firmware_dir.mkdir(parents=True, exist_ok=True)
    file_path = firmware_dir / safe_filename
    with open(file_path, "wb") as f:
        f.write(content)

    release = ESP32FirmwareRelease(
        version=clean_version,
        filename=safe_filename,
        sha256_checksum=sha256_hash,
        target_space_id=clean_target,
        uploaded_by_email=admin["email"],
    )
    session.add(release)
    await session.commit()
    await session.refresh(release)

    # Determine target spaces
    if release.target_space_id:
        target_spaces = [release.target_space_id]
    else:
        target_spaces = [s.slug for s in get_registered_spaces()]

    # Dispatch OTA_UPDATE command to target spaces via Outbox & WebSocket
    download_url = f"/api/esp32/firmware/{release.id}/download"
    ota_payload = {
        "version": release.version,
        "url": download_url,
        "sha256": release.sha256_checksum,
    }

    dispatched_count = 0
    for sp in target_spaces:
        await ESP32Service.enqueue_command(
            session=session,
            space_id=sp,
            command_type="OTA_UPDATE",
            payload=ota_payload
        )
        dispatched_count += 1

    return {
        "status": "success",
        "release_id": str(release.id),
        "version": release.version,
        "filename": release.filename,
        "sha256_checksum": release.sha256_checksum,
        "target_space_id": release.target_space_id,
        "dispatched_to_spaces": target_spaces,
        "message": f"Firmware v{release.version} stored and OTA update dispatched to {dispatched_count} space(s)."
    }


@router.get("/esp32/firmware")
async def list_firmware_releases(
    _admin: dict = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    """List all uploaded firmware releases.

    Strictly restricted to the Root Administrator.
    """
    res = await session.execute(
        select(ESP32FirmwareRelease).order_by(ESP32FirmwareRelease.created_at.desc())
    )
    releases = res.scalars().all()
    return [
        {
            "id": str(r.id),
            "version": r.version,
            "filename": r.filename,
            "sha256_checksum": r.sha256_checksum,
            "target_space_id": r.target_space_id or "All Spaces",
            "uploaded_by_email": r.uploaded_by_email,
            "created_at": r.created_at.isoformat(),
        }
        for r in releases
    ]


@router.post("/system-reset")
async def admin_system_reset(
    _admin: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Execute operational administrative reset (preserves Facility Spaces, Locks, and Admins)."""
    stats = await execute_admin_system_reset(session)
    return {
        "status": "success",
        "message": "Operational System Reset executed successfully.",
        "stats": stats
    }


@router.post("/factory-reset")
async def root_admin_factory_reset(
    current_root_admin: dict = Depends(require_root_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Execute complete Factory Reset (Zero-State) — strictly Master Root Administrator only.

    Wipes all operational entities AND all Facility Spaces, Door Locks, and non-root Admins,
    returning the system to 0 spaces and 0 locks while preserving immutable offline audit logs.
    """
    stats = await execute_factory_reset(session, current_root_admin["email"])
    return {
        "status": "success",
        "message": "Factory Reset executed successfully. System restored to 0 spaces and 0 locks.",
        "stats": stats
    }
