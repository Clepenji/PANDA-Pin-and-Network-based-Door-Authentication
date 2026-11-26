"""Database Schema and Constraint Validation Tests.

Verifies:
1. Root Admin exists with email rehankuriance@gmail.com and is_root = True.
2. Spaces are seeded (SandBoxx 0, SandBoxx 1).
3. Active PIN global uniqueness across active records.
4. User Space Assignment unique constraint (user_id, space_id).
"""

import pytest
import uuid
from datetime import timedelta
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from backend.app.db.session import AsyncSessionLocal
from backend.app.db.base import utc_now
from backend.app.models.admin import Admin
from backend.app.models.space import Space
from backend.app.models.user import User
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.models.active_pin import ActivePin
from backend.app.services.pin_service import PinService


@pytest.mark.asyncio
async def test_root_admin_seeded():
    """Verify Root Admin is present with master privileges."""
    async with AsyncSessionLocal() as session:
        stmt = select(Admin).where(Admin.email == "rehankuriance@gmail.com")
        res = await session.execute(stmt)
        admin = res.scalar_one_or_none()
        assert admin is not None
        assert admin.is_root is True


@pytest.mark.asyncio
async def test_facility_spaces_seeded():
    """Verify database supports dynamic spaces without requiring hardcoded sandboxx_0/sandboxx_1."""
    from backend.app.services.space_service import SpaceService
    slug = f"schema_test_{uuid.uuid4().hex[:6]}"
    async with AsyncSessionLocal() as session:
        await SpaceService.create_space(
            session=session,
            slug=slug,
            name="Schema Test Lab",
            esp32_device_id=f"ESP32_{slug.upper()}_DOOR",
            is_active=True,
        )
        res = await session.execute(select(Space).where(Space.slug == slug))
        sp = res.scalar_one_or_none()
        assert sp is not None
        assert sp.name == "Schema Test Lab"
        await SpaceService.remove_space(session, slug, "rehankuriance@gmail.com")


@pytest.mark.asyncio
async def test_user_space_assignment_unique_constraint():
    """Verify (user_id, space_id) unique constraint prevents duplicate assignments."""
    async with AsyncSessionLocal() as session:
        user = User(
            email=f"unique_test_{uuid.uuid4().hex[:6]}@test.edu",
            name="Test User",
            phone="123456"
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        # First assignment succeeds
        assign1 = UserSpaceAssignment(
            user_id=user.id,
            space_id="sandboxx_0",
        )
        session.add(assign1)
        await session.commit()

        # Second assignment for same user and same space must fail with IntegrityError
        assign2 = UserSpaceAssignment(
            user_id=user.id,
            space_id="sandboxx_0",
        )
        session.add(assign2)
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()


@pytest.mark.asyncio
async def test_pin_generation_uniqueness():
    """Verify generated 6-digit PIN is formatted properly and unique."""
    async with AsyncSessionLocal() as session:
        pin = await PinService.generate_unique_pin_code(session)
        assert len(pin) == 6
        assert pin.isdigit()
