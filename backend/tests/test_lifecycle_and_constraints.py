"""Unit and Integration Tests for Lifecycle Rules, Tagging, and Constraints.

Validates:
1. Strict UNIQUE(user_id, space_id) constraint on user_space_assignments.
2. Strict partial unique index on active_pins(pin_code) WHERE revoked_at IS NULL.
3. Account tagging ('New' / 'Old' only emitted July 15 - Sept 1, else null).
4. Pre-reset warning flag active August 25 - August 31.
5. Annual September 1st reset purge logic:
   - Users purged.
   - SuperUsers < July 15 purged.
   - SuperUsers >= July 15 preserved.
   - Admins preserved.
   - Logs > 3 years purged, logs <= 3 years retained.
"""

import pytest
import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError

from backend.app.db.session import AsyncSessionLocal
from backend.app.models.admin import Admin
from backend.app.models.superuser import SuperUser
from backend.app.models.user import User
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.models.access_request import AccessRequest, RequestStatus
from backend.app.models.active_pin import ActivePin
from backend.app.models.entry_log import EntryLog, EntryEventType
from backend.app.services.lifecycle_service import (
    get_account_tag,
    get_pre_reset_warning,
    execute_annual_september_purge,
)


@pytest.mark.asyncio
async def test_user_space_assignment_unique_constraint():
    """Verify strict constraint: UNIQUE(user_id, space_id).

    A user can only be assigned to one SuperUser per space at any given time.
    """
    async with AsyncSessionLocal() as session:
        # Create user
        user = User(
            email=f"entrant_{uuid.uuid4().hex[:8]}@test.edu",
            name="Test Entrant",
            phone="+919876543210"
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        user_id = user.id

        # First assignment for sandboxx_0 succeeds
        assign1 = UserSpaceAssignment(
            user_id=user_id,
            space_id="sandboxx_0",
            superuser_id=None
        )
        session.add(assign1)
        await session.commit()

        # Duplicate assignment for same user and same space must fail with IntegrityError
        assign2 = UserSpaceAssignment(
            user_id=user_id,
            space_id="sandboxx_0",
            superuser_id=None
        )
        session.add(assign2)
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()

        # Assignment for a different space (sandboxx_1) succeeds
        assign_different_space = UserSpaceAssignment(
            user_id=user_id,
            space_id="sandboxx_1",
            superuser_id=None
        )
        session.add(assign_different_space)
        await session.commit()


@pytest.mark.asyncio
async def test_active_pin_partial_uniqueness_constraint():
    """Verify partial unique index on pin_code where revoked_at IS NULL.

    Active PINs cannot share the same code, but once revoked, the code can be reused.
    """
    async with AsyncSessionLocal() as session:
        user1 = User(email=f"u1_{uuid.uuid4().hex[:8]}@test.edu", name="U1", phone="123")
        user2 = User(email=f"u2_{uuid.uuid4().hex[:8]}@test.edu", name="U2", phone="456")
        session.add_all([user1, user2])
        await session.commit()
        await session.refresh(user1)
        await session.refresh(user2)
        user1_id = user1.id
        user2_id = user2.id

        now = datetime.now(timezone.utc)
        expires = now + timedelta(minutes=5)
        test_pin_code = str(uuid.uuid4().int % 900000 + 100000)

        # First active PIN with code '778899' succeeds
        pin1 = ActivePin(
            pin_code=test_pin_code,
            space_id="sandboxx_0",
            holder_user_id=user1_id,
            issued_by_name_snapshot="Lead",
            issued_by_email_snapshot="lead@test.edu",
            expires_at=expires,
            revoked_at=None,
            created_at=now
        )
        session.add(pin1)
        await session.commit()
        await session.refresh(pin1)
        pin1_id = pin1.id

        # Second simultaneous active PIN with same code must fail
        pin2 = ActivePin(
            pin_code=test_pin_code,
            space_id="sandboxx_1",
            holder_user_id=user2_id,
            issued_by_name_snapshot="Lead",
            issued_by_email_snapshot="lead@test.edu",
            expires_at=expires,
            revoked_at=None,
            created_at=now
        )
        session.add(pin2)
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()

        # Now revoke pin1
        pin1_fetch = await session.get(ActivePin, pin1_id)
        assert pin1_fetch is not None
        pin1_fetch.revoked_at = datetime.now(timezone.utc)
        session.add(pin1_fetch)
        await session.commit()

        # Re-adding a new active PIN with code '778899' now succeeds because pin1 is revoked
        pin3 = ActivePin(
            pin_code=test_pin_code,
            space_id="sandboxx_1",
            holder_user_id=user2_id,
            issued_by_name_snapshot="Lead",
            issued_by_email_snapshot="lead@test.edu",
            expires_at=expires,
            revoked_at=None,
            created_at=now
        )
        session.add(pin3)
        await session.commit()


def test_account_tagging_lifecycle():
    """Verify 'New' / 'Old' tagging logic:

    - Outside July 15 - Sept 1 window: returns None.
    - Inside July 15 - Sept 1 window:
      - >= July 15: returns 'New'
      - < July 15: returns 'Old'
    """
    cycle_year = 2026

    # Outside window tests
    outside_date_spring = datetime(cycle_year, 4, 10, 12, 0, tzinfo=timezone.utc)
    outside_date_fall = datetime(cycle_year, 10, 20, 12, 0, tzinfo=timezone.utc)
    created_old = datetime(cycle_year, 3, 1, tzinfo=timezone.utc)
    created_new = datetime(cycle_year, 7, 20, tzinfo=timezone.utc)

    assert get_account_tag(created_old, outside_date_spring) is None
    assert get_account_tag(created_new, outside_date_fall) is None

    # Inside window tests (August 10, 2026)
    inside_date_august = datetime(cycle_year, 8, 10, 12, 0, tzinfo=timezone.utc)
    assert get_account_tag(created_old, inside_date_august) == "Old"
    assert get_account_tag(created_new, inside_date_august) == "New"

    # Boundary tests: exactly July 15 00:00:00
    exact_july_15 = datetime(cycle_year, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
    assert get_account_tag(exact_july_15, inside_date_august) == "New"

    # One second before July 15
    before_july_15 = datetime(cycle_year, 7, 14, 23, 59, 59, tzinfo=timezone.utc)
    assert get_account_tag(before_july_15, inside_date_august) == "Old"

    # End of window boundary (September 1)
    sept_1 = datetime(cycle_year, 9, 1, 15, 0, tzinfo=timezone.utc)
    assert get_account_tag(created_new, sept_1) == "New"

    # Immediately after window (September 2)
    sept_2 = datetime(cycle_year, 9, 2, 0, 0, 1, tzinfo=timezone.utc)
    assert get_account_tag(created_new, sept_2) is None


def test_pre_reset_warning_banner():
    """Verify pre-reset warning flag active August 25 - August 31."""
    # August 24: inactive
    w24 = get_pre_reset_warning(datetime(2026, 8, 24, 23, 59, tzinfo=timezone.utc))
    assert w24["is_warning_active"] is False
    assert w24["warning_message"] is None

    # August 25: active
    w25 = get_pre_reset_warning(datetime(2026, 8, 25, 0, 0, tzinfo=timezone.utc))
    assert w25["is_warning_active"] is True
    assert "All users and superusers" in w25["warning_message"]

    # August 31: active
    w31 = get_pre_reset_warning(datetime(2026, 8, 31, 23, 59, tzinfo=timezone.utc))
    assert w31["is_warning_active"] is True

    # September 1: inactive (purge runs)
    w_sept1 = get_pre_reset_warning(datetime(2026, 9, 1, 0, 0, tzinfo=timezone.utc))
    assert w_sept1["is_warning_active"] is False


@pytest.mark.asyncio
async def test_annual_september_purge_execution():
    """Verify annual September 1 purge logic across all tables."""
    async with AsyncSessionLocal() as session:
        current_year = 2026
        sept_1_time = datetime(current_year, 9, 1, 0, 0, 0, tzinfo=timezone.utc)

        # 1. Seed user + assignment + request + active pin
        test_user = User(
            email=f"purge_user_{uuid.uuid4().hex[:6]}@test.edu",
            name="Purge Candidate User",
            phone="111"
        )
        session.add(test_user)
        await session.commit()
        await session.refresh(test_user)

        assign = UserSpaceAssignment(user_id=test_user.id, space_id="sandboxx_0")
        req = AccessRequest(
            requester_user_id=test_user.id,
            space_id="sandboxx_0",
            justification="Work",
            status=RequestStatus.APPROVED
        )
        pin = ActivePin(
            pin_code="123456",
            space_id="sandboxx_0",
            holder_user_id=test_user.id,
            issued_by_name_snapshot="Admin",
            issued_by_email_snapshot="admin@test.edu",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10)
        )
        session.add_all([assign, req, pin])

        # 2. Seed old SuperUser (created before July 15)
        old_su = SuperUser(
            email=f"old_su_{uuid.uuid4().hex[:6]}@test.edu",
            name="Old Cohort SuperUser",
            phone="222",
            allowed_spaces=["sandboxx_0"],
            created_at=datetime(current_year, 5, 1, tzinfo=timezone.utc)
        )
        # 3. Seed new SuperUser (created on/after July 15)
        new_su = SuperUser(
            email=f"new_su_{uuid.uuid4().hex[:6]}@test.edu",
            name="New Cohort SuperUser",
            phone="333",
            allowed_spaces=["sandboxx_0"],
            created_at=datetime(current_year, 7, 20, tzinfo=timezone.utc)
        )
        session.add_all([old_su, new_su])

        # 4. Seed entry logs: 4-year-old log vs 1-year-old log
        old_log = EntryLog(
            event_type=EntryEventType.DOOR_UNLOCKED,
            space_id="sandboxx_0",
            actor_name="Old Actor",
            actor_email="old@test.edu",
            authority_name="Auth",
            authority_email="auth@test.edu",
            created_at=datetime(current_year - 4, 1, 1, tzinfo=timezone.utc)
        )
        recent_log = EntryLog(
            event_type=EntryEventType.DOOR_UNLOCKED,
            space_id="sandboxx_0",
            actor_name="Recent Actor",
            actor_email="recent@test.edu",
            authority_name="Auth",
            authority_email="auth@test.edu",
            created_at=datetime(current_year - 1, 1, 1, tzinfo=timezone.utc)
        )
        session.add_all([old_log, recent_log])
        await session.commit()

        old_su_id = old_su.id
        new_su_id = new_su.id
        old_log_id = old_log.id
        recent_log_id = recent_log.id

        # Execute annual purge simulating Sept 1
        stats = await execute_annual_september_purge(session, reference_date=sept_1_time)

        # Verify results
        assert stats["users_deleted"] >= 1
        assert stats["superusers_deleted"] >= 1
        assert stats["entry_logs_retained_unchanged"] is True

        # Check old SuperUser is deleted
        res_old_su = await session.execute(select(SuperUser).where(SuperUser.id == old_su_id))
        assert res_old_su.scalar_one_or_none() is None

        # Check new SuperUser (created on/after July 15) is preserved
        res_new_su = await session.execute(select(SuperUser).where(SuperUser.id == new_su_id))
        assert res_new_su.scalar_one_or_none() is not None

        # Check Root Admin is preserved
        res_admin = await session.execute(select(Admin).where(Admin.email == "rehankuriance@gmail.com"))
        assert res_admin.scalar_one_or_none() is not None

        # Annual Reset strictly preserves all entry logs unchanged
        res_old_log = await session.execute(select(EntryLog).where(EntryLog.id == old_log_id))
        assert res_old_log.scalar_one_or_none() is not None

        res_recent_log = await session.execute(select(EntryLog).where(EntryLog.id == recent_log_id))
        assert res_recent_log.scalar_one_or_none() is not None

        # Verify internal 3-year retention schedule function prunes logs > 3 years
        from backend.app.services.lifecycle_service import prune_logs_older_than_three_years
        pruned = await prune_logs_older_than_three_years(session)
        assert pruned >= 1

        res_old_log_after = await session.execute(select(EntryLog).where(EntryLog.id == old_log_id))
        assert res_old_log_after.scalar_one_or_none() is None

        # Clean up recent log
        await session.execute(delete(EntryLog).where(EntryLog.id == recent_log_id))
        await session.execute(delete(SuperUser).where(SuperUser.id == new_su_id))
        await session.commit()
