from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pathlib import Path
import os
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

# Include all routers under /api prefix
for router in [
    auth_router, students_router, employees_router, fees_router,
    attendance_router, marks_router, announcements_router, messages_router,
    syllabus_router, issues_router, classes_router, onboarding_router,
    reports_router, payments_router, notifications_router, utilities_router,
    upgradation_router, settings_router,
]:
    app.include_router(router, prefix="/api")

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


# ── Audit / request logging (#18) ────────────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    has_auth = "yes" if request.headers.get("authorization") else "no"
    response = await call_next(request)
    duration_ms = round((time.time() - start) * 1000)
    logger.info(
        "%s %s | status=%s auth=%s duration=%dms",
        request.method, request.url.path,
        response.status_code, has_auth, duration_ms
    )
    return response


# ── CORS (#4) ─────────────────────────────────────────────────────────────────
_cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)

@app.on_event("startup")
async def startup_event():
    from db_init import create_indexes
    await create_indexes(db)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
