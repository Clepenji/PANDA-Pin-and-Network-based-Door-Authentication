"""Tests for Admin Portal, Metrics, Directory, Cluster Graph, and Logs."""

import pytest
import uuid
from httpx import AsyncClient, ASGITransport
from backend.app.main import app
from backend.app.api.deps import create_access_token


@pytest.fixture
def root_admin_token() -> str:
    return create_access_token({
        "sub": "rehankuriance@gmail.com",
        "email": "rehankuriance@gmail.com",
        "role": "admin",
        "name": "Rehan Kurian",
        "is_root": True,
        "authorized_spaces": ["all"]
    })


@pytest.fixture
async def superuser_token() -> str:
    from backend.app.db.session import AsyncSessionLocal
    from backend.app.models.superuser import SuperUser
    from sqlalchemy import select
    async with AsyncSessionLocal() as session:
        su = (await session.execute(select(SuperUser).where(SuperUser.email == "lead.robotics@college.edu"))).scalar_one_or_none()
        if not su:
            su = SuperUser(
                email="lead.robotics@college.edu",
                name="Arjun Sharma",
                phone="+919999999991",
                allowed_spaces=["sandboxx_0"],
                is_active=True,
            )
            session.add(su)
            await session.commit()
            await session.refresh(su)
        tv = getattr(su, "token_version", 1)
    return create_access_token({
        "sub": "lead.robotics@college.edu",
        "email": "lead.robotics@college.edu",
        "uid": str(su.id),
        "tv": tv,
        "role": "superuser",
        "name": "Arjun Sharma",
        "is_root": False,
        "authorized_spaces": ["sandboxx_0"]
    })


@pytest.fixture
async def user_token() -> str:
    from backend.app.db.session import AsyncSessionLocal
    from backend.app.models.user import User
    from sqlalchemy import select
    async with AsyncSessionLocal() as session:
        u = (await session.execute(select(User).where(User.email == "student@college.edu"))).scalar_one_or_none()
        if not u:
            u = User(
                email="student@college.edu",
                name="Student Entrant",
                phone="+919999999992",
            )
            session.add(u)
            await session.commit()
            await session.refresh(u)
        tv = getattr(u, "token_version", 1)
    return create_access_token({
        "sub": "student@college.edu",
        "email": "student@college.edu",
        "uid": str(u.id),
        "tv": tv,
        "role": "user",
        "name": "Student Entrant",
        "is_root": False,
        "authorized_spaces": []
    })


@pytest.mark.asyncio
async def test_admin_metrics(root_admin_token: str, user_token: str):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Non-admin forbidden
        res = await client.get("/api/v1/admin/metrics", headers={"Authorization": f"Bearer {user_token}"})
        assert res.status_code == 403

        # Ensure a dynamic space exists to verify weekly_entries_per_space keys
        await client.post(
            "/api/v1/spaces",
            json={"slug": "metrics_space_a", "name": "Metrics Space A", "is_active": True},
            headers={"Authorization": f"Bearer {root_admin_token}"},
        )
        try:
            # Admin allowed
            res = await client.get("/api/v1/admin/metrics", headers={"Authorization": f"Bearer {root_admin_token}"})
            assert res.status_code == 200
            data = res.json()
            assert "total_registered_users" in data
            assert "weekly_entries_per_space" in data
            assert "metrics_space_a" in data["weekly_entries_per_space"]
            assert "avg_access_requests_per_day" in data
            # Ensure Active Pins and Pending Requests summary cards are NOT in the payload
            assert "active_pins" not in data
            assert "pending_requests" not in data
        finally:
            await client.delete(
                "/api/v1/spaces/metrics_space_a",
                headers={"Authorization": f"Bearer {root_admin_token}"},
            )


