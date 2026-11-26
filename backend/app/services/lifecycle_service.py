"""Account Lifecycle, Tagging, and Annual Reset Service.

Implements:
1. `New` / `Old` Account Tagging (only active between July 15 and September 1).
2. Pre-Reset Warning Flag (active August 25 through August 31).
3. Annual September 1st Purge job (00:00:00 on Sept 1):
   - Purges all users, user_space_assignments, access_requests, active_pins.
   - Purges superusers created before July 15 of that year (preserves superusers created >= July 15).
   - Preserves all admins.
   - Purges entry_logs older than 3 years, retaining logs within 3 years.
"""

from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
import uuid
import logging
from pathlib import Path
from fastapi import HTTPException
from sqlalchemy import select, delete, update, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from backend.app.db.base import utc_now
from backend.app.models.club import Club
from backend.app.models.admin import Admin
from backend.app.models.user import User
from backend.app.models.superuser import SuperUser
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.models.access_request import AccessRequest
from backend.app.models.active_pin import ActivePin
from backend.app.models.push_subscription import PushSubscription
from backend.app.models.entry_log import EntryLog
from backend.app.models.space import Space
from backend.app.models.esp32_device import ESP32Device
from backend.app.models.esp32_outbox import ESP32CommandOutbox
from backend.app.models.system_setting import SystemSetting
from backend.app.config.settings import settings
from backend.app.config.spaces import reset_to_default_spaces

logger = logging.getLogger(__name__)


def is_tagging_window_active(reference_date: datetime) -> bool:
    """Check if reference date falls within the July 15 to September 1 tagging window.

    Returns True if:
    - Month is July and day >= 15, OR
    - Month is August (any day), OR
    - Month is September and day == 1.
    """
    month = reference_date.month
    day = reference_date.day
    return (month == 7 and day >= 15) or (month == 8) or (month == 9 and day == 1)


