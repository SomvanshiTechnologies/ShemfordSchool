"""
Shemford Futuristic School — Auth Utilities

Security standards:
- Passwords hashed with bcrypt (cost factor 12)
- JWT HS256 access tokens (configurable expiry, default 15 min)
- Refresh tokens: opaque 256-bit random token, stored in DB, rotate on use
- JTI blocklist: revoked access tokens stored in DB with TTL index
- Atomic admission number generation (no race condition)
- No plaintext passwords stored
- All critical actions audit-logged
"""
import bcrypt
import jwt
import os
import uuid
import secrets
import logging
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Request
from database import db
from models import UserRole, AuditLog

logger = logging.getLogger(__name__)

JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable is required and must not be empty")

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = int(os.environ.get("ACCESS_TOKEN_MINUTES", "15"))
REFRESH_TOKEN_DAYS = int(os.environ.get("REFRESH_TOKEN_DAYS", "30"))


# ─── Password utilities ────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Hash password with bcrypt cost factor 12."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against its bcrypt hash."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ─── Access token (JWT) utilities ──────────────────────────────────────────────

def create_jwt_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "user_id": user_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        "jti": uuid.uuid4().hex,  # unique token ID for revocation
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")


# ─── Refresh token utilities ───────────────────────────────────────────────────

async def create_refresh_token_db(user_id: str, role: str) -> str:
    """
    Generate a new opaque refresh token, persist to DB, and return the raw token.
    Old un-revoked tokens for the same user are left intact (multi-device support).
    """
    token = secrets.token_urlsafe(48)  # 48 bytes → 64-char URL-safe string
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS)
    await db.refresh_tokens.insert_one({
        "token": token,
        "user_id": user_id,
        "role": role,
        "is_revoked": False,
        "created_at": datetime.now(timezone.utc),
        "expires_at": expires_at,   # BSON date — TTL index will auto-clean
    })
    return token


