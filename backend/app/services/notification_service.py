"""Web Push Notification Service.

Manages Web Push subscription persistence in PostgreSQL (push_subscriptions table)
and dispatches background VAPID Web Push alerts to SuperUsers when students
submit room access requests.
"""

import json
import logging
import uuid
from typing import Optional, List, Dict, Any
from pywebpush import webpush, WebPushException
from sqlalchemy import select, and_, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.config.settings import settings
from backend.app.models.push_subscription import PushSubscription
from backend.app.models.superuser import SuperUser
from backend.app.schemas.notification import PushSubscriptionCreate
from backend.app.config.spaces import get_space_by_slug

logger = logging.getLogger(__name__)


class NotificationService:
    """Service handling browser push subscription lifecycle and background VAPID push dispatch."""

    @staticmethod
    async def register_subscription(
        session: AsyncSession,
        user_email: str,
        payload: PushSubscriptionCreate,
    ) -> PushSubscription:
        """Register or update a browser push subscription for a user or superuser."""
        clean_email = user_email.lower().strip()
        endpoint_clean = payload.endpoint.strip()

        # Check if this endpoint already exists
        stmt = select(PushSubscription).where(PushSubscription.endpoint == endpoint_clean)
        res = await session.execute(stmt)
        existing = res.scalar_one_or_none()

        if existing:
            existing.user_email = clean_email
            existing.p256dh = payload.keys.p256dh
            existing.auth = payload.keys.auth
            await session.commit()
            await session.refresh(existing)
            logger.info("Updated existing push subscription for %s", clean_email)
            return existing

        new_sub = PushSubscription(
            user_email=clean_email,
            endpoint=endpoint_clean,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
        )
        session.add(new_sub)
        await session.commit()
        await session.refresh(new_sub)
        logger.info("Registered new push subscription for %s", clean_email)
        return new_sub

    @staticmethod
    def _dispatch_single_push(
        subscription_record: PushSubscription,
        title: str,
        body: str,
        url: str = "/",
        tag: str = "panda-notification",
    ) -> bool:
        """Synchronously execute VAPID push dispatch for a single subscription."""
        sub_info = {
            "endpoint": subscription_record.endpoint,
            "keys": {
                "p256dh": subscription_record.p256dh,
                "auth": subscription_record.auth,
            },
        }

        notification_payload = json.dumps({
            "title": title,
            "body": body,
            "icon": "/icons/icon-192x192.svg",
            "badge": "/icons/badge-72x72.svg",
            "tag": tag,
            "data": {
                "url": url,
            },
        })

        try:
            webpush(
                subscription_info=sub_info,
                data=notification_payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_CLAIM_EMAIL},
                timeout=2,
            )
            return True
        except WebPushException as ex:
            logger.warning("WebPush delivery failed for endpoint %s: %s", subscription_record.endpoint, ex)
            return False
        except Exception as ex:
            logger.error("Unexpected error in WebPush dispatch: %s", ex)
            return False

    @staticmethod
    async def notify_superusers_new_request(
        session: AsyncSession,
        space_id: str,
        requester_name: str,
        justification: str,
        target_su_id: Optional[uuid.UUID] = None,
    ) -> int:
        """Dispatch push notifications to SuperUsers governing the requested space."""
        target_emails: List[str] = []

        if target_su_id:
            su_res = await session.execute(
                select(SuperUser).where(and_(SuperUser.id == target_su_id, SuperUser.is_active.is_(True)))
            )
            su = su_res.scalar_one_or_none()
            if su:
                target_emails.append(su.email.lower().strip())
        else:
            # Notify all active superusers authorized for this space
            all_su_res = await session.execute(
                select(SuperUser).where(SuperUser.is_active.is_(True))
            )
            for su in all_su_res.scalars().all():
                if space_id in (su.allowed_spaces or []):
                    target_emails.append(su.email.lower().strip())

        if not target_emails:
            return 0

        # Query all active push subscriptions for these emails
        stmt = select(PushSubscription).where(PushSubscription.user_email.in_(target_emails))
        subs_res = await session.execute(stmt)
        subscriptions = subs_res.scalars().all()

        if not subscriptions:
            return 0

        space_obj = get_space_by_slug(space_id)
        space_name = space_obj.name if space_obj else space_id
        title = f"New Access Request: {space_name}"
        body = f"{requester_name} requested entry: \"{justification[:60]}\""

        sent_count = 0
        stale_ids = []

        for sub in subscriptions:
            success = NotificationService._dispatch_single_push(
                subscription_record=sub,
                title=title,
                body=body,
                url="/?tab=pending",
                tag="access-request",
            )
            if success:
                sent_count += 1

        return sent_count

    @staticmethod
    async def unsubscribe_user(
        session: AsyncSession,
        user_email: str,
    ) -> int:
        """Remove all push subscriptions for a user when Alerts are turned OFF."""
        clean_email = user_email.lower().strip()
        res = await session.execute(
            delete(PushSubscription).where(func.lower(PushSubscription.user_email) == clean_email)
        )
        await session.commit()
        return res.rowcount or 0

    @staticmethod
    async def notify_user_event(
        session: AsyncSession,
        target_email: str,
        title: str,
        body: str,
        url: str = "/",
        tag: str = "panda-event",
    ) -> int:
        """Dispatch a Web Push notification strictly to the concerned user."""
        clean_email = target_email.lower().strip()
        if not clean_email:
            return 0
        stmt = select(PushSubscription).where(func.lower(PushSubscription.user_email) == clean_email)
        subscriptions = (await session.execute(stmt)).scalars().all()
        if not subscriptions:
            return 0
        sent_count = 0
        for sub in subscriptions:
            if NotificationService._dispatch_single_push(
                subscription_record=sub,
                title=title,
                body=body,
                url=url,
                tag=tag,
            ):
                sent_count += 1
        return sent_count

    @staticmethod
    async def send_test_alert(
        session: AsyncSession,
        user_email: str,
    ) -> int:
        """Send diagnostic test push notification to subscriber's registered devices."""
        clean_email = user_email.lower().strip()
        stmt = select(PushSubscription).where(PushSubscription.user_email == clean_email)
        subs_res = await session.execute(stmt)
        subscriptions = subs_res.scalars().all()

        if not subscriptions:
            return 0

        title = "PANDA Mobile Alert: Verified Active"
        body = "Test notification delivered successfully to your device home screen."

        delivered = 0
        for sub in subscriptions:
            success = NotificationService._dispatch_single_push(
                subscription_record=sub,
                title=title,
                body=body,
                url="/",
                tag="test-alert",
            )
            if success:
                delivered += 1

        return delivered
