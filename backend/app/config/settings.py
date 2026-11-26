"""Application Settings and Environment Configuration.

Uses Pydantic Settings v2 to load, validate, and parse environment variables
from `.env` or the operating system environment.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
import os
from pathlib import Path

# Resolve base project root directory
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
BASE_DIR = _PROJECT_ROOT


class Settings(BaseSettings):
    """Global configuration settings for PANDA."""

    # Project Base Directory
    BASE_DIR: str = Field(default=str(_PROJECT_ROOT), description="Base project directory path")

    # Application Mode
    ENVIRONMENT: str = Field(default="development", description="Environment mode (development, staging, production)")
    DEBUG: bool = Field(default=False, description="Enable debug level logs, Swagger docs, and diagnostics")
    RATE_LIMIT_ENABLED: bool = Field(default=True, description="Enable sliding-window HTTP rate limiting middleware")

    # Database URLs
    # Async database URL for asyncpg engine used by FastAPI requests
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://postgres@localhost:5432/panda",
        description="Async PostgreSQL connection string using asyncpg driver"
    )
    # Sync database URL for migrations (if needed by Alembic sync engine)
    SYNC_DATABASE_URL: str = Field(
        default="postgresql://postgres@localhost:5432/panda",
        description="Sync PostgreSQL connection string"
    )

    # Security & JWT Tokens
    SECRET_KEY: str = Field(
        default="panda-jwt-secure-secret-key-change-in-production-random-token-2026",
        description="Cryptographic secret key for signing authentication tokens"
    )
    ALGORITHM: str = Field(default="HS256", description="JWT signature algorithm")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=43200, description="Token lifetime in minutes (default 30 days)")

    # Access PIN Lifespan (Production default: 24 hours = 86400 seconds)
    PIN_TTL_SECONDS: int = Field(
        default=86400,
        description="Lifespan of an approved 6-digit access PIN in seconds (production 86400s = 24 hours)"
    )
    ACTIVE_PIN_LIFESPAN_SECONDS: int = Field(
        default=86400,
        description="Alias lifespan of an approved 6-digit access PIN in seconds (24 hours)"
    )
    PIN_TTL_MINUTES: int = Field(
        default=1440,
        description="Lifespan of an approved 6-digit access PIN in minutes (24 hours)"
    )

    # Authentication Mode & Institutional Domain Restrictions
    AUTH_MODE: str = Field(
        default="dev",
        description="Authentication mode: 'dev' for direct email, 'oauth' for Google Workspace OAuth"
    )
    ALLOWED_EMAIL_DOMAIN: str = Field(
        default="",
        description="Restricted institutional email domain (e.g. 'hyderabad.bits-pilani.ac.in'). Exempts ROOT_ADMIN_EMAIL. If empty, all email domains are permitted in dev mode."
    )
    GOOGLE_CLIENT_ID: str = Field(
        default="",
        description="Google Workspace OAuth 2.0 Client ID"
    )
    GOOGLE_CLIENT_SECRET: str = Field(
        default="",
        description="Google Workspace OAuth 2.0 Client Secret"
    )
    GOOGLE_REDIRECT_URI: str = Field(
        default="",
        description="Google Workspace OAuth 2.0 Redirect URI"
    )

    # Seed Root Administrator
    ROOT_ADMIN_EMAIL: str = Field(
        default="rehankuriance@gmail.com",
        description="Email address seeded automatically as the initial Root Administrator (exempt from domain restriction)"
    )

    # Web Push Notification Configuration (VAPID)
    VAPID_PUBLIC_KEY: str = Field(
        default="BGYYyGhat5PNu2w7q_w4uhC1kdsSYOTCd8vrYSXgdxrKIoetQmhpbqxRZl_SRUxeJNubyWZXrU5F1mCkCtjLBmo",
        description="Public VAPID key for web push subscriptions"
    )
    VAPID_PRIVATE_KEY: str = Field(
        default="z3iINySUY5XeTyVsO19yv6CjFQbOo-J1FUt4LqDVscE",
        description="Private VAPID key for signing web push messages"
    )
    VAPID_CLAIM_EMAIL: str = Field(
        default="mailto:rehankuriance@gmail.com",
        description="VAPID claim contact subject email"
    )

    # Server Bind Configuration
    HOST: str = Field(default="0.0.0.0", description="IP address host binding")
    PORT: int = Field(default=8000, description="TCP port binding")
    FRONTEND_URL: str = Field(default="http://localhost:5173", description="Allowed CORS origin for frontend client")

    model_config = SettingsConfigDict(
        env_file=str(_PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )


# Instantiate singleton settings object
settings = Settings()
