"""
Shemford Futuristic School — Sliding-Window Rate Limiter

In-memory per-IP rate limiting with route-specific limits.
Design: swappable backend (Redis compatible interface) — drop in Redis counters
        for multi-process / multi-node deployments.

Route-specific limits (requests / window_seconds):
  POST /api/auth/login          → 10 / 60s
  POST /api/auth/register       → 5  / 60s
  POST /api/auth/forgot-password→ 3  / 3600s
  POST /api/auth/refresh        → 20 / 60s
  *   (default)                 → 120 / 60s

Headers returned on every response:
  X-RateLimit-Limit
  X-RateLimit-Remaining
  X-RateLimit-Reset          (Unix timestamp of window reset)
  Retry-After                (only on 429)
"""
import time
import asyncio
import logging
from collections import defaultdict, deque
from typing import Tuple
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# (max_requests, window_seconds)
_ROUTE_LIMITS: dict[str, Tuple[int, int]] = {
    # ── Authentication ────────────────────────────────────────────────────────
    # Login: per-credential brute-force is handled in the route itself (5 failures
    # → 15-min lockout). The IP limit here is a DoS guard only — set high enough
    # that the credential limiter always fires first for a single attacker.
    "POST /api/auth/login":             (20,  900),
    "POST /api/auth/register":          (5,    60),
    "POST /api/auth/forgot-password":   (3,  3600),
    "POST /api/auth/refresh":           (20,   60),
    "POST /api/auth/create-user":       (10,   60),
    "POST /api/auth/reset-password":    (5,   300),
    "PUT /api/auth/change-password":    (5,   300),
    "PUT /api/settings/change-password": (5,  300),
    # ── Payments — tighter limits to prevent abuse ────────────────────────────
    "POST /api/payments/razorpay/create-order":     (10,  60),
    "POST /api/payments/razorpay/verify":           (20,  60),
    "POST /api/payments/razorpay/verify-mobile":    (20,  60),
    "POST /api/payments/razorpay/refund":           (5,   60),
    "POST /api/payments/razorpay/cancel":           (20,  60),
    "POST /api/payments/razorpay/initiate":         (20,  60),
    # ── Webhooks — allow Razorpay retry bursts, but cap DoS ──────────────────
    "POST /api/webhook/razorpay":       (60,  60),
    "POST /api/webhook/stripe":         (60,  60),
    # ── Payroll generation — prevent accidental mass generation ──────────────
    "POST /api/payroll/generate":       (10,  60),
}
_DEFAULT_LIMIT: Tuple[int, int] = (120, 60)


def _get_limit(method: str, path: str) -> Tuple[int, int]:
    key = f"{method} {path}"
    # Also try with normalised (stripped) key to handle the aligned dict values
    if key not in _ROUTE_LIMITS:
        key = key.strip()
    return _ROUTE_LIMITS.get(key, _DEFAULT_LIMIT)


def _client_ip(request: Request) -> str:
    """Extract real client IP, respecting X-Forwarded-For from trusted proxies."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # Take leftmost address (original client); strip whitespace
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ── In-memory store ────────────────────────────────────────────────────────────
# { "{ip}:{method}:{path}" → deque of timestamps (float, seconds since epoch) }
_windows: dict[str, deque] = defaultdict(deque)
_lock = asyncio.Lock()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Sliding-window rate limiter.
    Skips health-check paths and static asset paths to avoid noise.
    """

    _SKIP_PREFIXES = ("/uploads/", "/docs", "/openapi.json", "/redoc")

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method

        # Skip non-API paths
        if any(path.startswith(p) for p in self._SKIP_PREFIXES):
            return await call_next(request)

        max_req, window_sec = _get_limit(method, path)
        ip = _client_ip(request)
        store_key = f"{ip}:{method}:{path}"
        now = time.time()
        window_start = now - window_sec

        async with _lock:
            window = _windows[store_key]
            # Evict timestamps outside the current window
            while window and window[0] < window_start:
                window.popleft()

            current_count = len(window)

            if current_count >= max_req:
                oldest = window[0]
                retry_after = int(oldest + window_sec - now) + 1
                logger.warning(
                    "Rate limit exceeded: ip=%s %s %s count=%d/%d retry_after=%ds",
                    ip, method, path, current_count, max_req, retry_after
                )
                retry_minutes = max(1, round(retry_after / 60))
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": f"Too many failed login attempts. Please try again after {retry_minutes} minute{'s' if retry_minutes != 1 else ''}.",
                        "retry_after": retry_after,
                    },
                    headers={
                        "X-RateLimit-Limit": str(max_req),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": str(int(oldest + window_sec)),
                        "Retry-After": str(retry_after),
                    }
                )

            window.append(now)
            remaining = max_req - len(window)
            reset_at = int(window[0] + window_sec) if window else int(now + window_sec)

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(max_req)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(reset_at)
        return response