@pytest.mark.asyncio
async def test_secondary_admin_lifecycle_and_root_protection(root_admin_token: str):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        admin_headers = {"Authorization": f"Bearer {root_admin_token}"}

        # 1. List secondary admins (root admin must be excluded)
        res = await client.get("/api/v1/admin/admins", headers=admin_headers)
        assert res.status_code == 200
        admins = res.json()
        for a in admins:
            assert a["email"] != "rehankuriance@gmail.com"
            assert a["is_root"] is False

        # 2. Add secondary admin
        unique_email = f"staff_{uuid.uuid4().hex[:6]}@college.edu"
        res = await client.post(
            "/api/v1/admin/admins",
            headers=admin_headers,
            json={"name": "Assistant Admin", "email": unique_email}
        )
        assert res.status_code == 200
        new_admin = res.json()
        assert new_admin["email"] == unique_email
        assert new_admin["is_root"] is False
        new_admin_id = new_admin["id"]

        # 3. Appears in secondary admin list
        res = await client.get("/api/v1/admin/admins", headers=admin_headers)
        admins = res.json()
        assert any(a["id"] == new_admin_id for a in admins)

        # 4. Attempting to add root admin again is rejected
        res = await client.post(
            "/api/v1/admin/admins",
            headers=admin_headers,
            json={"name": "Duplicate Root", "email": "rehankuriance@gmail.com"}
        )
        assert res.status_code == 400

        # 5. Delete secondary admin
        res = await client.delete(f"/api/v1/admin/admins/{new_admin_id}", headers=admin_headers)
        assert res.status_code == 200


@pytest.mark.asyncio
async def test_superuser_admin_management_and_revocation(root_admin_token: str):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        admin_headers = {"Authorization": f"Bearer {root_admin_token}"}

        # 1. Register new superuser
        su_email = f"lead_{uuid.uuid4().hex[:6]}@college.edu"
        res = await client.post(
            "/api/v1/admin/superusers",
            headers=admin_headers,
            json={
                "name": "Aero Lead",
                "email": su_email,
                "phone": "+919876543201",
                "club_name": "Aeromodelling Club",
                "allowed_spaces": ["sandboxx_0"]
            }
        )
        assert res.status_code == 200
        new_su = res.json()
        assert new_su["email"] == su_email
        assert new_su["is_active"] is True
        su_id = new_su["id"]

        # 2. Modify space authority
        res = await client.put(
            f"/api/v1/admin/superusers/{su_id}",
            headers=admin_headers,
            json={"allowed_spaces": ["sandboxx_0", "sandboxx_1"]}
        )
        assert res.status_code == 200
        updated = res.json()
        assert "sandboxx_1" in updated["allowed_spaces"]

        # 3. Revoke superuser (now deletes the superuser account directly)
        res = await client.post(f"/api/v1/admin/superusers/{su_id}/revoke", headers=admin_headers)
        assert res.status_code == 200
        assert "purged" in res.json()["message"].lower() or "deleted" in res.json()["message"].lower()

        # 4. Verify revoked superuser is omitted from active directory list
        res = await client.get("/api/v1/admin/superusers", headers=admin_headers)
        all_su = res.json()
        assert not any(s["id"] == su_id for s in all_su)


@pytest.mark.asyncio
async def test_directory_and_cluster_graph_exclude_admins(root_admin_token: str):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        admin_headers = {"Authorization": f"Bearer {root_admin_token}"}

        # Directory
        res = await client.get("/api/v1/admin/directory", headers=admin_headers)
        assert res.status_code == 200
        directory = res.json()
        for member in directory:
            assert member["role"] in ["user", "superuser"]
            assert member["email"] != "rehankuriance@gmail.com"

        # Cluster Graph
        res = await client.get("/api/v1/admin/cluster-graph", headers=admin_headers)
        assert res.status_code == 200
        graph = res.json()
        assert "nodes" in graph
        assert "links" in graph
        for node in graph["nodes"]:
            assert node["role"] in ["club", "superuser", "user"]
            assert node.get("email") != "rehankuriance@gmail.com"


