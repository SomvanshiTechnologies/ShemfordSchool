from fastapi import APIRouter, HTTPException, Request
import os
import logging

from database import db
from models import UserRole
from auth_utils import (
    get_current_user, require_roles, hash_password, verify_password,
    create_audit_log, revoke_all_refresh_tokens
)

router = APIRouter()
logger = logging.getLogger(__name__)

_DEFAULT_PROFILE = {
    "school_name": "Shemford Futuristic School",
    "address": "",
    "city": "",
    "state": "",
    "pincode": "",
    "phone": "",
    "email": "",
    "website": "",
    "affiliation_number": "",
    "principal_name": "",
}


@router.get("/settings/school")
async def get_school_profile(request: Request):
    await get_current_user(request)
    doc = await db.school_settings.find_one({"_id": "profile"}, {"_id": 0})
    return doc or _DEFAULT_PROFILE


@router.put("/settings/school")
async def update_school_profile(request: Request):
    admin = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    allowed = {
        "school_name", "address", "city", "state", "pincode",
        "phone", "email", "website", "affiliation_number", "principal_name",
    }
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields provided")

    await db.school_settings.update_one(
        {"_id": "profile"},
        {"$set": updates},
        upsert=True,
    )
    await create_audit_log("school_settings", "profile", "update", updates, admin)
    doc = await db.school_settings.find_one({"_id": "profile"}, {"_id": 0})
    return doc


def _computed_session() -> str:
    """Academic year by calendar: Apr–Mar. e.g. 2025-2026."""
    from datetime import datetime
    now = datetime.now()
    return f"{now.year}-{now.year + 1}" if now.month >= 4 else f"{now.year - 1}-{now.year}"


import re as _re
import uuid as _uuid
from datetime import datetime as _dt, timezone as _tz
_SESSION_RE = _re.compile(r"^\d{4}-\d{4}$")


def _validate_session_name(name: str) -> str:
    name = (name or "").strip()
    if not _SESSION_RE.match(name):
        raise HTTPException(status_code=400, detail="Session name must be YYYY-YYYY, e.g. 2025-2026")
    a, b = name.split("-")
    if int(b) != int(a) + 1:
        raise HTTPException(status_code=400, detail="Session years must be consecutive, e.g. 2025-2026")
    return name


def _derive_status(name: str, is_active: bool, explicit: str = None) -> str:
    """active if flagged; else explicit override, else by date window."""
    if is_active:
        return "active"
    if explicit in ("archived", "upcoming"):
        return explicit
    today = _dt.now().date().isoformat()
    try:
        start_year = int(name.split("-")[0])
        end = f"{start_year + 1}-03-31"
        return "archived" if end < today else "upcoming"
    except (ValueError, IndexError):
        return "archived"


async def _ensure_sessions_seeded():
    """
    Bootstrap the sessions collection (idempotent) from existing data so the
    new CRUD system has rows without a migration. Picks up every academic_year
    present in students/ledger + the previously-stored active session.
    """
    if await db.sessions.count_documents({}) > 0:
        return
    found = set()
    for coll in (db.students, db.student_ledger):
        for y in await coll.distinct("academic_year"):
            if y and _SESSION_RE.match(str(y)):
                found.add(str(y))
    legacy = await db.school_settings.find_one({"_id": "session"}, {"_id": 0})
    active = (legacy or {}).get("active_session") or _computed_session()
    found.add(active)
    found.add(_computed_session())

    now_iso = _dt.now(_tz.utc).isoformat()
    docs = []
    for name in sorted(found):
        sy = int(name.split("-")[0])
        is_active = (name == active)
        docs.append({
            "session_id": f"sess_{_uuid.uuid4().hex[:12]}",
            "session_name": name,
            "start_date": f"{sy}-04-01",
            "end_date": f"{sy + 1}-03-31",
            "status": _derive_status(name, is_active),
            "is_active": is_active,
            "created_at": now_iso,
            "updated_at": now_iso,
        })
    if docs:
        await db.sessions.insert_many(docs)


async def _active_session_name() -> str:
    """The active session's name, with safe fallbacks."""
    doc = await db.sessions.find_one({"is_active": True}, {"_id": 0, "session_name": 1})
    if doc:
        return doc["session_name"]
    legacy = await db.school_settings.find_one({"_id": "session"}, {"_id": 0})
    return (legacy or {}).get("active_session") or _computed_session()


