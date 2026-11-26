"""ESP32 Firmware Release Registry Model.

Stores binary firmware releases, SHA-256 checksums, and space deployment targets.
"""

import uuid
from datetime import datetime
from sqlalchemy import String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.db.base import Base, utc_now


class ESP32FirmwareRelease(Base):
    """Over-The-Air (OTA) firmware binary release record."""

    __tablename__ = "esp32_firmware_releases"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Firmware release UUID"
    )

    version: Mapped[str] = mapped_column(
        String(32),
        unique=True,
        index=True,
        nullable=False,
        doc="Semantic firmware version string (e.g. 1.0.1)"
    )

    filename: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        doc="Stored file name on disk"
    )

    sha256_checksum: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        doc="64-character SHA-256 hex digest for binary integrity validation"
    )

    target_space_id: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        doc="Specific target Facility Space, or NULL to deploy across all spaces"
    )

    uploaded_by_email: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        doc="Administrator who uploaded the release"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        doc="Upload timestamp"
    )

    def __repr__(self) -> str:
        return f"<ESP32FirmwareRelease(version='{self.version}', checksum='{self.sha256_checksum[:8]}...')>"
