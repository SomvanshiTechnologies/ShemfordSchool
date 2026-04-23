"""
Shemford School — Admin Operations
Provides database diagnostics, job-queue health, and backup hooks.
All endpoints are restricted to ADMIN role.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from database import db
from models import UserRole
from auth_utils import require_roles, create_audit_log

router = APIRouter()
logger = logging.getLogger(__name__)

BACKUP_DIR = os.environ.get("BACKUP_DIR", "/tmp/shemford_backups")
MONGO_URL  = os.environ.get("MONGO_URL", "")
DB_NAME    = os.environ.get("DB_NAME", "shemford_db")

# Monitored collections for stats endpoint
_STAT_COLLECTIONS = [
    "students", "users", "employees", "payroll",
    "student_ledger", "fee_payments", "razorpay_orders",
    "attendance", "audit_logs", "jobs",
]


# ── GET /admin/db-stats ───────────────────────────────────────────────────────

@router.get("/admin/db-stats")
async def get_db_stats(request: Request):
    """
    Return document counts for monitored collections plus raw dbStats.
    Useful for capacity planning, monitoring dashboards, and backup verification.
    """
    await require_roles(UserRole.ADMIN)(request)

    counts: dict = {}
    for coll in _STAT_COLLECTIONS:
        try:
            counts[coll] = await db[coll].count_documents({})
        except Exception as exc:
            counts[coll] = f"error: {exc}"

    db_meta: dict = {}
    try:
        raw = await db.command("dbStats")
        db_meta = {
            "data_size_mb":    round(raw.get("dataSize",    0) / 1_048_576, 2),
            "storage_size_mb": round(raw.get("storageSize", 0) / 1_048_576, 2),
            "collections":     raw.get("collections", 0),
            "indexes":         raw.get("indexes", 0),
        }
    except Exception as exc:
        db_meta = {"error": str(exc)}

    return {
        "timestamp":   datetime.now(timezone.utc).isoformat(),
        "collections": counts,
        "db":          db_meta,
    }


# ── POST /admin/backup ────────────────────────────────────────────────────────

@router.post("/admin/backup")
async def trigger_backup(request: Request):
    """
    Trigger a mongodump backup to BACKUP_DIR (set via env var).

    Requirements on the server:
      - mongodump (MongoDB Database Tools) must be installed and on PATH
      - BACKUP_DIR must be a writable directory (default: /tmp/shemford_backups)
      - MONGO_URL must be set in .env

    The dump is gzip-compressed. Each run creates a timestamped subdirectory.
    """
    user = await require_roles(UserRole.ADMIN)(request)

    if not MONGO_URL:
        raise HTTPException(
            status_code=503,
            detail="MONGO_URL is not configured — backup is unavailable.",
        )

    ts      = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_dir = os.path.join(BACKUP_DIR, f"backup_{ts}")

    try:
        os.makedirs(out_dir, exist_ok=True)
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Cannot create backup directory '{out_dir}': {exc}",
        )

    cmd = ["mongodump", f"--uri={MONGO_URL}", f"--out={out_dir}", "--gzip"]
    logger.info("Backup triggered by user=%s — output: %s", user["user_id"], out_dir)

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail="Backup timed out after 5 minutes. Check server resources.",
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=503,
            detail=(
                "mongodump not found on PATH. "
                "Install MongoDB Database Tools on this server to enable backups."
            ),
        )

    if proc.returncode != 0:
        err_msg = stderr.decode("utf-8", errors="replace")[:500]
        logger.error("mongodump failed for %s: %s", out_dir, err_msg)
        raise HTTPException(
            status_code=500,
            detail=f"mongodump exited with code {proc.returncode}: {err_msg}",
        )

    await create_audit_log(
        "admin", "backup", "triggered",
        {"output_dir": out_dir, "db": DB_NAME},
        user,
    )
    logger.info("Backup completed: %s by user=%s", out_dir, user["user_id"])

    return {
        "status":     "success",
        "backup_dir": out_dir,
        "timestamp":  ts,
        "message":    f"Database '{DB_NAME}' backed up (gzip) to {out_dir}",
    }


# ── GET /admin/job-queue ──────────────────────────────────────────────────────

@router.get("/admin/job-queue")
async def get_job_queue_stats(request: Request):
    """
    Job queue health dashboard: counts by status and the 10 most recent failures.
    """
    await require_roles(UserRole.ADMIN)(request)

    pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
    agg = await db.jobs.aggregate(pipeline).to_list(20)
    by_status = {doc["_id"]: doc["count"] for doc in agg}

    recent_failed = await db.jobs.find(
        {"status": "failed"},
        {
            "_id": 0,
            "job_id": 1, "task_name": 1, "attempts": 1,
            "max_attempts": 1, "error": 1, "completed_at": 1,
        },
    ).sort("completed_at", -1).limit(10).to_list(10)

    stale_running = await db.jobs.count_documents({"status": "running"})

    return {
        "timestamp":      datetime.now(timezone.utc).isoformat(),
        "by_status":      by_status,
        "stale_running":  stale_running,
        "recent_failed":  recent_failed,
    }
