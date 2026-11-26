"""ESP32 Command Outbox Model.

Server-side persistent queue guaranteeing command delivery (ADD_PIN, REVOKE_PIN,
PING, OTA_UPDATE) with mandatory ACK tracking and offline retry resilience.
"""

import uuid
from datetime import datetime
from typing import Dict, Any
from sqlalchemy import String, Integer, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.db.base import Base, utc_now


class ESP32CommandOutbox(Base):
    """Persistent queue of outbound hardware control messages for ESP32 nodes."""

    __tablename__ = "esp32_command_outbox"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Internal database record ID"
    )

    msg_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        unique=True,
        index=True,
        default=uuid.uuid4,
        nullable=False,
        doc="Cryptographic message ID used for ACK correlation and deduplication"
    )

    space_id: Mapped[str] = mapped_column(
        String(50),
        index=True,
        nullable=False,
        doc="Target Facility Space slug"
    )

    command_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        doc="Command category: ADD_PIN, REVOKE_PIN, PING, OTA_UPDATE"
    )

    payload: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        default=dict,
        nullable=False,
        doc="Structured command parameters"
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="PENDING",
        index=True,
        nullable=False,
        doc="Delivery status: PENDING, SENT, ACKED, FAILED"
    )

    error_code: Mapped[str | None] = mapped_column(
        String(40),
        nullable=True,
        doc="Error code if command was rejected or failed"
    )

    retry_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        doc="Number of push attempts across reconnects"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        doc="Time command was enqueued"
    )

    acked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        doc="Time ACK frame was received from physical node"
    )

    def __repr__(self) -> str:
        return f"<ESP32CommandOutbox(msg_id={self.msg_id}, space='{self.space_id}', cmd='{self.command_type}', status='{self.status}')>"
