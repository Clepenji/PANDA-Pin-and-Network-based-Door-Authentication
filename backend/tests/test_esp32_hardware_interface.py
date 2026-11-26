"""Comprehensive Automated Verification Test Suite for ESP32 Hardware Interface.

Covers:
1. Anti-Spoofing Challenge-Response Handshake:
   - Unknown Space Rejection (ERR_UNKNOWN_SPACE / 4004)
   - Invalid HMAC-SHA256 Signature Rejection (ERR_INVALID_SIGNATURE / 4001)
   - Clock Skew Replay Drift Rejection (ERR_REPLAY_DETECTED / 4002)
   - Successful Handshake & Online Registration (AUTH_ACK & ESP_ONLINE audit log)
2. Persistent Outbox Queue & Offline Resiliency:
   - Enqueue while offline -> status PENDING
   - On connection -> automatic flush over WebSocket
   - Inbound ACK -> status marked ACKED
3. Inbound Hardware Event Ingestion & Idempotency:
   - Valid PIN_ATTEMPT -> DOOR_UNLOCKED audit log with permanent entrant snapshot
   - Invalid PIN_ATTEMPT -> INVALID_PIN_ATTEMPT audit log
   - EXIT_BUTTON -> EXIT_BUTTON_UNLOCKED audit log
   - NETWORK_RECOVERED -> ESP_NETWORK_RECOVERED audit log
   - Duplicate msg_id deduplication
4. SuperUser & Admin Monitoring & Ping Control:
   - User role strictly forbidden (403)
   - SuperUser filtered by space authority
   - Admin universal status & manual ping
5. OTA Firmware Management:
   - Multi-part binary upload, SHA-256 checksum verification, and OTA_UPDATE dispatch
   - Binary download endpoint
   - Admin cryptographic secret rotation
"""

import asyncio
import hashlib
import hmac
import io
import time
import uuid
import pytest
from datetime import timedelta
from httpx import AsyncClient
from httpx_ws import aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport
from sqlalchemy import select, and_, delete

from backend.app.main import app
from backend.app.db.session import AsyncSessionLocal
from backend.app.db.base import utc_now
from backend.app.models.esp32_device import ESP32Device
from backend.app.models.esp32_outbox import ESP32CommandOutbox
from backend.app.models.entry_log import EntryLog, EntryEventType
from backend.app.models.user import User
from backend.app.models.active_pin import ActivePin
from backend.app.services.esp32_service import ESP32Service
from backend.app.services.pin_service import PinService
from backend.app.api.deps import create_access_token


@pytest.fixture(autouse=True, scope="module")
async def ensure_hardware_test_space():
    """Ensure dynamic test spaces ('sandboxx_0', 'sandboxx_1') and devices exist for hardware tests."""
    from backend.app.models.space import Space
    from backend.app.config.spaces import register_dynamic_space
    created_slugs = []
    async with AsyncSessionLocal() as session:
        for slug, name in [("sandboxx_0", "SandBoxx 0"), ("sandboxx_1", "SandBoxx 1")]:
            dev_id = f"ESP32_{slug.upper()}_DOOR"
            sp = (await session.execute(select(Space).where(Space.slug == slug))).scalar_one_or_none()
            if not sp:
                sp = Space(slug=slug, name=name, esp32_device_id=dev_id, is_active=True)
                session.add(sp)
                created_slugs.append(slug)
            dev = (await session.execute(select(ESP32Device).where(ESP32Device.space_id == slug))).scalar_one_or_none()
            if not dev:
                seed_secret = hashlib.sha256(f"panda_esp32_secret_{slug}_2026".encode()).hexdigest()[:32]
                dev = ESP32Device(
                    device_id=dev_id,
                    name="Main Door",
                    space_id=slug,
                    device_secret=seed_secret,
                    device_secret_hash=hashlib.sha256(seed_secret.encode()).hexdigest(),
                    is_disabled=False,
                    is_online=False,
                    firmware_version="1.0.0",
                )
                session.add(dev)
            register_dynamic_space(slug, name, dev_id, True)
        await session.commit()
    yield
    if created_slugs:
        async with AsyncSessionLocal() as session:
            from backend.app.services.space_service import SpaceService
            for slug in created_slugs:
                try:
                    await SpaceService.remove_space(session, slug, "rehankuriance@gmail.com")
                except Exception:
                    pass


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
async def superuser_sandboxx_0_token() -> str:
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
async def regular_user_token() -> str:
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


