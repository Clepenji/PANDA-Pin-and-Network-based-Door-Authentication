"""Comprehensive tests for Zero-Default Spaces, Lock/Space Cascade, Hardware Unbind,
Factory Reset, SuperUser Authority Reduction Routing, and PIN Privacy."""

import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select, and_
from backend.app.main import app
from backend.app.api.deps import create_access_token
from backend.app.db.session import AsyncSessionLocal
from backend.app.models.user import User
from backend.app.models.superuser import SuperUser
from backend.app.models.admin import Admin
from backend.app.models.space import Space
from backend.app.models.esp32_device import ESP32Device
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.models.entry_log import EntryLog, EntryEventType
from backend.app.services.log_service import LogService
from backend.app.services.pin_service import PinService


def _root_token() -> str:
    return create_access_token({
        "sub": "rehankuriance@gmail.com",
        "email": "rehankuriance@gmail.com",
        "role": "admin",
        "name": "Rehan Kurian",
        "is_root": True,
        "authorized_spaces": ["all"],
    })


def _std_admin_token() -> str:
    return create_access_token({
        "sub": "secadmin@college.edu",
        "email": "secadmin@college.edu",
        "role": "admin",
        "name": "Secondary Admin",
        "is_root": False,
        "authorized_spaces": ["all"],
    })


@pytest.mark.asyncio
async def test_last_lock_deletion_cascades_space_and_preserves_user_profile_and_logs():
    """Deleting the last remaining lock deletes the space, deletes single-space SuperUsers,
    removes space tabs from users (keeping user profile), and preserves immutable EntryLogs."""
    root_headers = {"Authorization": f"Bearer {_root_token()}"}
    slug = "cascade_zero_lab"
    su_email = "su_only_cascade@college.edu"
    user_email = "user_only_cascade@college.edu"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Clean slate if leftover
        await client.delete(f"/api/v1/spaces/{slug}", headers=root_headers)

        # 1. Create Facility Space (creates Lock #1 automatically)
        res = await client.post(
            "/api/v1/spaces",
            json={"slug": slug, "name": "Cascade Zero Lab", "lock_name": "Main Door", "is_active": True},
            headers=root_headers,
        )
        assert res.status_code == 201, res.text
        lock_id = res.json()["esp32_device_id"]

        # 2. Appoint a SuperUser with authority ONLY over this space
        res_su = await client.post(
            "/api/v1/admin/superusers",
            json={
                "email": su_email,
                "name": "Cascade Lead",
                "phone": "+919800000001",
                "college_year": "3rd Year",
                "allowed_spaces": [slug],
            },
            headers=root_headers,
        )
        assert res_su.status_code == 200, res_su.text
        su_id = res_su.json()["id"]

        # 3. Register regular student ONLY for this space
        res_reg = await client.post(
            "/api/v1/auth/register",
            json={
                "email": user_email,
                "name": "Cascade Student",
                "phone": "+919800000002",
                "college_year": "2nd Year",
                "space_id": slug,
                "assigned_superuser_id": su_id,
            },
        )
        assert res_reg.status_code == 200, res_reg.text

        # 4. Write an immutable EntryLog for this space
        async with AsyncSessionLocal() as session:
            await LogService.create_entry_log(
                session=session,
                event_type=EntryEventType.ACCESS_GRANTED,
                space_id=slug,
                actor_name="Cascade Student",
                actor_email=user_email,
                authority_name="Cascade Lead",
                authority_email=su_email,
                pin_used="123456",
                justification_snapshot="Immutable log check",
            )
            await session.commit()

        # 5. Delete Lock #1 (which is the LAST lock for this space)
        del_res = await client.delete(f"/api/v1/esp32/devices/{lock_id}", headers=root_headers)
        assert del_res.status_code == 200, del_res.text
        del_data = del_res.json()
        assert del_data["space_deleted"] is True

        # Verify database state immediately
        async with AsyncSessionLocal() as session:
            # Space deleted
            sp = (await session.execute(select(Space).where(Space.slug == slug))).scalar_one_or_none()
            assert sp is None
            # Single-space SuperUser deleted
            su = (await session.execute(select(SuperUser).where(SuperUser.email == su_email))).scalar_one_or_none()
            assert su is None
            # User profile PRESERVED, but assignment tab deleted!
            usr = (await session.execute(select(User).where(User.email == user_email))).scalar_one_or_none()
            assert usr is not None
            assigns = (await session.execute(
                select(UserSpaceAssignment).where(UserSpaceAssignment.user_id == usr.id)
            )).scalars().all()
            assert len(assigns) == 0
            # Immutable EntryLog preserved!
            logs = (await session.execute(
                select(EntryLog).where(EntryLog.space_id == slug)
            )).scalars().all()
            assert len(logs) >= 1

            # Cleanup test user/logs
            await session.delete(usr)
            for l in logs:
                await session.delete(l)
            await session.commit()


