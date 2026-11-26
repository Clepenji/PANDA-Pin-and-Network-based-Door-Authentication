"""Facility Space Model Definition.

Represents physical access-controlled zones (e.g. SandBoxx 0, SandBoxx 1)
linked to dedicated IoT door controller hardware (ESP32).
Terminology strictly enforces 'Facility Space' without floor descriptions in UI metadata.
"""

import uuid
from sqlalchemy import String, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.db.base import Base


class Space(Base):
    """Facility Space entity representing physical secured areas.

    Attributes:
        id: Primary key UUID for the facility space.
        slug: Unique machine-readable identifier (e.g. sandboxx_0, sandboxx_1).
        name: Clean display name (e.g. SandBoxx 0, SandBoxx 1).
        esp32_device_id: Unique hardware controller identifier assigned to the door lock.
        is_active: Boolean indicating if space is active and accepting access requests.
    """
    __tablename__ = "spaces"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Primary key UUID for facility space"
    )

    slug: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
        doc="Unique slug identifier matching spaces registry (e.g. sandboxx_0)"
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        doc="Clean human-readable display name (e.g. SandBoxx 0)"
    )

    esp32_device_id: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        index=True,
        doc="Optional primary hardware identifier of an assigned ESP32 door controller node"
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        doc="Flag indicating operational availability of the facility space"
    )

    def __repr__(self) -> str:
        return f"<Space(slug='{self.slug}', name='{self.name}', active={self.is_active})>"
