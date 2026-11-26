"""System Setting Model.

Stores dynamic system-wide runtime configuration parameters, such as access PIN validity lifespan (TTL),
which can be updated dynamically by the Root Administrator.
"""

from datetime import datetime
from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.db.base import Base, utc_now


class SystemSetting(Base):
    """Key-value system configuration store for runtime operational settings."""

    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
        doc="Unique configuration key (e.g. pin_validity_seconds)"
    )

    value: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        doc="Configuration value serialized as string"
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
        doc="Timestamp of last update by Root Admin"
    )

    def __repr__(self) -> str:
        return f"<SystemSetting(key='{self.key}', value='{self.value}')>"
