"""Entry Log Model Definition.

Represents immutable operational access and verification logs.
Stores permanent actor and authority snapshots to completely prevent attribution bugs
or self-approval confusion if accounts are deleted or modified.
"""

import uuid
from datetime import datetime
import enum
from sqlalchemy import String, DateTime, Enum, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.db.base import Base, utc_now


class EntryEventType(str, enum.Enum):
    """Permitted entry event categories strictly enforced in entry_logs."""
    REQUEST_REJECTED = "REQUEST_REJECTED"
    ACCESS_GRANTED = "ACCESS_GRANTED"
    DOOR_UNLOCKED = "DOOR_UNLOCKED"
    INVALID_PIN_ATTEMPT = "INVALID_PIN_ATTEMPT"
    ESP_ONLINE = "ESP_ONLINE"
    ESP_NETWORK_RECOVERED = "ESP_NETWORK_RECOVERED"
    EXIT_BUTTON_UNLOCKED = "EXIT_BUTTON_UNLOCKED"
    REG_ACCEPTED = "REG_ACCEPTED"
    PIN_REVOKED = "PIN_REVOKED"
    USER_DELETED = "USER_DELETED"
    SUPERUSER_DELETED = "SUPERUSER_DELETED"


class EntryLog(Base):
    """Entry Log entity capturing immutable access events and keypad attempts.

    Attributes:
        id: Primary key UUID identifying the entry log.
        event_type: Strictly restricted to REQUEST_REJECTED, ACCESS_GRANTED, DOOR_UNLOCKED, INVALID_PIN_ATTEMPT.
        space_id: Facility space identifier matching modular space registry (e.g. sandboxx_0).
        actor_name: Immutable snapshot of entrant/actor's name (max 80 chars).
        actor_email: Immutable snapshot of entrant/actor's email (max 120 chars).
        authority_name: Immutable snapshot of authorizing SuperUser or Admin (max 80 chars).
        authority_email: Immutable snapshot of authorizing SuperUser or Admin (max 120 chars).
        pin_used: 6-character PIN code used or attempted (nullable for rejections).
        justification_snapshot: Preserved justification text (max 256 chars, nullable).
        created_at: Timezone-aware timestamp (indexed for reverse-chronological and retention queries).
    """
    __tablename__ = "entry_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Primary key UUID for entry log"
    )

    event_type: Mapped[EntryEventType] = mapped_column(
        Enum(EntryEventType, name="entry_event_type_enum", native_enum=True),
        nullable=False,
        index=True,
        doc="Entry event category"
    )

    space_id: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        doc="Facility space identifier matching modular space registry"
    )

    device_id: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        default=None,
        index=True,
        doc="Hardware controller identifier for the specific door lock (e.g. ESP32_SANDBOXX_0_DOOR)"
    )

    door_name: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        default=None,
        doc="Friendly door lock display name snapshot (e.g. Main Door, Back Door)"
    )

    actor_name: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
        doc="Immutable entrant display name snapshot (max 80 characters)"
    )

    actor_email: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        index=True,
        doc="Immutable entrant email snapshot (max 120 characters)"
    )

    authority_name: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
        doc="Immutable authorizing official name snapshot (max 80 characters)"
    )

    authority_email: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        doc="Immutable authorizing official email snapshot (max 120 characters)"
    )

    pin_used: Mapped[str | None] = mapped_column(
        String(6),
        nullable=True,
        doc="6-digit PIN code involved in the event"
    )

    justification_snapshot: Mapped[str | None] = mapped_column(
        String(256),
        nullable=True,
        doc="Preserved justification snapshot (max 256 characters)"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        index=True,
        nullable=False,
        doc="Timestamp of event occurrence"
    )

    is_archived: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        index=True,
        doc="Whether this log has been archived/cleared from the active operational view"
    )

    def __repr__(self) -> str:
        return f"<EntryLog(id={self.id}, event='{self.event_type.value}', actor='{self.actor_email}', space='{self.space_id}')>"
