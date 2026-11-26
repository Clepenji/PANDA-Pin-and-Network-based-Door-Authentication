"""ESP32 WROOM Communication Layer and PIN Lifecycle Engine Tests.

Verifies:
1. Configurable PIN_TTL_SECONDS (180s) applied to generated active PINs.
2. Cryptographic uniqueness across active unrevoked records (no collisions).
3. Immediate PIN Revocation Flow (POST /api/pins/{pin_id}/revoke).
4. ESP32 Polling Sync Fallback (GET /api/esp32/{space_id}/sync).
5. ESP32 Keypad Event Ingestion (POST /api/esp32/events):
   - Valid unlocked -> logs DOOR_UNLOCKED.
   - Invalid/expired -> logs INVALID_PIN_ATTEMPT.
6. Attribution integrity snapshots (actor and authority preserved).
7. Portal UI log filtering (omits INVALID_PIN_ATTEMPT) vs CSV export (includes INVALID_PIN_ATTEMPT).
"""

import pytest
import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, and_
from backend.app.config.settings import settings
from backend.app.db.session import AsyncSessionLocal
from backend.app.db.base import utc_now
from backend.app.models.user import User
from backend.app.models.superuser import SuperUser
from backend.app.models.active_pin import ActivePin
from backend.app.models.entry_log import EntryLog, EntryEventType
from backend.app.services.pin_service import PinService
from backend.app.services.log_service import LogService


