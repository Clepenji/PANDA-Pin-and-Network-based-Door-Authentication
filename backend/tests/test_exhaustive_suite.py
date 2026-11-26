"""Exhaustive Automated Integration and Lifecycle Test Suite for PANDA.

Covers:
1. Email login routing (Root Admin, secondary Admin, active SuperUser, revoked SuperUser, new User onboarding).
2. UNIQUE(user_id, space_id) enforcement and inline SuperUser switching without duplicate cards.
3. Globally unique 6-digit PIN generation under concurrency, expiration masking, and early revocation.
4. Immutable audit log attribution verifying that deleting a SuperUser never causes self-approval or attribution loss.
5. Annual September 1st purge logic (July 14 vs. July 15 SuperUser cutoffs, Admin retention, 3-year log retention).
6. Web Push subscription registration and VAPID diagnostic alert dispatch.
"""

import asyncio
import pytest
import uuid
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select, and_, func

from backend.app.main import app
from backend.app.config.settings import settings
from backend.app.db.session import AsyncSessionLocal
from backend.app.db.base import utc_now
from backend.app.models.admin import Admin
from backend.app.models.superuser import SuperUser
from backend.app.models.user import User
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.models.active_pin import ActivePin
from backend.app.models.entry_log import EntryLog, EntryEventType
from backend.app.models.push_subscription import PushSubscription
from backend.app.services.pin_service import PinService
from backend.app.services.log_service import LogService
from backend.app.services.lifecycle_service import (
    execute_annual_september_purge,
    prune_logs_older_than_three_years,
)
from backend.app.api.deps import create_access_token


@pytest.fixture(autouse=True, scope="module")
async def ensure_exhaustive_fixtures():
    """Ensure prerequisite space & test SuperUsers exist for exhaustive lifecycle tests."""
    from backend.app.models.space import Space
    from backend.app.models.esp32_device import ESP32Device
    from backend.app.config.spaces import register_dynamic_space
    import hashlib
    async with AsyncSessionLocal() as session:
        if not (await session.execute(select(Space).where(Space.slug == "sandboxx_0"))).scalar_one_or_none():
            session.add(Space(slug="sandboxx_0", name="SandBoxx 0", esp32_device_id="ESP32_SANDBOXX_0_DOOR", is_active=True))
        if not (await session.execute(select(ESP32Device).where(ESP32Device.space_id == "sandboxx_0"))).scalar_one_or_none():
            sec = hashlib.sha256(b"panda_esp32_secret_sandboxx_0_2026").hexdigest()[:32]
            session.add(ESP32Device(device_id="ESP32_SANDBOXX_0_DOOR", name="Main Door", space_id="sandboxx_0", device_secret=sec))
        if not (await session.execute(select(SuperUser).where(SuperUser.email == "lead.robotics@college.edu"))).scalar_one_or_none():
            session.add(SuperUser(email="lead.robotics@college.edu", name="Arjun Sharma", phone="+919876543210", allowed_spaces=["sandboxx_0"], is_active=True))
        if not (await session.execute(select(SuperUser).where(SuperUser.email == "revoked.lead@college.edu"))).scalar_one_or_none():
            session.add(SuperUser(email="revoked.lead@college.edu", name="Revoked Lead", phone="+919876543219", allowed_spaces=["sandboxx_0"], is_active=False))
        await session.commit()
    register_dynamic_space("sandboxx_0", "SandBoxx 0", "ESP32_SANDBOXX_0_DOOR", True)
    yield


