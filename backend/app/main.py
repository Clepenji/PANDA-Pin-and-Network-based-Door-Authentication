"""PANDA (Pin And Network-based Door Authentication) - Core Application Entry Point.

FastAPI application configuration with asynchronous database lifecycle management,
APScheduler background jobs for annual September 1st resets, CORS handling,
dynamic WebSocket gateway, and SPA fallback routing.
"""

from contextlib import asynccontextmanager
import logging
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import DataError, IntegrityError, SQLAlchemyError

from backend.app.config.settings import settings
from backend.app.config.spaces import get_registered_spaces
from backend.app.core.sql_shield import SqlInjectionGuardMiddleware
from backend.app.core.rate_limit import RateLimitMiddleware
from backend.app.db.session import engine, AsyncSessionLocal
from backend.app.db.init_db import seed_initial_data
from backend.app.services.lifecycle_service import (
    lifecycle_scheduler,
    init_lifecycle_scheduler,
)
from backend.app.api.v1 import api_v1_router
from backend.app.api.v1.esp32 import router as esp32_router
from backend.app.api.v1.pins import router as pins_router

# Setup structured logging
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("panda.main")

# Paths for Frontend Static Build & SPA Routing
FRONTEND_DIST_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
FRONTEND_INDEX_HTML = FRONTEND_DIST_DIR / "index.html"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager: runs DB seeding & initializes background scheduler."""
    logger.info("Initializing PANDA application...")

    # 1. Seed initial database state: Root Admin and registered Facility Spaces
    async with AsyncSessionLocal() as session:
        try:
            await seed_initial_data(session)
        except Exception as e:
            logger.error(f"Error during startup database seeding: {e}", exc_info=True)

    # 2. Initialize and start annual reset background scheduler
    try:
        init_lifecycle_scheduler(AsyncSessionLocal)
        if not lifecycle_scheduler.running:
            lifecycle_scheduler.start()
            logger.info("APScheduler background lifecycle scheduler started.")
    except Exception as e:
        logger.error(f"Error starting lifecycle scheduler: {e}", exc_info=True)

    # 3. Startup ESP32 Synchronization & Log Reconciliation Task
    try:
        import asyncio
        from backend.app.services.esp32_service import ESP32Service
        asyncio.create_task(ESP32Service.on_server_startup_sync())
    except Exception as e:
        logger.error(f"Error launching startup ESP sync: {e}", exc_info=True)

    yield

    logger.info("Shutting down PANDA application, closing database pool and scheduler...")
    if lifecycle_scheduler.running:
        lifecycle_scheduler.shutdown(wait=False)
    await engine.dispose()


# Initialize FastAPI application (close dev OpenAPI/Swagger endpoints unless DEBUG=True)
_enable_docs = bool(settings.DEBUG and settings.ENVIRONMENT != "production")
app = FastAPI(
    title="PANDA - Pin And Network-based Door Authentication API",
    version="1.0.0",
    description="IoT-integrated facility access control system for college facilities.",
    lifespan=lifespan,
    docs_url="/api/docs" if _enable_docs else None,
    redoc_url="/api/redoc" if _enable_docs else None,
    openapi_url="/api/openapi.json" if _enable_docs else None,
)

# Enable Gzip compression for static bundles and JSON payloads > 1KB
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Active defense-in-depth SQL injection & NUL-byte inspection shield (pure ASGI)
app.add_middleware(SqlInjectionGuardMiddleware)

# Sliding-window HTTP rate limiting middleware
app.add_middleware(RateLimitMiddleware)

# Configure Cross-Origin Resource Sharing (CORS) outermost so security responses keep CORS headers
_cors_origins = [
    origin for origin in [
        settings.FRONTEND_URL,
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ] if origin
]
if settings.DEBUG:
    _cors_origins.extend(["http://localhost:5173", "http://127.0.0.1:5173"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Cache-Control", "Pragma"],
)


@app.middleware("http")
async def add_no_cache_headers_for_api(request: Request, call_next):
    """Ensure all dynamic API responses are never cached by browsers or proxies."""
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
    """Sanitized database exception handler preventing SQL/schema/driver disclosure."""
    logger.error(f"Database error processing {request.method} {request.url.path}: {exc}", exc_info=True)
    if isinstance(exc, (DataError, IntegrityError)):
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "detail": "Invalid or conflicting request data.",
                "status": "error",
            },
        )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "A database error occurred. Please contact system support.",
            "status": "error",
        },
    )


@app.exception_handler(Exception)
async def production_exception_handler(request: Request, exc: Exception):
    """Global structured error handling suppressing internal SQL/driver traces."""
    logger.error(f"Internal error processing {request.method} {request.url.path}: {exc}", exc_info=True)
    exc_module = type(exc).__module__ or ""
    is_db_driver_err = (
        isinstance(exc, SQLAlchemyError)
        or "asyncpg" in exc_module
        or "sqlalchemy" in exc_module
    )
    if not settings.DEBUG or is_db_driver_err:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "detail": "An internal server error occurred. Please contact system support.",
                "status": "error"
            }
        )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": str(exc), "status": "error"}
    )

# Register API v1 routes
app.include_router(api_v1_router)

# Direct aliases for ESP32 hardware, PIN routes, and WebSocket gateway
from backend.app.api.v1.ws import router as ws_router
app.include_router(esp32_router, prefix="/api/esp32")
app.include_router(pins_router, prefix="/api")
app.include_router(ws_router)


# Health check endpoint
@app.get("/health", tags=["Monitoring"])
async def health_check() -> dict:
    """Service health and registered facility spaces summary."""
    spaces = get_registered_spaces()
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT,
        "facility_spaces": [s.slug for s in spaces],
    }


# Static Assets Serving and SPA Fallback Routing
if FRONTEND_DIST_DIR.exists():
    assets_dir = FRONTEND_DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def spa_fallback(request: Request, full_path: str):
        """Serve index.html for client-side routing fallback if requested path is not an API route."""
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"detail": "API endpoint not found."}
            )

        target_file = FRONTEND_DIST_DIR / full_path
        if target_file.is_file():
            # Static assets with hash in filename can be cached long-term
            if full_path.startswith("assets/"):
                return FileResponse(
                    str(target_file),
                    headers={"Cache-Control": "public, max-age=31536000, immutable"}
                )
            return FileResponse(str(target_file))

        if FRONTEND_INDEX_HTML.is_file():
            # SPA entry index.html must never be cached to ensure instant UI updates
            return FileResponse(
                str(FRONTEND_INDEX_HTML),
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
            )

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"message": "PANDA API Running. Frontend build in progress."}
        )
else:
    @app.get("/", include_in_schema=False)
    async def index_root():
        """Root API response when frontend dist is not yet built."""
        return {
            "name": "PANDA API",
            "status": "running",
            "docs": "/api/docs",
            "facility_spaces": [s.slug for s in get_registered_spaces()]
        }
