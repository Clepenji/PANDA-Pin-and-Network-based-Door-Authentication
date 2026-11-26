"""Tests for Registration Acceptance tag, PIN Revocation audit logs, and Active Keys authority scoping."""

import pytest
import uuid
from datetime import timedelta
from sqlalchemy import select, and_, delete
from backend.app.db.base import utc_now
from backend.app.models.user import User
from backend.app.models.superuser import SuperUser
from backend.app.models.active_pin import ActivePin
from backend.app.models.entry_log import EntryLog, EntryEventType
from backend.app.models.access_request import AccessRequest, RequestStatus
from backend.app.services.pin_service import PinService
from backend.app.services.log_service import LogService
from httpx import AsyncClient, ASGITransport
from backend.app.main import app
from backend.app.api.deps import create_access_token
from backend.app.db.session import AsyncSessionLocal


@pytest.mark.asyncio
async def test_pin_revocation_creates_visible_audit_log():
    """Test that revoking an active PIN creates an immutable EntryLog with PIN_REVOKED."""
    async with AsyncSessionLocal() as async_session:
        now = utc_now()
        
        # 1. Create entrant user
        unique_suffix = uuid.uuid4().hex[:6]
        entrant = User(
            email=f"entrant_{unique_suffix}@hyderabad.bits-pilani.ac.in",
            name=f"Entrant {unique_suffix}",
            phone="9876543210",
            college_year="2nd Year",
        )
        async_session.add(entrant)
        await async_session.commit()
        await async_session.refresh(entrant)

        # 2. Issue an active PIN
        pin = ActivePin(
            pin_code=f"9{unique_suffix[:5]}",
            space_id="sandboxx_0",
            holder_user_id=entrant.id,
            issued_by_name_snapshot="Admin Lead",
            issued_by_email_snapshot="admin@campus.edu",
            expires_at=now + timedelta(hours=2),
        )
        async_session.add(pin)
        await async_session.commit()
        await async_session.refresh(pin)

        # 3. Revoke PIN via PinService
        actor = {
            "role": "admin",
            "email": "revoker@campus.edu",
            "name": "Prof Revoker",
            "authorized_spaces": ["sandboxx_0", "sandboxx_1"],
        }
        revoked = await PinService.revoke_pin(
            session=async_session,
            pin_id=pin.id,
            actor=actor,
        )
        await async_session.commit()

        assert revoked.revoked_at is not None

        # 4. Verify EntryLog was written
        stmt = (
            select(EntryLog)
            .where(
                and_(
                    EntryLog.event_type == EntryEventType.PIN_REVOKED,
                    EntryLog.pin_used == pin.pin_code,
                )
            )
            .order_by(EntryLog.created_at.desc())
        )
        res = await async_session.execute(stmt)
        log_entry = res.scalar_one_or_none()

        assert log_entry is not None
        assert log_entry.actor_name == entrant.name
        assert log_entry.actor_email == entrant.email
        assert log_entry.authority_name == "Prof Revoker"
        assert log_entry.authority_email == "revoker@campus.edu"
        assert log_entry.space_id == "sandboxx_0"


