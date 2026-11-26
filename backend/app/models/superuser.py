"""SuperUser Model Definition.

Defines SuperUsers who hold delegated authority to review access requests
and issue PIN grants for designated Facility Spaces.
"""

import uuid
from datetime import datetime
from typing import List, Any
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.app.db.base import Base, utc_now


class SuperUser(Base):
    """SuperUser entity holding delegated authority to approve PIN access grants.

    Attributes:
        id: Primary key UUID identifying the superuser.
        email: Unique institutional email address (max 120 chars, indexed).
        name: Full name of the superuser (max length 80).
        phone: Contact mobile phone number with country code (max length 20).
        club_id: Foreign key to clubs table (nullable for independent leads).
        allowed_spaces: JSONB list of Facility Space identifiers (e.g. ['sandboxx_0', 'sandboxx_1']).
        is_active: Status flag indicating active authorization status.
        created_at: Timezone-aware timestamp critical for July 15 cohort cycle tracking.
    """
    __tablename__ = "superusers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Primary key UUID for superuser"
    )

    email: Mapped[str] = mapped_column(
        String(120),
        unique=True,
        index=True,
        nullable=False,
        doc="Unique institutional email address for authentication (max 120 chars)"
    )

    name: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
        doc="Full name of superuser (max 80 characters)"
    )

    phone: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        doc="Contact phone number with country code (max 20 characters)"
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

    allowed_spaces: Mapped[List[str]] = mapped_column(
        JSONB,
        default=list,
        nullable=False,
        doc="Array of space slugs this superuser is authorized to govern (e.g. ['sandboxx_0', 'sandboxx_1'])"
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        doc="Operational status allowing request approvals"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        doc="Creation timestamp used for cohort lifecycle tracking"
    )

    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
        onupdate=utc_now,
        doc="Last updated timestamp used to preserve renewed SuperUsers during annual reset"
    )

    token_version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default="1",
        nullable=False,
        doc="Session version incremented on profile/authority changes to invalidate existing JWTs"
    )

    # Relationships
    club = relationship("Club", back_populates="superusers")
    space_assignments = relationship("UserSpaceAssignment", back_populates="superuser")
    supervised_requests = relationship("AccessRequest", back_populates="superuser")

    def __repr__(self) -> str:
        return f"<SuperUser(id={self.id}, email='{self.email}', name='{self.name}')>"
