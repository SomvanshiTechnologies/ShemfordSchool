"""
Shemford School — Admin Operations
Provides database diagnostics, job-queue health, and backup hooks.
All endpoints are restricted to ADMIN role.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response

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


# ── Audit Trail (deletion log + restore) ──────────────────────────────────────

# Entity types that support restore via flipping is_active back to True.
# Maps entity_type (as stored in audit_logs) → (collection_name, id_field).
_RESTORABLE_ENTITIES = {
    "student":      ("students",      "student_id"),
    "employee":     ("employees",     "employee_id"),
    "holiday":      ("holidays",      "holiday_id"),
    "announcement": ("announcements", "announcement_id"),
    "pos_device":   ("pos_devices",   "device_id"),
}


@router.get("/admin/audit-trail")
async def list_audit_trail(
    request: Request,
    response: Response,
    only_non_admin: bool = Query(True, description="If true, hide deletions performed by admins"),
    include_restored: bool = Query(False, description="If true, include already-restored entries"),
    entity_type: Optional[str] = Query(None, description="Filter by entity type"),
    limit: int = Query(30, ge=1, le=200),
    page: int = Query(1, ge=1),
):
    """
    List deletion (deactivate) events from audit_logs, with optional filters.
    Used by the admin Audit Trails tab to show 'who deleted what' and offer restore.
    """
    await require_roles(UserRole.ADMIN)(request)

    query: dict = {"action": "deactivate"}
    if only_non_admin:
        query["performed_by_role"] = {"$ne": "admin"}
    if not include_restored:
        query["restored_at"] = None
    if entity_type:
        query["entity_type"] = entity_type

    import asyncio
    total, entries = await asyncio.gather(
        db.audit_logs.count_documents(query),
        db.audit_logs.find(query, {"_id": 0})
            .sort("created_at", -1)
            .skip((page - 1) * limit)
            .limit(limit)
            .to_list(limit),
    )
    pages = max(1, -(-total // limit))
    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Total-Pages"] = str(pages)
    response.headers["X-Page"] = str(page)
    return {
        "count": total,
        "entries": entries,
        "restorable_entity_types": sorted(_RESTORABLE_ENTITIES.keys()),
    }


@router.post("/admin/audit-trail/{log_id}/restore")
async def restore_from_audit_trail(log_id: str, request: Request):
    """
    Restore a soft-deleted entity referenced by an audit log entry.
    Admin only. Idempotent failure if the entry was already restored or the
    underlying record no longer exists.
    """
    user = await require_roles(UserRole.ADMIN)(request)

    log = await db.audit_logs.find_one({"log_id": log_id}, {"_id": 0})
    if not log:
        raise HTTPException(status_code=404, detail="Audit log entry not found")
    if log.get("action") != "deactivate":
        raise HTTPException(status_code=400, detail="Only deactivate entries can be restored")
    if log.get("restored_at"):
        raise HTTPException(status_code=400, detail="Entry already restored")

    entity_type = log.get("entity_type")
    mapping = _RESTORABLE_ENTITIES.get(entity_type)
    if not mapping:
        raise HTTPException(
            status_code=400,
            detail=f"Restore not supported for entity_type '{entity_type}'",
        )
    collection_name, id_field = mapping
    entity_id = log["entity_id"]

    doc = await db[collection_name].find_one({id_field: entity_id}, {"_id": 0})
    if not doc:
        raise HTTPException(
            status_code=404,
            detail=f"{entity_type} '{entity_id}' no longer exists — cannot restore",
        )
    if doc.get("is_active", True):
        # Already active — mark log as restored anyway so it stops cluttering the list
        await db.audit_logs.update_one(
            {"log_id": log_id},
            {"$set": {
                "restored_at": datetime.now(timezone.utc).isoformat(),
                "restored_by": user["user_id"],
                "restored_by_name": user.get("name", ""),
            }},
        )
        return {"message": f"{entity_type} was already active", "entity_id": entity_id}

    update_doc = {
        "is_active": True,
        "restored_at": datetime.now(timezone.utc).isoformat(),
        "restored_by": user["user_id"],
    }
    # Mirror the un-deactivation: clear the deactivation marker so it doesn't look stale.
    unset_doc = {"deactivated_at": "", "deleted_at": "", "deleted_by": ""}
    await db[collection_name].update_one(
        {id_field: entity_id},
        {"$set": update_doc, "$unset": unset_doc},
    )

    # For student/employee, the linked user account was also deactivated — re-enable it.
    if entity_type == "student":
        if doc.get("email"):
            await db.users.update_one(
                {"email": doc["email"], "role": "student"},
                {"$set": {"is_active": True}},
            )
        if doc.get("user_id"):
            await db.users.update_one(
                {"user_id": doc["user_id"]},
                {"$set": {"is_active": True}},
            )
    elif entity_type == "employee":
        if doc.get("user_id"):
            await db.users.update_one(
                {"user_id": doc["user_id"]},
                {"$set": {"is_active": True}},
            )

    await db.audit_logs.update_one(
        {"log_id": log_id},
        {"$set": {
            "restored_at": datetime.now(timezone.utc).isoformat(),
            "restored_by": user["user_id"],
            "restored_by_name": user.get("name", ""),
        }},
    )
    await create_audit_log(
        entity_type, entity_id, "restore",
        {"original_log_id": log_id},
        user,
    )
    return {
        "message": f"{entity_type} restored",
        "entity_type": entity_type,
        "entity_id": entity_id,
    }
