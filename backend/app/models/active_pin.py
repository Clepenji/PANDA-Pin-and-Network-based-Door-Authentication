"""Active PIN Model Definition.

Represents an active, ephemeral 6-digit numeric access PIN generated upon request approval.
Enforces that active/unrevoked PINs (where revoked_at IS NULL) are strictly unique across
the entire system at any moment.
"""

import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.app.db.base import Base, utc_now


class ActivePin(Base):
    """Active PIN entity containing an authorized 6-digit access code.

    Attributes:
        id: Primary key UUID identifying the PIN record.
        pin_code: 6-character numeric PIN string (e.g. '849201').
        space_id: Facility space identifier matching modular space registry (e.g. sandboxx_0).
        holder_user_id: Foreign key to users table identifying the entrant holding this PIN.
        issued_by_superuser_id: Foreign key to superusers table (nullable on delete).
        issued_by_name_snapshot: Preserved snapshot name of approving SuperUser (max 80 chars).
        issued_by_email_snapshot: Preserved snapshot email of approving SuperUser (max 120 chars).
        expires_at: Timezone-aware timestamp when PIN naturally expires.
        revoked_at: Nullable timezone-aware timestamp when PIN was revoked prematurely.
        created_at: Timezone-aware timestamp when PIN was generated.
    """
    __tablename__ = "active_pins"
    __table_args__ = (
        # Strict constraint: enforce partial unique index on pin_code where revoked_at IS NULL
        # Guarantees that active 6-digit PINs are strictly unique across the entire system at any moment
        Index(
            "uq_active_pins_unrevoked_pin_code",
            "pin_code",
            unique=True,
            postgresql_where=text("revoked_at IS NULL")
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Primary key UUID for active PIN record"
    )

    pin_code: Mapped[str] = mapped_column(
        String(6),
        nullable=False,
        index=True,
        doc="6-digit numeric PIN string"
    )

    space_id: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        doc="Facility space identifier matching modular space registry"
    )

    holder_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        doc="Authorized entrant user foreign key"
    )

    issued_by_superuser_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("superusers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        doc="Approving SuperUser ID (nullable on delete to preserve record)"
    )

    issued_by_name_snapshot: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
        doc="Preserved snapshot of SuperUser name who authorized the PIN (max 80 chars)"
    )

    issued_by_email_snapshot: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        doc="Preserved snapshot of SuperUser email who authorized the PIN (max 120 chars)"
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        doc="Timestamp of PIN expiration"
    )

    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        doc="Timestamp of premature revocation (NULL while active and unrevoked)"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        doc="Timestamp of PIN issuance"
    )

    # Relationships
    holder_user = relationship("User", back_populates="active_pins")
    issued_by_superuser = relationship("SuperUser")

    def __repr__(self) -> str:
        return f"<ActivePin(pin='{self.pin_code}', space='{self.space_id}', user_id={self.holder_user_id}, revoked={self.revoked_at is not None})>"