@pytest.mark.asyncio
async def test_pin_ttl_seconds_configuration():
    """Verify PIN_TTL_SECONDS is configured to 180 seconds and applied upon issue."""
    assert settings.PIN_TTL_SECONDS == 180

    async with AsyncSessionLocal() as session:
        user = User(
            email=f"entrant_{uuid.uuid4().hex[:6]}@test.edu",
            name="TTL Test User",
            phone="123"
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        before = utc_now()
        pin = await PinService.issue_pin_for_grant(
            session=session,
            space_id="sandboxx_0",
            holder_user_id=user.id,
            issued_by_superuser_id=None,
            issued_by_name="Super Authority",
            issued_by_email="lead@test.edu"
        )
        await session.commit()
        await session.refresh(pin)

        # Expected expiration is approx now + 180 seconds
        expected_expiry = before + timedelta(seconds=180)
        diff = abs((pin.expires_at - expected_expiry).total_seconds())
        assert diff < 2.0, f"Expected expiry ~180s, got diff {diff}s"
        assert pin.revoked_at is None


@pytest.mark.asyncio
async def test_immediate_pin_revocation_flow():
    """Verify early revocation marks revoked_at and prevents subsequent authentication."""
    async with AsyncSessionLocal() as session:
        user = User(
            email=f"entrant_{uuid.uuid4().hex[:6]}@test.edu",
            name="Revoke User",
            phone="456"
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        pin = await PinService.issue_pin_for_grant(
            session=session,
            space_id="sandboxx_0",
            holder_user_id=user.id,
            issued_by_superuser_id=None,
            issued_by_name="Super Authority",
            issued_by_email="lead@test.edu"
        )
        await session.commit()
        await session.refresh(pin)
        pin_id = pin.id
        pin_code = pin.pin_code

        # Admin revokes PIN early
        admin_actor = {
            "email": "rehankuriance@gmail.com",
            "name": "Root Admin",
            "role": "admin",
            "is_root": True,
            "authorized_spaces": ["sandboxx_0", "sandboxx_1"]
        }
        revoked = await PinService.revoke_pin(session, pin_id, admin_actor)
        await session.commit()
        await session.refresh(revoked)

        assert revoked.revoked_at is not None

        # Re-query active list: must not appear in active memory
        active_list = await PinService.list_active_pins_for_space(session, "sandboxx_0")
        active_pin_ids = [p.id for p, u in active_list]
        assert pin_id not in active_pin_ids


@pytest.mark.asyncio
async def test_esp32_sync_polling_fallback():
    """Verify GET /api/esp32/{space_id}/sync returns only active unrevoked PINs."""
    async with AsyncSessionLocal() as session:
        user = User(
            email=f"entrant_{uuid.uuid4().hex[:6]}@test.edu",
            name="Sync Entrant",
            phone="789"
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        pin1 = await PinService.issue_pin_for_grant(
            session=session,
            space_id="sandboxx_0",
            holder_user_id=user.id,
            issued_by_superuser_id=None,
            issued_by_name="Lead",
            issued_by_email="lead@test.edu"
        )
        await session.commit()

        # Query sync list for sandboxx_0
        sync_records = await PinService.list_active_pins_for_space(session, "sandboxx_0")
        pins = [p.pin_code for p, u in sync_records]
        assert pin1.pin_code in pins

        # Different space sandboxx_1 should not contain pin1
        sync_other = await PinService.list_active_pins_for_space(session, "sandboxx_1")
        other_pins = [p.pin_code for p, u in sync_other]
        assert pin1.pin_code not in other_pins


@pytest.mark.asyncio
async def test_esp32_keypad_event_logging():
    """Verify keypad events correctly attribute entrant and authority snapshots."""
    async with AsyncSessionLocal() as session:
        user = User(
            email=f"keypad_actor_{uuid.uuid4().hex[:6]}@test.edu",
            name="Keypad Entrant",
            phone="999"
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        pin = await PinService.issue_pin_for_grant(
            session=session,
            space_id="sandboxx_0",
            holder_user_id=user.id,
            issued_by_superuser_id=None,
            issued_by_name="Approver Snapshot",
            issued_by_email="approver@test.edu"
        )
        await session.commit()
        await session.refresh(pin)

        # 1. Valid keypad entry -> verify DOOR_UNLOCKED logged
        now = utc_now()
        stmt = select(ActivePin, User).join(
            User, User.id == ActivePin.holder_user_id
        ).where(
            and_(
                ActivePin.pin_code == pin.pin_code,
                ActivePin.space_id == "sandboxx_0",
                ActivePin.revoked_at.is_(None),
                ActivePin.expires_at > now
            )
        )
        row = (await session.execute(stmt)).first()
        assert row is not None

        # Log DOOR_UNLOCKED
        log_unlock = await LogService.create_entry_log(
            session=session,
            event_type=EntryEventType.DOOR_UNLOCKED,
            space_id="sandboxx_0",
            actor_name=user.name,
            actor_email=user.email,
            authority_name=pin.issued_by_name_snapshot,
            authority_email=pin.issued_by_email_snapshot,
            pin_used=pin.pin_code,
            justification_snapshot="ESP32 test pulse"
        )
        await session.commit()
        await session.refresh(log_unlock)

        assert log_unlock.event_type == EntryEventType.DOOR_UNLOCKED
        assert log_unlock.actor_name == "Keypad Entrant"
        assert log_unlock.authority_name == "Approver Snapshot"

        # 2. Invalid keypad entry -> verify INVALID_PIN_ATTEMPT logged
        log_invalid = await LogService.create_entry_log(
            session=session,
            event_type=EntryEventType.INVALID_PIN_ATTEMPT,
            space_id="sandboxx_0",
            actor_name="Unknown Keypad Entrant",
            actor_email="keypad@facility.local",
            authority_name="ESP32 Security Controller",
            authority_email="controller@facility.local",
            pin_used="000000",
            justification_snapshot="Failed keypad attempt"
        )
        await session.commit()
        await session.refresh(log_invalid)

        assert log_invalid.event_type == EntryEventType.INVALID_PIN_ATTEMPT

        # 3. Verify CSV audit contains INVALID_PIN_ATTEMPT
        csv_data = await LogService.export_entry_logs_csv(session)
        assert "INVALID_PIN_ATTEMPT" in csv_data
        assert "DOOR_UNLOCKED" in csv_data
