"""User Model Definition.

Represents standard student/faculty users requesting access to Facility Spaces.
"""

import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.app.db.base import Base, utc_now


class User(Base):
    """User entity representing facility members requesting door unlock PINs.

    Attributes:
        id: Primary key UUID identifying the user.
        email: Unique institutional email address (max 120 chars, indexed for auth lookups).
        name: Full name of user (max length 80).
        phone: Contact mobile number (max length 20).
        club_id: Foreign key to clubs table (nullable).
        created_at: Timezone-aware timestamp critical for July 15 cohort tracking.
    """
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Primary key UUID for user"
    )

    email: Mapped[str] = mapped_column(
        String(120),
        unique=True,
        index=True,
        nullable=False,
        doc="Institutional email address used as login identity (max 120 chars)"
    )

    name: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
        doc="Full legal name of the user (max 80 characters)"
    )

    phone: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        doc="Mobile contact phone number (max 20 characters)"
    )

    club_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clubs.id", ondelete="SET NULL"),
        nullable=True,
        doc="Associated club / organization foreign key"
    )

    college_year: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="Not Applicable",
        doc="Year of college (e.g. 1st Year, 2nd Year, Postgraduate, Not Applicable)"
    )

    note: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        default=None,
        doc="Self-declared role title or representative note (max 255 chars)"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        doc="Creation timestamp used for cohort lifecycle tracking"
    )

    token_version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default="1",
        nullable=False,
        doc="Session version incremented on profile/authority changes to invalidate existing JWTs"
    )

    # Relationships
    club = relationship("Club", back_populates="users")
    space_assignments = relationship("UserSpaceAssignment", back_populates="user", cascade="all, delete-orphan")
    access_requests = relationship("AccessRequest", back_populates="requester_user", cascade="all, delete-orphan")
    active_pins = relationship("ActivePin", back_populates="holder_user", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email='{self.email}', name='{self.name}')>"
