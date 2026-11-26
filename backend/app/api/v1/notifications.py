"""Web Push Notification API Endpoints.

Provides endpoints for:
1. Retrieving VAPID public key for browser PushManager.subscribe()
2. Registering client push subscriptions in PostgreSQL
3. Disagreeable diagnostic "Send Test Alert" endpoint for device verification
"""

from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.db.session import get_db
from backend.app.config.settings import settings
from backend.app.api.deps import get_current_actor
from backend.app.schemas.notification import (
    PushSubscriptionCreate,
    VapidPublicKeyResponse,
    NotificationTestResponse,
)
from backend.app.services.notification_service import NotificationService

router = APIRouter(prefix="/notifications", tags=["Mobile Push Notifications"])


@router.get("/vapid-public-key", response_model=VapidPublicKeyResponse)
async def get_vapid_public_key() -> VapidPublicKeyResponse:
    """Retrieve VAPID public key required to subscribe via browser PushManager."""
    return VapidPublicKeyResponse(public_key=settings.VAPID_PUBLIC_KEY)


@router.post("/subscribe", response_model=Dict[str, Any])
async def subscribe_for_push(
    payload: PushSubscriptionCreate,
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Register or refresh browser Web Push subscription for authenticated actor."""
    email = actor["email"]
    sub = await NotificationService.register_subscription(
        session=session,
        user_email=email,
        payload=payload,
    )
    return {
        "status": "success",
        "message": "Push subscription registered successfully.",
        "subscription_id": str(sub.id),
    }


@router.delete("/subscribe", response_model=Dict[str, Any])
async def unsubscribe_from_push(
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Remove all browser Web Push subscriptions for the authenticated actor."""
    removed = await NotificationService.unsubscribe_user(
        session=session,
        user_email=actor["email"],
    )
    return {"status": "success", "removed_count": removed}


@router.post("/test-alert", response_model=NotificationTestResponse)
async def send_diagnostic_test_alert(
    actor: Dict[str, Any] = Depends(get_current_actor),
    session: AsyncSession = Depends(get_db)
) -> NotificationTestResponse:
    """Send a diagnostic test alert to verify push delivery on user's device."""
    email = actor["email"]
    delivered = await NotificationService.send_test_alert(
        session=session,
        user_email=email,
    )

    if delivered == 0:
        return NotificationTestResponse(
            status="no_subscriptions",
            delivered_count=0,
            message="No active browser push subscription registered on this device yet. Please enable notifications first.",
        )

    return NotificationTestResponse(
        status="delivered",
        delivered_count=delivered,
        message=f"Test alert dispatched to {delivered} registered device(s).",
    )
