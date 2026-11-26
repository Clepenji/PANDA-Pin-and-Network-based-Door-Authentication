"""SQL Injection Protection & Input Validation Security Tests."""

import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import OperationalError

from backend.app.api.deps import create_access_token
from backend.app.config.settings import settings
from backend.app.core.sql_shield import detect_sql_injection
from backend.app.main import app


def _root_headers() -> dict:
    token = create_access_token({
        "sub": settings.ROOT_ADMIN_EMAIL,
        "role": "admin",
        "is_root": True,
        "name": "Root Admin",
        "authorized_spaces": [],
    })
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize(
    "payload",
    [
        "' OR '1'='1",
        "\" OR 1=1 --",
        "sandboxx_0') OR ('a'='a",
        "1 OR 1=1",
        "test' UNION SELECT password FROM admins--",
        "test'; DROP TABLE users;--",
        "'; SELECT pg_sleep(5);--",
        "pg_sleep(10)",
        "1; TRUNCATE TABLE entry_logs;",
        "admin'/*",
        "1 ORDER BY 5--",
        "SELECT * FROM information_schema.tables",
        "pg_catalog.pg_tables",
        "WAITFOR DELAY '0:0:5'",
        "CHAR(65, 66, 67, 68)",
        "hello\x00world",
    ],
)
def test_sqli_detector_catches_malicious_payloads(payload: str):
    """Verify SQLi detection identifies common attack vectors."""
    assert detect_sql_injection(payload) is not None


@pytest.mark.parametrize(
    "benign",
    [
        "O'Connor",
        "Need access for team's robotics arm; testing sensors",
        "Urgent hardware check -- battery test",
        "f20230326@hyderabad.bits-pilani.ac.in",
        "ESP32_SANDBOXX_0_DOOR",
        "sandboxx_0",
        "Lab check for ARC & Robotics Club",
        "Order by Friday 5pm",
    ],
)
def test_sqli_detector_allows_benign_inputs(benign: str):
    """Verify legitimate facility access text and identifiers do not false-positive."""
    assert detect_sql_injection(benign) is None


@pytest.mark.asyncio
async def test_middleware_blocks_sqli_in_query_path_and_body():
    """SQLi probes across query params, path segments, URL-encoding, and JSON bodies are blocked."""
    headers = _root_headers()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Query string SQLi (raw & URL-encoded)
        q1 = await client.get("/api/v1/logs/portal?space_slug=sandboxx_0' OR '1'='1", headers=headers)
        assert q1.status_code == 400
        assert q1.json()["status"] == "blocked"

        q2 = await client.get(
            "/api/v1/logs/portal?club_name=ARC%27%20UNION%20SELECT%20*%20FROM%20admins--",
            headers=headers,
        )
        assert q2.status_code == 400
        assert q2.json()["status"] == "blocked"

        # 2. Path parameter SQLi (single and double URL-encoded)
        p1 = await client.get("/api/v1/spaces/'; DROP TABLE users;--", headers=headers)
        assert p1.status_code == 400

        p2 = await client.get("/api/v1/spaces/sandboxx_0%2527%2520OR%25201%253D1--", headers=headers)
        assert p2.status_code == 400

        # 3. JSON body SQLi across endpoints
        b1 = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin' OR '1'='1'--@gmail.com"},
        )
        assert b1.status_code == 400
        assert b1.json()["status"] == "blocked"

        b2 = await client.post(
            "/api/v1/requests",
            headers=headers,
            json={
                "space_slug": "sandboxx_0",
                "justification": "Access'; DELETE FROM entry_logs WHERE '1'='1",
            },
        )
        assert b2.status_code == 400
        assert b2.json()["status"] == "blocked"

        b3 = await client.post(
            "/api/v1/requests",
            headers=headers,
            json={
                "space_slug": "sandboxx_0",
                "justification": "test UNION ALL SELECT email FROM admins",
            },
        )
        assert b3.status_code == 400

        # 4. NUL byte injection blocked safely with 400 (not 500 asyncpg crash)
        n1 = await client.get("/api/v1/logs/portal?club_name=test%00drop", headers=headers)
        assert n1.status_code == 400

        n2 = await client.post(
            "/api/v1/auth/login",
            json={"email": "nul\x00test@college.edu"},
        )
        assert n2.status_code == 400


@pytest.mark.asyncio
async def test_schema_validation_rejects_malformed_identifiers():
    """Strict identifier schemas reject non-conforming space slugs and PIN codes."""
    headers = _root_headers()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        sp_bad = await client.post(
            "/api/v1/spaces",
            headers=headers,
            json={"slug": "bad slug!$", "name": "Bad Slug"},
        )
        assert sp_bad.status_code in (400, 422)

        pin_bad = await client.post(
            "/api/v1/esp32/events",
            json={
                "space_id": "sandboxx_0",
                "device_id": "ESP32_DOOR",
                "pin_entered": "12345a",
            },
        )
        assert pin_bad.status_code in (400, 422)


@pytest.mark.asyncio
async def test_benign_apostrophes_and_semicolons_still_work():
    """Ensure legitimate text with apostrophes/semicolons works end-to-end."""
    headers = _root_headers()
    unique_slug = f"sqli_safe_{uuid.uuid4().hex[:6]}"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            "/api/v1/spaces",
            headers=headers,
            json={"slug": unique_slug, "name": "O'Connor Robotics; Lab A"},
        )
        assert res.status_code == 201
        assert res.json()["name"] == "O'Connor Robotics; Lab A"

        cleanup = await client.delete(f"/api/v1/spaces/{unique_slug}", headers=headers)
        assert cleanup.status_code == 200


@pytest.mark.asyncio
async def test_database_error_does_not_leak_sql_details(monkeypatch):
    """Ensure SQLAlchemyError responses mask raw SQL/driver/schema details."""
    headers = _root_headers()
    from backend.app.services.space_service import SpaceService

    async def boom(*args, **kwargs):
        raise OperationalError("SELECT * FROM users WHERE secret='abc'", {}, Exception("asyncpg pg_catalog leak"))

    monkeypatch.setattr(SpaceService, "get_all_spaces", boom)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/v1/spaces", headers=headers)
        assert res.status_code == 500
        body_text = res.text.lower()
        assert "select" not in body_text
        assert "asyncpg" not in body_text
        assert "pg_catalog" not in body_text
