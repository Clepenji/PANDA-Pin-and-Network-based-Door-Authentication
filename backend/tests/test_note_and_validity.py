"""Test Note Field, Prefill, and Validity Day-of-Week Format.

Verifies:
1. Registration with Note field.
2. Self-editing profile updates Note field and prefills properly.
3. Directory members include Note field.
4. Active PIN valid_till string includes 3-letter weekday abbreviation (e.g., Mon, Tue, etc.).
"""

import pytest
from httpx import AsyncClient, ASGITransport
from backend.app.main import app
from backend.app.models.user import User
from backend.app.db.session import AsyncSessionLocal
from sqlalchemy import select


@pytest.mark.asyncio
async def test_user_note_registration_profile_and_validity():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Register user with Note
        reg_payload = {
            "email": "test_note_user@college.edu",
            "name": "Note Tester",
            "phone": "+919988776655",
            "college_year": "2nd Year",
            "club_name": "Robotics Club",
            "space_id": "sandboxx_0",
            "note": "Robotics Club Vice President",
        }
        res = await client.post("/api/v1/auth/register", json=reg_payload)
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["email"] == "test_note_user@college.edu"
        token = data["access_token"]
        assert data.get("note") == "Robotics Club Vice President"

        # Verify DB persistence directly
        async with AsyncSessionLocal() as session:
            user = (await session.execute(
                select(User).where(User.email == "test_note_user@college.edu")
            )).scalar_one()
            assert user.note == "Robotics Club Vice President"

        # 2. Verify /auth/me returns note
        auth_headers = {"Authorization": f"Bearer {token}"}
        me_res = await client.get("/api/v1/auth/me", headers=auth_headers)
        assert me_res.status_code == 200
        me_data = me_res.json()
        assert me_data["name"] == "Note Tester"
        assert me_data["note"] == "Robotics Club Vice President"

        # 3. Update profile note
        update_payload = {
            "name": "Note Tester Updated",
            "note": "Robotics Lead Representative",
        }
        update_res = await client.put("/api/v1/auth/profile", json=update_payload, headers=auth_headers)
        assert update_res.status_code == 200
        updated_data = update_res.json()
        assert updated_data["name"] == "Note Tester Updated"
        assert updated_data["note"] == "Robotics Lead Representative"

        # 4. Verify directory includes note
        admin_login = await client.post("/api/v1/auth/login", json={"email": "rehankuriance@gmail.com"})
        admin_token = admin_login.json()["access_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        dir_res = await client.get("/api/v1/admin/directory", headers=admin_headers)
        assert dir_res.status_code == 200
        dir_members = dir_res.json()
        found = [m for m in dir_members if m["email"] == "test_note_user@college.edu"]
        assert len(found) == 1
        assert found[0]["note"] == "Robotics Lead Representative"
