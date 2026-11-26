"""Entry Log and Audit Service.

Manages recording and exporting immutable entry logs with permanent
actor and authority snapshots to guarantee attribution integrity.
"""

import csv
import io
import logging
import uuid
from typing import Optional, Dict, Any, List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.models.entry_log import EntryLog, EntryEventType
from backend.app.services.websocket_service import ws_manager

logger = logging.getLogger(__name__)


class LogService:
    """Service handling entry logging and audit trail persistence."""

    @staticmethod
    async def create_entry_log(
        session: AsyncSession,
        event_type: EntryEventType,
        space_id: str,
        actor_name: str,
        actor_email: str,
        authority_name: str,
        authority_email: str,
        pin_used: Optional[str] = None,
        justification_snapshot: Optional[str] = None,
        device_id: Optional[str] = None,
        door_name: Optional[str] = None,
    ) -> EntryLog:
        """Create and persist an immutable entry log.

        Guarantees attribution integrity by preserving actor and authority snapshots
        at event creation time so subsequent user edits or superuser deletions
        never produce self-approval or missing attribution bugs.
        Captures specific door lock (device_id and door_name) used for entry.
        """
        log_entry = EntryLog(
            event_type=event_type,
            space_id=space_id,
            device_id=device_id[:100] if device_id else None,
            door_name=door_name[:100] if door_name else None,
            actor_name=actor_name[:80],
            actor_email=actor_email[:120],
            authority_name=authority_name[:80],
            authority_email=authority_email[:120],
            pin_used=pin_used[:6] if pin_used else None,
            justification_snapshot=justification_snapshot[:256] if justification_snapshot else None,
        )
        session.add(log_entry)
        await session.flush()

        # Broadcast update over WebSockets
        await ws_manager.broadcast_space_event(
            space_slug=space_id,
            event_type=f"ENTRY_LOG_{event_type.value}",
            data={
                "id": str(log_entry.id),
                "event_type": event_type.value,
                "space_id": space_id,
                "device_id": log_entry.device_id,
                "door_name": log_entry.door_name,
                "actor_name": log_entry.actor_name,
                "actor_email": log_entry.actor_email,
                "authority_name": log_entry.authority_name,
                "authority_email": log_entry.authority_email,
                "pin_used": log_entry.pin_used,
                "justification_snapshot": log_entry.justification_snapshot,
                "created_at": log_entry.created_at.isoformat(),
            }
        )
        return log_entry

    @staticmethod
    async def export_entry_logs_csv(
        session: AsyncSession,
        include_archived: bool = True,
        include_pin_codes: bool = True,
    ) -> str:
        """Generate a complete CSV document of entry logs for administrator download.

        When include_archived=True, exports the full 3-year audit trail including logs
        cleared from the active portal view.
        """
        stmt = select(EntryLog)
        if not include_archived:
            stmt = stmt.where(EntryLog.is_archived.is_(False))
        stmt = stmt.order_by(EntryLog.created_at.desc())
        result = await session.execute(stmt)
        records = result.scalars().all()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "ID",
            "Event Type",
            "Space ID",
            "Door Name",
            "Device ID",
            "Actor Name",
            "Actor Email",
            "Authority Name",
            "Authority Email",
            "PIN Used",
            "Justification Snapshot",
            "Is Archived From View",
            "Created At (UTC)"
        ])

        for r in records:
            writer.writerow([
                str(r.id),
                r.event_type.value,
                r.space_id,
                r.door_name or "",
                r.device_id or "",
                r.actor_name,
                r.actor_email,
                r.authority_name,
                r.authority_email,
                (r.pin_used or "") if include_pin_codes else ("******" if r.pin_used else ""),
                r.justification_snapshot or "",
                "YES" if getattr(r, "is_archived", False) else "NO",
                r.created_at.isoformat()
            ])

        return output.getvalue()