@pytest.mark.asyncio
async def test_multi_lock_promotion_and_hardware_unbind():
    """Deleting Lock #1 when Lock #2 exists keeps the space and promotes Lock #2.
    Hardware unbind clears IP & MAC while keeping device_id & device_secret."""
    root_headers = {"Authorization": f"Bearer {_root_token()}"}
    slug = "multi_lock_lab"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.delete(f"/api/v1/spaces/{slug}", headers=root_headers)

        # Create Space + Lock #1
        res = await client.post(
            "/api/v1/spaces",
            json={"slug": slug, "name": "Multi Lock Lab", "esp32_device_id": "ESP32_ML_LOCK1", "is_active": True},
            headers=root_headers,
        )
        assert res.status_code == 201

        # Add Lock #2
        res2 = await client.post(
            "/api/v1/esp32/devices",
            json={"device_id": "ESP32_ML_LOCK2", "name": "Back Door", "space_id": slug},
            headers=root_headers,
        )
        assert res2.status_code == 201
        orig_secret = res2.json()["device_secret"]

        # Simulate Lock #2 connected with IP and MAC
        async with AsyncSessionLocal() as session:
            dev2 = (await session.execute(select(ESP32Device).where(ESP32Device.device_id == "ESP32_ML_LOCK2"))).scalar_one()
            dev2.ip_address = "10.20.30.40"
            dev2.mac_address = "AA:BB:CC:DD:EE:FF"
            dev2.is_online = True
            await session.commit()

        # Delete Lock #1 -> Space must remain, Lock #2 promoted
        del1 = await client.delete("/api/v1/esp32/devices/ESP32_ML_LOCK1", headers=root_headers)
        assert del1.status_code == 200
        assert del1.json()["space_deleted"] is False

        sp_res = await client.get(f"/api/v1/spaces/{slug}", headers=root_headers)
        assert sp_res.status_code == 200
        assert sp_res.json()["esp32_device_id"] == "ESP32_ML_LOCK2"

        # Unbind Hardware on Lock #2 -> IP & MAC forgotten, secret preserved
        unbind_res = await client.post("/api/v1/esp32/devices/ESP32_ML_LOCK2/unbind", headers=root_headers)
        assert unbind_res.status_code == 200
        assert unbind_res.json()["ip_address"] is None
        assert unbind_res.json()["mac_address"] is None
        assert unbind_res.json()["is_online"] is False

        async with AsyncSessionLocal() as session:
            dev2 = (await session.execute(select(ESP32Device).where(ESP32Device.device_id == "ESP32_ML_LOCK2"))).scalar_one()
            assert dev2.ip_address is None
            assert dev2.mac_address is None
            assert dev2.device_secret == orig_secret

        # Cleanup
        await client.delete(f"/api/v1/spaces/{slug}", headers=root_headers)