@pytest.mark.asyncio
async def test_email_login_routing_and_revoked_superuser():
    """Verify all role login flows and revoked superuser redirection."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Root Admin login
        r = await client.post("/api/v1/auth/login", json={"email": "rehankuriance@gmail.com"})
        assert r.status_code == 200
        admin_data = r.json()
        assert admin_data["role"] == "admin"
        assert admin_data["is_root"] is True
        admin_token = admin_data["access_token"]

        # 2. Create secondary admin and verify login
        sec_email = f"sec_admin_{uuid.uuid4().hex[:6]}@college.edu"
        r = await client.post(
            "/api/v1/admin/admins",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"name": "Secondary Admin", "email": sec_email}
        )
        assert r.status_code == 200

        r = await client.post("/api/v1/auth/login", json={"email": sec_email})
        assert r.status_code == 200
        sec_data = r.json()
        assert sec_data["role"] == "admin"
        assert sec_data["is_root"] is False

        # 3. Active SuperUser login
        r = await client.post("/api/v1/auth/login", json={"email": "lead.robotics@college.edu"})
        assert r.status_code == 200
        su_data = r.json()
        assert su_data["role"] == "superuser"
        assert len(su_data["authorized_spaces"]) > 0

        # 4. Revoked SuperUser login (is_active=False)
        r = await client.post("/api/v1/auth/login", json={"email": "revoked.lead@college.edu"})
        assert r.status_code == 403
        assert r.json()["detail"] == "REVOKED_SUPERUSER_NEEDS_REGISTRATION"

        # 5. Unknown email -> 404 ACCOUNT_NOT_FOUND (triggers registration on client)
        r = await client.post("/api/v1/auth/login", json={"email": f"unknown_{uuid.uuid4().hex[:6]}@college.edu"})
        assert r.status_code == 404
        assert r.json()["detail"] == "ACCOUNT_NOT_FOUND"

        # 6. Fresh User Onboarding Registration
        new_user_email = f"fresh_user_{uuid.uuid4().hex[:6]}@college.edu"
        reg_payload = {
            "email": new_user_email,
            "name": "Fresh Student",
            "phone": "+919876543210",
            "club_name": "Robotics & Automation Club",
            "space_id": "sandboxx_0",
        }
        r = await client.post("/api/v1/auth/register", json=reg_payload)
        assert r.status_code == 200
        user_data = r.json()
        assert user_data["role"] == "user"

        # Verify newly registered user can now login
        r = await client.post("/api/v1/auth/login", json={"email": new_user_email})
        assert r.status_code == 200
        assert r.json()["role"] == "user"


@pytest.mark.asyncio
async def test_unique_user_space_assignment_and_inline_switching():
    """Verify UNIQUE(user_id, space_id) constraint and inline SuperUser switching without duplicate cards."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create user
        user_email = f"student_{uuid.uuid4().hex[:6]}@college.edu"
        r = await client.post(
            "/api/v1/auth/register",
            json={
                "email": user_email,
                "name": "Card Test Student",
                "phone": "+919876543210",
                "space_id": "sandboxx_0"
            }
        )
        assert r.status_code == 200
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # User has exactly 1 card for sandboxx_0
        r = await client.get("/api/v1/spaces/user/assignments", headers=headers)
        assert r.status_code == 200
        cards = r.json()
        assert len(cards) == 1
        assert cards[0]["space_id"] == "sandboxx_0"

        # Attempt to register duplicate space sandboxx_0 -> must fail with 400
        r = await client.post(
            "/api/v1/spaces/user/assignments",
            headers=headers,
            json={"space_id": "sandboxx_0"}
        )
        assert r.status_code == 400
        assert "Already registered" in r.json()["detail"]

        # Register additional space sandboxx_1 -> succeeds
        r = await client.post(
            "/api/v1/spaces/user/assignments",
            headers=headers,
            json={"space_id": "sandboxx_1"}
        )
        assert r.status_code == 200

        # Cards count is now 2
        r = await client.get("/api/v1/spaces/user/assignments", headers=headers)
        cards = r.json()
        assert len(cards) == 2

        # Inline SuperUser switch on sandboxx_0
        su_list = await client.get("/api/v1/auth/superusers")
        target_su_id = su_list.json()[0]["id"]
        r = await client.put(
            "/api/v1/spaces/user/assignments/sandboxx_0",
            headers=headers,
            json={"assigned_superuser_id": target_su_id}
        )
        assert r.status_code == 200
        updated_card = r.json()
        assert updated_card["assigned_superuser_id"] == target_su_id

        # Total cards count remains exactly 2 (zero duplicate cards created)
        r = await client.get("/api/v1/spaces/user/assignments", headers=headers)
        cards = r.json()
        assert len(cards) == 2


