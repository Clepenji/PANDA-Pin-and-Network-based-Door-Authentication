"""Database Initialization and Data Seeding.

Seeds the hardcoded Root Administrator, registers default Facility Space (sandboxx_0),
dynamically syncs all custom spaces from the database, and ensures initial operational records exist.
"""

import logging
import hashlib
from sqlalchemy import select, text, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.config.settings import settings
from backend.app.config.spaces import (
    REGISTERED_SPACES,
    get_registered_spaces,
    register_dynamic_space,
    FacilitySpaceDefinition,
)
from backend.app.models.admin import Admin
from backend.app.models.space import Space
from backend.app.models.esp32_device import ESP32Device
from backend.app.models.club import Club
from backend.app.models.system_setting import SystemSetting

logger = logging.getLogger(__name__)


async def seed_initial_data(session: AsyncSession) -> None:
    """Seed the root admin, initial facility spaces, and core clubs if not present.

    Args:
        session: Active asynchronous database session.
    """
    # 0. Ensure system_settings table exists & seed dynamic PIN validity lifespan
    await session.execute(text("""
        CREATE TABLE IF NOT EXISTS system_settings (
            key VARCHAR(64) PRIMARY KEY,
            value VARCHAR(255) NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    await session.execute(text("ALTER TABLE esp32_devices ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);"))
    await session.execute(text("ALTER TABLE esp32_devices ADD COLUMN IF NOT EXISTS name VARCHAR(100) DEFAULT 'Main Door';"))
    await session.execute(text("ALTER TABLE esp32_devices ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT FALSE;"))
    await session.execute(text("ALTER TABLE esp32_devices ADD COLUMN IF NOT EXISTS disabled_by_email VARCHAR(120);"))
    await session.execute(text("ALTER TABLE esp32_devices ADD COLUMN IF NOT EXISTS disabled_reason VARCHAR(255);"))
    await session.execute(text("ALTER TABLE esp32_devices ADD COLUMN IF NOT EXISTS mac_address VARCHAR(32);"))
    await session.execute(text("ALTER TABLE entry_logs ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;"))
    await session.execute(text("ALTER TABLE entry_logs ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);"))
    await session.execute(text("ALTER TABLE entry_logs ADD COLUMN IF NOT EXISTS door_name VARCHAR(100);"))
    await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS college_year VARCHAR(30) NOT NULL DEFAULT 'Not Applicable';"))
    await session.execute(text("ALTER TABLE superusers ADD COLUMN IF NOT EXISTS college_year VARCHAR(30) NOT NULL DEFAULT 'Not Applicable';"))
    await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS note VARCHAR(255);"))
    await session.execute(text("ALTER TABLE superusers ADD COLUMN IF NOT EXISTS note VARCHAR(255);"))
    await session.execute(text("ALTER TABLE superusers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();"))
    await session.execute(text("ALTER TABLE superusers ALTER COLUMN updated_at DROP NOT NULL;"))
    await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;"))
    await session.execute(text("ALTER TABLE superusers ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;"))
    await session.execute(text("ALTER TABLE admins ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;"))
    # Ensure new EntryEventType enum values exist in PostgreSQL
    from backend.app.db.session import engine
    async with engine.connect() as autocommit_conn:
        autocommit_conn = await autocommit_conn.execution_options(isolation_level="AUTOCOMMIT")
        await autocommit_conn.execute(text("ALTER TYPE entry_event_type_enum ADD VALUE IF NOT EXISTS 'USER_DELETED';"))
        await autocommit_conn.execute(text("ALTER TYPE entry_event_type_enum ADD VALUE IF NOT EXISTS 'SUPERUSER_DELETED';"))
    # Ensure esp32_devices permits multiple locks per space_id while keeping device_id unique
    await session.execute(text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE tablename = 'esp32_devices'
                  AND indexname = 'ix_esp32_devices_space_id'
                  AND indexdef LIKE '%UNIQUE%'
            ) THEN
                DROP INDEX ix_esp32_devices_space_id;
                CREATE INDEX ix_esp32_devices_space_id ON esp32_devices (space_id);
            END IF;
        END $$;
    """))
    await session.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_esp32_devices_device_id ON esp32_devices (device_id);"))

    # Check pin_validity_seconds setting
    pin_val_res = await session.execute(
        select(SystemSetting).where(SystemSetting.key == "pin_validity_seconds")
    )
    if not pin_val_res.scalar_one_or_none():
        session.add(SystemSetting(key="pin_validity_seconds", value=str(settings.ACTIVE_PIN_LIFESPAN_SECONDS)))

    # 1. Seed Hardcoded Master Root Administrator (rehankuriance@gmail.com)
    root_email = settings.ROOT_ADMIN_EMAIL.lower().strip()
    result = await session.execute(select(Admin).where(Admin.email == root_email))
    root_admin = result.scalar_one_or_none()

    if not root_admin:
        logger.info(f"Seeding master root admin: {root_email}")
        root_admin = Admin(
            email=root_email,
            name="Rehan Kurian",
            is_root=True
        )
        session.add(root_admin)
    else:
        root_admin.is_root = True
        session.add(root_admin)

    # 2. Zero default Facility Spaces on fresh database; Root Admin sets them up via portal
    db_spaces_count = (await session.execute(select(func.count(Space.id)))).scalar() or 0
    if db_spaces_count == 0:
        fresh_setting = (await session.execute(
            select(SystemSetting).where(SystemSetting.key == "fresh_setup_pending")
        )).scalar_one_or_none()
        if not fresh_setting:
            session.add(SystemSetting(key="fresh_setup_pending", value="true"))

    # 2b. Synchronize any spaces already present in PostgreSQL into in-memory registry
    REGISTERED_SPACES.clear()
    db_spaces_res = await session.execute(select(Space))
    for s in db_spaces_res.scalars().all():
        register_dynamic_space(
            slug=s.slug,
            name=s.name,
            esp32_device_id=s.esp32_device_id or f"ESP32_{s.slug.upper()}_DOOR",
            is_active=s.is_active
        )
        # Ensure ESP32 device credentials exist
        dev_res = await session.execute(
            select(ESP32Device).where(
                or_(
                    func.lower(ESP32Device.space_id) == s.slug.lower(),
                    ESP32Device.device_id == (s.esp32_device_id or "")
                )
            )
        )
        if not dev_res.scalar_one_or_none():
            seed_secret = hashlib.sha256(f"panda_esp32_secret_{s.slug}_2026".encode()).hexdigest()[:32]
            dev_id = s.esp32_device_id or f"ESP32_{s.slug.upper()}_DOOR"
            logger.info(f"Seeding ESP32 device credentials for {s.slug} (device_id={dev_id})")
            dev = ESP32Device(
                device_id=dev_id,
                name="Main Door",
                space_id=s.slug,
                device_secret=seed_secret,
                device_secret_hash=hashlib.sha256(seed_secret.encode()).hexdigest(),
                is_disabled=False,
                is_online=False,
                firmware_version="1.0.0",
            )
            session.add(dev)

    # 3. Dynamic Club handling: clubs are registered dynamically on-the-fly
    # during user or superuser registration.

    await session.commit()
    logger.info("Database initialization and seeding completed successfully.")
