"""Tests for new PANDA requirements:
- Waiting room rejection & pending enforcement (Item 6)
- SuperUser deletion revokes mapped user registrations & deletes SU cleanly (Items 7, 10)
- Re-registration deletes old account & invalidates old JWT; SU update invalidates JWT (Item 8)
- SuperUser & Admin user deletion creates visible audit logs (Item 9)
- PIN regeneration immediately revokes current active PIN (Item 11)
- Bulk revoke-all PINs endpoint scoped by authority (Item 13)
- Rate limiting middleware returns 429 when exceeded (Item 14)
"""

import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select, and_
from backend.app.main import app
from backend.app.api.deps import create_access_token
from backend.app.config.settings import settings
from backend.app.db.session import AsyncSessionLocal
from backend.app.models.entry_log import EntryLog, EntryEventType
from backend.app.models.assignment import UserSpaceAssignment


def _root_headers() -> dict:
    tok = create_access_token({
        "sub": settings.ROOT_ADMIN_EMAIL,
        "role": "admin",
        "name": "Rehan Kurian",
        "is_root": True,
        "authorized_spaces": ["all"],
    })
    return {"Authorization": f"Bearer {tok}"}


@pytest.mark.asyncio
async def test_waiting_room_blocks_rejected_and_pending_access_requests():
    uid = uuid.uuid4().hex[:6]
    sp_slug = f"wait_sp_{uid}"
    su_email = f"wait_su_{uid}@college.edu"
    u_email = f"wait_u_{uid}@college.edu"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/v1/spaces", json={"slug": sp_slug, "name": "Wait Space"}, headers=_root_headers())
        su_res = await client.post(
            "/api/v1/admin/superusers",
            json={"name": "Wait SU", "email": su_email, "phone": "9876543210", "allowed_spaces": [sp_slug]},
            headers=_root_headers(),
        )
        su_id = su_res.json()["id"]
        su_tok = (await client.post("/api/v1/auth/login", json={"email": su_email})).json()["access_token"]

        reg_res = await client.post(
            "/api/v1/auth/register",
            json={
                "name": "Wait User",
                "email": u_email,
                "phone": "9876543211",
                "space_id": sp_slug,
                "assigned_superuser_id": su_id,
            },
        )
        assert reg_res.status_code == 200
        u_tok = reg_res.json()["access_token"]

        # Pending user cannot request PIN
        r_pend = await client.post(
            "/api/v1/requests",
            json={"space_slug": sp_slug, "justification": "Trying while pending"},
            headers={"Authorization": f"Bearer {u_tok}"},
        )
        assert r_pend.status_code == 400

        # SuperUser rejects the REGISTRATION request
        reqs = (await client.get(f"/api/v1/requests?space_slug={sp_slug}", headers={"Authorization": f"Bearer {su_tok}"})).json()
        reg_req = next(r for r in reqs if r["requester_email"] == u_email and r["request_type"] == "REGISTRATION")
        dec = await client.post(
            f"/api/v1/requests/{reg_req['id']}/decision",
            json={"status": "REJECTED"},
            headers={"Authorization": f"Bearer {su_tok}"},
        )
        assert dec.status_code == 200

        # Rejected user MUST be blocked from requesting PIN (403)
        r_rej = await client.post(
            "/api/v1/requests",
            json={"space_slug": sp_slug, "justification": "Trying after rejection"},
            headers={"Authorization": f"Bearer {u_tok}"},
        )
        assert r_rej.status_code == 403

        await client.delete(f"/api/v1/admin/users/{u_email}", headers=_root_headers())
        await client.delete(f"/api/v1/admin/superusers/{su_id}", headers=_root_headers())
        await client.delete(f"/api/v1/spaces/{sp_slug}", headers=_root_headers())


@pytest.mark.asyncio
async def test_superuser_deletion_revokes_mapped_users_and_logs():
    uid = uuid.uuid4().hex[:6]
    sp_slug = f"sudel_sp_{uid}"
    su_email = f"sudel_su_{uid}@college.edu"
    u_email = f"sudel_u_{uid}@college.edu"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/v1/spaces", json={"slug": sp_slug, "name": "SU Del Space"}, headers=_root_headers())
        su_res = await client.post(
            "/api/v1/admin/superusers",
            json={"name": "Del SU", "email": su_email, "phone": "9876543210", "allowed_spaces": [sp_slug]},
            headers=_root_headers(),
        )
        su_id = su_res.json()["id"]
        su_tok = (await client.post("/api/v1/auth/login", json={"email": su_email})).json()["access_token"]

        reg = await client.post(
            "/api/v1/auth/register",
            json={"name": "Mapped User", "email": u_email, "phone": "9876543211", "space_id": sp_slug, "assigned_superuser_id": su_id},
        )
        u_tok = reg.json()["access_token"]

        # Delete SuperUser
        del_res = await client.delete(f"/api/v1/admin/superusers/{su_id}", headers=_root_headers())
        assert del_res.status_code == 200

        # SuperUser login should now be 404 ACCOUNT_NOT_FOUND (completely deleted, not inactive)
        su_login_after = await client.post("/api/v1/auth/login", json={"email": su_email})
        assert su_login_after.status_code == 404

        # Old SuperUser token & affected user token should be invalidated (401)
        assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {su_tok}"})).status_code == 401
        assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {u_tok}"})).status_code == 401

        # User's assignment for sp_slug must be revoked (deleted)
        async with AsyncSessionLocal() as session:
            assigns = (await session.execute(
                select(UserSpaceAssignment).where(UserSpaceAssignment.space_id == sp_slug)
            )).scalars().all()
            assert len(assigns) == 0

            # Visible SUPERUSER_DELETED log exists
            logs = (await session.execute(
                select(EntryLog).where(
                    and_(EntryLog.event_type == EntryEventType.SUPERUSER_DELETED, EntryLog.actor_email == su_email)
                )
            )).scalars().all()
            assert len(logs) >= 1

        await client.delete(f"/api/v1/admin/users/{u_email}", headers=_root_headers())
        await client.delete(f"/api/v1/spaces/{sp_slug}", headers=_root_headers())