@pytest.mark.asyncio
async def test_shared_logs_universal_visibility_and_csv_export(root_admin_token: str, superuser_token: str):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Both Admin and SuperUser can access portal logs
        for token in [root_admin_token, superuser_token]:
            res = await client.get("/api/v1/logs/portal", headers={"Authorization": f"Bearer {token}"})
            assert res.status_code == 200
            logs = res.json()
            for log in logs:
                # Privacy check: raw PIN must never be exposed
                assert "pin_used" not in log or log["pin_used"] is None
                assert log["event_type"] != "INVALID_PIN_ATTEMPT"

            # Both can download CSV
            csv_res = await client.get("/api/v1/logs/audit/csv", headers={"Authorization": f"Bearer {token}"})
            assert csv_res.status_code == 200
            assert "text/csv" in csv_res.headers.get("content-type", "")
            assert "ID,Event Type,Space ID" in csv_res.text


@pytest.mark.asyncio
async def test_reappoint_revoked_superuser_and_existing_user_sync(root_admin_token: str):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        admin_headers = {"Authorization": f"Bearer {root_admin_token}"}
        unique_id = uuid.uuid4().hex[:6]
        user_email = f"student_{unique_id}@college.edu"

        # 1. Register a student user
        reg_res = await client.post(
            "/api/v1/auth/register",
            json={
                "name": "Original Student",
                "email": user_email,
                "phone": "+919876543210",
                "college_year": "2nd Year",
                "club_name": "Robotics Club",
                "space_id": "sandboxx_0",
            }
        )
        assert reg_res.status_code == 200

        # 2. Lookup user to test autofill endpoint
        lookup_res = await client.get(
            f"/api/v1/admin/users/lookup?email={user_email}",
            headers=admin_headers
        )
        assert lookup_res.status_code == 200
        user_info = lookup_res.json()
        assert user_info["found"] is True
        assert user_info["name"] == "Original Student"
        assert user_info["phone"] == "+919876543210"

        # 3. Promote existing student to SuperUser with 10-digit phone
        create_res = await client.post(
            "/api/v1/admin/superusers",
            headers=admin_headers,
            json={
                "name": "Promoted Lead",
                "email": user_email,
                "phone": "9876543210",  # Test phone normalizer
                "college_year": "3rd Year",
                "club_name": "Robotics Club",
                "allowed_spaces": ["sandboxx_0", "sandboxx_1"]
            }
        )
        assert create_res.status_code == 200
        su_data = create_res.json()
        assert su_data["is_active"] is True
        assert su_data["phone"] == "+919876543210"
        su_id = su_data["id"]

        # 4. Attempting to create an active SuperUser with same email is rejected with 400
        dup_res = await client.post(
            "/api/v1/admin/superusers",
            headers=admin_headers,
            json={
                "name": "Duplicate Lead",
                "email": user_email,
                "phone": "9876543210",
                "allowed_spaces": ["sandboxx_0"]
            }
        )
        assert dup_res.status_code == 400
        assert "already exists" in dup_res.json()["detail"].lower()

        # 5. Revoke superuser
        revoke_res = await client.post(
            f"/api/v1/admin/superusers/{su_id}/revoke",
            headers=admin_headers
        )
        assert revoke_res.status_code == 200

        # Verify revoked superuser is not in active list
        list_res = await client.get("/api/v1/admin/superusers", headers=admin_headers)
        assert not any(s["id"] == su_id for s in list_res.json())

        # 6. Re-appoint the revoked superuser via POST /api/v1/admin/superusers
        reappoint_res = await client.post(
            "/api/v1/admin/superusers",
            headers=admin_headers,
            json={
                "name": "Reactivated Lead",
                "email": user_email,
                "phone": "+91 98765-43210",  # Test dashed/spaced phone normalizer
                "college_year": "4th Year",
                "club_name": "Robotics Club",
                "allowed_spaces": ["sandboxx_0"]
            }
        )
        assert reappoint_res.status_code == 200
        reappointed_data = reappoint_res.json()
        assert reappointed_data["id"] != su_id  # Old superuser was deleted; new record created
        assert reappointed_data["name"] == "Reactivated Lead"
        assert reappointed_data["phone"] == "+919876543210"
        assert reappointed_data["is_active"] is True
        assert reappointed_data["allowed_spaces"] == ["sandboxx_0"]

        # 7. Verify re-appointed superuser is back in active superusers list
        list_res2 = await client.get("/api/v1/admin/superusers", headers=admin_headers)
        assert any(s["id"] == reappointed_data["id"] for s in list_res2.json())