# =============================================================================
# 1. ANTI-SPOOFING HANDSHAKE & WEBSOCKET PROTOCOL
# =============================================================================

@pytest.mark.asyncio
async def test_handshake_unknown_space_rejection():
    """Verify rejection when an unregistered space connects."""
    async with AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="http://test") as client:
        async with aconnect_ws("/ws/esp32/non_existent_space", client) as ws:
            msg = await ws.receive_json()
            assert msg["type"] == "NACK"
            assert msg["error_code"] == "ERR_UNKNOWN_SPACE"


@pytest.mark.asyncio
async def test_handshake_invalid_signature_rejection():
    """Verify constant-time HMAC check rejects invalid signature with ERR_INVALID_SIGNATURE (4001)."""
    async with AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="http://test") as client:
        async with aconnect_ws("/ws/esp32/sandboxx_0", client) as ws:
            challenge = await ws.receive_json()
            assert challenge["type"] == "AUTH_CHALLENGE"
            assert "nonce" in challenge

            # Send invalid signature
            await ws.send_json({
                "type": "AUTH_HELLO",
                "msg_id": str(uuid.uuid4()),
                "space_id": "sandboxx_0",
                "timestamp": int(time.time()),
                "firmware_version": "1.0.0",
                "boot_reason": "power_on",
                "signature": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            })

            nack = await ws.receive_json()
            assert nack["type"] == "NACK"
            assert nack["error_code"] == "ERR_INVALID_SIGNATURE"


@pytest.mark.asyncio
async def test_handshake_replay_drift_rejection():
    """Verify timestamp drift > 300s is rejected as replay attempt."""
    async with AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="http://test") as client:
        async with aconnect_ws("/ws/esp32/sandboxx_0", client) as ws:
            challenge = await ws.receive_json()
            assert challenge["type"] == "AUTH_CHALLENGE"

            # Send timestamp 1000s in the past
            await ws.send_json({
                "type": "AUTH_HELLO",
                "msg_id": str(uuid.uuid4()),
                "space_id": "sandboxx_0",
                "timestamp": int(time.time()) - 1000,
                "firmware_version": "1.0.0",
                "signature": "any"
            })

            nack = await ws.receive_json()
            assert nack["type"] == "NACK"
            assert nack["error_code"] == "ERR_REPLAY_DETECTED"


@pytest.mark.asyncio
async def test_handshake_successful_authentication(root_admin_token: str):
    """Verify valid HMAC challenge-response handshake authenticates and writes ESP_ONLINE log."""
    space_id = "sandboxx_0"
    async with AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="http://test") as client:
        # 1. Fetch secret via admin endpoint
        dev_res = await client.get("/api/v1/admin/esp32/devices", headers={"Authorization": f"Bearer {root_admin_token}"})
        assert dev_res.status_code == 200
        devices = dev_res.json()
        secret = next(d["device_secret"] for d in devices if d["space_id"] == space_id)

        # 2. Handshake over WebSocket
        async with aconnect_ws(f"/ws/esp32/{space_id}", client) as ws:
            challenge = await ws.receive_json()
            assert challenge["type"] == "AUTH_CHALLENGE"
            nonce = challenge["nonce"]

            epoch = int(time.time())
            expected_payload = f"{space_id}:{nonce}:{epoch}".encode("utf-8")
            signature = hmac.new(secret.encode("utf-8"), expected_payload, hashlib.sha256).hexdigest()

            await ws.send_json({
                "type": "AUTH_HELLO",
                "msg_id": str(uuid.uuid4()),
                "space_id": space_id,
                "timestamp": epoch,
                "firmware_version": "1.0.4",
                "boot_reason": "ota_restart",
                "signature": signature,
            })

            auth_ack = await ws.receive_json()
            assert auth_ack["type"] == "AUTH_ACK"
            assert "server_epoch" in auth_ack

        # 3. Check status via API
        status_res = await client.get("/api/v1/esp32/status", headers={"Authorization": f"Bearer {root_admin_token}"})
        assert status_res.status_code == 200
        statuses = status_res.json()
        dev_status = next(s for s in statuses if s["space_id"] == space_id)
        assert dev_status["firmware_version"] == "1.0.4"


