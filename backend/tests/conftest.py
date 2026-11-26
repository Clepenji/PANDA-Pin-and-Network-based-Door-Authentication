"""Pytest global configuration and fixtures.

Ensures that tests run in a predictable test environment across all workspaces,
permitting test email domains and test credentials while keeping production .env intact.
"""

import os
import pytest
from sqlalchemy import select
from backend.app.config.settings import settings
from backend.app.db.session import AsyncSessionLocal
from backend.app.models.system_setting import SystemSetting


@pytest.fixture(autouse=True, scope="session")
def configure_test_environment():
    """Configure in-memory settings for unit testing suite."""
    orig_auth_mode = settings.AUTH_MODE
    orig_domain = settings.ALLOWED_EMAIL_DOMAIN
    orig_ttl = settings.PIN_TTL_SECONDS
    orig_lifespan = settings.ACTIVE_PIN_LIFESPAN_SECONDS
    orig_rate_limit = settings.RATE_LIMIT_ENABLED

    # Set test friendly defaults
    settings.AUTH_MODE = "dev"
    settings.ALLOWED_EMAIL_DOMAIN = ""
    settings.PIN_TTL_SECONDS = 180
    settings.ACTIVE_PIN_LIFESPAN_SECONDS = 180
    settings.RATE_LIMIT_ENABLED = False

    yield

    # Restore settings after tests
    settings.AUTH_MODE = orig_auth_mode
    settings.ALLOWED_EMAIL_DOMAIN = orig_domain
    settings.PIN_TTL_SECONDS = orig_ttl
    settings.ACTIVE_PIN_LIFESPAN_SECONDS = orig_lifespan
    settings.RATE_LIMIT_ENABLED = orig_rate_limit


@pytest.fixture(autouse=True, scope="session")
async def run_db_migrations():
    """Ensure schema migrations and baseline seeding are applied once per test session."""
    from backend.app.db.init_db import seed_initial_data

    async with AsyncSessionLocal() as session:
        await seed_initial_data(session)


@pytest.fixture(autouse=True)
async def configure_test_db_settings():
    """Ensure dynamic database setting pin_validity_seconds matches test TTL (180s)."""
    orig_val = None
    async with AsyncSessionLocal() as session:
        setting = (await session.execute(
            select(SystemSetting).where(SystemSetting.key == "pin_validity_seconds")
        )).scalar_one_or_none()
        if setting:
            orig_val = setting.value
            setting.value = "180"
            await session.commit()
        else:
            session.add(SystemSetting(key="pin_validity_seconds", value="180"))
            await session.commit()

    yield

    if orig_val is not None:
        async with AsyncSessionLocal() as session:
            setting = (await session.execute(
                select(SystemSetting).where(SystemSetting.key == "pin_validity_seconds")
            )).scalar_one_or_none()
            if setting:
                setting.value = orig_val
                await session.commit()
