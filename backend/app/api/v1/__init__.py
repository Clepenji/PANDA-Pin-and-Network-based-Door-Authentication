"""API v1 router assembly."""
from fastapi import APIRouter
from backend.app.api.v1.auth import router as auth_router
from backend.app.api.v1.spaces import router as spaces_router
from backend.app.api.v1.requests import router as requests_router
from backend.app.api.v1.pins import router as pins_router
from backend.app.api.v1.logs import router as logs_router
from backend.app.api.v1.ws import router as ws_router
from backend.app.api.v1.esp32 import router as esp32_router
from backend.app.api.v1.admin import router as admin_router
from backend.app.api.v1.notifications import router as notifications_router

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(auth_router)
api_v1_router.include_router(admin_router)
api_v1_router.include_router(spaces_router)
api_v1_router.include_router(requests_router)
api_v1_router.include_router(pins_router)
api_v1_router.include_router(logs_router)
api_v1_router.include_router(ws_router)
api_v1_router.include_router(notifications_router)
api_v1_router.include_router(esp32_router, prefix="/esp32")

__all__ = ["api_v1_router"]