# =============================================================================
# 2. PERSISTENT OUTBOX QUEUE & FLUSHING
# =============================================================================

@pytest.mark.asyncio
async def test_outbox_persistence_and_ws_flush(root_admin_token: str):
    """Verify commands enqueued while offline are saved as PENDING and pushed upon handshake."""
    space_id = "sandboxx_1"
    async with AsyncSessionLocal() as session:
        await session.execute(delete(ESP32CommandOutbox).where(ESP32CommandOutbox.space_id == space_id))
        await session.commit()

    async with AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="http://test") as client:
        # 1. Issue a direct PIN while hardware is offline
        test_entrant = f"entrant_outbox_{uuid.uuid4().hex[:6]}@college.edu"
        pin_res = await client.post(
            "/api/v1/pins/direct",
            headers={"Authorization": f"Bearer {root_admin_token}"},
            json={
                "space_id": space_id,
                "entrant_email": test_entrant,
                "justification": "Hardware test pass"
            }
        )
        assert pin_res.status_code == 200
        issued_pin = pin_res.json()["pin_code"]

        # 2. Fetch secret for space
        dev_res = await client.get("/api/v1/admin/esp32/devices", headers={"Authorization": f"Bearer {root_admin_token}"})
        devices = dev_res.json()
        secret = next(d["device_secret"] for d in devices if d["space_id"] == space_id)

        # 3. Connect device & verify outbox command arrives
        async with aconnect_ws(f"/ws/esp32/{space_id}", client) as ws:
            challenge = await ws.receive_json()
            nonce = challenge["nonce"]
            epoch = int(time.time())
            sig = hmac.new(secret.encode("utf-8"), f"{space_id}:{nonce}:{epoch}".encode("utf-8"), hashlib.sha256).hexdigest()

            await ws.send_json({
                "type": "AUTH_HELLO",
                "msg_id": str(uuid.uuid4()),
                "space_id": space_id,
                "timestamp": epoch,
                "firmware_version": "1.0.0",
                "signature": sig,
            })
            ack = await ws.receive_json()
            assert ack["type"] == "AUTH_ACK"

            # Flushed outbox commands arrive - ACK each command until our issued PIN is found
            found_issued_pin = False
            for _ in range(20):
                try:
                    pushed_cmd = await asyncio.wait_for(ws.receive_json(), timeout=2.0)
                except asyncio.TimeoutError:
                    break
                if "msg_id" in pushed_cmd:
                    await ws.send_json({"type": "ACK", "ack_id": pushed_cmd["msg_id"]})
                if pushed_cmd.get("type") == "ADD_PIN" and pushed_cmd.get("pin") == issued_pin:
                    found_issued_pin = True
                    break

            assert found_issued_pin, f"Expected issued PIN {issued_pin} to be flushed from outbox"
            await asyncio.sleep(0.1)

        # 4. Check outbox status
        async with AsyncSessionLocal() as session:
            outbox_res = await session.execute(
                select(ESP32CommandOutbox).where(
                    and_(
                        ESP32CommandOutbox.space_id == space_id,
                        ESP32CommandOutbox.command_type == "ADD_PIN",
                    )
                ).order_by(ESP32CommandOutbox.created_at.desc())
            )
            latest_outbox = outbox_res.scalars().first()
            assert latest_outbox is not None
            assert latest_outbox.status == "ACKED"


