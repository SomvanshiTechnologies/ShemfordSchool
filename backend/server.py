from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pathlib import Path
import os
import uuid
import logging
import time

from database import client, db

# Load environment
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("shemford.api")

app = FastAPI(title="Shemford School Management System")

# ── Serve uploaded files ──────────────────────────────────────────────────────
_uploads_dir = ROOT_DIR / "uploads"
_uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")

# Import all routers
from routes.auth import router as auth_router
from routes.students import router as students_router
from routes.employees import router as employees_router
from routes.fees import router as fees_router
from routes.attendance import router as attendance_router
from routes.marks import router as marks_router
from routes.announcements import router as announcements_router
from routes.messages import router as messages_router
from routes.syllabus import router as syllabus_router
from routes.issues import router as issues_router
from routes.classes import router as classes_router
from routes.onboarding import router as onboarding_router
from routes.reports import router as reports_router
from routes.payments import router as payments_router
from routes.notifications import router as notifications_router
from routes.utilities import router as utilities_router
from routes.upgradation import router as upgradation_router
from routes.settings import router as settings_router
from routes.razorpay_payments import router as razorpay_router
from routes.payroll import router as payroll_router
from routes.admin import router as admin_router
from routes.pos_payments import router as pos_router
from routes.voice_notes import router as voice_notes_router
from middleware.rate_limiter import RateLimitMiddleware
from middleware.rbac import RBACEnforcementMiddleware

# Include all routers under /api prefix
for router in [
    auth_router, students_router, employees_router, fees_router,
    attendance_router, marks_router, announcements_router, messages_router,
    syllabus_router, issues_router, classes_router, onboarding_router,
    reports_router, payments_router, notifications_router, utilities_router,
    upgradation_router, settings_router, razorpay_router, payroll_router,
    admin_router, pos_router, voice_notes_router,
]:
    app.include_router(router, prefix="/api")

# ── Global exception handler ──────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception("Unhandled exception request_id=%s path=%s: %s", request_id, request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal error occurred.", "request_id": request_id}
    )


# ── Request size limit (#25) ──────────────────────────────────────────────────
MAX_REQUEST_SIZE = int(os.environ.get("MAX_REQUEST_SIZE_MB", "10")) * 1024 * 1024

@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_REQUEST_SIZE:
        return JSONResponse(
            status_code=413,
            content={"detail": f"Request body too large. Maximum allowed: {MAX_REQUEST_SIZE // (1024*1024)} MB"}
        )
    return await call_next(request)


# ── Security headers (#19) ────────────────────────────────────────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# ── Request ID ────────────────────────────────────────────────────────────────
@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    """
    Attach a unique X-Request-ID to every request/response.
    Clients may send their own ID; we honour it if present, otherwise generate one.
    The ID is stored in request.state.request_id for use in exception handlers and logs.
    """
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# ── Audit / request logging (#18) ────────────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    has_auth = "yes" if request.headers.get("authorization") else "no"
    response = await call_next(request)
    # Read request_id AFTER call_next — attach_request_id (which runs inside the chain)
    # sets request.state.request_id before returning, so it is now available here.
    request_id = getattr(request.state, "request_id", "-")
    duration_ms = round((time.time() - start) * 1000)
    logger.info(
        "%s %s | status=%s auth=%s duration=%dms rid=%s",
        request.method, request.url.path,
        response.status_code, has_auth, duration_ms, request_id
    )
    return response


# ── Middleware stack (add_middleware is LIFO — last added = outermost) ────────
#
# Execution order for incoming requests (outermost → innermost):
#   RateLimitMiddleware → RBACEnforcementMiddleware → CORSMiddleware → @app.middleware chain
#
# RBAC is added BEFORE CORS so that CORSMiddleware (which wraps RBAC) can
# append CORS headers to the 401 responses that RBAC generates, preventing
# the browser from masking real 401s with CORS errors.

_cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")

# 1. Innermost: RBAC
app.add_middleware(RBACEnforcementMiddleware)

# 2. Middle: rate limiting
app.add_middleware(RateLimitMiddleware)

# 3. Outermost: CORS — must wrap everything so every response (incl. 429s) has CORS headers
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "X-Request-ID"],
    expose_headers=["X-Total-Count", "X-Total-Pages", "X-Page", "X-Request-ID"],
)


def _validate_env():
    """
    Fail fast at boot: check every required env var is non-empty.
    Raises RuntimeError with a list of all missing vars so operators fix
    all problems in one restart rather than one-at-a-time.
    """
    required = {
        "MONGO_URL":        "MongoDB connection string",
        "DB_NAME":          "MongoDB database name",
        "JWT_SECRET":       "HS256 signing secret for access tokens",
    }
    # Ezetap POS is required only when the feature is enabled
    if os.environ.get("EZETAP_ENABLED", "true").lower() != "false":
        required.update({
            "EZETAP_USERNAME": "Ezetap API username (not the web-portal login)",
            "EZETAP_APP_KEY":  "Ezetap App Key from merchant dashboard",
        })

    missing = [f"  {var}  ({desc})" for var, desc in required.items() if not os.environ.get(var)]
    if missing:
        raise RuntimeError(
            "Missing required environment variables — server cannot start:\n"
            + "\n".join(missing)
            + "\n\nCopy backend/.env.example to backend/.env and fill in the values."
        )


@app.on_event("startup")
async def startup_event():
    _validate_env()
    from db_init import create_indexes
    from job_queue import recover_stale_jobs, start_worker
    await create_indexes(db)
    await recover_stale_jobs()
    start_worker()
    logger.info("Startup complete — DB indexes verified, job worker running")


@app.on_event("shutdown")
async def shutdown_db_client():
    from job_queue import stop_worker
    stop_worker()
    client.close()


# ── Liveness probe ────────────────────────────────────────────────────────────
@app.get("/health", tags=["ops"])
async def health():
    """Liveness: returns 200 immediately. Used by load balancers / container runtimes."""
    return {"status": "ok"}


# ── Readiness probe ───────────────────────────────────────────────────────────
@app.get("/readiness", tags=["ops"])
async def readiness():
    """
    Readiness: checks MongoDB connectivity before accepting traffic.
    Returns 503 if the database is unreachable.
    """
    try:
        await db.command("ping")
        return {"status": "ready", "database": "connected"}
    except Exception as exc:
        logger.error("Readiness check failed: %s", exc)
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "database": "disconnected"},
        )
