"""SQL Injection Defense-in-Depth Shield & Input Validation Utilities.

Provides:
1. Compiled SQL injection & NUL-byte detection across paths, query strings, and JSON payloads.
2. Safe identifier regex validators for Facility Space slugs, lock device IDs, and versions.
3. Pure ASGI middleware (`SqlInjectionGuardMiddleware`) that inspects inbound HTTP/WebSocket
   requests before route dispatch and blocks malicious SQL payloads without breaking
   downstream body consumption or legitimate user text (e.g., apostrophes in names/notes).
"""

import json
import logging
import re
from typing import Any, List, Optional, Tuple
from urllib.parse import parse_qsl, unquote

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("panda.security.sql_shield")

# Strict identifier patterns (safe against SQL metacharacters and path traversal)
SAFE_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$")
SAFE_DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")
SAFE_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$")
SIX_DIGIT_PIN_RE = re.compile(r"^[0-9]{6}$")

# High-confidence SQL injection signatures designed to minimize false positives on normal English
_SQLI_RULES: List[Tuple[str, re.Pattern[str]]] = [
    (
        "boolean_tautology",
        re.compile(
            r"(?:(?:'|\"|\))\s*(?:or|and)\s+(?:\(*\s*(?:''|\"\"|'[^']*'?|\"[^\"]*\"?|\d+|[a-z_][a-z0-9_]*)\s*(?:=|!=|<>|<|>|\blike\b|\bis\b)\s*\(*\s*(?:''|\"\"|'[^']*'?|\"[^\"]*\"?|\d+|[a-z_][a-z0-9_]*)|true\b|false\b|not\s+null\b|null\b))"
            r"|(?:\b(?:or|and)\s+\d+\s*(?:=|!=|<>)\s*\d+\b)",
            re.IGNORECASE,
        ),
    ),
    (
        "union_select",
        re.compile(r"\bunion\b(?:\s+all)?\s+\bselect\b", re.IGNORECASE),
    ),
    (
        "stacked_query",
        re.compile(
            r"(?:;\s*(?:drop\b|truncate\b|alter\b|delete\s+from\b|insert\s+into\b|update\s+\w+\s+set\b"
            r"|select\s+.*?\bfrom\b|select\s+(?:pg_sleep|version|current_|@@)|exec(?:ute)?\b|grant\b|revoke\b|copy\b|create\s+(?:table|user|role|function)\b|shutdown\b))"
            r"|(?:['\"]\s*;\s*(?:--|select\b|drop\b|insert\b|update\b|delete\b|truncate\b|alter\b|exec(?:ute)?\b))",
            re.IGNORECASE,
        ),
    ),
    (
        "comment_injection",
        re.compile(
            r"(?:['\"`]\s*--(?:\s|$|#))"
            r"|(?:['\"`]\s*#(?:\s|$))"
            r"|(?:['\"`]\s*/\*)"
            r"|(?:\b(?:order|group)\s+by\s+\d+\s*(?:--|#|/\*))"
            r"|(?:/\*![0-9]*)"
            r"|(?:/\*[\s\S]*?\b(?:select|union|drop|insert|update|delete|pg_sleep|sleep|waitfor|or|and)\b[\s\S]*?\*/)",
            re.IGNORECASE,
        ),
    ),
    (
        "db_function_probe",
        re.compile(
            r"\b(?:pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_activity"
            r"|lo_import|lo_export|dblink_connect|query_to_xml|benchmark|sleep"
            r"|xp_cmdshell|sp_executesql|extractvalue|updatexml|utl_inaddr|load_file)\s*\("
            r"|\bwaitfor\s+(?:delay|time)\s+['\"]",
            re.IGNORECASE,
        ),
    ),
    (
        "system_catalog_probe",
        re.compile(
            r"\b(?:information_schema|pg_catalog|pg_tables|pg_user|pg_shadow|pg_roles|sqlite_master)\b"
            r"|@@(?:version|datadir|hostname|basedir|user)\b"
            r"|\binto\s+(?:outfile|dumpfile)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "encoded_char_obfuscation",
        re.compile(
            r"\b(?:char|chr|ascii|unhex)\s*\(\s*\d+(?:\s*,\s*\d+){2,}\s*\)",
            re.IGNORECASE,
        ),
    ),
]


def contains_null_byte(value: str) -> bool:
    """Return True if value contains raw or URL-encoded NUL bytes."""
    if "\x00" in value:
        return True
    lowered = value.lower()
    return "%00" in lowered


def _decode_variants(value: str) -> List[str]:
    """Return raw plus up to two URL-decoded passes to catch encoded SQLi probes."""
    variants = [value]
    if "%" in value:
        once = unquote(value)
        variants.append(once)
        if "%" in once:
            variants.append(unquote(once))
    return variants


def detect_sql_injection(value: str, decode_url: bool = False) -> Optional[str]:
    """Inspect a string for high-confidence SQL injection or NUL-byte payloads.

    Returns the violated rule name if detected, otherwise None.
    """
    if not value:
        return None

    candidates = _decode_variants(value) if decode_url else [value]
    for candidate in candidates:
        if contains_null_byte(candidate):
            return "null_byte"
        for rule_name, pattern in _SQLI_RULES:
            if pattern.search(candidate):
                return rule_name
    return None


def scan_value_for_sqli(value: Any, path: str = "body") -> Optional[Tuple[str, str]]:
    """Recursively scan JSON-compatible Python structures for SQLi signatures or NUL bytes."""
    if isinstance(value, str):
        rule = detect_sql_injection(value, decode_url=False)
        if rule:
            return (path, rule)
        return None

    if isinstance(value, dict):
        for k, v in value.items():
            if isinstance(k, str):
                key_rule = detect_sql_injection(k, decode_url=False)
                if key_rule:
                    return (f"{path}.{k}", key_rule)
            hit = scan_value_for_sqli(v, f"{path}.{k}")
            if hit:
                return hit
        return None

    if isinstance(value, list):
        for idx, item in enumerate(value):
            hit = scan_value_for_sqli(item, f"{path}[{idx}]")
            if hit:
                return hit
        return None

    return None


def assert_safe_identifier(value: str, pattern: re.Pattern[str], field_label: str) -> str:
    """Validate and return a clean identifier string against strict character allowlists."""
    cleaned = (value or "").strip()
    if contains_null_byte(cleaned) or detect_sql_injection(cleaned):
        raise ValueError(f"Invalid or unsafe {field_label}.")
    if not pattern.match(cleaned):
        raise ValueError(f"Invalid {field_label} format.")
    return cleaned


def _get_header(headers: List[Tuple[bytes, bytes]], name: bytes) -> str:
    target = name.lower()
    for k, v in headers:
        if k.lower() == target:
            return v.decode("latin-1", errors="ignore")
    return ""


class SqlInjectionGuardMiddleware:
    """Pure ASGI defense-in-depth middleware inspecting API/WebSocket requests for SQLi."""

    MAX_INSPECT_BODY_BYTES = 2 * 1024 * 1024  # 2 MB cap for JSON/form inspection

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        scope_type = scope.get("type")
        if scope_type not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        raw_qs = scope.get("query_string", b"").decode("latin-1", errors="ignore")

        # 1. Inspect path and query parameters for API and WebSocket endpoints
        is_protected_route = (
            path.startswith("/api/")
            or path.startswith("/ws/")
            or path == "/health"
        )
        if is_protected_route:
            if path_hit := detect_sql_injection(path, decode_url=True):
                await self._reject(scope, send, f"path ({path_hit})")
                return

            if raw_qs:
                if qs_hit := detect_sql_injection(raw_qs, decode_url=True):
                    await self._reject(scope, send, f"query ({qs_hit})")
                    return
                for qk, qv in parse_qsl(raw_qs, keep_blank_values=True):
                    if k_hit := detect_sql_injection(qk, decode_url=True):
                        await self._reject(scope, send, f"query.{qk} ({k_hit})")
                        return
                    if v_hit := detect_sql_injection(qv, decode_url=True):
                        await self._reject(scope, send, f"query.{qk} ({v_hit})")
                        return

        # 2. Inspect JSON / URL-encoded HTTP bodies without consuming downstream stream
        if scope_type == "http" and path.startswith("/api/"):
            method = scope.get("method", "GET").upper()
            content_type = _get_header(scope.get("headers", []), b"content-type").lower()
            if method in ("POST", "PUT", "PATCH", "DELETE") and (
                "application/json" in content_type
                or "application/x-www-form-urlencoded" in content_type
            ):
                body_chunks: List[bytes] = []
                total_size = 0
                more_body = True
                while more_body:
                    message: Message = await receive()
                    chunk = message.get("body", b"")
                    if chunk:
                        total_size += len(chunk)
                        if total_size > self.MAX_INSPECT_BODY_BYTES:
                            # Too large for middleware scan; let FastAPI enforce limits while replaying buffered bytes
                            body_chunks.append(chunk)
                            more_body = bool(message.get("more_body", False))
                            break
                        body_chunks.append(chunk)
                    more_body = bool(message.get("more_body", False))

                # Drain any remaining chunks only if oversized bypass occurred
                while more_body:
                    message = await receive()
                    chunk = message.get("body", b"")
                    if chunk:
                        body_chunks.append(chunk)
                    more_body = bool(message.get("more_body", False))

                full_body = b"".join(body_chunks)

                if full_body and len(full_body) <= self.MAX_INSPECT_BODY_BYTES:
                    hit_desc = self._inspect_body(full_body, content_type)
                    if hit_desc:
                        await self._reject(scope, send, hit_desc)
                        return

                delivered = False

                async def replay_receive() -> Message:
                    nonlocal delivered
                    if not delivered:
                        delivered = True
                        return {"type": "http.request", "body": full_body, "more_body": False}
                    return {"type": "http.disconnect"}

                await self.app(scope, replay_receive, send)
                return

        await self.app(scope, receive, send)

    @staticmethod
    def _inspect_body(full_body: bytes, content_type: str) -> Optional[str]:
        if b"\x00" in full_body:
            return "body (null_byte)"

        text_body = full_body.decode("utf-8", errors="ignore")
        if "application/json" in content_type:
            try:
                parsed = json.loads(text_body)
            except Exception:
                # Malformed JSON will be rejected by FastAPI's JSON parser
                return None
            hit = scan_value_for_sqli(parsed, path="body")
            if hit:
                return f"{hit[0]} ({hit[1]})"
            return None

        if "application/x-www-form-urlencoded" in content_type:
            for fk, fv in parse_qsl(text_body, keep_blank_values=True):
                if k_hit := detect_sql_injection(fk, decode_url=True):
                    return f"form.{fk} ({k_hit})"
                if v_hit := detect_sql_injection(fv, decode_url=True):
                    return f"form.{fk} ({v_hit})"
        return None

    @staticmethod
    async def _reject(scope: Scope, send: Send, location_rule: str) -> None:
        client = scope.get("client")
        client_ip = client[0] if client else "unknown"
        path = scope.get("path", "")
        logger.warning(
            "Blocked suspected SQL injection payload from client=%s path=%s match=%s",
            client_ip,
            path,
            location_rule,
        )
        if scope.get("type") == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return

        response = JSONResponse(
            status_code=400,
            content={
                "detail": "Request rejected: invalid or potentially unsafe SQL syntax detected.",
                "status": "blocked",
            },
        )
        await response(scope, _empty_receive, send)


async def _empty_receive() -> Message:
    return {"type": "http.disconnect"}
