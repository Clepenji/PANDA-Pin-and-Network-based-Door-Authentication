"""User Space Assignment Model Definition.

Defines the explicit association of a user to an assigned SuperUser per Facility Space.
Enforces the strict constraint: UNIQUE(user_id, space_id) to guarantee that a user
can only be associated with ONE SuperUser per Facility Space at any given time.
"""

import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.app.db.base import Base, utc_now


class UserSpaceAssignment(Base):
    """User Space Assignment mapping a user to a specific SuperUser per Facility Space.

    Attributes:
        id: Primary key UUID identifying the assignment record.
        user_id: Foreign key to users table (cascades on delete).
        space_id: String identifier matching modular space registry (e.g. sandboxx_0).
        superuser_id: Foreign key to superusers table (authorizing SuperUser).
        created_at: Timezone-aware timestamp when assignment was created.
    """
    __tablename__ = "user_space_assignments"
    __table_args__ = (
        # Strict constraint: a user can only have at most one SuperUser assignment per space
        UniqueConstraint("user_id", "space_id", name="uq_user_space_assignment"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Primary key UUID for user space assignment"
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        doc="Assigned entrant user foreign key"
    )

    space_id: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        doc="Facility space identifier matching modular space registry"
    )

    superuser_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("superusers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        doc="Designated approving SuperUser foreign key"
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="APPROVED",
        nullable=False,
        doc="Assignment authorization status: PENDING, APPROVED, REJECTED"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        doc="Timestamp of assignment establishment"
    )

    # Relationships
    user = relationship("User", back_populates="space_assignments")
    superuser = relationship("SuperUser", back_populates="space_assignments")

    def __repr__(self) -> str:
        return f"<UserSpaceAssignment(user_id={self.user_id}, space_id='{self.space_id}', superuser_id={self.superuser_id})>"
