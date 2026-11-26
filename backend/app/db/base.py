"""SQLAlchemy Declarative Base and Shared Model Utilities.

Provides a standardized Base class with table name generation and
common metadata for all ORM models.
"""

from datetime import datetime, timezone
import uuid
from sqlalchemy import DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base declarative class for all PANDA models."""
    pass


def utc_now() -> datetime:
    """Generate a timezone-aware current UTC datetime."""
    return datetime.now(timezone.utc)