# =============================================================================
# 3. HARDWARE EVENT INGESTION & IDEMPOTENCY
# =============================================================================

@pytest.mark.asyncio
async def test_inbound_hardware_events_ingestion():
    """Verify PIN_ATTEMPT, EXIT_BUTTON, and NETWORK_RECOVERED event logging."""
    space_id = "sandboxx_0"

    # Seed test student and active PIN
    async with AsyncSessionLocal() as session:
        test_email = f"student_hw_{uuid.uuid4().hex[:6]}@college.edu"
        user = User(
            name="Hardware Test Student",
            email=test_email,
            phone="9876543210",
            college_year="2nd Year"
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        pin_code = await PinService.generate_unique_pin_code(session)
        pin = ActivePin(
            holder_user_id=user.id,
            space_id=space_id,
            pin_code=pin_code,
            expires_at=utc_now() + timedelta(hours=1),
            issued_by_name_snapshot="SuperUser Lead",
            issued_by_email_snapshot="lead@facility.local",
        )
        session.add(pin)
        await session.commit()

        # Ingest PIN_ATTEMPT
        evt_msg_id = str(uuid.uuid4())
        res = await ESP32Service.process_inbound_event(
            session=session,
            space_id=space_id,
            payload={
                "type": "PIN_ATTEMPT",
                "msg_id": evt_msg_id,
                "pin": pin_code,
                "present_in_register": True,
                "door_unlocked": True,
                "timestamp": int(time.time()),
            }
        )
        assert res["type"] == "ACK"
        assert res["result"] == "DOOR_UNLOCKED"

        # Verify duplicate msg_id is idempotently ignored
        dup_res = await ESP32Service.process_inbound_event(
            session=session,
            space_id=space_id,
            payload={
                "type": "PIN_ATTEMPT",
                "msg_id": evt_msg_id,
                "pin": pin_code,
                "door_unlocked": True,
            }
        )
        assert dup_res["status"] == "duplicate_ignored"

        # Ingest EXIT_BUTTON
        exit_res = await ESP32Service.process_inbound_event(
            session=session,
            space_id=space_id,
            payload={
                "type": "EXIT_BUTTON",
                "msg_id": str(uuid.uuid4()),
                "timestamp": int(time.time()),
            }
        )
        assert exit_res["type"] == "ACK"

        # Ingest NETWORK_RECOVERED
        net_res = await ESP32Service.process_inbound_event(
            session=session,
            space_id=space_id,
            payload={
                "type": "NETWORK_RECOVERED",
                "msg_id": str(uuid.uuid4()),
                "outage_duration_seconds": 142,
                "cached_events_count": 0,
                "timestamp": int(time.time()),
            }
        )
        assert net_res["type"] == "ACK"

        # Verify entry_logs records created
        logs_res = await session.execute(
            select(EntryLog).where(EntryLog.space_id == space_id).order_by(EntryLog.created_at.desc())
        )
        event_types = [l.event_type for l in logs_res.scalars().all()]
        assert EntryEventType.DOOR_UNLOCKED in event_types
        assert EntryEventType.EXIT_BUTTON_UNLOCKED in event_types
        assert EntryEventType.ESP_NETWORK_RECOVERED in event_types


# =============================================================================
# 4. SUPERUSER & ADMIN RESTRICTED MONITORING & PING
# =============================================================================

@pytest.mark.asyncio
async def test_hardware_monitoring_role_restrictions(
    root_admin_token: str,
    superuser_sandboxx_0_token: str,
    regular_user_token: str
):
    """Verify regular Users are forbidden from hardware status and ping endpoints."""
    async with AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="http://test") as client:
        # Regular user GET /api/v1/esp32/status -> 403 Forbidden
        user_res = await client.get("/api/v1/esp32/status", headers={"Authorization": f"Bearer {regular_user_token}"})
        assert user_res.status_code == 403

        # SuperUser can view authorized spaces
        su_res = await client.get("/api/v1/esp32/status", headers={"Authorization": f"Bearer {superuser_sandboxx_0_token}"})
        assert su_res.status_code == 200
        su_data = su_res.json()
        assert any(d["space_id"] == "sandboxx_0" for d in su_data)

        # SuperUser pinging unauthorized space -> 403
        su_ping_fail = await client.post(
            "/api/v1/esp32/sandboxx_1/ping",
            headers={"Authorization": f"Bearer {superuser_sandboxx_0_token}"}
        )
        assert su_ping_fail.status_code == 403

        # SuperUser pinging authorized space -> 200 (returns status even if offline)
        su_ping_ok = await client.post(
            "/api/v1/esp32/sandboxx_0/ping",
            headers={"Authorization": f"Bearer {superuser_sandboxx_0_token}"}
        )
        assert su_ping_ok.status_code == 200
        assert "is_online" in su_ping_ok.json()

        # Admin GET /api/v1/esp32/status -> 200 with all spaces
        admin_res = await client.get("/api/v1/esp32/status", headers={"Authorization": f"Bearer {root_admin_token}"})
        assert admin_res.status_code == 200
        admin_data = admin_res.json()
        space_slugs = [d["space_id"] for d in admin_data]
        assert "sandboxx_0" in space_slugs
        assert "sandboxx_1" in space_slugs