async def verify_refresh_token(token: str) -> dict:
    """
    Validate a refresh token.
    Returns the stored document on success.
    Raises 401 if invalid, revoked, or expired.
    """
    doc = await db.refresh_tokens.find_one({"token": token, "is_revoked": False}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token.")
    expires_at = doc.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token has expired. Please log in again.")
    return doc


async def revoke_refresh_token(token: str) -> None:
    """Mark a single refresh token as revoked."""
    await db.refresh_tokens.update_one({"token": token}, {"$set": {"is_revoked": True}})


async def revoke_all_refresh_tokens(user_id: str) -> None:
    """Revoke all refresh tokens for a user (e.g., on password change or admin action)."""
    await db.refresh_tokens.update_many(
        {"user_id": user_id, "is_revoked": False},
        {"$set": {"is_revoked": True}}
    )


# ─── JTI blocklist (revoked access tokens) ────────────────────────────────────

async def revoke_jti(jti: str, expires_at: datetime) -> None:
    """
    Add a JTI to the blocklist until its natural expiry.
    TTL index on the collection automatically removes the document after expiry.
    Idempotent — inserting a duplicate JTI is silently ignored.
    """
    try:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        await db.jti_blocklist.insert_one({
            "jti": jti,
            "expires_at": expires_at,   # BSON date for TTL index
        })
    except Exception:
        # DuplicateKeyError means it was already revoked — safe to ignore
        pass


async def is_jti_revoked(jti: str) -> bool:
    """Return True if the JTI is present in the blocklist."""
    doc = await db.jti_blocklist.find_one({"jti": jti}, {"_id": 1})
    return doc is not None


# ─── Current user extraction ───────────────────────────────────────────────────

async def get_current_user(request: Request) -> dict:
    """
    Extract and validate the current user from:
    1. session_token cookie (OAuth / web sessions)
    2. Authorization: Bearer <jwt> header (API / mobile)

    For JWT tokens: also checks the JTI blocklist so revoked tokens
    (e.g., from logout) are rejected even within their validity window.
    """
    token = request.cookies.get("session_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

    if not token:
        raise HTTPException(status_code=401, detail="Authentication required.")

    # Try session-token lookup first (OAuth flow)
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if session:
        expires_at = session.get("expires_at")
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
        user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User account not found.")
        if not user.get("is_active", True):
            raise HTTPException(status_code=403, detail="Account is deactivated. Contact admin.")
        return user

    # Fall back to JWT
    payload = decode_jwt_token(token)

    # Check JTI blocklist — catches tokens invalidated by logout before expiry
    jti = payload.get("jti")
    if jti and await is_jti_revoked(jti):
        raise HTTPException(status_code=401, detail="Token has been revoked. Please log in again.")

    user = await db.users.find_one({"user_id": payload["user_id"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User account not found.")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account is deactivated. Contact admin.")
    return user


# ─── Role-based access control ────────────────────────────────────────────────

def require_roles(*roles):
    """
    FastAPI dependency that validates the caller has one of the specified roles.
    Usage: user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    """
    async def role_checker(request: Request):
        user = await get_current_user(request)
        if user["role"] not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Required role(s): {', '.join(roles)}. Your role: {user['role']}"
            )
        return user
    return role_checker


# ─── Academic utilities ────────────────────────────────────────────────────────

def calculate_grade(percentage: float) -> str:
    """CBSE grading scale."""
    if percentage >= 91: return "A1"
    if percentage >= 81: return "A2"
    if percentage >= 71: return "B1"
    if percentage >= 61: return "B2"
    if percentage >= 51: return "C1"
    if percentage >= 41: return "C2"
    if percentage >= 33: return "D"
    return "E"


# ─── Atomic admission number generation ───────────────────────────────────────

async def generate_admission_number() -> str:
    """
    Generate a sequential, collision-free admission number.
    Format: SFS2025/0001
    Uses MongoDB atomic findAndModify (find_one_and_update) for safety.
    """
    year = datetime.now().year
    counter_key = f"admission_{year}"
    counter = await db.counters.find_one_and_update(
        {"_id": counter_key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    seq = counter["seq"]
    return f"SFS{year}/{seq:04d}"


# ─── Audit logging ─────────────────────────────────────────────────────────────

async def create_audit_log(
    entity_type: str,
    entity_id: str,
    action: str,
    changes: dict,
    user: dict
):
    """
    Write an immutable audit log entry.
    Never raises — failures are logged but do not break the main operation.
    """
    try:
        log = AuditLog(
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            changes=changes,
            performed_by=user["user_id"],
            performed_by_name=user.get("name", ""),
        )
        log_dict = log.model_dump()
        log_dict["created_at"] = log_dict["created_at"].isoformat()
        await db.audit_logs.insert_one(log_dict)
    except Exception as e:
        logger.error(f"Audit log write failed for {entity_type}/{entity_id}/{action}: {e}")


def get_rid(request: Request) -> str:
    """Return the request correlation ID attached by the middleware, or '-' if absent."""
    return getattr(request.state, "request_id", "-")


async def get_teacher_assigned_classes(user_id: str) -> list:
    """
    Return [{class_name, section}] for a teacher based on class_structures assignment.
    Returns empty list if no assignment found (caller should fall back to permissive mode).
    """
    employee = await db.employees.find_one(
        {"user_id": user_id, "is_active": True},
        {"_id": 0, "employee_id": 1}
    )
    if not employee:
        return []
    emp_id = employee["employee_id"]
    classes = await db.class_structures.find(
        {"is_active": True},
        {"_id": 0, "name": 1, "sections": 1}
    ).to_list(100)
    assigned = []
    for cls in classes:
        for sec in cls.get("sections", []):
            if sec.get("class_teacher_id") == emp_id:
                assigned.append({"class_name": cls["name"], "section": sec["section_name"]})
    return assigned
