"""Access Request Model Definition.

Represents an entrant's formal petition for physical entry to a Facility Space,
routing to the assigned SuperUser for approval or rejection.
"""

import uuid
from datetime import datetime
import enum
from sqlalchemy import String, DateTime, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.app.db.base import Base, utc_now


class RequestStatus(str, enum.Enum):
    """Lifecycle states of an access request."""
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class AccessRequest(Base):
    """Access Request entity capturing a user's justification and authorization status.

    Attributes:
        id: Primary key UUID identifying the access request.
        requester_user_id: Foreign key to users table identifying the entrant.
        space_id: Facility Space identifier matching modular space registry (e.g. sandboxx_0).
        superuser_id: Designated superuser responsible for review (nullable on delete).
        justification: Required reason for entry (non-empty string, max 256 characters).
        status: Lifecycle enumeration (PENDING, APPROVED, REJECTED).
        created_at: Timezone-aware timestamp of request creation.
        resolved_at: Timezone-aware timestamp of request resolution (nullable while PENDING).
    """
    __tablename__ = "access_requests"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Primary key UUID for access request"
    )

    requester_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        doc="Entrant user foreign key"
    )

    space_id: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        doc="Target facility space identifier matching modular space registry"
    )

    superuser_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("superusers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        doc="SuperUser assigned/authorized to review this petition"
    )

    justification: Mapped[str] = mapped_column(
        String(256),
        nullable=False,
        doc="Mandatory reason for access (max 256 chars, non-empty)"
    )

    status: Mapped[RequestStatus] = mapped_column(
        Enum(RequestStatus, name="request_status_enum", native_enum=True),
        default=RequestStatus.PENDING,
        nullable=False,
        doc="Current state of access request"
    )

    request_type: Mapped[str] = mapped_column(
        String(30),
        default="ACCESS",
        nullable=False,
        doc="Request category: ACCESS or REGISTRATION"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        doc="Submission timestamp"
    )

    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        doc="Resolution timestamp"
    )

    # Relationships
    requester_user = relationship("User", back_populates="access_requests")
    superuser = relationship("SuperUser", back_populates="supervised_requests")

    def __repr__(self) -> str:
        return f"<AccessRequest(id={self.id}, user_id={self.requester_user_id}, space='{self.space_id}', status='{self.status.value}')>"
