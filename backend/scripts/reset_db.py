"""Database Reset and Clean Seeding Utility for PANDA.

Truncates all application tables and reseeds the system to a clean,
production-ready baseline with only the Root Administrator, registered
Facility Spaces, core campus clubs, and standard development SuperUsers.
"""

import asyncio
import logging
import sys
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sqlalchemy import func, select, table, text
from backend.app.db.session import AsyncSessionLocal, engine
from backend.app.db.init_db import seed_initial_data

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("reset_db")

TABLES_TO_TRUNCATE = (
    "entry_logs",
    "active_pins",
    "access_requests",
    "user_space_assignments",
    "push_subscriptions",
    "users",
    "superusers",
    "admins",
    "clubs",
    "spaces",
)
ALLOWED_TABLES = frozenset(TABLES_TO_TRUNCATE)


async def reset_database():
    """Truncate all application tables and reseed with clean initial state."""
    logger.info("Starting PANDA database reset...")

    async with AsyncSessionLocal() as session:
        # 1. Truncate allowlisted application tables with CASCADE
        for tbl in TABLES_TO_TRUNCATE:
            if tbl not in ALLOWED_TABLES:
                raise ValueError(f"Refusing to truncate non-allowlisted table: {tbl}")
        truncate_sql = f"TRUNCATE TABLE {', '.join(TABLES_TO_TRUNCATE)} CASCADE;"
        logger.info("Truncating all application tables...")
        await session.execute(text(truncate_sql))
        await session.commit()
        logger.info("All tables successfully truncated.")

        # 2. Reseed initial baseline data
        logger.info("Reseeding initial baseline data...")
        await seed_initial_data(session)

    # 3. Print verification summary using parameterized SQLAlchemy Core queries
    async with AsyncSessionLocal() as session:
        logger.info("=== Database Reset Verification Summary ===")
        for tbl in TABLES_TO_TRUNCATE:
            if tbl not in ALLOWED_TABLES:
                raise ValueError(f"Non-allowlisted table: {tbl}")
            result = await session.execute(select(func.count()).select_from(table(tbl)))
            count = result.scalar()
            logger.info(f"  {tbl:25}: {count} records")

    logger.info("Database reset completed successfully!")


if __name__ == "__main__":
    asyncio.run(reset_database())
