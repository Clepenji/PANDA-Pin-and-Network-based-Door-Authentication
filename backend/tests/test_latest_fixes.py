import asyncio
from datetime import datetime, timezone
import httpx
import uuid
from backend.app.db.session import AsyncSessionLocal
from backend.app.models.superuser import SuperUser
from backend.app.models.user import User
from backend.app.models.access_request import AccessRequest, RequestStatus
from backend.app.models.assignment import UserSpaceAssignment
from backend.app.services.lifecycle_service import execute_annual_september_purge, get_account_tag
from sqlalchemy import select, delete
from backend.app.main import app

async def test_suite():
    from backend.app.models.space import Space
    from backend.app.models.esp32_device import ESP32Device
    from backend.app.config.spaces import register_dynamic_space
    import hashlib
    async with AsyncSessionLocal() as session:
        for slug, name in [("sandboxx_0", "SandBoxx 0"), ("sandboxx_1", "SandBoxx 1")]:
            if not (await session.execute(select(Space).where(Space.slug == slug))).scalar_one_or_none():
                session.add(Space(slug=slug, name=name, esp32_device_id=f"ESP32_{slug.upper()}_DOOR", is_active=True))
            if not (await session.execute(select(ESP32Device).where(ESP32Device.space_id == slug))).scalar_one_or_none():
                sec = hashlib.sha256(f"panda_esp32_secret_{slug}_2026".encode()).hexdigest()[:32]
                session.add(ESP32Device(device_id=f"ESP32_{slug.upper()}_DOOR", name="Main Door", space_id=slug, device_secret=sec))
            register_dynamic_space(slug, name, f"ESP32_{slug.upper()}_DOOR", True)
        if not (await session.execute(select(SuperUser).where(SuperUser.email == "lead.robotics@college.edu"))).scalar_one_or_none():
            session.add(SuperUser(email="lead.robotics@college.edu", name="Arjun Sharma", phone="+919876543210", allowed_spaces=["sandboxx_0"], is_active=True))
        await session.commit()

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        print("=== Test 1: Old SuperUser renewal between July 15 - Sept 1 ===")
        # 1. Simulate an old superuser created on June 1st of current year
        now_year = datetime.now(timezone.utc).year
        old_created = datetime(now_year, 6, 1, 10, 0, 0, tzinfo=timezone.utc)
        test_su_email = f"test.old.su.{uuid.uuid4().hex[:6]}@college.edu"

        async with AsyncSessionLocal() as session:
            test_su = SuperUser(
                email=test_su_email,
                name="Test Old SuperUser",
                phone="+919876543210",
                college_year="4th Year",
                allowed_spaces=["sandboxx_0"],
                created_at=old_created,
                updated_at=None,
            )
            session.add(test_su)
            await session.commit()
            await session.refresh(test_su)
            su_id = test_su.id

        # Before edit: in August, their tag would be "Old"
        august_ref = datetime(now_year, 8, 1, 12, 0, 0, tzinfo=timezone.utc)
        tag_before = get_account_tag(old_created, reference_date=august_ref, updated_at=None)
        assert tag_before == "Old", f"Expected 'Old', got {tag_before}"
        print(f"Verified: SuperUser created on June 1 has tag '{tag_before}' in August before edit.")

        # Admin logs in and edits this old superuser on August 10th
        admin_login = await client.post("/api/v1/auth/login", json={"email": "rehankuriance@gmail.com"})
        admin_token = admin_login.json()["access_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # Edit superuser
        edit_payload = {
            "name": "Test Renewed SuperUser",
            "phone": "+919876543211",
            "college_year": "Postgraduate",
            "allowed_spaces": ["sandboxx_0", "sandboxx_1"]
        }
        edit_resp = await client.put(f"/api/v1/admin/superusers/{su_id}", json=edit_payload, headers=admin_headers)
        assert edit_resp.status_code == 200, f"Edit failed: {edit_resp.text}"

        # Verify updated_at is now set on database record
        async with AsyncSessionLocal() as session:
            refreshed = (await session.execute(select(SuperUser).where(SuperUser.id == su_id))).scalar_one()
            assert refreshed.updated_at is not None, "updated_at was not set!"
            print(f"Verified: updated_at is set to {refreshed.updated_at}")

            # Verify account tag is now "New" (renewed) during August
            tag_after = get_account_tag(refreshed.created_at, reference_date=august_ref, updated_at=refreshed.updated_at)
            assert tag_after == "New", f"Expected 'New', got {tag_after}"
            print(f"Verified: SuperUser tag is now '{tag_after}' (renewed) for the upcoming cycle.")

            # Test September 1st reset: SuperUser should NOT be deleted!
            # Create a second un-edited old superuser who SHOULD be deleted
            unrenewed_email = f"test.unrenewed.{uuid.uuid4().hex[:6]}@college.edu"
            unrenewed_su = SuperUser(
                email=unrenewed_email,
                name="Unrenewed SU",
                phone="+919876543212",
                allowed_spaces=["sandboxx_0"],
                created_at=old_created,
                updated_at=None,
            )
            session.add(unrenewed_su)
            await session.commit()

            # Execute September reset for current year cycle
            reset_date = datetime(now_year, 9, 1, 0, 0, 0, tzinfo=timezone.utc)
            stats = await execute_annual_september_purge(session, reference_date=reset_date)
            print(f"Reset executed: {stats}")

            # Verify unrenewed SU was deleted, but renewed SU was preserved!
            renewed_check = (await session.execute(select(SuperUser).where(SuperUser.email == test_su_email))).scalar_one_or_none()
            unrenewed_check = (await session.execute(select(SuperUser).where(SuperUser.email == unrenewed_email))).scalar_one_or_none()

            assert renewed_check is not None, "ERROR: Renewed SuperUser was deleted!"
            assert unrenewed_check is None, "ERROR: Unrenewed SuperUser was not deleted!"
            print("Verified: Edited/renewed SuperUser was preserved during September 1st reset!")

            # Cleanup
            await session.delete(renewed_check)
            await session.commit()

        print("\n=== Test 2: Deleting Access Request made by mistake ===")
        # Student creates access request
        student_email = f"student.{uuid.uuid4().hex[:6]}@example.com"
        reg_payload = {
            "email": student_email,
            "name": "Target Test Student",
            "phone": "+919988776655",
            "college_year": "2nd Year",
            "space_id": "sandboxx_0",
        }
        reg_resp = await client.post("/api/v1/auth/register", json=reg_payload)
        assert reg_resp.status_code == 200, f"Register failed: {reg_resp.text}"
        student_token = reg_resp.json()["access_token"]
        student_headers = {"Authorization": f"Bearer {student_token}"}

        # Approve registration space assignment so user can file requests
        async with AsyncSessionLocal() as session:
            res = await session.execute(
                select(UserSpaceAssignment).where(UserSpaceAssignment.space_id == "sandboxx_0")
            )
            for a in res.scalars():
                a.status = "APPROVED"
            await session.commit()

        req_payload = {
            "space_slug": "sandboxx_0",
            "justification": "Accidental request made by mistake"
        }
        create_resp = await client.post("/api/v1/requests", json=req_payload, headers=student_headers)
        assert create_resp.status_code == 200, f"Request creation failed: {create_resp.text}"
        req_id = create_resp.json()["id"]
        print(f"Created request {req_id} by student.")

        # Student deletes their own request
        del_resp = await client.delete(f"/api/v1/requests/{req_id}", headers=student_headers)
        assert del_resp.status_code == 200, f"Delete failed: {del_resp.text}"
        assert del_resp.json()["status"] == "success"
        print("Verified: Student successfully deleted their accidental access request.")

        # Verify request is gone
        async with AsyncSessionLocal() as session:
            check_req = (await session.execute(select(AccessRequest).where(AccessRequest.id == uuid.UUID(req_id)))).scalar_one_or_none()
            assert check_req is None, "Request still exists in DB!"
            print("Verified: Request record no longer exists in database.")

        # SuperUser deletes an accidental request submitted to them
        create_resp2 = await client.post("/api/v1/requests", json={"space_slug": "sandboxx_0", "justification": "Mistake 2"}, headers=student_headers)
        req_id2 = create_resp2.json()["id"]

        su_login = await client.post("/api/v1/auth/login", json={"email": "lead.robotics@college.edu"})
        su_token = su_login.json()["access_token"]
        su_headers = {"Authorization": f"Bearer {su_token}"}

        del_resp2 = await client.delete(f"/api/v1/requests/{req_id2}", headers=su_headers)
        assert del_resp2.status_code == 200, f"SuperUser delete failed: {del_resp2.text}"
        print("Verified: SuperUser successfully deleted accidental request from queue.")

        print("\n=== Test 3: Updating User Profile Details (Settings Drawer) ===")
        # Student updates profile
        update_profile_payload = {
            "name": "Target Updated",
            "phone": "+919988776655",
            "college_year": "3rd Year",
            "club_name": "Robotics Club"
        }
        prof_resp = await client.put("/api/v1/auth/profile", json=update_profile_payload, headers=student_headers)
        assert prof_resp.status_code == 200, f"Profile update failed: {prof_resp.text}"
        prof_data = prof_resp.json()
        assert prof_data["name"] == "Target Updated"
        assert prof_data["college_year"] == "3rd Year"
        assert prof_data["club_name"] == "Robotics Club"
        print(f"Verified: Profile update for Student: {prof_data['name']}, {prof_data['college_year']}, {prof_data['club_name']}")

        # SuperUser updates profile
        su_update_payload = {
            "name": "Arjun Lead",
            "phone": "+919876543210",
            "college_year": "4th Year",
            "club_name": "Robotics Club"
        }
        su_prof_resp = await client.put("/api/v1/auth/profile", json=su_update_payload, headers=su_headers)
        assert su_prof_resp.status_code == 200, f"SU Profile update failed: {su_prof_resp.text}"
        su_prof_data = su_prof_resp.json()
        assert su_prof_data["name"] == "Arjun Lead"
        print(f"Verified: Profile update for SuperUser: {su_prof_data['name']}, {su_prof_data['college_year']}")

        print("\nALL 3 TESTS PASSED PERFECTLY!")

if __name__ == "__main__":
    asyncio.run(test_suite())
