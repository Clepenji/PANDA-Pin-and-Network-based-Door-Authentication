"""Tests for server startup ESP32 PIN synchronization, purging, and log reconciliation."""

import uuid
import secrets
import pytest
from datetime import timedelta
from sqlalchemy import select, func

from backend.app.db.base import utc_now
from backend.app.db.session import AsyncSessionLocal
from backend.app.models.user import User
from backend.app.models.active_pin import ActivePin
from backend.app.models.entry_log import EntryLog
from backend.app.models.system_setting import SystemSetting
from backend.app.models.esp32_outbox import ESP32CommandOutbox
from backend.app.services.esp32_service import ESP32Service


@pytest.mark.asyncio
async def test_fresh_setup_detection_and_toggle():
    """Verify is_fresh_setup correctly identifies fresh setups and handles clear_fresh_setup."""
    async with AsyncSessionLocal() as session:
        # Explicitly set fresh_setup_pending to true
        res = await session.execute(
            select(SystemSetting).where(SystemSetting.key == "fresh_setup_pending")
        )
        setting = res.scalar_one_or_none()
        if setting:
            setting.value = "true"
        else:
            session.add(SystemSetting(key="fresh_setup_pending", value="true"))
        await session.commit()

        assert await ESP32Service.is_fresh_setup(session) is True

        # Clear fresh setup (sets to false)
        await ESP32Service.clear_fresh_setup(session)
        assert await ESP32Service.is_fresh_setup(session) is False


@pytest.mark.asyncio
async def test_sync_space_pins_dispatches_valid_pins():
    """Verify sync_space_pins collects currently valid unrevoked PINs for a space."""
    now = utc_now()
    user_id = uuid.uuid4()
    test_email = f"sync_user_{uuid.uuid4().hex[:6]}@hyderabad.bits-pilani.ac.in"
    valid_code = f"{secrets.randbelow(900000) + 100000}"
    expired_code = f"{secrets.randbelow(900000) + 100000}"
    revoked_code = f"{secrets.randbelow(900000) + 100000}"

    async with AsyncSessionLocal() as session:
        user = User(
            id=user_id,
            email=test_email,
            name="Sync Test Entrant",
            phone="9876543210",
            college_year="2nd Year",
        )
        session.add(user)

        # Active valid PIN
        valid_pin = ActivePin(
            id=uuid.uuid4(),
            pin_code=valid_code,
            holder_user_id=user_id,
            space_id="sandboxx_0",
            issued_by_name_snapshot="SuperUser Lead",
            issued_by_email_snapshot="lead@hyderabad.bits-pilani.ac.in",
            expires_at=now + timedelta(hours=12),
            created_at=now,
        )
        # Expired PIN
        expired_pin = ActivePin(
            id=uuid.uuid4(),
            pin_code=expired_code,
            holder_user_id=user_id,
            space_id="sandboxx_0",
            issued_by_name_snapshot="SuperUser Lead",
            issued_by_email_snapshot="lead@hyderabad.bits-pilani.ac.in",
            expires_at=now - timedelta(hours=2),
            created_at=now - timedelta(hours=14),
        )
        # Revoked PIN
        revoked_pin = ActivePin(
            id=uuid.uuid4(),
            pin_code=revoked_code,
            holder_user_id=user_id,
            space_id="sandboxx_0",
            issued_by_name_snapshot="SuperUser Lead",
            issued_by_email_snapshot="lead@hyderabad.bits-pilani.ac.in",
            expires_at=now + timedelta(hours=5),
            created_at=now,
            revoked_at=now,
        )
        session.add_all([valid_pin, expired_pin, revoked_pin])
        await session.commit()

        sync_result = await ESP32Service.sync_space_pins(session, "sandboxx_0")
        assert sync_result["space_id"] == "sandboxx_0"
        pin_codes = [p["pin"] for p in sync_result["pins"]]
        assert valid_code in pin_codes
        assert expired_code not in pin_codes
        assert revoked_code not in pin_codes


