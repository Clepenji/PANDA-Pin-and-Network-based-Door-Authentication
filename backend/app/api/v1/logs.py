"""Entry Logs, Audits, and Lifecycle Maintenance API Endpoints.

Provides activity streaming, administrative CSV audit exports, and on-demand lifecycle maintenance.
"""

from typing import List, Optional, Dict, Any
from pathlib import Path
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.db.session import get_db
from backend.app.db.base import utc_now
from backend.app.api.deps import require_admin, require_superuser_or_admin
from backend.app.models.entry_log import EntryLog, EntryEventType
from backend.app.models.user import User
from backend.app.models.superuser import SuperUser
from backend.app.models.club import Club
from backend.app.config.spaces import get_space_by_slug
from backend.app.schemas.log import EntryLogResponse
from backend.app.services.log_service import LogService
from backend.app.services.lifecycle_service import (
    execute_annual_september_purge,
    execute_admin_system_reset,
)

router = APIRouter(prefix="/logs", tags=["Logs & Audits"])


@router.get("/portal", response_model=List[EntryLogResponse])
@router.get("/entry", response_model=List[EntryLogResponse])
async def list_entry_logs(
    space_slug: Optional[str] = Query(None, max_length=60, description="Filter by space slug"),
    club_name: Optional[str] = Query(None, max_length=100, description="Filter by club affiliation"),
    event_type: Optional[EntryEventType] = Query(None, description="Filter by event type"),
    start_date: Optional[datetime] = Query(None, description="Start timestamp filter (default: last 7 days, up to 3 years)"),
    end_date: Optional[datetime] = Query(None, description="End timestamp filter"),
    limit: int = Query(500, ge=1, le=5000),
    _actor: dict = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> List[EntryLogResponse]:
    """Retrieve immutable entry logs for portal UI.

    Universal Visibility: All SuperUsers and Admins can view logs across all Facility Spaces.
    UI Filtering: Strictly excludes INVALID_PIN_ATTEMPT entries (reserved for CSV internal audit)
    and strictly omits raw PIN numbers.
    Time Filter: Defaults to last 7 days, allowing queries back up to 3 years.
    """
    now = utc_now()
    eff_end = end_date or now
    eff_start = start_date or (now - timedelta(days=7))

    # Guard against queries beyond 3 years
    max_history = now - timedelta(days=3 * 365 + 1)
    if eff_start < max_history:
        eff_start = max_history

    stmt = (
        select(EntryLog, Club.name.label("user_club_name"))
        .outerjoin(User, User.email == EntryLog.actor_email)
        .outerjoin(Club, Club.id == User.club_id)
        .where(
            EntryLog.is_archived.is_(False),
            EntryLog.event_type != EntryEventType.INVALID_PIN_ATTEMPT,
            EntryLog.event_type != EntryEventType.ESP_ONLINE,
            EntryLog.created_at >= eff_start,
            EntryLog.created_at <= eff_end
        )
    )
    if space_slug and space_slug != "all":
        stmt = stmt.where(EntryLog.space_id == space_slug)

    if event_type:
        stmt = stmt.where(EntryLog.event_type == event_type)

    stmt = stmt.order_by(EntryLog.created_at.desc()).limit(limit)
    result = await session.execute(stmt)
    rows = result.all()

    # Pre-fetch superuser club map for superuser actor events
    su_clubs_res = await session.execute(
        select(SuperUser.email, Club.name)
        .outerjoin(Club, Club.id == SuperUser.club_id)
    )
    su_club_map = {email: cname for email, cname in su_clubs_res.all()}

    output: List[EntryLogResponse] = []
    for log, u_club in rows:
        eff_club = u_club or su_club_map.get(log.actor_email)
        if club_name and club_name != "all":
            if club_name == "Independent" and eff_club is not None:
                continue
            elif club_name != "Independent" and eff_club != club_name:
                continue

        sp_def = get_space_by_slug(log.space_id)
        sp_name = sp_def.name if sp_def else log.space_id

        output.append(
            EntryLogResponse(
                id=log.id,
                event_type=log.event_type,
                space_id=log.space_id,
                space_name=sp_name,
                door_name=log.door_name,
                device_id=log.device_id,
                actor_name=log.actor_name,
                actor_email=log.actor_email,
                authority_name=log.authority_name,
                authority_email=log.authority_email,
                club_name=eff_club,
                justification_snapshot=log.justification_snapshot,
                created_at=log.created_at,
            )
        )

    return output


@router.get("/audit/csv")
async def export_audit_logs_csv(
    _actor: dict = Depends(require_superuser_or_admin),
    session: AsyncSession = Depends(get_db)
) -> Response:
    """Download the complete immutable entry audit ledger as a CSV spreadsheet.

    Includes INVALID_PIN_ATTEMPT entries, PIN-to-user mapping (pin_used), and all archived logs
    for internal security auditing. Universally accessible to all SuperUsers and Admins.
    """
    is_admin = _actor.get("role") == "admin"
    csv_data = await LogService.export_entry_logs_csv(
        session,
        include_archived=True,
        include_pin_codes=is_admin,
    )
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=panda_internal_audit.csv"}
    )


@router.get("/offline-archive")
async def download_offline_archive(
    _admin: dict = Depends(require_admin)
) -> Response:
    """Download the offline audit archive file generated during administrative system resets."""
    from backend.app.config.settings import settings
    archive_path = Path(settings.BASE_DIR) / "logs" / "panda_offline_audit_archive.csv"
    if not archive_path.exists():
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="No offline audit archive file found.")
    content = archive_path.read_text(encoding="utf-8")
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=panda_offline_audit_archive.csv"}
    )


@router.post("/annual-reset")
@router.post("/annual-purge-test")
async def trigger_admin_system_reset(
    _admin: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Manually invoke the administrative system reset (Admin only).

    Purges all superusers, regular users, and registered clubs.
    Archives logs from the active UI view and exports an offline CSV copy.
    Preserves all current Facility Spaces, Admin accounts, and ESP door locks.
    """
    stats = await execute_admin_system_reset(session)
    return {
        "status": "success",
        "message": "Administrative System Reset executed successfully.",
        "stats": stats
    }
