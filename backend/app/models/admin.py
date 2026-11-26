"""Admin Model Definition.

Represents system administrators with access to the Admin Dashboard.
Includes Root Administrator flag to govern destructive or critical actions.
"""

import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.db.base import Base, utc_now


class Admin(Base):
    """Admin entity representing staff authorized for facility management and audits.

    Attributes:
        id: Primary key UUID identifying the administrator.
        email: Administrator's unique institutional email address (indexed for fast lookups).
        name: Full display name of the administrator.
        is_root: Flag indicating whether this account is the protected Root Admin (rehankuriance@gmail.com).
        created_at: Timezone-aware timestamp marking account establishment.
    """
    __tablename__ = "admins"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Primary key UUID for administrator"
    )

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
        doc="Unique institutional email address for admin login"
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        doc="Full display name of administrator"
    )

    is_root: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        doc="Root admin status granting unrevokable master privileges"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        doc="Timestamp of administrator profile creation"
    )

    token_version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default="1",
        nullable=False,
        doc="Session version incremented on profile/authority changes to invalidate existing JWTs"
    )

    def __repr__(self) -> str:
        return f"<Admin(id={self.id}, email='{self.email}', is_root={self.is_root})>"
