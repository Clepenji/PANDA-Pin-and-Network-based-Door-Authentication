"""Database Engine, Connection Pooling, and Async Session Management.

Configures SQLAlchemy 2.0 async engine with PostgreSQL connection pooling
via asyncpg. Employs connection recycling and pre-ping health checks to
prevent stale socket connections.
"""

from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from backend.app.config.settings import settings

# Create async engine with robust connection pooling
# pool_pre_ping=True issues a lightweight test query before returning a connection from the pool
# pool_size=10 maintains 10 warm connections
# max_overflow=20 accommodates concurrent access spikes
# pool_recycle=1800 closes and replaces connections older than 30 minutes to mitigate PostgreSQL server timeouts
engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=1800,
    echo=settings.DEBUG,
)

# Async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    autoflush=False,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an isolated async database session.

    Ensures rollback on unhandled exceptions and orderly session closure.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
