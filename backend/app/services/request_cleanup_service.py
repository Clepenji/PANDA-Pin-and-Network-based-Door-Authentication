"""Access Request Lifecycle and Dynamic TTL Cleanup Service.

Automatically purges registration requests and PIN access requests whose lifespan
exceeds the dynamic PIN validity lifespan configured by the Root Administrator.
"""

from datetime import datetime, timezone, timedelta
import logging
import uuid
from typing import Optional, Dict, Any, List
from sqlalchemy import select, delete, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.base import utc_now
from backend.app.models.access_request import AccessRequest, RequestStatus
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.models.user import User
from backend.app.services.system_setting_service import SystemSettingService
from backend.app.services.websocket_service import ws_manager

logger = logging.getLogger(__name__)


class RequestCleanupService:
    """Service to automatically purge expired access requests and registration requests."""

    @staticmethod
    async def cleanup_expired_requests(session: AsyncSession) -> int:
        """Purge registration and PIN requests exceeding the dynamic PIN validity lifespan.

        Lifespan rules:
        - Dynamic TTL retrieved from SystemSettingService.get_pin_validity_seconds().
        - Pending requests (ACCESS or REGISTRATION) created_at <= (now - TTL).
        - Resolved requests (APPROVED / REJECTED) resolved_at <= (now - TTL).
        - For unapproved entrants whose initial REGISTRATION request expires:
          cleans up pending space assignment and unapproved User entity.
        - Emits ACCESS_REQUEST_DELETED WebSocket notifications so SuperUser & Student UIs
          drop expired items in real time.
        """
        try:
            ttl_seconds = await SystemSettingService.get_pin_validity_seconds(session)
            now = utc_now()
            cutoff = now - timedelta(seconds=ttl_seconds)

            # Query all requests exceeding TTL
            stmt = select(AccessRequest).where(
                or_(
                    and_(
                        AccessRequest.status == RequestStatus.PENDING,
                        AccessRequest.created_at <= cutoff,
                    ),
                    and_(
                        AccessRequest.status != RequestStatus.PENDING,
                        or_(
                            AccessRequest.resolved_at <= cutoff,
                            and_(
                                AccessRequest.resolved_at.is_(None),
                                AccessRequest.created_at <= cutoff,
                            ),
                        ),
                    ),
                )
            )
            res = await session.execute(stmt)
            expired_reqs = res.scalars().all()

            if not expired_reqs:
                return 0

            deleted_count = 0
            for req in expired_reqs:
                req_id = req.id
                space_id = req.space_id
                user_id = req.requester_user_id
                req_type = req.request_type
                req_status = req.status

                user_to_delete = None

                # Clean up pending space assignment for timed-out registration requests
                if req_type == "REGISTRATION" and req_status == RequestStatus.PENDING:
                    assign_stmt = select(UserSpaceAssignment).where(
                        and_(
                            UserSpaceAssignment.user_id == user_id,
                            UserSpaceAssignment.space_id == space_id,
                            UserSpaceAssignment.status == "PENDING",
                        )
                    )
                    assign_res = await session.execute(assign_stmt)
                    pending_assign = assign_res.scalar_one_or_none()
                    if pending_assign:
                        await session.delete(pending_assign)
                        await session.flush()

                    # Check if user has any other assignments (e.g. approved spaces)
                    other_stmt = select(UserSpaceAssignment).where(
                        UserSpaceAssignment.user_id == user_id
                    )
                    other_res = await session.execute(other_stmt)
                    if not other_res.scalars().all():
                        # Entrant was never approved for any space; clean up unapproved User
                        user_res = await session.execute(select(User).where(User.id == user_id))
                        user_to_delete = user_res.scalar_one_or_none()

                # Broadcast WebSocket deletion event
                try:
                    await ws_manager.broadcast_space_event(
                        space_slug=space_id,
                        event_type="ACCESS_REQUEST_DELETED",
                        data={
                            "request_id": str(req_id),
                            "space_id": space_id,
                            "expired": True,
                            "request_type": req_type,
                        },
                    )
                except Exception as ws_err:
                    logger.warning(f"Could not broadcast ACCESS_REQUEST_DELETED for {req_id}: {ws_err}")

                if user_to_delete:
                    # Deleting user cascades all child access_requests, assignments, active_pins
                    await session.delete(user_to_delete)
                else:
                    await session.delete(req)

                deleted_count += 1

            await session.commit()
            if deleted_count > 0:
                logger.info(
                    f"Purged {deleted_count} expired request(s) exceeding {ttl_seconds}s dynamic PIN validity TTL."
                )
            return deleted_count

        except Exception as e:
            await session.rollback()
            logger.error(f"Error during expired request cleanup: {e}", exc_info=True)
            return 0