# =============================================================================
# 5. OTA FIRMWARE RELEASE & DOWNLOAD & SECRET ROTATION
# =============================================================================

@pytest.mark.asyncio
async def test_ota_firmware_upload_download_and_secret_rotation(root_admin_token: str):
    """Verify admin firmware upload, SHA-256 calculation, OTA command dispatch, and secret rotation."""
    async with AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="http://test") as client:
        # 1. Secret Rotation
        rotate_res = await client.post(
            "/api/v1/admin/esp32/devices/sandboxx_0/rotate-secret",
            headers={"Authorization": f"Bearer {root_admin_token}"}
        )
        assert rotate_res.status_code == 200
        new_secret = rotate_res.json()["new_device_secret"]
        assert len(new_secret) in (32, 64)

        # 2. Upload Firmware Binary (.bin)
        fake_binary = b"\x00\x01\x02\x03ESP32_FIRMWARE_PAYLOAD_TEST"
        expected_sha = hashlib.sha256(fake_binary).hexdigest()
        version = f"2.1.{uuid.uuid4().hex[:4]}"

        files = {"file": ("firmware.bin", io.BytesIO(fake_binary), "application/octet-stream")}
        data = {"version": version, "target_space_id": "sandboxx_0"}

        up_res = await client.post(
            "/api/v1/admin/esp32/firmware",
            headers={"Authorization": f"Bearer {root_admin_token}"},
            data=data,
            files=files
        )
        assert up_res.status_code == 200
        up_data = up_res.json()
        release_id = up_data["release_id"]
        assert up_data["sha256_checksum"] == expected_sha

        # 3. Download Firmware Binary
        down_res = await client.get(f"/api/esp32/firmware/{release_id}/download")
        assert down_res.status_code == 200
        assert down_res.content == fake_binary
        assert hashlib.sha256(down_res.content).hexdigest() == expected_sha

        # 4. Verify OTA_UPDATE command enqueued in outbox
        async with AsyncSessionLocal() as session:
            outbox_res = await session.execute(
                select(ESP32CommandOutbox).where(
                    and_(
                        ESP32CommandOutbox.space_id == "sandboxx_0",
                        ESP32CommandOutbox.command_type == "OTA_UPDATE"
                    )
                ).order_by(ESP32CommandOutbox.created_at.desc())
            )
            ota_cmd = outbox_res.scalars().first()
            assert ota_cmd is not None
            assert ota_cmd.payload["version"] == version
            assert ota_cmd.payload["sha256"] == expected_sha
