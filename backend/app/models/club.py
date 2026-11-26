"""Club Model Definition.

Represents student clubs or campus organizations associated with users and superusers.
"""

import uuid
from datetime import datetime
from sqlalchemy import String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.app.db.base import Base, utc_now


class Club(Base):
    """Club entity categorizing campus organizations for facility access tracking.

    Attributes:
        id: Primary key UUID identifying the club.
        name: Unique name of the student club/organization (max 80 chars, indexed).
        created_at: Timezone-aware timestamp when the club record was created.
    """
    __tablename__ = "clubs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Primary key UUID for club"
    )

    name: Mapped[str] = mapped_column(
        String(80),
        unique=True,
        index=True,
        nullable=False,
        doc="Unique club/organization title (max 80 characters)"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        doc="Timestamp of club registration"
    )

    # Relationships
    superusers = relationship("SuperUser", back_populates="club")
    users = relationship("User", back_populates="club")

    def __repr__(self) -> str:
        return f"<Club(id={self.id}, name='{self.name}')>"
