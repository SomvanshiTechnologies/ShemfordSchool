"""
Shemford Futuristic School — Auth Utilities

Security standards:
- Passwords hashed with bcrypt (cost factor 12)
- JWT HS256, 24-hour expiry
- Atomic admission number generation (no race condition)
- No plaintext passwords stored
- All critical actions audit-logged
"""
import bcrypt
import jwt
import os
import uuid
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
JWT_EXPIRATION_HOURS = 24


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


# ─── JWT utilities ─────────────────────────────────────────────────────────────

def create_jwt_token(user_id: str, role: str) -> str:
    payload = {
        "user_id": user_id,
        "role": role,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS),
        "jti": uuid.uuid4().hex,  # unique token ID for revocation support
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")


# ─── Current user extraction ───────────────────────────────────────────────────

async def get_current_user(request: Request) -> dict:
    """
    Extract and validate the current user from:
    1. session_token cookie (OAuth / web sessions)
    2. Authorization: Bearer <jwt> header (API / mobile)
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