@pytest.mark.asyncio
async def test_active_keys_scoped_strictly_to_superuser_authority():
    """Test that SuperUsers only see active keys within their real-time DB allowed_spaces."""
    async with AsyncSessionLocal() as async_session:
        now = utc_now()
        unique_suffix = uuid.uuid4().hex[:6]

        # Create entrant
        entrant = User(
            email=f"student_{unique_suffix}@hyderabad.bits-pilani.ac.in",
            name=f"Student {unique_suffix}",
            phone="9876543211",
            college_year="3rd Year",
        )
        async_session.add(entrant)

        # Create SuperUser with authority ONLY over sandboxx_0
        su = SuperUser(
            email=f"su_{unique_suffix}@hyderabad.bits-pilani.ac.in",
            name=f"Lead {unique_suffix}",
            phone="9876543212",
            allowed_spaces=["sandboxx_0"],
            is_active=True,
        )
        async_session.add(su)
        await async_session.commit()
        await async_session.refresh(entrant)
        await async_session.refresh(su)

        # Issue PIN 1 in sandboxx_0 (authorized)
        pin0 = ActivePin(
            pin_code=f"8{unique_suffix[:5]}",
            space_id="sandboxx_0",
            holder_user_id=entrant.id,
            issued_by_name_snapshot="Authority",
            issued_by_email_snapshot=su.email,
            expires_at=now + timedelta(hours=2),
        )
        # Issue PIN 2 in sandboxx_1 (unauthorized for this SU)
        pin1 = ActivePin(
            pin_code=f"7{unique_suffix[:5]}",
            space_id="sandboxx_1",
            holder_user_id=entrant.id,
            issued_by_name_snapshot="Authority",
            issued_by_email_snapshot="other@campus.edu",
            expires_at=now + timedelta(hours=2),
        )
        async_session.add_all([pin0, pin1])
        await async_session.commit()

        token = create_access_token({
            "sub": su.email,
            "role": "superuser",
            "name": su.name,
            "authorized_spaces": ["sandboxx_0"],
        })

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get(
                "/api/v1/pins/active-keys",
                headers={"Authorization": f"Bearer {token}"}
            )
            assert resp.status_code == 200
            data = resp.json()

            # Should contain sandboxx_0 but NOT sandboxx_1
            returned_pin_ids = [d["id"] for d in data]
            assert str(pin0.id) in returned_pin_ids
            assert str(pin1.id) not in returned_pin_ids

            # Now simulate reducing SuperUser authority in the database (remove all spaces)
            su.allowed_spaces = []
            await async_session.commit()

            # Call again without changing token - real-time DB authority kicks in
            resp2 = await ac.get(
                "/api/v1/pins/active-keys",
                headers={"Authorization": f"Bearer {token}"}
            )
            assert resp2.status_code == 200
            data2 = resp2.json()
            assert len(data2) == 0


@pytest.mark.asyncio
async def test_registration_approval_logs_reg_accepted():
    """Test that approving an entrant registration request logs REG_ACCEPTED instead of ACCESS_GRANTED."""
    async with AsyncSessionLocal() as async_session:
        unique_suffix = uuid.uuid4().hex[:6]
        user = User(
            email=f"reg_user_{unique_suffix}@hyderabad.bits-pilani.ac.in",
            name=f"Reg User {unique_suffix}",
            phone="9876543213",
            college_year="1st Year",
        )
        su = SuperUser(
            email=f"reg_su_{unique_suffix}@hyderabad.bits-pilani.ac.in",
            name=f"Approver {unique_suffix}",
            phone="9876543214",
            allowed_spaces=["sandboxx_0"],
            is_active=True,
        )
        async_session.add_all([user, su])
        await async_session.commit()
        await async_session.refresh(user)
        await async_session.refresh(su)

        req = AccessRequest(
            requester_user_id=user.id,
            space_id="sandboxx_0",
            superuser_id=su.id,
            justification=f"New Entrant Registration {unique_suffix}",
            request_type="REGISTRATION",
            status=RequestStatus.PENDING,
        )
        async_session.add(req)
        await async_session.commit()
        await async_session.refresh(req)

        token = create_access_token({
            "sub": su.email,
            "role": "superuser",
            "name": su.name,
            "authorized_spaces": ["sandboxx_0"],
        })

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.post(
                f"/api/v1/requests/{req.id}/decision",
                headers={"Authorization": f"Bearer {token}"},
                json={"status": "APPROVED"}
            )
            assert resp.status_code == 200

        # Check EntryLog
        stmt = (
            select(EntryLog)
            .where(
                and_(
                    EntryLog.actor_email == user.email,
                    EntryLog.space_id == "sandboxx_0",
                )
            )
            .order_by(EntryLog.created_at.desc())
        )
        res = await async_session.execute(stmt)
        log_entry = res.scalar_one_or_none()
        assert log_entry is not None
        assert log_entry.event_type == EntryEventType.REG_ACCEPTED
        assert log_entry.authority_email == su.email