@pytest.mark.asyncio
async def test_reregistration_recreates_user_and_pin_regeneration_revokes_old_pin_and_bulk_revoke():
    uid = uuid.uuid4().hex[:6]
    sp_slug = f"regen_sp_{uid}"
    su_email = f"regen_su_{uid}@college.edu"
    u_email = f"regen_u_{uid}@college.edu"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/v1/spaces", json={"slug": sp_slug, "name": "Regen Space"}, headers=_root_headers())
        su_res = await client.post(
            "/api/v1/admin/superusers",
            json={"name": "Regen SU", "email": su_email, "phone": "9876543210", "allowed_spaces": [sp_slug]},
            headers=_root_headers(),
        )
        su_id = su_res.json()["id"]
        su_tok = (await client.post("/api/v1/auth/login", json={"email": su_email})).json()["access_token"]

        # 1. Register user, then re-register same email -> old token invalidated
        r1 = await client.post(
            "/api/v1/auth/register",
            json={"name": "Old Name", "email": u_email, "phone": "9876543211", "space_id": sp_slug, "assigned_superuser_id": su_id},
        )
        old_tok = r1.json()["access_token"]

        r2 = await client.post(
            "/api/v1/auth/register",
            json={"name": "New Name", "email": u_email, "phone": "9876543212", "space_id": sp_slug, "assigned_superuser_id": su_id},
        )
        new_tok = r2.json()["access_token"]
        assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {old_tok}"})).status_code == 401
        assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new_tok}"})).status_code == 200

        # Approve registration
        reqs = (await client.get(f"/api/v1/requests?space_slug={sp_slug}", headers={"Authorization": f"Bearer {su_tok}"})).json()
        reg_req = next(r for r in reqs if r["requester_email"] == u_email and r["request_type"] == "REGISTRATION")
        await client.post(f"/api/v1/requests/{reg_req['id']}/decision", json={"status": "APPROVED"}, headers={"Authorization": f"Bearer {su_tok}"})

        # Issue direct PIN for user
        pin_res = await client.post(
            "/api/v1/pins/direct",
            json={"space_id": sp_slug, "entrant_email": u_email, "justification": "Initial pin"},
            headers={"Authorization": f"Bearer {su_tok}"},
        )
        assert pin_res.status_code == 200

        # Verify active PIN exists for user
        active_before = await client.get(f"/api/v1/pins/active?space_slug={sp_slug}", headers={"Authorization": f"Bearer {new_tok}"})
        assert active_before.json() is not None

        # User sends a new PIN request to regenerate -> old PIN is IMMEDIATELY disabled!
        regen_req = await client.post(
            "/api/v1/requests",
            json={"space_slug": sp_slug, "justification": "Need a fresh PIN"},
            headers={"Authorization": f"Bearer {new_tok}"},
        )
        assert regen_req.status_code == 200

        active_after = await client.get(f"/api/v1/pins/active?space_slug={sp_slug}", headers={"Authorization": f"Bearer {new_tok}"})
        assert active_after.json() is None

        # Approve new request -> issues new PIN, then test bulk revoke-all
        await client.post(
            f"/api/v1/requests/{regen_req.json()['id']}/decision",
            json={"status": "APPROVED"},
            headers={"Authorization": f"Bearer {su_tok}"},
        )
        revoke_all = await client.post(
            f"/api/v1/pins/revoke-all?space_slug={sp_slug}",
            headers={"Authorization": f"Bearer {su_tok}"},
        )
        assert revoke_all.status_code == 200
        assert revoke_all.json()["revoked_count"] >= 1

        # SuperUser deletes user from directory -> visible USER_DELETED log
        del_u = await client.delete(f"/api/v1/admin/users/{u_email}", headers={"Authorization": f"Bearer {su_tok}"})
        assert del_u.status_code == 200
        async with AsyncSessionLocal() as session:
            u_logs = (await session.execute(
                select(EntryLog).where(
                    and_(EntryLog.event_type == EntryEventType.USER_DELETED, EntryLog.actor_email == u_email)
                )
            )).scalars().all()
            assert len(u_logs) >= 1

        await client.delete(f"/api/v1/admin/superusers/{su_id}", headers=_root_headers())
        await client.delete(f"/api/v1/spaces/{sp_slug}", headers=_root_headers())


@pytest.mark.asyncio
async def test_rate_limiting_middleware_enforces_429():
    orig = settings.RATE_LIMIT_ENABLED
    settings.RATE_LIMIT_ENABLED = True
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            statuses = []
            for _ in range(35):
                res = await client.post("/api/v1/auth/login", json={"email": "nonexistent_rate@college.edu"})
                statuses.append(res.status_code)
            assert 429 in statuses
    finally:
        settings.RATE_LIMIT_ENABLED = orig