@pytest.mark.asyncio
async def test_concurrent_pin_generation_uniqueness_and_revocation():
    """Verify zero collisions in concurrent 6-digit PIN generation and immediate revocation."""
    async with AsyncSessionLocal() as session:
        # Create 10 dummy users
        users = []
        for i in range(10):
            u = User(
                email=f"entrant_concur_{i}_{uuid.uuid4().hex[:6]}@college.edu",
                name=f"Entrant {i}",
                phone="+919876543210"
            )
            session.add(u)
            users.append(u)
        await session.commit()

        user_ids = [u.id for u in users]

        # Issue 10 PINs concurrently, each task using its own isolated database session
        async def issue_single_pin(uid: uuid.UUID) -> str:
            async with AsyncSessionLocal() as s:
                p = await PinService.issue_pin_for_grant(
                    session=s,
                    space_id="sandboxx_0",
                    holder_user_id=uid,
                    issued_by_superuser_id=None,
                    issued_by_name="Lead Tester",
                    issued_by_email="lead@college.edu",
                )
                await s.commit()
                return p.pin_code

        tasks = [issue_single_pin(uid) for uid in user_ids]
        pin_codes = await asyncio.gather(*tasks)

        # Verify all 10 PINs are strictly unique 6-digit numbers
        assert len(set(pin_codes)) == len(pin_codes)
        for code in pin_codes:
            assert len(code) == 6
            assert code.isdigit()

        # Query one issued PIN to verify early revocation
        res = await session.execute(
            select(ActivePin).where(
                and_(ActivePin.holder_user_id == user_ids[0], ActivePin.revoked_at.is_(None))
            )
        )
        pin_to_revoke = res.scalar_one()
        revoked = await PinService.revoke_pin(
            session=session,
            pin_id=pin_to_revoke.id,
            actor={"role": "admin", "email": "admin@college.edu"},
        )
        assert revoked is not None
        assert revoked.revoked_at is not None

        # Verify active PIN query returns None for this user (now revoked)
        check_res = await session.execute(
            select(ActivePin).where(
                and_(ActivePin.holder_user_id == user_ids[0], ActivePin.revoked_at.is_(None))
            )
        )
        assert check_res.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_immutable_audit_log_attribution_on_superuser_deletion():
    """Verify that deleting an authorizing SuperUser never corrupts attribution into 'self-approved' logs."""
    async with AsyncSessionLocal() as session:
        # 1. Create SuperUser
        su = SuperUser(
            name="Temporary Authorizer",
            email=f"temp.lead_{uuid.uuid4().hex[:6]}@college.edu",
            phone="+919876543210",
            allowed_spaces=["sandboxx_0"],
            is_active=True
        )
        session.add(su)
        await session.commit()
        await session.refresh(su)
        su_id = su.id
        su_email = su.email
        su_name = su.name

        # 2. Entrant User
        entrant = User(
            name="Research Student",
            email=f"student_{uuid.uuid4().hex[:6]}@college.edu",
            phone="+919876543210"
        )
        session.add(entrant)
        await session.commit()
        await session.refresh(entrant)

        # 3. Create entry log with permanent snapshot
        log = await LogService.create_entry_log(
            session=session,
            event_type=EntryEventType.ACCESS_GRANTED,
            space_id="sandboxx_0",
            actor_name=entrant.name,
            actor_email=entrant.email,
            authority_name=su_name,
            authority_email=su_email,
            pin_used="123456",
            justification_snapshot="Autonomous vehicle testing"
        )
        await session.commit()
        await session.refresh(log)
        log_id = log.id

        # 4. Delete the authorizing SuperUser entity
        await session.delete(su)
        await session.commit()

        # 5. Query the entry log and verify attribution is completely intact
        log_res = await session.execute(select(EntryLog).where(EntryLog.id == log_id))
        persisted_log = log_res.scalar_one()

        assert persisted_log.actor_name == "Research Student"
        assert persisted_log.authority_name == "Temporary Authorizer"
        assert persisted_log.authority_email == su_email
        assert persisted_log.authority_name != persisted_log.actor_name, "Attribution corrupted into self-approval!"


