"""Facility Space Domain Service.

Provides dynamic queries and real-time operational status for all registered Facility Spaces.
Guarantees that new spaces added by the root administrator are seamlessly picked up by all
business logic without code refactoring.
"""

import logging
import secrets
import hashlib
from typing import List, Optional
from sqlalchemy import select, func, and_, delete, or_, update
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.config.spaces import get_registered_spaces, register_dynamic_space, unregister_space
from backend.app.models.space import Space
from backend.app.models.esp32_device import ESP32Device
from backend.app.models.esp32_outbox import ESP32CommandOutbox
from backend.app.models.esp32_firmware import ESP32FirmwareRelease
from backend.app.models.active_pin import ActivePin
from backend.app.models.access_request import AccessRequest, RequestStatus
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.models.user import User
from backend.app.models.superuser import SuperUser
from backend.app.models.admin import Admin
from backend.app.models.push_subscription import PushSubscription
from backend.app.models.system_setting import SystemSetting
from backend.app.services.websocket_service import ws_manager
from collections import defaultdict
from backend.app.schemas.space import SpaceResponse, SpaceStatusResponse, AssignedLockSummary
from backend.app.services.esp32_service import esp32_manager
from backend.app.db.base import utc_now

logger = logging.getLogger(__name__)


class SpaceService:
    """Service encapsulating dynamic space querying and operational telemetry."""

    @staticmethod
    async def get_all_spaces(session: AsyncSession) -> List[SpaceResponse]:
        """Fetch all facility spaces configured in the database, including assigned locks."""
        stmt = select(Space).order_by(Space.slug)
        result = await session.execute(stmt)
        spaces = list(result.scalars().all())

        dev_stmt = select(ESP32Device).order_by(ESP32Device.device_id.asc())
        dev_res = await session.execute(dev_stmt)
        devices = dev_res.scalars().all()

        devs_by_space = defaultdict(list)
        for d in devices:
            devs_by_space[d.space_id].append(d)

        out = []
        for s in spaces:
            devs = devs_by_space.get(s.slug, [])
            primary_dev = s.esp32_device_id or (devs[0].device_id if devs else None)
            assigned = [
                AssignedLockSummary(
                    id=d.id,
                    device_id=d.device_id,
                    name=d.name or "Door Lock",
                    is_online=esp32_manager.is_device_online(d.device_id) or d.is_online,
                    is_disabled=d.is_disabled,
                    firmware_version=d.firmware_version or "1.0.0",
                    ip_address=d.ip_address,
                    mac_address=d.mac_address,
                    last_seen_at=d.last_seen_at,
                    last_ping_ms=d.last_ping_ms,
                )
                for d in devs
            ]
            out.append(SpaceResponse(
                id=s.id,
                slug=s.slug,
                name=s.name,
                esp32_device_id=primary_dev or "",
                is_active=s.is_active,
                assigned_devices=assigned,
            ))
        return out

    @staticmethod
    async def get_space_by_slug(session: AsyncSession, slug: str) -> Optional[SpaceResponse]:
        """Fetch space entity by unique slug, including assigned locks."""
        slug_clean = slug.strip().lower()
        stmt = select(Space).where(func.lower(Space.slug) == slug_clean)
        result = await session.execute(stmt)
        s = result.scalar_one_or_none()
        if not s:
            return None

        dev_stmt = select(ESP32Device).where(func.lower(ESP32Device.space_id) == slug_clean).order_by(ESP32Device.device_id.asc())
        dev_res = await session.execute(dev_stmt)
        devs = dev_res.scalars().all()

        primary_dev = s.esp32_device_id or (devs[0].device_id if devs else None)
        assigned = [
            AssignedLockSummary(
                id=d.id,
                device_id=d.device_id,
                name=d.name or "Door Lock",
                is_online=esp32_manager.is_device_online(d.device_id) or d.is_online,
                is_disabled=d.is_disabled,
                firmware_version=d.firmware_version or "1.0.0",
                ip_address=d.ip_address,
                mac_address=d.mac_address,
                last_seen_at=d.last_seen_at,
                last_ping_ms=d.last_ping_ms,
            )
            for d in devs
        ]
        return SpaceResponse(
            id=s.id,
            slug=s.slug,
            name=s.name,
            esp32_device_id=primary_dev or "",
            is_active=s.is_active,
            assigned_devices=assigned,
        )

    @staticmethod
    async def get_space_by_device_id(session: AsyncSession, device_id: str) -> Optional[SpaceResponse]:
        """Fetch space entity by IoT hardware controller ID."""
        dev_res = await session.execute(select(ESP32Device).where(ESP32Device.device_id == device_id))
        dev_obj = dev_res.scalar_one_or_none()
        if dev_obj and dev_obj.space_id:
            return await SpaceService.get_space_by_slug(session, dev_obj.space_id)

        stmt = select(Space).where(Space.esp32_device_id == device_id)
        result = await session.execute(stmt)
        space = result.scalar_one_or_none()
        if space:
            return await SpaceService.get_space_by_slug(session, space.slug)
        return None

    @staticmethod
    async def create_space(
        session: AsyncSession,
        slug: str,
        name: str,
        esp32_device_id: Optional[str] = None,
        lock_name: Optional[str] = "Main Door",
        is_active: bool = True
    ) -> SpaceResponse:
        """Register a new facility space and its initial ESP32 controller.

        Args:
            session: Active database session.
            slug: Unique slug identifier.
            name: Human-readable space name.
            esp32_device_id: Hardware ESP32 identifier for initial lock (auto-generated if omitted).
            lock_name: Friendly name for initial door lock.
            is_active: Whether space is immediately active.

        Returns:
            Newly created SpaceResponse instance.
        """
        slug_clean = slug.strip().lower()
        name_clean = name.strip()
        device_id_clean = (esp32_device_id or "").strip()
        if not device_id_clean:
            device_id_clean = f"ESP32_{slug_clean.upper()}_DOOR"
        lock_name_clean = (lock_name or "Main Door").strip()

        # 1. Check duplicate slug
        existing_slug = await SpaceService.get_space_by_slug(session, slug_clean)
        if existing_slug:
            from fastapi import HTTPException, status
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Facility space with slug '{slug_clean}' already exists."
            )

        # 2. Check and clean up any duplicate or orphaned devices in esp32_devices
        #    First, check if any conflicting device is legitimately assigned to another ACTIVE space.
        dev_chk = await session.execute(
            select(ESP32Device).where(
                or_(
                    ESP32Device.device_id == device_id_clean,
                    func.lower(ESP32Device.space_id) == slug_clean
                )
            )
        )
        existing_devs = dev_chk.scalars().all()
        for existing_dev in existing_devs:
            if existing_dev.space_id:
                other_space_chk = await session.execute(
                    select(Space).where(func.lower(Space.slug) == existing_dev.space_id.lower())
                )
                other_space = other_space_chk.scalar_one_or_none()
                if other_space and other_space.slug.lower() != slug_clean:
                    from fastapi import HTTPException, status
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"ESP32 door lock with hardware ID '{existing_dev.device_id}' is already assigned to active space '{other_space.name}'."
                    )

        # Purge ALL orphaned devices matching this device_id or space slug using raw SQL DELETE
        # (bypasses SQLAlchemy ORM deferred-delete batching that causes UniqueViolationError)
        if existing_devs:
            for existing_dev in existing_devs:
                logger.info(f"Purging orphaned ESP32 device '{existing_dev.device_id}' from previous deleted space '{existing_dev.space_id}'.")
                esp32_manager.disconnect_and_unregister(existing_dev.device_id, existing_dev.space_id)
            # Expunge ORM-tracked objects so they don't interfere with the raw DELETE
            for existing_dev in existing_devs:
                await session.refresh(existing_dev)
                session.expunge(existing_dev)
            await session.execute(
                delete(ESP32Device).where(
                    or_(
                        ESP32Device.device_id == device_id_clean,
                        func.lower(ESP32Device.space_id) == slug_clean
                    )
                )
            )
            await session.flush()

        new_space = Space(
            slug=slug_clean,
            name=name_clean,
            esp32_device_id=device_id_clean,
            is_active=is_active,
        )
        session.add(new_space)
        await session.flush()

        # Register initial hardware device for this space
        seed_secret = hashlib.sha256(f"panda_esp32_secret_{slug_clean}_{secrets.token_hex(8)}".encode()).hexdigest()[:32]
        new_device = ESP32Device(
            space_id=slug_clean,
            device_id=device_id_clean,
            name=lock_name_clean or f"{name_clean} Door Lock",
            device_secret=seed_secret,
            device_secret_hash=hashlib.sha256(seed_secret.encode()).hexdigest(),
            is_disabled=False,
            is_online=False,
            firmware_version="1.0.0",
        )
        session.add(new_device)

        await session.commit()
        await session.refresh(new_space)

        # Immediately update the in-memory registry so all services recognize the new space
        register_dynamic_space(
            slug=slug_clean,
            name=name_clean,
            esp32_device_id=device_id_clean,
            is_active=is_active
        )

        logger.info(f"Registered new facility space: {name_clean} ({slug_clean}) [Initial Lock: {device_id_clean} ({lock_name_clean})]")

        # Broadcast real-time WebSocket event for space creation
        try:
            from backend.app.services.websocket_service import ws_manager
            await ws_manager.broadcast("global", {
                "event_type": "FACILITY_SPACE_CREATED",
                "space_slug": slug_clean,
                "name": name_clean,
                "esp32_device_id": device_id_clean,
            })
        except Exception as e:
            logger.warning(f"Failed to broadcast space creation event: {e}")

        return await SpaceService.get_space_by_slug(session, slug_clean)

    @staticmethod
    async def update_space(
        session: AsyncSession,
        slug: str,
        name: Optional[str] = None,
        is_active: Optional[bool] = None,
        esp32_device_id: Optional[str] = None,
    ) -> SpaceResponse:
        """Update properties of an existing Facility Space (Root Admin only)."""
        slug_clean = slug.strip().lower()
        stmt = select(Space).where(Space.slug == slug_clean)
        res = await session.execute(stmt)
        space = res.scalar_one_or_none()
        if not space:
            from fastapi import HTTPException, status
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Facility Space '{slug_clean}' not found."
            )

        if name is not None and name.strip():
            space.name = name.strip()
        if is_active is not None:
            space.is_active = is_active
        if esp32_device_id is not None:
            space.esp32_device_id = esp32_device_id.strip() if esp32_device_id else None

        await session.commit()
        await session.refresh(space)

        # Update central in-memory registry
        register_dynamic_space(
            slug=space.slug,
            name=space.name,
            esp32_device_id=space.esp32_device_id or f"ESP32_{space.slug.upper()}_DOOR",
            is_active=space.is_active,
        )

        # Broadcast update over WebSocket
        try:
            from backend.app.services.websocket_service import ws_manager
            await ws_manager.broadcast("global", {
                "type": "SPACE_UPDATED",
                "space": {
                    "slug": space.slug,
                    "name": space.name,
                    "is_active": space.is_active,
                }
            })
        except Exception as e:
            logger.warning(f"Failed to broadcast space update: {e}")

        logger.info(f"Updated facility space: {space.name} ({space.slug}) [Active: {space.is_active}]")
        return await SpaceService.get_space_by_slug(session, slug_clean)

    @staticmethod
    async def remove_space(
        session: AsyncSession,
        slug: str,
        admin_email: str
    ) -> bool:
        """Remove a facility space and cascade updates across the User Directory:
        
        1. Users registered to ONLY this space are completely deleted.
        2. SuperUsers authorized for ONLY this space are reverted to normal Users.
        3. SuperUsers authorized for multiple spaces have this space removed from allowed_spaces.
        4. UserSpaceAssignments for this space are deleted.
        5. ActivePins, AccessRequests for this space are revoked/deleted.
        6. Associated ESP32 devices are disconnected and removed.
        7. Space record is removed from DB and in-memory registry.
        8. Real-time WebSockets event broadcasted to update User Directory across all clients.
        """
        slug_clean = slug.strip().lower()
        db_space = (await session.execute(
            select(Space).where(func.lower(Space.slug) == slug_clean)
        )).scalar_one_or_none()
        if not db_space:
            from fastapi import HTTPException, status
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Facility Space '{slug_clean}' not found."
            )
        primary_dev_id = db_space.esp32_device_id

        # Check existing admins and superusers
        admin_emails = {a.email.lower().strip() for a in (await session.execute(select(Admin))).scalars().all()}
        all_superusers = (await session.execute(select(SuperUser))).scalars().all()
        deleted_account_emails: List[str] = []
        authority_changed_emails: List[str] = []

        # A. Regular Users who were registered ONLY to this space (including waiting room) keep their
        # User profile intact, but their space tab, active pins, and requests for this space are deleted
        # in step C AND their active session is invalidated (thrown out) so they must log in again.
        affected_assign_uids = (await session.execute(
            select(UserSpaceAssignment.user_id).where(func.lower(UserSpaceAssignment.space_id) == slug_clean).distinct()
        )).scalars().all()
        su_emails_set = {s.email.lower().strip() for s in all_superusers}
        waiting_room_logout_emails: List[str] = []
        for uid in affected_assign_uids:
            other_count = (await session.execute(
                select(func.count(UserSpaceAssignment.id)).where(
                    and_(
                        UserSpaceAssignment.user_id == uid,
                        func.lower(UserSpaceAssignment.space_id) != slug_clean,
                    )
                )
            )).scalar_one()
            if other_count == 0:
                u_rec = (await session.execute(select(User).where(User.id == uid))).scalar_one_or_none()
                if u_rec:
                    u_email = u_rec.email.lower().strip()
                    if u_email not in admin_emails and u_email not in su_emails_set:
                        u_rec.token_version = (getattr(u_rec, "token_version", 1) or 1) + 1
                        session.add(u_rec)
                        waiting_room_logout_emails.append(u_email)

        # B. Cascade update or delete SuperUsers authorized for this space
        for su in all_superusers:
            allowed = [s.strip().lower() for s in (su.allowed_spaces or [])]
            if slug_clean in allowed:
                remaining_spaces = [s for s in allowed if s != slug_clean]
                su_email_clean = su.email.lower().strip()
                if len(remaining_spaces) == 0:
                    # SuperUser had authority over ONLY this space -> Delete their SuperUser account
                    logger.info(f"Deleting SuperUser account {su.email} (only authorized space '{slug_clean}' removed).")
                    existing_user = (await session.execute(
                        select(User).where(func.lower(User.email) == su_email_clean)
                    )).scalar_one_or_none()

                    if existing_user and su_email_clean not in admin_emails:
                        other_assigns = (await session.execute(
                            select(func.count(UserSpaceAssignment.id)).where(
                                and_(
                                    UserSpaceAssignment.user_id == existing_user.id,
                                    func.lower(UserSpaceAssignment.space_id) != slug_clean,
                                )
                            )
                        )).scalar_one()
                        if other_assigns == 0:
                            await session.execute(delete(ActivePin).where(ActivePin.holder_user_id == existing_user.id))
                            await session.execute(delete(AccessRequest).where(AccessRequest.requester_user_id == existing_user.id))
                            await session.execute(delete(UserSpaceAssignment).where(UserSpaceAssignment.user_id == existing_user.id))
                            await session.execute(delete(PushSubscription).where(PushSubscription.user_email == su_email_clean))
                            await session.execute(delete(SystemSetting).where(SystemSetting.key == f"last_login:{su_email_clean}"))
                            await session.delete(existing_user)

                    await session.delete(su)
                    deleted_account_emails.append(su_email_clean)
                else:
                    # SuperUser still governs other spaces -> Keep SuperUser with updated allowed_spaces
                    su.allowed_spaces = remaining_spaces
                    flag_modified(su, "allowed_spaces")
                    su.token_version = (getattr(su, "token_version", 1) or 1) + 1
                    su.updated_at = utc_now()
                    session.add(su)
                    synced_u = (await session.execute(
                        select(User).where(func.lower(User.email) == su_email_clean)
                    )).scalar_one_or_none()
                    if synced_u:
                        synced_u.token_version = (getattr(synced_u, "token_version", 1) or 1) + 1
                        session.add(synced_u)
                    authority_changed_emails.append(su_email_clean)

        # C. Delete assignments (user space tabs), active pins, access requests, and outbox commands for this space
        # Note: EntryLog audit records are strictly immutable and preserved.
        await session.execute(delete(UserSpaceAssignment).where(func.lower(UserSpaceAssignment.space_id) == slug_clean))
        await session.execute(delete(ActivePin).where(func.lower(ActivePin.space_id) == slug_clean))
        await session.execute(delete(AccessRequest).where(func.lower(AccessRequest.space_id) == slug_clean))
        await session.execute(delete(ESP32CommandOutbox).where(func.lower(ESP32CommandOutbox.space_id) == slug_clean))

        # D. Nullify target_space_id in firmware releases targeting this removed space
        await session.execute(
            update(ESP32FirmwareRelease)
            .where(func.lower(ESP32FirmwareRelease.target_space_id) == slug_clean)
            .values(target_space_id=None)
        )

        # E. Disconnect and remove all ESP32 devices associated with this space
        dev_res = await session.execute(
            select(ESP32Device).where(
                or_(
                    func.lower(ESP32Device.space_id) == slug_clean,
                    ESP32Device.device_id == (primary_dev_id or "")
                )
            )
        )
        removed_devices = dev_res.scalars().all()
        for dev in removed_devices:
            esp32_manager.disconnect_and_unregister(dev.device_id, slug_clean)
            await session.delete(dev)

        # F. Delete space DB record and unregister from in-memory map
        await session.delete(db_space)
        unregister_space(slug_clean)

        await session.commit()

        # G. Broadcast real-time WebSocket events for User Directory, Auth, and Space updates
        await ws_manager.broadcast("global", {
            "event_type": "FACILITY_SPACE_REMOVED",
            "type": "FACILITY_SPACE_REMOVED",
            "space_slug": slug_clean,
            "admin_email": admin_email,
        })
        for del_email in deleted_account_emails:
            await ws_manager.broadcast("global", {
                "event_type": "ACCOUNT_DELETED",
                "type": "ACCOUNT_DELETED",
                "email": del_email,
                "reason": f"Authorized Facility Space '{slug_clean}' was deleted.",
            })
        for auth_email in authority_changed_emails:
            await ws_manager.broadcast("global", {
                "event_type": "FORCE_LOGOUT",
                "type": "FORCE_LOGOUT",
                "email": auth_email,
                "reason": f"Your space authority changed because '{slug_clean}' was deleted. Please log in again.",
            })
        for wr_email in waiting_room_logout_emails:
            await ws_manager.broadcast("global", {
                "event_type": "FORCE_LOGOUT",
                "type": "FORCE_LOGOUT",
                "email": wr_email,
                "reason": f"Facility Space '{slug_clean}' was deleted. Please log in again.",
            })
        for dev in removed_devices:
            await ws_manager.broadcast("global", {
                "event_type": "ESP_DEVICE_DELETED",
                "type": "ESP_DEVICE_DELETED",
                "device_id": dev.device_id,
                "space_slug": slug_clean,
            })
        await ws_manager.broadcast("global", {
            "event_type": "USER_DIRECTORY_UPDATED",
            "detail": f"Facility Space '{slug_clean}' removed, user tabs & single-space superusers updated.",
        })

        logger.info(f"Facility space '{slug_clean}' completely removed and user directory cascaded by {admin_email}.")
        return True

    @staticmethod
    async def get_all_spaces_status(session: AsyncSession) -> List[SpaceStatusResponse]:
        """Calculate dynamic live status across every registered facility space.

        Iterates dynamically over all spaces to compute active PIN count and
        pending access requests.
        """
        spaces = await SpaceService.get_all_spaces(session)
        now = utc_now()
        status_list: List[SpaceStatusResponse] = []

        for space in spaces:
            # Count valid active unrevoked PINs for this space
            pin_stmt = select(func.count(ActivePin.id)).where(
                and_(
                    ActivePin.space_id == space.slug,
                    ActivePin.revoked_at.is_(None),
                    ActivePin.expires_at > now
                )
            )
            pin_res = await session.execute(pin_stmt)
            active_pin_count = pin_res.scalar() or 0

            # Count pending access requests for this space
            req_stmt = select(func.count(AccessRequest.id)).where(
                and_(
                    AccessRequest.space_id == space.slug,
                    AccessRequest.status == RequestStatus.PENDING
                )
            )
            req_res = await session.execute(req_stmt)
            pending_count = req_res.scalar() or 0

            status_list.append(
                SpaceStatusResponse(
                    slug=space.slug,
                    name=space.name,
                    is_active=space.is_active,
                    door_locked=True,
                    active_pin_count=active_pin_count,
                    pending_request_count=pending_count,
                )
            )

        return status_list
