"""ESP32 Device Registry Model.

Tracks hardware device identities, cryptographic shared secrets for HMAC
handshakes, online state, ping latency, and firmware versions.
"""

import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, Integer, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.db.base import Base, utc_now


class ESP32Device(Base):
    """ESP32 Hardware node representing an IoT door controller (lock)."""

    __tablename__ = "esp32_devices"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Primary key UUID for ESP32 device"
    )

    device_id: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        index=True,
        nullable=False,
        doc="Unique hardware controller identifier (e.g. ESP32_SANDBOXX_0_DOOR)"
    )

    name: Mapped[str] = mapped_column(
        String(100),
        default="Main Door",
        nullable=False,
        doc="Friendly display name for this door/lock (e.g. Front Door, Emergency Exit)"
    )

    space_id: Mapped[str] = mapped_column(
        String(50),
        index=True,
        nullable=False,
        doc="Associated Facility Space slug (e.g. sandboxx_0, sandboxx_1)"
    )

    device_secret: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        doc="High-entropy 64-character hexadecimal shared secret used for HMAC-SHA256 handshake"
    )

    device_secret_hash: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        doc="Optional SHA-256 hash of device secret for cryptographic auditing"
    )

    is_disabled: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        doc="Whether this lock is disabled by Root Admin (blocks all PINs except TOTP)"
    )

    disabled_by_email: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
        doc="Email of the Root Admin who placed this lock in disabled state"
    )

    disabled_reason: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        doc="Reason why lock is currently disabled"
    )

    is_online: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        doc="Live WebSocket connection state"
    )

    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        doc="Timestamp of most recent incoming frame or successful handshake"
    )

    last_ping_ms: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        doc="Most recent round-trip ping latency in milliseconds"
    )

    firmware_version: Mapped[str] = mapped_column(
        String(32),
        default="1.0.0",
        nullable=False,
        doc="Current running firmware version reported by ESP32"
    )

    ip_address: Mapped[str | None] = mapped_column(
        String(45),
        nullable=True,
        doc="Client IP address of last connected socket"
    )

    mac_address: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
        doc="Hardware MAC address of the ESP32 Wi-Fi interface (e.g. 24:6F:28:B2:1A:40)"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        doc="Device registration timestamp"
    )

    def __repr__(self) -> str:
        return f"<ESP32Device(space_id='{self.space_id}', is_online={self.is_online}, fw='{self.firmware_version}')>"