@pytest.mark.asyncio
async def test_batch_logs_disregarded_on_fresh_setup():
    """Verify that on a fresh setup, incoming batch logs from ESP are disregarded and purged without DB write."""
    async with AsyncSessionLocal() as session:
        # Force fresh setup state
        res = await session.execute(
            select(SystemSetting).where(SystemSetting.key == "fresh_setup_pending")
        )
        setting = res.scalar_one_or_none()
        if setting:
            setting.value = "true"
        else:
            session.add(SystemSetting(key="fresh_setup_pending", value="true"))
        await session.commit()

        initial_log_count = (await session.execute(select(func.count(EntryLog.id)))).scalar() or 0

        batch_payload = {
            "type": "BATCH_LOGS",
            "msg_id": str(uuid.uuid4()),
            "space_id": "sandboxx_0",
            "events": [
                {
                    "type": "PIN_ATTEMPT",
                    "msg_id": str(uuid.uuid4()),
                    "pin": f"{secrets.randbelow(900000) + 100000}",
                    "door_unlocked": True,
                    "timestamp": int(utc_now().timestamp()) - 3600,
                },
                {
                    "type": "EXIT_BUTTON",
                    "msg_id": str(uuid.uuid4()),
                    "timestamp": int(utc_now().timestamp()) - 1800,
                },
            ],
        }

        reply = await ESP32Service.process_inbound_event(session, "sandboxx_0", batch_payload)
        assert reply["type"] == "ACK"
        assert reply.get("status") == "disregarded_fresh_setup"
        assert reply.get("processed_batch_count") == 0

        # Ensure no logs were added
        after_log_count = (await session.execute(select(func.count(EntryLog.id)))).scalar() or 0
        assert after_log_count == initial_log_count


@pytest.mark.asyncio
async def test_batch_logs_processed_on_existing_setup():
    """Verify that on an existing (non-fresh) setup, offline logs from ESP are processed and saved."""
    now = utc_now()
    user_id = uuid.uuid4()
    test_email = f"active_ent_{uuid.uuid4().hex[:6]}@hyderabad.bits-pilani.ac.in"
    active_code = f"{secrets.randbelow(900000) + 100000}"

    async with AsyncSessionLocal() as session:
        user = User(
            id=user_id,
            email=test_email,
            name="Existing Setup Entrant",
            phone="9123456789",
            college_year="3rd Year",
        )
        session.add(user)

        pin = ActivePin(
            id=uuid.uuid4(),
            pin_code=active_code,
            holder_user_id=user_id,
            space_id="sandboxx_0",
            issued_by_name_snapshot="SuperUser Lead",
            issued_by_email_snapshot="lead@hyderabad.bits-pilani.ac.in",
            expires_at=now + timedelta(hours=10),
            created_at=now - timedelta(hours=2),
        )
        session.add(pin)

        # Disable fresh_setup_pending
        res = await session.execute(
            select(SystemSetting).where(SystemSetting.key == "fresh_setup_pending")
        )
        setting = res.scalar_one_or_none()
        if setting:
            setting.value = "false"
        else:
            session.add(SystemSetting(key="fresh_setup_pending", value="false"))
        await session.commit()

        initial_log_count = (await session.execute(select(func.count(EntryLog.id)))).scalar() or 0

        batch_payload = {
            "type": "BATCH_LOGS",
            "msg_id": str(uuid.uuid4()),
            "space_id": "sandboxx_0",
            "events": [
                {
                    "type": "PIN_ATTEMPT",
                    "msg_id": str(uuid.uuid4()),
                    "pin": active_code,
                    "door_unlocked": True,
                    "timestamp": int((now - timedelta(minutes=5)).timestamp()),
                },
                {
                    "type": "EXIT_BUTTON",
                    "msg_id": str(uuid.uuid4()),
                    "timestamp": int((now - timedelta(minutes=3)).timestamp()),
                },
            ],
        }

        reply = await ESP32Service.process_inbound_event(session, "sandboxx_0", batch_payload)
        assert reply["type"] == "ACK"
        assert reply.get("status") == "success"
        assert reply.get("processed_batch_count") == 2

        # Check that logs were recorded
        after_log_count = (await session.execute(select(func.count(EntryLog.id)))).scalar() or 0
        assert after_log_count == initial_log_count + 2


@pytest.mark.asyncio
async def test_on_server_startup_sync_runs_cleanly():
    """Verify on_server_startup_sync executes without raising exceptions."""
    await ESP32Service.on_server_startup_sync()


@pytest.mark.asyncio
async def test_purge_all_space_pins():
    """Verify purge_all_space_pins dispatches PURGE_PINS frame and enqueues to outbox."""
    async with AsyncSessionLocal() as session:
        await ESP32Service.purge_all_space_pins(session, "sandboxx_0")

        # Verify outbox command exists
        res = await session.execute(
            select(ESP32CommandOutbox).where(
                ESP32CommandOutbox.space_id == "sandboxx_0",
                ESP32CommandOutbox.command_type == "PURGE_PINS",
            )
        )
        cmds = res.scalars().all()
        assert len(cmds) > 0
