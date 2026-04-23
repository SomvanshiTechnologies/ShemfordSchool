"""
Shemford Futuristic School — Centralized RBAC Enforcement Middleware

Belt-and-suspenders guard: every /api/* route that is not on the explicit
public whitelist MUST carry an authentication credential.

This does NOT replace per-route require_roles() calls — those still enforce
the specific allowed roles. This layer catches routes that accidentally omit
authentication entirely by failing fast with 401 before the route handler runs.

Public routes are any of:
  - Exact paths in _PUBLIC_EXACT
  - Paths starting with any prefix in _PUBLIC_PREFIXES
  - CORS preflight (OPTIONS)
  - Anything outside /api/* (static files, docs, probes)
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

# ── Public path registry ──────────────────────────────────────────────────────

_PUBLIC_EXACT: frozenset = frozenset({
    # Auth — unauthenticated entry points
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/session",          # OAuth session exchange
    "/api/auth/refresh",          # refresh-token rotation (bearer of refresh token)
    "/api/auth/logout",           # logout works even with expired tokens
    "/api/auth/forgot-password",
    "/api/auth/reset-password",   # uses a one-time reset token, not a session

    # Webhooks — called by Razorpay/Stripe servers, not end-users
    "/api/webhook/razorpay",
    "/api/webhook/stripe",
})

_PUBLIC_PREFIXES: tuple = (
    "/uploads/",                               # static file serving
    "/api/payments/razorpay/checkout/",        # mobile checkout HTML page
    "/api/payments/razorpay/verify-mobile",    # verify callback from mobile HTML page
)


# ── Middleware ────────────────────────────────────────────────────────────────

class RBACEnforcementMiddleware(BaseHTTPMiddleware):
    """
    Enforce authentication *presence* on all non-public API routes.

    Only checks that a credential exists — full validation (signature, expiry,
    JTI revocation, role) is done inside each route by get_current_user /
    require_roles. This layer solely prevents accidentally-unprotected routes
    from serving unauthenticated requests.
    """

    async def dispatch(self, request: Request, call_next):
        path   = request.url.path
        method = request.method

        # Always allow CORS preflight
        if method == "OPTIONS":
            return await call_next(request)

        # Non-API paths (static files, docs, health probes) — pass through
        if not path.startswith("/api/"):
            return await call_next(request)

        # Exact public path
        if path in _PUBLIC_EXACT:
            return await call_next(request)

        # Public prefix
        for prefix in _PUBLIC_PREFIXES:
            if path.startswith(prefix):
                return await call_next(request)

        # ── Credential presence check ─────────────────────────────────────────
        has_bearer = request.headers.get("authorization", "").lower().startswith("bearer ")
        has_cookie = bool(request.cookies.get("session_token"))

        if not has_bearer and not has_cookie:
            # Best-effort: use the client-supplied X-Request-ID if attach_request_id
            # hasn't run yet (RBAC is outer middleware, request_id may not be set).
            request_id = (
                request.headers.get("X-Request-ID")
                or getattr(request.state, "request_id", None)
                or "-"
            )
            return JSONResponse(
                status_code=401,
                content={"detail": "Authentication required.", "request_id": request_id},
                headers={"WWW-Authenticate": "Bearer"},
            )

        return await call_next(request)