@pytest.mark.asyncio
async def test_superuser_authority_reduction_and_pin_privacy():
    """Reducing SuperUser authority reassigns assignments & blocks self/unauthorized routing.
    SuperUsers cannot see student PINs in active-list, direct response, or CSV export."""
    root_headers = {"Authorization": f"Bearer {_root_token()}"}
    sp_a = "auth_scope_a"
    sp_b = "auth_scope_b"
    su1_email = "su_reduced@college.edu"
    su2_email = "su_lead_b@college.edu"
    student_email = "pin_priv_student@college.edu"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.delete(f"/api/v1/spaces/{sp_a}", headers=root_headers)
        await client.delete(f"/api/v1/spaces/{sp_b}", headers=root_headers)

        await client.post("/api/v1/spaces", json={"slug": sp_a, "name": "Scope Space A"}, headers=root_headers)
        await client.post("/api/v1/spaces", json={"slug": sp_b, "name": "Scope Space B"}, headers=root_headers)

        # Create SU1 (governing both A and B) and SU2 (governing B)
        r1 = await client.post(
            "/api/v1/admin/superusers",
            json={"email": su1_email, "name": "Lead Reduced", "phone": "+919800000011", "allowed_spaces": [sp_a, sp_b]},
            headers=root_headers,
        )
        r2 = await client.post(
            "/api/v1/admin/superusers",
            json={"email": su2_email, "name": "Lead Space B", "phone": "+919800000012", "allowed_spaces": [sp_b]},
            headers=root_headers,
        )
        su1_id = r1.json()["id"]
        su2_id = r2.json()["id"]

        # Unchecking ALL spaces (empty array) must be rejected
        bad_edit = await client.put(
            f"/api/v1/admin/superusers/{su1_id}",
            json={"allowed_spaces": []},
            headers=root_headers,
        )
        assert bad_edit.status_code == 400

        # Register a student under SU1 in sp_b and issue an active PIN BEFORE removing SU1's sp_b authority
        reg_st = await client.post(
            "/api/v1/auth/register",
            json={
                "email": student_email,
                "name": "Priv Student",
                "phone": "+919800000099",
                "college_year": "2nd Year",
                "space_id": sp_b,
                "assigned_superuser_id": su1_id,
            },
        )
        assert reg_st.status_code == 200, reg_st.text
        st_tok = reg_st.json()["access_token"]
        su1_login0 = await client.post("/api/v1/auth/login", json={"email": su1_email})
        su1_tok0 = su1_login0.json()["access_token"]
        su1_reqs0 = (await client.get(f"/api/v1/requests?space_slug={sp_b}", headers={"Authorization": f"Bearer {su1_tok0}"})).json()
        st_reg_req = next(r for r in su1_reqs0 if r["requester_email"] == student_email)
        await client.post(
            f"/api/v1/requests/{st_reg_req['id']}/decision",
            json={"status": "APPROVED"},
            headers={"Authorization": f"Bearer {su1_tok0}"},
        )
        st_pin_res = await client.post(
            "/api/v1/pins/direct",
            json={"space_id": sp_b, "entrant_email": student_email, "justification": "Active PIN before authority removal"},
            headers={"Authorization": f"Bearer {su1_tok0}"},
        )
        assert st_pin_res.status_code == 200

        # Reduce SU1 authority to ONLY [sp_a]
        ok_edit = await client.put(
            f"/api/v1/admin/superusers/{su1_id}",
            json={"allowed_spaces": [sp_a]},
            headers=root_headers,
        )
        assert ok_edit.status_code == 200

        # Both SU1's own assignment in sp_b AND the student's assignment + active PIN in sp_b must be revoked/deleted (not remapped!)
        async with AsyncSessionLocal() as session:
            from backend.app.models.active_pin import ActivePin
            u1 = (await session.execute(select(User).where(User.email == su1_email))).scalar_one()
            assign_b = (await session.execute(
                select(UserSpaceAssignment).where(
                    and_(UserSpaceAssignment.user_id == u1.id, UserSpaceAssignment.space_id == sp_b)
                )
            )).scalar_one_or_none()
            assert assign_b is None

            st_u = (await session.execute(select(User).where(User.email == student_email))).scalar_one()
            st_assign_b = (await session.execute(
                select(UserSpaceAssignment).where(
                    and_(UserSpaceAssignment.user_id == st_u.id, UserSpaceAssignment.space_id == sp_b)
                )
            )).scalar_one_or_none()
            assert st_assign_b is None

            st_active_pins = (await session.execute(
                select(ActivePin).where(
                    and_(ActivePin.holder_user_id == st_u.id, ActivePin.space_id == sp_b, ActivePin.revoked_at.is_(None))
                )
            )).scalars().all()
            assert len(st_active_pins) == 0

        # Student's old token must be invalidated (401) because they have 0 spaces left
        me_after = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {st_tok}"})
        assert me_after.status_code == 401

        # SU1 registers for sp_b under SU2, SU2 approves, then SU1 requests access to sp_b -> SU2 approves
        su1_login = await client.post("/api/v1/auth/login", json={"email": su1_email})
        assert su1_login.status_code == 200
        su1_token = su1_login.json()["access_token"]
        su2_login = await client.post("/api/v1/auth/login", json={"email": su2_email})
        assert su2_login.status_code == 200
        su2_token = su2_login.json()["access_token"]

        reg_sp_b = await client.post(
            "/api/v1/spaces/user/assignments",
            json={"space_id": sp_b, "assigned_superuser_id": su2_id},
            headers={"Authorization": f"Bearer {su1_token}"},
        )
        assert reg_sp_b.status_code == 200
        su2_reqs = (await client.get(f"/api/v1/requests?space_slug={sp_b}", headers={"Authorization": f"Bearer {su2_token}"})).json()
        su1_reg_req = next(r for r in su2_reqs if r["requester_email"] == su1_email and r["request_type"] == "REGISTRATION")
        await client.post(
            f"/api/v1/requests/{su1_reg_req['id']}/decision",
            json={"status": "APPROVED"},
            headers={"Authorization": f"Bearer {su2_token}"},
        )

        # Explicitly trying to target self must fail with 400
        self_req = await client.post(
            "/api/v1/requests",
            json={"space_slug": sp_b, "justification": "Testing self block", "target_superuser_id": su1_id},
            headers={"Authorization": f"Bearer {su1_token}"},
        )
        assert self_req.status_code == 400

        # Normal request without explicit ID (or with SU2 selected) routes to SU2
        good_req = await client.post(
            "/api/v1/requests",
            json={"space_slug": sp_b, "justification": "Need access to Lab B"},
            headers={"Authorization": f"Bearer {su1_token}"},
        )
        assert good_req.status_code == 200
        assert good_req.json()["superuser_id"] == su2_id

        # SU2 approves the request -> generates a student PIN
        req_id = good_req.json()["id"]
        app_res = await client.post(
            f"/api/v1/requests/{req_id}/decision",
            json={"status": "APPROVED"},
            headers={"Authorization": f"Bearer {su2_token}"},
        )
        assert app_res.status_code == 200

        # PIN Privacy checks for SuperUsers:
        # 1. /pins/active-list must mask PIN ("******") for SU2
        active_list = await client.get(
            f"/api/v1/pins/active-list?space_slug={sp_b}",
            headers={"Authorization": f"Bearer {su2_token}"},
        )
        assert active_list.status_code == 200
        assert len(active_list.json()) >= 1
        assert all(item["pin_code"] == "******" for item in active_list.json())

        # 2. /pins/direct for another student masks PIN ("******") for SU1
        direct_res = await client.post(
            "/api/v1/pins/direct",
            json={"space_id": sp_a, "entrant_email": student_email, "justification": "Privacy check"},
            headers={"Authorization": f"Bearer {su1_token}"},
        )
        assert direct_res.status_code == 200
        assert direct_res.json()["pin_code"] == "******"

        # 3. /logs/audit/csv masks PINs for SuperUser callers
        csv_res = await client.get(
            "/api/v1/logs/audit/csv",
            headers={"Authorization": f"Bearer {su2_token}"},
        )
        assert csv_res.status_code == 200
        assert "******" in csv_res.text

        # Cleanup
        await client.delete(f"/api/v1/spaces/{sp_a}", headers=root_headers)
        await client.delete(f"/api/v1/spaces/{sp_b}", headers=root_headers)


