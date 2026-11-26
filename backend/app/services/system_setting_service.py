"""System Setting Service.

Handles reading and updating dynamic system configuration parameters in PostgreSQL.
"""

import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.models.system_setting import SystemSetting
from backend.app.config.settings import settings

logger = logging.getLogger(__name__)

PIN_VALIDITY_KEY = "pin_validity_seconds"


class SystemSettingService:
    """Service to read and write dynamic runtime configurations."""

    @staticmethod
    async def get_pin_validity_seconds(session: AsyncSession) -> int:
        """Get the current PIN validity lifespan in seconds.

        Defaults to settings.PIN_TTL_SECONDS (180s = 3 minutes).
        """
        try:
            stmt = select(SystemSetting).where(SystemSetting.key == PIN_VALIDITY_KEY)
            res = await session.execute(stmt)
            setting = res.scalar_one_or_none()
            if setting and setting.value:
                val = int(setting.value)
                if val > 0:
                    return val
        except Exception as e:
            logger.warning(f"Could not load dynamic {PIN_VALIDITY_KEY}, falling back to default: {e}")

        return settings.PIN_TTL_SECONDS or 180

    @staticmethod
    async def set_pin_validity_seconds(session: AsyncSession, seconds: int) -> int:
        """Update the dynamic PIN validity lifespan in seconds.

        Strictly validated between 30 seconds and 86,400 seconds (24 hours).
        """
        if seconds < 30 or seconds > 86400:
            raise ValueError("PIN validity duration must be between 30 seconds and 86,400 seconds (24 hours).")

        stmt = select(SystemSetting).where(SystemSetting.key == PIN_VALIDITY_KEY)
        res = await session.execute(stmt)
        setting = res.scalar_one_or_none()

        if not setting:
            setting = SystemSetting(key=PIN_VALIDITY_KEY, value=str(seconds))
            session.add(setting)
        else:
            setting.value = str(seconds)

        await session.commit()
        await session.refresh(setting)
        logger.info(f"Updated dynamic PIN validity lifespan to {seconds} seconds.")
        return seconds
