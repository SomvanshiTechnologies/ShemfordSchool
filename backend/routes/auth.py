from fastapi import APIRouter, HTTPException, Request, Response
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import httpx
import secrets
import os
import logging

from database import db
from models import (
    UserRole, UserBase, UserCreate, UserLogin, UserResponse, PasswordReset
)
from auth_utils import (
    hash_password, verify_password, create_jwt_token, get_current_user,
    require_roles, create_audit_log
)

logger = logging.getLogger(__name__)

OAUTH_SESSION_URL = os.environ.get(
    "OAUTH_SESSION_URL",
    "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
)
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "notifications@shemford.edu")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")


async def _send_password_reset_email(email: str, token: str, user_name: str) -> bool:
    """
    Send a password reset email via Resend.
    Returns True on success, False if RESEND_API_KEY is not configured.
    Logs but never raises — caller should not fail if email delivery fails.
    """
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — password reset email not sent for %s", email)
        return False

    reset_url = f"{FRONTEND_URL}/login?reset_token={token}"
    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #1A1A1A; margin-bottom: 8px;">Password Reset</h2>
      <p style="color: #555; margin-bottom: 24px;">Hi {user_name},</p>
      <p style="color: #555;">We received a request to reset your password for your Shemford School account.
         Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
      <a href="{reset_url}"
         style="display:inline-block;margin:24px 0;padding:12px 28px;background:#E88A1A;
                color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">
        Reset Password
      </a>
      <p style="color:#888;font-size:13px;">
        If you didn't request a password reset, you can safely ignore this email.
        Your password will not change.
      </p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
      <p style="color:#aaa;font-size:12px;">Shemford Futuristic School</p>
    </div>
    """
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from": f"Shemford School <{SENDER_EMAIL}>",
            "to": [email],
            "subject": "Reset your Shemford School password",
            "html": html_body,
        })
        logger.info("Password reset email sent to %s", email)
        return True
    except Exception as exc:
        logger.error("Failed to send password reset email to %s: %s", email, exc)
        return False

router = APIRouter()


@router.post("/auth/register")
async def register_user(user: UserCreate):
    existing = await db.users.find_one({"email": user.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    allowed_public_role = UserRole.PARENT
    if user.role != allowed_public_role:
        raise HTTPException(
            status_code=403,
            detail=f"Public registration is only available for parent accounts. Contact school admin for {user.role} accounts."
        )

    if len(user.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user_obj = UserBase(email=user.email, name=user.name, role=allowed_public_role, phone=user.phone)
    user_dict = user_obj.model_dump()
    user_dict["password_hash"] = hash_password(user.password)
    user_dict["created_at"] = user_dict["created_at"].isoformat()

    await db.users.insert_one(user_dict)
    user_dict.pop("_id", None)

    token = create_jwt_token(user_obj.user_id, allowed_public_role)
    return {"token": token, "user": UserResponse(**user_obj.model_dump()).model_dump()}


@router.post("/auth/create-user")
async def admin_create_user(user: UserCreate, request: Request):
    await require_roles(UserRole.ADMIN)(request)
    existing = await db.users.find_one({"email": user.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    valid_roles = [UserRole.ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT, UserRole.ACCOUNTANT]
    if user.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}")

    if len(user.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user_obj = UserBase(email=user.email, name=user.name, role=user.role, phone=user.phone)
    user_dict = user_obj.model_dump()
    user_dict["password_hash"] = hash_password(user.password)
    user_dict["created_at"] = user_dict["created_at"].isoformat()

    await db.users.insert_one(user_dict)
    user_dict.pop("_id", None)

    return {"message": "User created successfully", "user": UserResponse(**user_obj.model_dump()).model_dump()}


_RESET_MAX_ATTEMPTS = 3
_RESET_WINDOW_SECONDS = 60 * 60  # 1 hour


@router.post("/auth/login")
async def login_user(credentials: UserLogin):
    email = credentials.email

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(credentials.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account is deactivated")

    # Update last_login (#28)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"last_login": now_iso}})
    user["last_login"] = now_iso

    token = create_jwt_token(user["user_id"], user["role"])

    if isinstance(user.get("created_at"), str):
        user["created_at"] = datetime.fromisoformat(user["created_at"])

    return {"token": token, "user": UserResponse(**user).model_dump()}


@router.post("/auth/session")
async def exchange_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")

    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    async with httpx.AsyncClient() as client_http:
        auth_response = await client_http.get(
            OAUTH_SESSION_URL,
            headers={"X-Session-ID": session_id}
        )
        if auth_response.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session")
        session_data = auth_response.json()

    user = await db.users.find_one({"email": session_data["email"]}, {"_id": 0})

    if not user:
        user_obj = UserBase(
            email=session_data["email"],
            name=session_data["name"],
            role=UserRole.PARENT,
            picture=session_data.get("picture")
        )
        user_dict = user_obj.model_dump()
        user_dict["created_at"] = user_dict["created_at"].isoformat()
        await db.users.insert_one(user_dict)
        user = user_dict
    else:
        if session_data.get("picture") and user.get("picture") != session_data["picture"]:
            await db.users.update_one(
                {"user_id": user["user_id"]},
                {"$set": {"picture": session_data["picture"]}}
            )
            user["picture"] = session_data["picture"]

    session_token = session_data["session_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)

    await db.user_sessions.insert_one({
        "user_id": user["user_id"],
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat()
    })

    response.set_cookie(
        key="session_token", value=session_token,
        httponly=True, secure=True, samesite="none", path="/", max_age=7*24*60*60
    )

    # Update last_login (#28)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"last_login": now_iso}})
    user["last_login"] = now_iso

    if isinstance(user.get("created_at"), str):
        user["created_at"] = datetime.fromisoformat(user["created_at"])

    return {"user": UserResponse(**user).model_dump()}


@router.get("/auth/me")
async def get_current_user_info(request: Request):
    user = await get_current_user(request)
    if isinstance(user.get("created_at"), str):
        user["created_at"] = datetime.fromisoformat(user["created_at"])
    return UserResponse(**user).model_dump()


@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/", secure=True, samesite="none")
    return {"message": "Logged out successfully"}


# ==================== PASSWORD RESET ====================

@router.post("/auth/forgot-password")
async def forgot_password(request: Request):
    body = await request.json()
    email = body.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    # ── Rate limit: max 3 reset requests per email per hour ──────────────────
    attempt_doc = await db.reset_attempts.find_one({"email": email}, {"_id": 0})
    if attempt_doc:
        window_start = datetime.now(timezone.utc) - timedelta(seconds=_RESET_WINDOW_SECONDS)
        last_attempt = attempt_doc.get("last_attempt")
        if isinstance(last_attempt, str):
            last_attempt = datetime.fromisoformat(last_attempt)
        if last_attempt and last_attempt > window_start:
            if attempt_doc.get("attempts", 0) >= _RESET_MAX_ATTEMPTS:
                raise HTTPException(
                    status_code=429,
                    detail="Too many password reset requests. Try again in 1 hour.",
                    headers={"Retry-After": "3600"}
                )
    await db.reset_attempts.update_one(
        {"email": email},
        {"$inc": {"attempts": 1}, "$set": {"last_attempt": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        # Don't reveal whether email exists
        return {"message": "If that email exists, a password reset link has been sent."}

    token = secrets.token_urlsafe(32)
    reset = PasswordReset(
        user_id=user["user_id"],
        email=email,
        token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
    )
    reset_dict = reset.model_dump()
    reset_dict["created_at"] = reset_dict["created_at"].isoformat()
    reset_dict["expires_at"] = reset_dict["expires_at"].isoformat()

    await db.password_resets.insert_one(reset_dict)

    await _send_password_reset_email(email, token, user.get("name", "User"))

    return {"message": "If that email exists, a password reset link has been sent."}


@router.post("/auth/reset-password")
async def reset_password(request: Request):
    body = await request.json()
    token = body.get("token")
    new_password = body.get("new_password")

    if not token or not new_password:
        raise HTTPException(status_code=400, detail="Token and new_password are required")

    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    reset = await db.password_resets.find_one({"token": token, "used": False}, {"_id": 0})
    if not reset:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    expires_at = reset["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Reset token has expired")

    await db.users.update_one(
        {"user_id": reset["user_id"]},
        {"$set": {"password_hash": hash_password(new_password)}}
    )

    await db.password_resets.update_one({"token": token}, {"$set": {"used": True}})
    await db.reset_attempts.delete_one({"email": reset["email"]})

    return {"message": "Password has been reset successfully. Please login with your new password."}


@router.put("/auth/change-password")
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
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": hash_password(new_password)}}
    )

    return {"message": "Password changed successfully"}


# ==================== USER MANAGEMENT ====================

@router.get("/users")
async def get_users(request: Request, role: Optional[str] = None):
    await require_roles(UserRole.ADMIN)(request)
    query = {}
    if role:
        query["role"] = role
    users = await db.users.find(query, {"_id": 0, "password_hash": 0}).to_list(1000)
    for u in users:
        if isinstance(u.get("created_at"), str):
            u["created_at"] = datetime.fromisoformat(u["created_at"])
    return [UserResponse(**u).model_dump() for u in users]


@router.put("/users/{user_id}")
async def update_user(user_id: str, request: Request):
    current_user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    if user_id == current_user["user_id"] and "role" in body:
        del body["role"]

    if body:
        await db.users.update_one({"user_id": user_id}, {"$set": body})

    updated = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if isinstance(updated.get("created_at"), str):
        updated["created_at"] = datetime.fromisoformat(updated["created_at"])
    return UserResponse(**updated)


@router.put("/users/{user_id}/role")
async def update_user_role(user_id: str, request: Request):
    await require_roles(UserRole.ADMIN)(request)
    body = await request.json()
    new_role = body.get("role")

    if new_role not in [UserRole.ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=400, detail="Invalid role")

    await db.users.update_one({"user_id": user_id}, {"$set": {"role": new_role}})
    return {"message": "Role updated"}


@router.get("/users/search")
async def search_users(request: Request, q: Optional[str] = None, role: Optional[str] = None):
    await get_current_user(request)
    query = {"is_active": True}
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}}
        ]
    if role:
        query["role"] = role

    users = await db.users.find(query, {"_id": 0, "password_hash": 0}).to_list(50)
    return [{"user_id": u["user_id"], "name": u["name"], "email": u["email"], "role": u["role"]} for u in users]