@pytest.mark.asyncio
async def test_factory_reset_root_only_zero_state():
    """Factory reset is strictly restricted to Root Admin and restores 0 spaces & 0 locks."""
    from backend.app.models.admin import Admin
    async with AsyncSessionLocal() as session:
        sec = (await session.execute(select(Admin).where(Admin.email == "secadmin@college.edu"))).scalar_one_or_none()
        if not sec:
            session.add(Admin(email="secadmin@college.edu", name="Secondary Admin", is_root=False))
        other_root = (await session.execute(select(Admin).where(Admin.email == "otherroot@college.edu"))).scalar_one_or_none()
        if not other_root:
            session.add(Admin(email="otherroot@college.edu", name="Other Root Admin", is_root=True))
        await session.commit()

    root_headers = {"Authorization": f"Bearer {_root_token()}"}
    sec_headers = {"Authorization": f"Bearer {_std_admin_token()}"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Non-root admin forbidden from Factory Reset
        forbidden_res = await client.post("/api/v1/admin/factory-reset", headers=sec_headers)
        assert forbidden_res.status_code == 403

        # Create a space first
        await client.post(
            "/api/v1/spaces",
            json={"slug": "factory_wipe_zone", "name": "Factory Wipe Zone"},
            headers=root_headers,
        )

        # Root Admin executes Factory Reset
        ok_res = await client.post("/api/v1/admin/factory-reset", headers=root_headers)
        assert ok_res.status_code == 200
        data = ok_res.json()
        assert data["stats"]["factory_reset"] is True

        # Verify 0 spaces and 0 locks remain
        sps = (await client.get("/api/v1/spaces", headers=root_headers)).json()
        devs = (await client.get("/api/v1/esp32/devices", headers=root_headers)).json()
        assert len(sps) == 0
        assert len(devs) == 0

    # Verify all other admin accounts (standard + other root) were deleted, leaving only initiator
    async with AsyncSessionLocal() as session:
        remaining_admins = (await session.execute(select(Admin))).scalars().all()
        remaining_emails = {a.email.lower().strip() for a in remaining_admins}
        assert "secadmin@college.edu" not in remaining_emails
        assert "otherroot@college.edu" not in remaining_emails
        assert "rehankuriance@gmail.com" in remaining_emails


@pytest.mark.asyncio
async def test_emergency_totp_fixed_24h_independent_of_pin_validity():
    """Emergency Master TOTP stays pinned to 24h (86400s) when PIN validity policy is edited."""
    from backend.app.services.totp_service import TotpService

    root_headers = {"Authorization": f"Bearer {_root_token()}"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Remember original PIN validity setting to restore cleanly
        orig_setting = (await client.get("/api/v1/admin/settings/pin-validity", headers=root_headers)).json()
        orig_seconds = orig_setting["pin_validity_seconds"]

        sp_res = await client.post(
            "/api/v1/spaces",
            json={"slug": "totp_24h_zone", "name": "TOTP 24h Zone"},
            headers=root_headers,
        )
        assert sp_res.status_code == 201
        space_slug = sp_res.json()["slug"]

        try:
            # Capture initial 24h TOTP
            totp_res_1 = (await client.get("/api/v1/admin/esp32/totp", headers=root_headers)).json()
            entry_1 = totp_res_1[space_slug]
            assert entry_1["time_step"] == 86400
            initial_pin = entry_1["pin"]

            devices_1 = (await client.get("/api/v1/admin/esp32/devices", headers=root_headers)).json()
            dev_1 = next(d for d in devices_1 if d["space_id"] == space_slug)
            assert dev_1["totp_time_step"] == 86400
            assert dev_1["totp_pin"] == initial_pin
            assert TotpService.verify_totp(dev_1["device_secret"], initial_pin) is True

            # Edit user PIN validity to 2 hours (7200s), then 5 minutes (300s)
            for new_ttl in (7200, 300):
                upd_res = await client.put(
                    "/api/v1/admin/settings/pin-validity",
                    json={"pin_validity_seconds": new_ttl},
                    headers=root_headers,
                )
                assert upd_res.status_code == 200
                assert upd_res.json()["pin_validity_seconds"] == new_ttl

                totp_res_after = (await client.get("/api/v1/admin/esp32/totp", headers=root_headers)).json()
                entry_after = totp_res_after[space_slug]
                assert entry_after["time_step"] == 86400
                assert entry_after["pin"] == initial_pin

                devices_after = (await client.get("/api/v1/admin/esp32/devices", headers=root_headers)).json()
                dev_after = next(d for d in devices_after if d["space_id"] == space_slug)
                assert dev_after["totp_time_step"] == 86400
                assert dev_after["totp_pin"] == initial_pin
                assert TotpService.verify_totp(dev_after["device_secret"], initial_pin) is True
        finally:
            await client.put(
                "/api/v1/admin/settings/pin-validity",
                json={"pin_validity_seconds": orig_seconds},
                headers=root_headers,
            )
            await client.delete(f"/api/v1/spaces/{space_slug}", headers=root_headers)


@pytest.mark.asyncio
async def test_multi_lock_same_space_distinct_emergency_totp():
    """Locks in the same Facility Space with different secrets produce and verify distinct TOTP PINs."""
    root_headers = {"Authorization": f"Bearer {_root_token()}"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        try:
            await client.delete("/api/v1/spaces/multi_totp_zone", headers=root_headers)
            sp_res = await client.post(
                "/api/v1/spaces",
                json={
                    "slug": "multi_totp_zone",
                    "name": "Multi TOTP Zone",
                    "esp32_device_id": "ESP32_MULTI_LOCK_1",
                    "lock_name": "Front Door",
                },
                headers=root_headers,
            )
            assert sp_res.status_code == 201

            lock2_res = await client.post(
                "/api/v1/esp32/devices",
                json={
                    "space_id": "multi_totp_zone",
                    "device_id": "ESP32_MULTI_LOCK_2",
                    "name": "Back Door",
                },
                headers=root_headers,
            )
            assert lock2_res.status_code == 201
            devices = (await client.get("/api/v1/admin/esp32/devices", headers=root_headers)).json()
            d1 = next(d for d in devices if d["device_id"] == "ESP32_MULTI_LOCK_1")
            d2 = next(d for d in devices if d["device_id"] == "ESP32_MULTI_LOCK_2")
            assert d1["device_secret"] != d2["device_secret"]
            assert d1["totp_pin"] != d2["totp_pin"]

            totp_map = (await client.get("/api/v1/admin/esp32/totp", headers=root_headers)).json()
            assert totp_map["ESP32_MULTI_LOCK_1"]["pin"] == d1["totp_pin"]
            assert totp_map["ESP32_MULTI_LOCK_2"]["pin"] == d2["totp_pin"]
            assert totp_map["ESP32_MULTI_LOCK_1"]["pin"] != totp_map["ESP32_MULTI_LOCK_2"]["pin"]

            # Rotating lock #2 secret changes ONLY lock #2, leaving lock #1 untouched
            rot_res = await client.post(
                "/api/v1/admin/esp32/devices/ESP32_MULTI_LOCK_2/rotate-secret",
                headers=root_headers,
            )
            assert rot_res.status_code == 200
            rot_data = rot_res.json()
            assert rot_data["device_id"] == "ESP32_MULTI_LOCK_2"

            devices_after = (await client.get("/api/v1/admin/esp32/devices", headers=root_headers)).json()
            d1_after = next(d for d in devices_after if d["device_id"] == "ESP32_MULTI_LOCK_1")
            d2_after = next(d for d in devices_after if d["device_id"] == "ESP32_MULTI_LOCK_2")
            assert d1_after["device_secret"] == d1["device_secret"]
            assert d1_after["totp_pin"] == d1["totp_pin"]
            assert d2_after["device_secret"] == rot_data["new_device_secret"]
            assert d2_after["totp_pin"] == rot_data["totp_pin"]
            assert d1_after["totp_pin"] != d2_after["totp_pin"]

            # Cross-lock TOTP verification isolation on /esp32/events and /pins/verify-keypad
            ev1_ok = await client.post(
                "/api/v1/esp32/events",
                json={
                    "space_id": "multi_totp_zone",
                    "device_id": "ESP32_MULTI_LOCK_1",
                    "pin_entered": d1_after["totp_pin"],
                    "door_unlocked": True,
                },
            )
            assert ev1_ok.status_code == 200 and ev1_ok.json()["granted"] is True

            ev1_wrong = await client.post(
                "/api/v1/esp32/events",
                json={
                    "space_id": "multi_totp_zone",
                    "device_id": "ESP32_MULTI_LOCK_1",
                    "pin_entered": d2_after["totp_pin"],
                    "door_unlocked": True,
                },
            )
            assert ev1_wrong.status_code == 200 and ev1_wrong.json()["granted"] is False

            vp2_ok = await client.post(
                "/api/v1/pins/verify-keypad",
                json={"device_id": "ESP32_MULTI_LOCK_2", "pin_code": d2_after["totp_pin"]},
            )
            assert vp2_ok.status_code == 200 and vp2_ok.json()["granted"] is True

            vp2_wrong = await client.post(
                "/api/v1/pins/verify-keypad",
                json={"device_id": "ESP32_MULTI_LOCK_2", "pin_code": d1_after["totp_pin"]},
            )
            assert vp2_wrong.status_code == 200 and vp2_wrong.json()["granted"] is False
        finally:
            await client.delete("/api/v1/spaces/multi_totp_zone", headers=root_headers)


@pytest.mark.asyncio
async def test_auth_login_and_me_include_full_profile_for_prefill():
    """Login, register, and /auth/me return phone, club_name, college_year, and note for profile prefill."""
    root_headers = {"Authorization": f"Bearer {_root_token()}"}
    unique_email = f"prefill_{uuid.uuid4().hex[:6]}@college.edu"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        reg_res = await client.post(
            "/api/v1/auth/register",
            json={
                "email": unique_email,
                "name": "Prefill User",
                "phone": "+919876543210",
                "college_year": "4th Year",
                "club_name": "Prefill Robotics Club",
                "note": "Creator",
            },
        )
        assert reg_res.status_code == 200
        reg_data = reg_res.json()
        assert reg_data["phone"] == "+919876543210"
        assert reg_data["club_name"] == "Prefill Robotics Club"
        assert reg_data["college_year"] == "4th Year"
        assert reg_data["note"] == "Creator"

        login_res = await client.post("/api/v1/auth/login", json={"email": unique_email})
        assert login_res.status_code == 200
        login_data = login_res.json()
        assert login_data["phone"] == "+919876543210"
        assert login_data["club_name"] == "Prefill Robotics Club"
        assert login_data["college_year"] == "4th Year"
        assert login_data["note"] == "Creator"

        me_res = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {login_data['access_token']}"},
        )
        assert me_res.status_code == 200
        me_data = me_res.json()
        assert me_data["phone"] == "+919876543210"
        assert me_data["club_name"] == "Prefill Robotics Club"
        assert me_data["college_year"] == "4th Year"
        assert me_data["note"] == "Creator"

        # Cleanup created test user
        await client.delete(
            "/api/v1/auth/account",
            headers={"Authorization": f"Bearer {login_data['access_token']}"},
        )
        # Ensure Root Admin remains intact
        me_root = await client.get("/api/v1/auth/me", headers=root_headers)
        assert me_root.status_code == 200


@pytest.mark.asyncio
async def test_multi_door_space_receives_pins_and_outbox_independently():
    """All doors in the same Facility Space receive generated PINs, revocations, and independent outbox ACKs."""
    import asyncio
    import hashlib
    import hmac
    import time
    from httpx_ws import aconnect_ws
    from httpx_ws.transport import ASGIWebSocketTransport

    root_headers = {"Authorization": f"Bearer {_root_token()}"}
    slug = f"multi_ws_{uuid.uuid4().hex[:6]}"
    d1_id = f"ESP32_{slug.upper()}_MAIN"
    d2_id = f"ESP32_{slug.upper()}_BACK"

    async def _auth_ws(ws, space_slug: str, dev_id: str, secret: str):
        challenge = await ws.receive_json()
        nonce = challenge["nonce"]
        epoch = int(time.time())
        sig = hmac.new(secret.encode("utf-8"), f"{space_slug}:{nonce}:{epoch}".encode("utf-8"), hashlib.sha256).hexdigest()
        await ws.send_json({
            "type": "AUTH_HELLO",
            "msg_id": str(uuid.uuid4()),
            "space_id": space_slug,
            "device_id": dev_id,
            "timestamp": epoch,
            "firmware_version": "1.2.0",
            "signature": sig,
        })
        ack = await ws.receive_json()
        assert ack["type"] == "AUTH_ACK"
        # Drain initial PURGE_PINS, SYNC_PINS, REQUEST_LOGS frames
        for _ in range(5):
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=0.3)
                if "msg_id" in msg and msg.get("type") in ("PURGE_PINS", "SYNC_PINS"):
                    await ws.send_json({"type": "ACK", "ack_id": msg["msg_id"]})
            except asyncio.TimeoutError:
                break

    async with AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="http://test") as client:
        try:
            sp_res = await client.post(
                "/api/v1/spaces",
                json={"slug": slug, "name": "Multi Door WS", "esp32_device_id": d1_id, "lock_name": "Main Door"},
                headers=root_headers,
            )
            assert sp_res.status_code == 201
            d2_res = await client.post(
                "/api/v1/esp32/devices",
                json={"space_id": slug, "device_id": d2_id, "name": "Back Door"},
                headers=root_headers,
            )
            assert d2_res.status_code == 201

            devices = (await client.get("/api/v1/admin/esp32/devices", headers=root_headers)).json()
            sec1 = next(d["device_secret"] for d in devices if d["device_id"] == d1_id)
            sec2 = next(d["device_secret"] for d in devices if d["device_id"] == d2_id)

            # 1. Both doors online simultaneously -> both receive generated PIN
            async with aconnect_ws(f"/ws/esp32/{slug}", client) as ws1, aconnect_ws(f"/ws/esp32/{slug}", client) as ws2:
                await _auth_ws(ws1, slug, d1_id, sec1)
                await _auth_ws(ws2, slug, d2_id, sec2)

                pin_res = await client.post(
                    "/api/v1/pins/direct",
                    headers=root_headers,
                    json={"space_id": slug, "entrant_email": f"entrant_{slug}@college.edu", "justification": "Multi-door test"},
                )
                assert pin_res.status_code == 200
                pin_code = pin_res.json()["pin_code"]
                pin_id = pin_res.json()["id"]

                msg1 = await asyncio.wait_for(ws1.receive_json(), timeout=2.0)
                msg2 = await asyncio.wait_for(ws2.receive_json(), timeout=2.0)
                assert msg1["type"] == "ADD_PIN" and msg1["pin"] == pin_code
                assert msg2["type"] == "ADD_PIN" and msg2["pin"] == pin_code

                # Ack ONLY from door 1, then verify door 2 still gets REVOKE_PIN as well
                await ws1.send_json({"type": "ACK", "ack_id": msg1["msg_id"]})
                await ws2.send_json({"type": "ACK", "ack_id": msg2["msg_id"]})
                await asyncio.sleep(0.05)

                rev_res = await client.post(f"/api/v1/pins/{pin_id}/revoke", headers=root_headers)
                assert rev_res.status_code == 200
                rev1 = await asyncio.wait_for(ws1.receive_json(), timeout=2.0)
                rev2 = await asyncio.wait_for(ws2.receive_json(), timeout=2.0)
                assert rev1["type"] == "REVOKE_PIN" and rev1["pin"] == pin_code
                assert rev2["type"] == "REVOKE_PIN" and rev2["pin"] == pin_code

            # 2. Door 1 online, Door 2 offline -> status must NOT falsely show Door 2 online,
            #    and Door 2 must still receive the PIN via outbox/SYNC_PINS on reconnect!
            async with aconnect_ws(f"/ws/esp32/{slug}", client) as ws1:
                await _auth_ws(ws1, slug, d1_id, sec1)
                st_list = (await client.get("/api/v1/esp32/status", headers=root_headers)).json()
                st1 = next(s for s in st_list if s["device_id"] == d1_id)
                st2 = next(s for s in st_list if s["device_id"] == d2_id)
                assert st1["is_online"] is True
                assert st2["is_online"] is False

                pin2_res = await client.post(
                    "/api/v1/pins/direct",
                    headers=root_headers,
                    json={"space_id": slug, "entrant_email": f"entrant2_{slug}@college.edu", "justification": "Offline door 2 test"},
                )
                assert pin2_res.status_code == 200
                pin2_code = pin2_res.json()["pin_code"]

                # Door 1 receives & ACKs immediately
                m1 = await asyncio.wait_for(ws1.receive_json(), timeout=2.0)
                assert m1["type"] == "ADD_PIN" and m1["pin"] == pin2_code
                await ws1.send_json({"type": "ACK", "ack_id": m1["msg_id"]})
                await asyncio.sleep(0.05)

                # Door 2 connects later -> receives pin2_code via SYNC_PINS & its own outbox row
                async with aconnect_ws(f"/ws/esp32/{slug}", client) as ws2:
                    challenge = await ws2.receive_json()
                    nonce = challenge["nonce"]
                    epoch = int(time.time())
                    sig = hmac.new(sec2.encode("utf-8"), f"{slug}:{nonce}:{epoch}".encode("utf-8"), hashlib.sha256).hexdigest()
                    await ws2.send_json({
                        "type": "AUTH_HELLO",
                        "msg_id": str(uuid.uuid4()),
                        "space_id": slug,
                        "device_id": d2_id,
                        "timestamp": epoch,
                        "firmware_version": "1.2.0",
                        "signature": sig,
                    })
                    ack = await ws2.receive_json()
                    assert ack["type"] == "AUTH_ACK"
                    assert any(p["pin"] == pin2_code for p in ack.get("pins", []))

                    saw_outbox_add = False
                    for _ in range(10):
                        try:
                            pushed = await asyncio.wait_for(ws2.receive_json(), timeout=1.0)
                        except asyncio.TimeoutError:
                            break
                        if "msg_id" in pushed:
                            await ws2.send_json({"type": "ACK", "ack_id": pushed["msg_id"]})
                        if pushed.get("type") == "ADD_PIN" and pushed.get("pin") == pin2_code:
                            saw_outbox_add = True
                            break
                    assert saw_outbox_add, "Expected Door 2 to receive its own ADD_PIN outbox entry upon reconnect"
        finally:
            await client.delete(f"/api/v1/spaces/{slug}", headers=root_headers)