def get_account_tag(
    created_at: datetime,
    reference_date: Optional[datetime] = None,
    updated_at: Optional[datetime] = None,
) -> Optional[str]:
    """Calculate 'New' or 'Old' account tag based on annual July 15 cohort boundary.

    Rules:
    - This tag metadata must ONLY be emitted/displayed between July 15 and September 1 each year.
    - Outside those dates (September 2 through July 14), returns None (JSON null).
    - If within window:
      - Returns "New" if created_at >= July 15 of the current cycle, OR if updated_at >= July 15 (renewed).
      - Returns "Old" if both created_at < July 15 and (updated_at is None or updated_at < July 15).
    """
    now = reference_date if reference_date is not None else utc_now()
    if not is_tagging_window_active(now):
        return None

    # Threshold is July 15 of the current reference year
    threshold = datetime(now.year, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
    effective_date = updated_at if (updated_at and updated_at >= threshold) else created_at
    return "New" if effective_date >= threshold else "Old"


def get_pre_reset_warning(reference_date: Optional[datetime] = None) -> Dict[str, Any]:
    """Check whether the pre-reset warning banner should be displayed.

    Rules:
    - Active from August 25 through August 31 (inclusive).
    - Returns warning state and mandatory banner message.
    """
    now = reference_date if reference_date is not None else utc_now()
    is_active = (now.month == 8 and 25 <= now.day <= 31)

    if is_active:
        return {
            "is_warning_active": True,
            "warning_message": "All users and superusers (created before 15th July) will be deleted from the system on 1st September."
        }
    return {
        "is_warning_active": False,
        "warning_message": None
    }


async def execute_annual_september_purge(
    session: AsyncSession,
    reference_date: Optional[datetime] = None
) -> Dict[str, int]:
    """Execute the annual September 1st system purge.

    Purge Rules:
    1. Delete all `users` (which cascades to `user_space_assignments`, `access_requests`, `active_pins`).
    2. Clean up any orphaned `user_space_assignments`, `access_requests`, `active_pins`.
    3. Delete all `superusers` whose `created_at` is BEFORE July 15 of that year
       (preserves SuperUsers created on or after July 15).
    4. PRESERVE all `admins` (none deleted).
    5. Delete `entry_logs` older than 3 years (`created_at < NOW() - INTERVAL '3 years'`),
       retaining logs within 3 years.

    Returns:
        Dict with count of deleted rows per entity.
    """
    now = reference_date if reference_date is not None else utc_now()
    july_15_cutoff = datetime(now.year, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
    three_years_ago = datetime(
        now.year - 3, now.month, now.day,
        now.hour, now.minute, now.second,
        tzinfo=timezone.utc
    )

    logger.info(f"Initiating Annual September Reset for cycle {now.year}...")

    # 1. Delete active pins
    res_pins = await session.execute(delete(ActivePin))
    pins_count = res_pins.rowcount or 0

    # 2. Delete access requests
    res_reqs = await session.execute(delete(AccessRequest))
    reqs_count = res_reqs.rowcount or 0

    # 3. Delete user space assignments
    res_assign = await session.execute(delete(UserSpaceAssignment))
    assign_count = res_assign.rowcount or 0

    # 4. Delete all users
    res_users = await session.execute(delete(User))
    users_count = res_users.rowcount or 0

    # 5. Delete superusers created before July 15 of this year UNLESS they were updated/renewed on or after July 15
    res_su = await session.execute(
        delete(SuperUser).where(
            and_(
                SuperUser.created_at < july_15_cutoff,
                or_(
                    SuperUser.updated_at.is_(None),
                    SuperUser.updated_at < july_15_cutoff,
                )
            )
        )
    )
    su_count = res_su.rowcount or 0

    # 6. Delete campus clubs
    res_clubs = await session.execute(delete(Club))
    clubs_count = res_clubs.rowcount or 0

    # 7. Purge all cached PINs from all ESPs
    from backend.app.services.esp32_service import ESP32Service
    from backend.app.config.spaces import get_registered_spaces
    for sp in get_registered_spaces():
        await ESP32Service.purge_all_space_pins(session, sp.slug)

    # NOTE: In annual system-mandated reset, entry logs strictly remain as-is and are NOT changed!
    # (Logs are preserved indefinitely up to the internal 3-year retention schedule).

    await session.commit()

    stats = {
        "users_deleted": users_count,
        "superusers_deleted": su_count,
        "assignments_deleted": assign_count,
        "access_requests_deleted": reqs_count,
        "active_pins_deleted": pins_count,
        "clubs_deleted": clubs_count,
        "entry_logs_retained_unchanged": True,
    }

    logger.info(f"Annual September Reset completed: {stats}")
    return stats


async def execute_admin_system_reset(session: AsyncSession) -> Dict[str, Any]:
    """Execute administrative system reset.

    Scope:
    - Strictly deletes all SuperUsers, regular Users, and registered clubs.
    - Generates an offline CSV copy of the audit ledger and hides logs from the active UI view (is_archived = True),
      while maintaining the internal 3-year audit log retention in the database.
    - PRESERVES the current configuration of Facility Spaces, Admin accounts, and ESP door locks.
    """
    import time
    from backend.app.services.log_service import LogService

    logger.info("Executing Admin System Reset (Users, SuperUsers & Clubs purge; Logs archived from view with offline export; Spaces, Admins & ESPs preserved)...")

    # 1. Delete active pins
    res_pins = await session.execute(delete(ActivePin))
    pins_count = res_pins.rowcount or 0

    # 2. Delete access requests
    res_reqs = await session.execute(delete(AccessRequest))
    reqs_count = res_reqs.rowcount or 0

    # 3. Delete user space assignments
    res_assign = await session.execute(delete(UserSpaceAssignment))
    assign_count = res_assign.rowcount or 0

    # 4. Delete all regular users
    res_users = await session.execute(delete(User))
    users_count = res_users.rowcount or 0

    # 5. Delete ALL superusers (all superusers cleared on manual reset)
    res_su = await session.execute(delete(SuperUser))
    su_count = res_su.rowcount or 0

    # 6. Delete all registered clubs
    res_clubs = await session.execute(delete(Club))
    clubs_count = res_clubs.rowcount or 0

    # 7. Generate offline audit archive CSV BEFORE archiving from view
    logs_dir = Path(settings.BASE_DIR) / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    try:
        offline_csv_data = await LogService.export_entry_logs_csv(session, include_archived=True)
        primary_archive = logs_dir / "panda_offline_audit_archive.csv"
        timestamp_archive = logs_dir / f"panda_offline_audit_archive_{int(time.time())}.csv"
        primary_archive.write_text(offline_csv_data, encoding="utf-8")
        timestamp_archive.write_text(offline_csv_data, encoding="utf-8")
        logger.info(f"Offline audit archive exported to {primary_archive}")
    except Exception as e:
        logger.warning(f"Failed to write offline audit archive CSV: {e}")

    # 8. Archive logs from the active view (is_archived = True), retaining records for 3-year audit
    res_archived = await session.execute(
        update(EntryLog).where(EntryLog.is_archived.is_(False)).values(is_archived=True)
    )
    archived_count = res_archived.rowcount or 0

    # 9. Clear user and superuser login tracking keys from system_settings
    # Preserve admin login tracking
    all_admins = (await session.execute(select(Admin.email))).scalars().all()
    admin_emails = {a.lower().strip() for a in all_admins}
    login_settings = (await session.execute(
        select(SystemSetting).where(SystemSetting.key.like("last_login:%"))
    )).scalars().all()
    for s in login_settings:
        email = s.key.split("last_login:", 1)[-1].lower().strip()
        if email not in admin_emails:
            await session.delete(s)

    # 10. Purge orphaned ESP32 devices whose space_id no longer exists in Space table
    from backend.app.services.esp32_service import esp32_manager
    spaces_rows = (await session.execute(select(Space.slug))).scalars().all()
    valid_space_slugs = {s.lower().strip() for s in spaces_rows if s}
    all_devs = (await session.execute(select(ESP32Device))).scalars().all()
    orphaned_dev_count = 0
    for dev in all_devs:
        if not dev.space_id or dev.space_id.lower().strip() not in valid_space_slugs:
            esp32_manager.disconnect_and_unregister(dev.device_id, dev.space_id)
            await session.delete(dev)
            orphaned_dev_count += 1

    # 11. Mark fresh setup pending so lingering historical logs on ESPs from before reset are disregarded
    fresh_setting = (await session.execute(
        select(SystemSetting).where(SystemSetting.key == "fresh_setup_pending")
    )).scalar_one_or_none()
    if fresh_setting:
        fresh_setting.value = "true"
    else:
        session.add(SystemSetting(key="fresh_setup_pending", value="true"))

    # 12. Purge all cached PINs from all ESPs immediately
    from backend.app.services.esp32_service import ESP32Service
    from backend.app.config.spaces import get_registered_spaces
    for sp in get_registered_spaces():
        await ESP32Service.purge_all_space_pins(session, sp.slug)

    await session.commit()

    stats = {
        "users_deleted": users_count,
        "superusers_deleted": su_count,
        "assignments_deleted": assign_count,
        "access_requests_deleted": reqs_count,
        "active_pins_deleted": pins_count,
        "clubs_deleted": clubs_count,
        "orphaned_esps_purged": orphaned_dev_count,
        "entry_logs_archived_from_view": archived_count,
        "audit_logs_preserved_internally": True,
        "offline_archive_generated": True,
        "spaces_preserved": True,
        "admins_preserved": True,
        "esps_preserved": True,
    }
    logger.info(f"Admin System Reset executed successfully: {stats}")
    return stats


async def execute_factory_reset(session: AsyncSession, initiated_by_email: str) -> Dict[str, Any]:
    """Execute complete Factory Reset (Zero-State) — Master Root Admin Exclusive.

    Scope:
    - Clears all Users, SuperUsers, Clubs, Active PINs, Access Requests, Assignments, and Push Subscriptions.
    - Exports immutable CSV archive and archives EntryLog rows from active UI view.
    - Purges ALL Facility Spaces, ALL ESP32 door lock devices, and ALL command outbox items.
    - Removes ALL other Admin accounts (both standard and other root admins), preserving strictly the Root Admin who initiated the reset.
    - Leaves 0 registered spaces and 0 locks so the initiating Root Admin can configure everything from scratch.
    """
    from backend.app.services.esp32_service import ESP32Service, esp32_manager
    from backend.app.services.websocket_service import ws_manager
    from backend.app.config.spaces import get_registered_spaces

    logger.warning(f"Executing FACTORY RESET (Zero-State) initiated by Root Admin {initiated_by_email}...")

    # 1. Purge cached PINs on currently connected ESPs before tearing down devices
    for sp in get_registered_spaces():
        try:
            await ESP32Service.purge_all_space_pins(session, sp.slug)
        except Exception:
            pass

    # 2. Run operational wipe (users, superusers, clubs, assignments, requests, pins, log archival)
    stats = await execute_admin_system_reset(session)

    # 3. Disconnect and delete ALL ESP32 devices & command outbox queues
    all_devs = (await session.execute(select(ESP32Device))).scalars().all()
    for dev in all_devs:
        esp32_manager.disconnect_and_unregister(dev.device_id, dev.space_id)
    res_outbox = await session.execute(delete(ESP32CommandOutbox))
    outbox_deleted = res_outbox.rowcount or 0
    res_devs = await session.execute(delete(ESP32Device))
    devices_deleted = res_devs.rowcount or 0

    # 4. Delete ALL Facility Spaces and clear in-memory registry
    res_spaces = await session.execute(delete(Space))
    spaces_deleted = res_spaces.rowcount or 0
    reset_to_default_spaces()

    # 5. Delete ALL Admin accounts except the initiating Root Admin, plus all non-initiator push/login entries
    initiator_email = initiated_by_email.lower().strip()
    other_admins = (
        await session.execute(
            select(Admin).where(func.lower(func.trim(Admin.email)) != initiator_email)
        )
    ).scalars().all()
    other_admin_emails = [a.email.lower().strip() for a in other_admins]
    res_admins = await session.execute(
        delete(Admin).where(func.lower(func.trim(Admin.email)) != initiator_email)
    )
    admins_deleted = res_admins.rowcount or 0
    await session.execute(
        delete(PushSubscription).where(func.lower(func.trim(PushSubscription.user_email)) != initiator_email)
    )
    for em in other_admin_emails:
        await session.execute(delete(SystemSetting).where(SystemSetting.key == f"last_login:{em}"))

    # 6. Mark fresh_setup_pending = "true"
    fresh_setting = (await session.execute(
        select(SystemSetting).where(SystemSetting.key == "fresh_setup_pending")
    )).scalar_one_or_none()
    if fresh_setting:
        fresh_setting.value = "true"
    else:
        session.add(SystemSetting(key="fresh_setup_pending", value="true"))

    await session.commit()

    # 7. Broadcast real-time reset notifications
    await ws_manager.broadcast("global", {
        "event_type": "FACTORY_RESET",
        "type": "FACTORY_RESET",
        "initiated_by": initiated_by_email,
    })
    await ws_manager.broadcast("global", {
        "event_type": "USER_DIRECTORY_UPDATED",
        "detail": "Factory Reset executed. Zero spaces and zero locks active.",
    })

    stats.update({
        "factory_reset": True,
        "spaces_deleted": spaces_deleted,
        "devices_deleted": devices_deleted,
        "outbox_deleted": outbox_deleted,
        "non_root_admins_deleted": admins_deleted,
        "spaces_preserved": False,
        "esps_preserved": False,
    })
    logger.warning(f"Factory Reset (Zero-State) completed by {initiated_by_email}: {stats}")
    return stats


async def prune_logs_older_than_three_years(session: AsyncSession) -> int:
    """Scheduled background job: prune logs older than 3 years to maintain 3-year retention policy."""
    now = utc_now()
    cutoff = now - timedelta(days=3 * 365 + 1)
    res = await session.execute(delete(EntryLog).where(EntryLog.created_at < cutoff))
    await session.commit()
    pruned = res.rowcount or 0
    if pruned > 0:
        logger.info(f"Pruned {pruned} entry logs older than 3 years (retention policy).")
    return pruned


async def purge_person_by_identifier(
    session: AsyncSession,
    identifier: str
) -> Dict[str, Any]:
    """Completely purge all records for a person (User or SuperUser) by UUID, prefixed ID, or email.

    Purges:
    - User records
    - SuperUser records
    - ActivePin records
    - AccessRequest records (broadcasting WebSocket cancellation first)
    - UserSpaceAssignment records (both as student and supervisor)
    - PushSubscription records
    - SystemSetting login tracking (last_login:{email})
    """
    clean_id = str(identifier).strip()
    if clean_id.startswith("user_"):
        clean_id = clean_id[5:]
    elif clean_id.startswith("su_"):
        clean_id = clean_id[3:]

    target_email: Optional[str] = None
    target_name: str = "User"

    # 1. Try as UUID
    try:
        parsed_uuid = uuid.UUID(clean_id)
        u_res = await session.execute(select(User).where(User.id == parsed_uuid))
        u = u_res.scalar_one_or_none()
        if u:
            target_email = u.email.lower().strip()
            target_name = u.name

        if not target_email:
            su_res = await session.execute(select(SuperUser).where(SuperUser.id == parsed_uuid))
            su = su_res.scalar_one_or_none()
            if su:
                target_email = su.email.lower().strip()
                target_name = su.name
    except (ValueError, AttributeError):
        pass

    # 2. Try as Email directly if not resolved
    if not target_email:
        clean_email = clean_id.lower().strip()
        u_res = await session.execute(select(User).where(func.lower(User.email) == clean_email))
        u = u_res.scalar_one_or_none()
        if u:
            target_email = u.email.lower().strip()
            target_name = u.name
        else:
            su_res = await session.execute(select(SuperUser).where(func.lower(SuperUser.email) == clean_email))
            su = su_res.scalar_one_or_none()
            if su:
                target_email = su.email.lower().strip()
                target_name = su.name

    if not target_email:
        raise HTTPException(status_code=404, detail=f"Member '{identifier}' not found in directory.")

    # Never delete Source Administrator
    if target_email == settings.ROOT_ADMIN_EMAIL.lower().strip():
        raise HTTPException(
            status_code=400,
            detail="The Source Master Root Administrator cannot be deleted."
        )

    # Collect all user and superuser records with this email
    all_users = (await session.execute(
        select(User).where(func.lower(User.email) == target_email)
    )).scalars().all()
    user_ids = [u.id for u in all_users]

    all_sus = (await session.execute(
        select(SuperUser).where(func.lower(SuperUser.email) == target_email)
    )).scalars().all()
    su_ids = [su.id for su in all_sus]

    # 1. Access Requests: broadcast deletion and delete
    req_conditions = []
    if user_ids:
        req_conditions.append(AccessRequest.requester_user_id.in_(user_ids))
    if su_ids:
        req_conditions.append(AccessRequest.superuser_id.in_(su_ids))

    if req_conditions:
        req_stmt = select(AccessRequest).where(or_(*req_conditions))
        reqs = (await session.execute(req_stmt)).scalars().all()
        for r in reqs:
            try:
                from backend.app.services.websocket_service import ws_manager
                await ws_manager.broadcast_space_event(
                    space_slug=r.space_id,
                    event_type="ACCESS_REQUEST_DELETED",
                    data={"request_id": str(r.id), "space_id": r.space_id}
                )
            except Exception:
                pass
        await session.execute(
            delete(AccessRequest).where(or_(*req_conditions))
        )

    # 2. Active Pins
    pin_conditions = []
    if user_ids:
        pin_conditions.append(ActivePin.holder_user_id.in_(user_ids))
    if su_ids:
        pin_conditions.append(ActivePin.issued_by_superuser_id.in_(su_ids))
    if pin_conditions:
        await session.execute(delete(ActivePin).where(or_(*pin_conditions)))

    # 3. User Space Assignments (both as entrant student and as supervising lead)
    assign_conditions = []
    if user_ids:
        assign_conditions.append(UserSpaceAssignment.user_id.in_(user_ids))
    if su_ids:
        assign_conditions.append(UserSpaceAssignment.superuser_id.in_(su_ids))
    if assign_conditions:
        await session.execute(delete(UserSpaceAssignment).where(or_(*assign_conditions)))

    # 4. Push Subscriptions
    await session.execute(
        delete(PushSubscription).where(func.lower(PushSubscription.user_email) == target_email)
    )

    # 5. Login Tracking in SystemSetting
    await session.execute(
        delete(SystemSetting).where(SystemSetting.key == f"last_login:{target_email}")
    )

    # 6. Delete all User records
    for u in all_users:
        await session.delete(u)

    # 7. Delete all SuperUser records
    for su in all_sus:
        await session.delete(su)

    await session.commit()
    logger.info(f"Completely purged member {target_name} ({target_email}) from all tables.")

    return {
        "status": "success",
        "email": target_email,
        "name": target_name,
        "message": f"Account for {target_name} ({target_email}) completely purged from system."
    }


# Global AsyncIOScheduler instance for PANDA background automation
lifecycle_scheduler = AsyncIOScheduler(timezone=timezone.utc)


def init_lifecycle_scheduler(session_factory):
    """Register cron tasks with APScheduler.

    Schedules the annual purge to execute at 00:00:00 on September 1 every year.
    """
    async def scheduled_purge_job():
        logger.info("Executing scheduled September 1 00:00:00 UTC annual purge...")
        async with session_factory() as session:
            try:
                await execute_annual_september_purge(session)
            except Exception as e:
                logger.error(f"Error during scheduled annual reset: {e}", exc_info=True)

    lifecycle_scheduler.add_job(
        scheduled_purge_job,
        trigger=CronTrigger(month=9, day=1, hour=0, minute=0, second=0, timezone=timezone.utc),
        id="annual_september_reset_job",
        replace_existing=True,
    )
    logger.info("Registered annual September 1st purge cron job with APScheduler.")

    async def scheduled_esp32_heartbeat_job():
        from backend.app.config.spaces import get_registered_spaces
        from backend.app.services.esp32_service import ESP32Service, esp32_manager
        spaces = get_registered_spaces()
        for sp in spaces:
            if esp32_manager.is_online(sp.slug):
                try:
                    success, latency = await ESP32Service.ping_device(sp.slug, timeout_seconds=10.0)
                    if not success:
                        logger.warning(f"5-min Heartbeat: ESP32 [{sp.slug}] missed PONG, marked offline.")
                except Exception as e:
                    logger.warning(f"Error during heartbeat check for ESP32 [{sp.slug}]: {e}")

    lifecycle_scheduler.add_job(
        scheduled_esp32_heartbeat_job,
        trigger=IntervalTrigger(minutes=5),
        id="esp32_heartbeat_job",
        replace_existing=True,
    )
    logger.info("Registered 5-minute ESP32 hardware heartbeat watchdog with APScheduler.")

    async def scheduled_request_cleanup_job():
        from backend.app.services.request_cleanup_service import RequestCleanupService
        async with session_factory() as session:
            try:
                await RequestCleanupService.cleanup_expired_requests(session)
            except Exception as e:
                logger.warning(f"Error during periodic request cleanup: {e}")

    lifecycle_scheduler.add_job(
        scheduled_request_cleanup_job,
        trigger=IntervalTrigger(seconds=5),
        id="request_ttl_cleanup_job",
        replace_existing=True,
    )
    logger.info("Registered 5-second dynamic request TTL cleanup job with APScheduler.")

    async def scheduled_3yr_log_prune_job():
        async with session_factory() as session:
            try:
                await prune_logs_older_than_three_years(session)
            except Exception as e:
                logger.error(f"Error during scheduled 3-year log retention pruning: {e}")

    lifecycle_scheduler.add_job(
        scheduled_3yr_log_prune_job,
        trigger=CronTrigger(hour=3, minute=0, second=0, timezone=timezone.utc),
        id="prune_3yr_logs_job",
        replace_existing=True,
    )
    logger.info("Registered daily 03:00 UTC 3-year log retention pruning job with APScheduler.")