# ─── Sessions CRUD (Phase 1) ──────────────────────────────────────────────────

@router.get("/sessions")
async def list_sessions(request: Request):
    """All sessions, newest first. Any logged-in user may read."""
    await get_current_user(request)
    await _ensure_sessions_seeded()
    sessions = await db.sessions.find({}, {"_id": 0}).sort("session_name", -1).to_list(200)
    return sessions


@router.post("/sessions")
async def create_session(request: Request):
    """Admin: create a new academic session (inactive by default)."""
    admin = await require_roles(UserRole.ADMIN)(request)
    await _ensure_sessions_seeded()
    body = await request.json()
    name = _validate_session_name(body.get("session_name"))
    if await db.sessions.find_one({"session_name": name}, {"_id": 0, "session_id": 1}):
        raise HTTPException(status_code=409, detail=f"Session {name} already exists")
    sy = int(name.split("-")[0])
    # Block creating a FUTURE academic year while the current session is still
    # running — the admin must end (archive) the active session first. Past /
    # backfill years are always allowed.
    active = await db.sessions.find_one({"is_active": True}, {"_id": 0, "session_name": 1})
    if active:
        active_start = int(active["session_name"].split("-")[0])
        if sy > active_start:
            raise HTTPException(
                status_code=400,
                detail=f"End the current session ({active['session_name']}) before creating {name}.",
            )
    now_iso = _dt.now(_tz.utc).isoformat()
    doc = {
        "session_id": f"sess_{_uuid.uuid4().hex[:12]}",
        "session_name": name,
        "start_date": body.get("start_date") or f"{sy}-04-01",
        "end_date": body.get("end_date") or f"{sy + 1}-03-31",
        "status": _derive_status(name, False, body.get("status")),
        "is_active": False,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.sessions.insert_one(doc)
    await create_audit_log("session", doc["session_id"], "create", {"session_name": name}, admin)
    doc.pop("_id", None)
    return doc


@router.put("/sessions/{session_id}")
async def update_session(session_id: str, request: Request):
    """Admin: edit a session's dates / name / status."""
    admin = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()
    sess = await db.sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    update = {}
    if "session_name" in body:
        name = _validate_session_name(body["session_name"])
        clash = await db.sessions.find_one(
            {"session_name": name, "session_id": {"$ne": session_id}}, {"_id": 0, "session_id": 1}
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"Session {name} already exists")
        update["session_name"] = name
    if "start_date" in body:
        update["start_date"] = body["start_date"]
    if "end_date" in body:
        update["end_date"] = body["end_date"]
    if body.get("status") in ("archived", "upcoming") and not sess.get("is_active"):
        update["status"] = body["status"]
    if not update:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    update["updated_at"] = _dt.now(_tz.utc).isoformat()
    await db.sessions.update_one({"session_id": session_id}, {"$set": update})
    await create_audit_log("session", session_id, "update", update, admin)
    return await db.sessions.find_one({"session_id": session_id}, {"_id": 0})


@router.post("/sessions/{session_id}/activate")
async def activate_session(session_id: str, request: Request):
    """Admin: make this the active session; the previous active becomes inactive."""
    admin = await require_roles(UserRole.ADMIN)(request)
    sess = await db.sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")

    now_iso = _dt.now(_tz.utc).isoformat()
    # Demote whatever is currently active (back to archived/upcoming by date).
    async for cur in db.sessions.find({"is_active": True}, {"_id": 0, "session_id": 1, "session_name": 1}):
        await db.sessions.update_one(
            {"session_id": cur["session_id"]},
            {"$set": {"is_active": False, "status": _derive_status(cur["session_name"], False), "updated_at": now_iso}},
        )
    # Promote the chosen one.
    await db.sessions.update_one(
        {"session_id": session_id},
        {"$set": {"is_active": True, "status": "active", "updated_at": now_iso}},
    )
    # Keep legacy school_settings in sync for any code still reading it.
    await db.school_settings.update_one(
        {"_id": "session"}, {"$set": {"active_session": sess["session_name"]}}, upsert=True
    )
    await create_audit_log("session", session_id, "activate", {"session_name": sess["session_name"]}, admin)
    return {"active_session": sess["session_name"], "session_id": session_id}


@router.post("/sessions/{session_id}/archive")
async def archive_session(session_id: str, request: Request):
    """Admin: archive (read-only) or reopen a session. Body: {archived: bool}."""
    admin = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()
    archived = body.get("archived", True)
    sess = await db.sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    new_status = "archived" if archived else _derive_status(sess["session_name"], False, "upcoming")
    update = {"status": new_status, "updated_at": _dt.now(_tz.utc).isoformat()}
    # Ending (archiving) the active session clears its active flag — this is the
    # admin's way to close the current academic year so the next one can be
    # created. (Activating a session later restores a single active session.)
    if sess.get("is_active") and archived:
        update["is_active"] = False
    await db.sessions.update_one(
        {"session_id": session_id},
        {"$set": update},
    )
    await create_audit_log("session", session_id, "archive" if archived else "reopen",
                           {"session_name": sess["session_name"]}, admin)
    return await db.sessions.find_one({"session_id": session_id}, {"_id": 0})


# ─── Backward-compatible session endpoints (used by SessionContext) ───────────

@router.get("/settings/session")
async def get_active_session(request: Request):
    """Active session + available session names. Backed by the sessions collection."""
    await get_current_user(request)
    await _ensure_sessions_seeded()
    sessions = await db.sessions.find({}, {"_id": 0}).sort("session_name", -1).to_list(200)
    active = next((s["session_name"] for s in sessions if s.get("is_active")), None) or await _active_session_name()
    return {
        "active_session": active,
        "available_sessions": [s["session_name"] for s in sessions],
        "sessions": sessions,
    }


@router.put("/settings/session")
async def set_active_session(request: Request):
    """Admin: set active session by name (creates the session row if missing)."""
    admin = await require_roles(UserRole.ADMIN)(request)
    await _ensure_sessions_seeded()
    body = await request.json()
    name = _validate_session_name(body.get("active_session"))
    sess = await db.sessions.find_one({"session_name": name}, {"_id": 0})
    if not sess:
        sy = int(name.split("-")[0])
        now_iso = _dt.now(_tz.utc).isoformat()
        sess = {
            "session_id": f"sess_{_uuid.uuid4().hex[:12]}",
            "session_name": name,
            "start_date": f"{sy}-04-01", "end_date": f"{sy + 1}-03-31",
            "status": "active", "is_active": False,
            "created_at": now_iso, "updated_at": now_iso,
        }
        await db.sessions.insert_one(sess)
    # Reuse activate logic
    now_iso = _dt.now(_tz.utc).isoformat()
    await db.sessions.update_many({"is_active": True}, {"$set": {"is_active": False, "updated_at": now_iso}})
    for s in await db.sessions.find({"is_active": False}, {"_id": 0, "session_id": 1, "session_name": 1}).to_list(200):
        if s["session_name"] != name:
            await db.sessions.update_one({"session_id": s["session_id"]},
                {"$set": {"status": _derive_status(s["session_name"], False)}})
    await db.sessions.update_one({"session_name": name},
        {"$set": {"is_active": True, "status": "active", "updated_at": now_iso}})
    await db.school_settings.update_one({"_id": "session"}, {"$set": {"active_session": name}}, upsert=True)
    await create_audit_log("school_settings", "session", "update", {"active_session": name}, admin)
    return {"active_session": name}


@router.get("/settings/system")
async def get_system_status(request: Request):
    await require_roles(UserRole.ADMIN)(request)
    return {
        "stripe_configured": bool(os.environ.get("STRIPE_API_KEY")),
        "email_configured": bool(os.environ.get("RESEND_API_KEY")),
        "oauth_configured": bool(os.environ.get("OAUTH_SESSION_URL")),
    }


@router.put("/settings/change-password")
async def change_password(request: Request):
    user = await get_current_user(request)
    body = await request.json()

    current_password = body.get("current_password")
    new_password = body.get("new_password")

    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="current_password and new_password are required")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    full_user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not verify_password(current_password, full_user.get("password_hash", "")):
        logger.warning("Failed password change attempt for user %s", user["user_id"])
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": hash_password(new_password)}}
    )
    # Invalidate all refresh tokens — force re-login on all devices
    await revoke_all_refresh_tokens(user["user_id"])
    await create_audit_log("user", user["user_id"], "password_change", {}, user)
    logger.info("Password changed and all tokens revoked for user %s", user["user_id"])
    return {"message": "Password changed successfully"}