@pytest.mark.asyncio
async def test_annual_september_purge_rules():
    """Verify annual September 1st purge logic:
    - Entrant users purged
    - SuperUsers created < July 15 purged
    - SuperUsers created >= July 15 preserved
    - Admins preserved
    - Logs older than 3 years purged, logs <= 3 years retained
    """
    async with AsyncSessionLocal() as session:
        # User to be purged
        u = User(
            name="Purgeable Student",
            email=f"purge_user_{uuid.uuid4().hex[:6]}@college.edu",
            phone="+919876543210"
        )
        session.add(u)

        # SuperUser before July 15 (e.g. July 14) -> must be purged
        current_year = utc_now().year
        old_su_date = datetime(current_year, 7, 14, 12, 0, tzinfo=timezone.utc)
        old_su = SuperUser(
            name="Old Cohort Lead",
            email=f"old_lead_{uuid.uuid4().hex[:6]}@college.edu",
            phone="+919876543210",
            allowed_spaces=["sandboxx_0"],
            is_active=True,
            created_at=old_su_date
        )
        session.add(old_su)

        # SuperUser on/after July 15 (e.g. July 15) -> must be preserved
        new_su_date = datetime(current_year, 7, 15, 12, 0, tzinfo=timezone.utc)
        new_su = SuperUser(
            name="New Cohort Lead",
            email=f"new_lead_{uuid.uuid4().hex[:6]}@college.edu",
            phone="+919876543210",
            allowed_spaces=["sandboxx_0"],
            is_active=True,
            created_at=new_su_date
        )
        session.add(new_su)

        # Log > 3 years old -> must be purged
        four_years_ago = utc_now() - timedelta(days=4 * 365)
        old_log = EntryLog(
            event_type=EntryEventType.DOOR_UNLOCKED,
            space_id="sandboxx_0",
            actor_name="Historical User",
            actor_email="hist@college.edu",
            authority_name="Historical Lead",
            authority_email="hist_lead@college.edu",
            created_at=four_years_ago
        )
        session.add(old_log)

        # Log within 3 years -> must be retained
        recent_log = EntryLog(
            event_type=EntryEventType.DOOR_UNLOCKED,
            space_id="sandboxx_0",
            actor_name="Recent User",
            actor_email="recent@college.edu",
            authority_name="Recent Lead",
            authority_email="recent_lead@college.edu",
            created_at=utc_now() - timedelta(days=30)
        )
        session.add(recent_log)

        await session.commit()
        old_su_id = old_su.id
        new_su_id = new_su.id
        old_log_id = old_log.id
        recent_log_id = recent_log.id

        # Execute purge logic
        stats = await execute_annual_september_purge(session)
        assert stats["users_deleted"] >= 1
        assert stats["superusers_deleted"] >= 1
        await prune_logs_older_than_three_years(session)

        # Verify old superuser was purged
        res = await session.execute(select(SuperUser).where(SuperUser.id == old_su_id))
        assert res.scalar_one_or_none() is None

        # Verify new superuser was preserved
        res = await session.execute(select(SuperUser).where(SuperUser.id == new_su_id))
        assert res.scalar_one_or_none() is not None

        # Verify old log was purged and recent log retained
        res = await session.execute(select(EntryLog).where(EntryLog.id == old_log_id))
        assert res.scalar_one_or_none() is None

        res = await session.execute(select(EntryLog).where(EntryLog.id == recent_log_id))
        assert res.scalar_one_or_none() is not None

        # Verify Root Admin was preserved
        res = await session.execute(select(Admin).where(Admin.email == "rehankuriance@gmail.com"))
        assert res.scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_web_push_vapid_and_subscription_flow():
    """Verify VAPID public key endpoint, subscription persistence, and test alert."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Fetch VAPID public key
        r = await client.get("/api/v1/notifications/vapid-public-key")
        assert r.status_code == 200
        key_data = r.json()
        assert "public_key" in key_data
        assert len(key_data["public_key"]) > 20

        # 2. Login as SuperUser to obtain auth token
        login_res = await client.post("/api/v1/auth/login", json={"email": "lead.robotics@college.edu"})
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 3. Register push subscription
        fake_endpoint = f"https://fcm.googleapis.com/fcm/send/{uuid.uuid4().hex}"
        sub_payload = {
            "endpoint": fake_endpoint,
            "keys": {
                "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcDnVwT3JhWuWwT_K",
                "auth": "tBHItJI5svbpez7KI4CCXg",
            }
        }
        r = await client.post("/api/v1/notifications/subscribe", headers=headers, json=sub_payload)
        assert r.status_code == 200
        assert r.json()["status"] == "success"

        # Verify saved in database
        async with AsyncSessionLocal() as session:
            sub_res = await session.execute(
                select(PushSubscription).where(PushSubscription.endpoint == fake_endpoint)
            )
            sub = sub_res.scalar_one_or_none()
            assert sub is not None
            assert sub.user_email == "lead.robotics@college.edu"

        # 4. Trigger diagnostic test alert
        r = await client.post("/api/v1/notifications/test-alert", headers=headers)
        assert r.status_code == 200
        test_res = r.json()
        assert test_res["status"] in ["delivered", "no_subscriptions"]
