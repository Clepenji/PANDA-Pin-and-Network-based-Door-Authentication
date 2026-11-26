"""Sliding-window in-memory HTTP rate limiting middleware for PANDA."""

from collections import defaultdict, deque
import json
import time
from typing import Deque, Dict, Tuple

from backend.app.config.settings import settings


class RateLimitMiddleware:
    """Pure ASGI sliding-window rate limiter protecting API and auth endpoints."""

    def __init__(self, app) -> None:
        self.app = app
        self._hits: Dict[Tuple[str, str], Deque[float]] = defaultdict(deque)

    def _get_limit(self, path: str) -> Tuple[str, int, int]:
        """Return (bucket_name, max_requests, window_seconds) for a request path."""
        if path.startswith("/api/v1/auth/"):
            return ("auth", 30, 60)
        if path.startswith("/api/esp32/") or path.startswith("/api/v1/esp32/") or path == "/api/pins/verify-keypad":
            return ("hardware", 300, 60)
        if path.startswith("/api/"):
            return ("api", 180, 60)
        return ("exempt", 0, 60)

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or not getattr(settings, "RATE_LIMIT_ENABLED", True):
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        bucket, max_reqs, window_sec = self._get_limit(path)
        if bucket == "exempt" or max_reqs <= 0:
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        client_ip = client[0] if client else "unknown"
        key = (client_ip, bucket)
        now = time.monotonic()
        cutoff = now - window_sec

        dq = self._hits[key]
        while dq and dq[0] <= cutoff:
            dq.popleft()

        if len(dq) >= max_reqs:
            retry_after = max(1, int(window_sec - (now - dq[0])))
            body = json.dumps({
                "detail": "Too many requests. Please slow down and try again shortly.",
                "status": "error",
            }).encode("utf-8")
            await send({
                "type": "http.response.start",
                "status": 429,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"retry-after", str(retry_after).encode("ascii")),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            })
            await send({
                "type": "http.response.body",
                "body": body,
            })
            return

        dq.append(now)
        await self.app(scope, receive, send)
