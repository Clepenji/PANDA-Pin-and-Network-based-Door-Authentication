import asyncio
import httpx
from sqlalchemy import select
from backend.app.main import app
from backend.app.db.session import AsyncSessionLocal
from backend.app.models.assignment import UserSpaceAssignment

async def get_token(client: httpx.AsyncClient, email: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"email": email})
    assert resp.status_code == 200, f"Login failed for {email}: {resp.status_code} {resp.text}"
    return resp.json()["access_token"]

async def test_fixes():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        # 1. Admin login
        admin_token = await get_token(client, "rehankuriance@gmail.com")
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 1. Test SuperUser Update / Authority modification
        print("=== 1. Testing SuperUser Update & Authority Modification ===")
        resp = await client.get("/api/v1/admin/superusers", headers=admin_headers)
        assert resp.status_code == 200, f"Failed to get superusers: {resp.text}"
        superusers = resp.json()
        print(f"Found {len(superusers)} superusers.")
        
        target_su = None
        for su in superusers:
            if su.get("is_active"):
                target_su = su
                break
        
        if target_su:
            su_id = target_su["id"]
            orig_spaces = target_su.get("allowed_spaces", [])
            new_spaces = ["sandboxx_0", "sandboxx_1"]
            print(f"Updating superuser {su_id} ({target_su['name']}) with spaces {new_spaces}...")
            
            update_payload = {
                "name": target_su["name"] + " Updated",
                "phone": "+919876543210",
                "college_year": "4th Year",
                "club_id": target_su.get("club_id"),
                "allowed_spaces": new_spaces
            }
            update_resp = await client.put(f"/api/v1/admin/superusers/{su_id}", json=update_payload, headers=admin_headers)
            assert update_resp.status_code == 200, f"Update failed: {update_resp.text}"
            updated_data = update_resp.json()
            assert "sandboxx_0" in updated_data["allowed_spaces"] and "sandboxx_1" in updated_data["allowed_spaces"]
            print("SuperUser update and authority assignment SUCCESS:", updated_data["name"], updated_data["allowed_spaces"])
            
            # Restore
            restore_payload = {
                "name": target_su["name"],
                "phone": target_su.get("phone", "+919876543210"),
                "college_year": target_su.get("college_year", "Not Applicable"),
                "club_id": target_su.get("club_id"),
                "allowed_spaces": orig_spaces
            }
            await client.put(f"/api/v1/admin/superusers/{su_id}", json=restore_payload, headers=admin_headers)

        # 2. Test Targeted Access Request Routing
        print("\n=== 2. Testing Targeted Access Request Routing ===")
        active_sus = [s for s in superusers if s.get("is_active")]
        if len(active_sus) >= 2:
            su1 = active_sus[0]
            su2 = active_sus[1]
            print(f"Su1: {su1['name']} ({su1['email']}, id={su1['id']})")
            print(f"Su2: {su2['name']} ({su2['email']}, id={su2['id']})")
            
            student_email = "test.target.student@example.com"
            # Check if student exists
            login_resp = await client.post("/api/v1/auth/login", json={"email": student_email})
            if login_resp.status_code != 200:
                # Register student
                reg_payload = {
                    "email": student_email,
                    "name": "Target Test Student",
                    "phone": "+919988776655",
                    "college_year": "2nd Year",
                    "space_id": "sandboxx_0",
                    "superuser_id": su1["id"]
                }
                reg_resp = await client.post("/api/v1/auth/register", json=reg_payload)
                assert reg_resp.status_code == 200, f"Registration failed: {reg_resp.text}"
                student_token = reg_resp.json()["access_token"]
            else:
                student_token = login_resp.json()["access_token"]
            
            student_headers = {"Authorization": f"Bearer {student_token}"}

            # Approve registration space assignment so user can file targeted access requests
            async with AsyncSessionLocal() as session:
                res = await session.execute(
                    select(UserSpaceAssignment).where(UserSpaceAssignment.space_id == "sandboxx_0")
                )
                for a in res.scalars():
                    a.status = "APPROVED"
                await session.commit()
            
            # Submit access request explicitly targeting su1
            req_payload = {
                "space_slug": "sandboxx_0",
                "justification": "Targeted test request for su1 only",
                "target_superuser_id": su1["id"]
            }
            req_resp = await client.post("/api/v1/requests", json=req_payload, headers=student_headers)
            assert req_resp.status_code == 200, f"Request creation failed: {req_resp.text}"
            created_req = req_resp.json()
            req_id = created_req["id"]
            print(f"Created request {req_id} targeting su1 ({su1['id']})")
            
            # Fetch requests as su1
            su1_token = await get_token(client, su1["email"])
            su1_resp = await client.get("/api/v1/requests?status_filter=PENDING", headers={"Authorization": f"Bearer {su1_token}"})
            assert su1_resp.status_code == 200
            su1_req_ids = [r["id"] for r in su1_resp.json()]
            assert req_id in su1_req_ids, f"Request {req_id} not visible to targeted su1!"
            print(f"Verified: Request is visible to targeted superuser su1 ({su1['name']})")
            
            # Fetch requests as su2
            su2_token = await get_token(client, su2["email"])
            su2_resp = await client.get("/api/v1/requests?status_filter=PENDING", headers={"Authorization": f"Bearer {su2_token}"})
            assert su2_resp.status_code == 200
            su2_req_ids = [r["id"] for r in su2_resp.json()]
            assert req_id not in su2_req_ids, f"Request {req_id} should NOT be visible to su2!"
            print(f"Verified: Request is NOT visible to non-targeted superuser su2 ({su2['name']})")

        # 3. Test Space Logs Multi-Field Filters & Club/Space Enrichment
        print("\n=== 3. Testing Space Logs Filters & Data Population ===")
        logs_resp = await client.get("/api/v1/logs/portal", headers=admin_headers)
        assert logs_resp.status_code == 200
        logs = logs_resp.json()
        print(f"Fetched {len(logs)} portal logs.")
        if logs:
            first_log = logs[0]
            print("First log sample fields:", {
                "timestamp": first_log.get("timestamp"),
                "event_type": first_log.get("event_type"),
                "space_id": first_log.get("space_id"),
                "space_name": first_log.get("space_name"),
                "club_name": first_log.get("club_name")
            })
            assert "space_name" in first_log
            assert "club_name" in first_log
            print("Verified: Log response contains both space_name and club_name.")

        print("\nALL VERIFICATIONS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(test_fixes())
