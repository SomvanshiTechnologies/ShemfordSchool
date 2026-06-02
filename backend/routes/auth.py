from fastapi import APIRouter, HTTPException, Request, Response
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import httpx
import secrets
import os
import logging
import re

from database import db
from models import (
    UserRole, UserBase, UserCreate, UserLogin, UserResponse, PasswordReset
)
from auth_utils import (
    hash_password, verify_password, create_jwt_token, decode_jwt_token,
    get_current_user, require_roles, create_audit_log,
    create_refresh_token_db, verify_refresh_token,
    revoke_refresh_token, revoke_all_refresh_tokens, revoke_jti, session_window,
)

def _system_actor(user_id: str, name: str = "system") -> dict:
    """Minimal user dict for audit logs that don't have a session user."""
    return {"user_id": user_id, "name": name}

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
    user.email = (user.email or "").strip().lower()
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
    refresh_token = await create_refresh_token_db(user_obj.user_id, allowed_public_role)
    return {
        "token": token,
        "refresh_token": refresh_token,
        "user": UserResponse(**user_obj.model_dump()).model_dump(),
    }


@router.post("/auth/create-user")
async def admin_create_user(user: UserCreate, request: Request):
    admin = await require_roles(UserRole.ADMIN)(request)
    user.email = (user.email or "").strip().lower()
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

    await create_audit_log("user", user_obj.user_id, "admin_create",
                           {"email": user.email, "role": user.role, "name": user.name}, admin)
    logger.info("Admin %s created user %s (role=%s)", admin["user_id"], user_obj.user_id, user.role)

    return {"message": "User created successfully", "user": UserResponse(**user_obj.model_dump()).model_dump()}


_RESET_MAX_ATTEMPTS = 3
_RESET_WINDOW_SECONDS = 60 * 60  # 1 hour


@router.post("/auth/login")
async def login_user(credentials: UserLogin):
    # Normalise email: trim whitespace, lowercase so that typing variations
    # ("  student@shemford.edu" / "Student@Shemford.edu") still match the
    # stored record. Emails are always stored lowercased by our seed/register
    # flows, but real users and autocorrect frequently add case or spaces.
    identifier = (credentials.email or "").strip()

    # Resolve the account by any of: email, student admission number, or
    # employee ID. Students log in with their admission number, employees with
    # their employee ID (both linked to a users account via user_id).
    user = await db.users.find_one({"email": identifier.lower()}, {"_id": 0})
    if not user:
        stu = await db.students.find_one(
            {"admission_number": {"$regex": f"^{re.escape(identifier)}$", "$options": "i"}},
            {"_id": 0, "user_id": 1},
        )
        if stu and stu.get("user_id"):
            user = await db.users.find_one({"user_id": stu["user_id"]}, {"_id": 0})
    if not user:
        emp = await db.employees.find_one(
            {"employee_id": {"$regex": f"^{re.escape(identifier)}$", "$options": "i"}},
            {"_id": 0, "user_id": 1},
        )
        if emp and emp.get("user_id"):
            user = await db.users.find_one({"user_id": emp["user_id"]}, {"_id": 0})

    if not user or not verify_password(credentials.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.get("is_active", True):
        # Check if this is a deletion-pending account so the frontend can show the revoke option
        del_req = await db.account_deletion_requests.find_one(
            {"user_id": user["user_id"], "status": {"$in": ["pending", "revoke_pending", "approved"]}},
            {"_id": 0, "request_id": 1, "status": 1, "expires_at": 1, "final_deletion_at": 1},
            sort=[("requested_at", -1)],
        )
        if del_req:
            import json as _json
            # Choose the relevant expiry window for display
            expires = (del_req.get("final_deletion_at") if del_req["status"] == "approved"
                       else del_req.get("expires_at"))
            raise HTTPException(status_code=403, detail=_json.dumps({
                "code": "DELETION_PENDING",
                "request_id": del_req["request_id"],
                "request_status": del_req["status"],
                "expires_at": expires,
            }))
        raise HTTPException(status_code=403, detail="Account is deactivated")

    # Block web login for students whose admin has restricted them to app-only
    if credentials.platform == "web" and user.get("role") == "student":
        stu = await db.students.find_one({"user_id": user["user_id"]}, {"_id": 0, "web_login_enabled": 1})
        if stu and stu.get("web_login_enabled") is False:
            raise HTTPException(
                status_code=403,
                detail="APP_ONLY_LOGIN"
            )

    # Update last_login (#28)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"last_login": now_iso}})
    user["last_login"] = now_iso

    token = create_jwt_token(user["user_id"], user["role"])
    refresh_token = await create_refresh_token_db(user["user_id"], user["role"])

    if isinstance(user.get("created_at"), str):
        user["created_at"] = datetime.fromisoformat(user["created_at"])

    return {
        "token": token,
        "refresh_token": refresh_token,
        "user": UserResponse(**user).model_dump(),
    }


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


@router.put("/auth/me")
async def update_current_user_info(request: Request):
    """Logged-in user updates their own profile fields (name, phone, picture, email).
    Setting an email lets the user log in with it; their admission/employee ID still
    works as a fallback. Role is NOT editable here — that requires admin action."""
    user = await get_current_user(request)
    body = await request.json()

    updates = {}
    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty.")
        updates["name"] = name
    if "phone" in body:
        updates["phone"] = (body.get("phone") or "").strip() or None
    if "picture" in body:
        updates["picture"] = body.get("picture") or None
    if "email" in body:
        email = (body.get("email") or "").strip().lower()
        if email:
            if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
                raise HTTPException(status_code=400, detail="Please enter a valid email address.")
            clash = await db.users.find_one(
                {"email": email, "user_id": {"$ne": user["user_id"]}},
                {"_id": 0, "user_id": 1},
            )
            if clash:
                raise HTTPException(status_code=400, detail="That email is already in use by another account.")
            updates["email"] = email

    if not updates:
        raise HTTPException(status_code=400, detail="No editable fields provided.")

    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})

    # Keep the linked student/employee record in sync so admin sees the same email
    # in the student/employee details, and so email login resolves correctly.
    if "email" in updates:
        await db.students.update_one(
            {"user_id": user["user_id"]}, {"$set": {"email": updates["email"]}}
        )
        await db.employees.update_one(
            {"user_id": user["user_id"]}, {"$set": {"email": updates["email"]}}
        )

    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if isinstance(updated.get("created_at"), str):
        updated["created_at"] = datetime.fromisoformat(updated["created_at"])
    return UserResponse(**updated).model_dump()


@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    """
    Logout endpoint — clears session and revokes tokens.
    Works even with expired tokens (graceful degradation).
    """
    try:
        # 1. Clear OAuth session cookie
        cookie_token = request.cookies.get("session_token")
        if cookie_token:
            try:
                await db.user_sessions.delete_one({"session_token": cookie_token})
            except Exception:
                pass  # Ignore errors deleting session
        
        response.delete_cookie("session_token", path="/", secure=True, samesite="none")

        # 2. Revoke the JWT (add its JTI to the blocklist)
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            jwt_token = auth_header[7:]
            try:
                payload = decode_jwt_token(jwt_token)
                jti = payload.get("jti")
                exp = payload.get("exp")
                if jti and exp:
                    expires_at = datetime.fromtimestamp(exp, tz=timezone.utc)
                    await revoke_jti(jti, expires_at)
            except Exception:
                pass  # Already expired tokens or invalid tokens don't need special handling

        # 3. Revoke the refresh token if provided
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass  # No JSON body provided
        
        refresh_token = body.get("refresh_token")
        if refresh_token:
            try:
                await revoke_refresh_token(refresh_token)
            except Exception:
                pass  # Ignore errors revoking refresh token

        return {"message": "Logged out successfully", "status": "ok"}
    except Exception as e:
        # Even if something goes wrong, return success to frontend
        # The important thing is clearing the cookie, which we already did
        logger.warning(f"Logout error: {str(e)}")
        return {"message": "Logged out successfully", "status": "ok"}


@router.post("/auth/refresh")
async def refresh_access_token(request: Request):
    """
    Exchange a valid refresh token for a new access token + rotated refresh token.
    Old refresh token is revoked immediately (rotation prevents replay attacks).
    """
    body = await request.json()
    old_refresh_token = body.get("refresh_token")
    if not old_refresh_token:
        raise HTTPException(status_code=400, detail="refresh_token is required")

    # Validate the incoming refresh token
    token_doc = await verify_refresh_token(old_refresh_token)
    user_id = token_doc["user_id"]
    role = token_doc["role"]

    # Rotate: revoke old, issue new
    await revoke_refresh_token(old_refresh_token)
    new_refresh_token = await create_refresh_token_db(user_id, role)
    new_access_token = create_jwt_token(user_id, role)

    # Confirm user still active
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("is_active", True):
        await revoke_refresh_token(new_refresh_token)
        raise HTTPException(status_code=403, detail="Account is deactivated. Contact admin.")

    return {
        "token": new_access_token,
        "refresh_token": new_refresh_token,
    }


# ==================== PASSWORD RESET ====================

@router.post("/auth/forgot-password")
async def forgot_password(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
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

    # Revoke all refresh tokens — force re-login everywhere after password reset
    await revoke_all_refresh_tokens(reset["user_id"])
    await create_audit_log("user", reset["user_id"], "password_reset",
                           {"email": reset["email"]}, _system_actor(reset["user_id"], "password_reset"))
    logger.info("Password reset and all tokens revoked for user %s", reset["user_id"])

    return {"message": "Password has been reset successfully. Please login with your new password."}


@router.post("/auth/student-reset-password")
async def student_reset_password(request: Request):
    """
    Self-service password reset for STUDENTS, who log in with their admission
    number (not email). Identity is verified directly against the students
    collection — admission number + date of birth must both match — so no email
    or reset token is involved. On success the linked user account's password is
    updated immediately.
    """
    body = await request.json()
    admission_number = (body.get("admission_number") or "").strip()
    date_of_birth = (body.get("date_of_birth") or "").strip()
    new_password = body.get("new_password") or ""

    if not admission_number or not date_of_birth:
        raise HTTPException(status_code=400, detail="Admission number and date of birth are required")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    # ── Rate limit: max attempts per admission number per hour (brute-force
    #    guard on the DOB factor). Reuses the reset_attempts collection. ────────
    rl_key = f"adm:{admission_number.lower()}"
    attempt_doc = await db.reset_attempts.find_one({"email": rl_key}, {"_id": 0})
    if attempt_doc:
        window_start = datetime.now(timezone.utc) - timedelta(seconds=_RESET_WINDOW_SECONDS)
        last_attempt = attempt_doc.get("last_attempt")
        if isinstance(last_attempt, str):
            last_attempt = datetime.fromisoformat(last_attempt)
        if last_attempt and last_attempt > window_start and attempt_doc.get("attempts", 0) >= _RESET_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=429,
                detail="Too many reset attempts. Try again in 1 hour.",
                headers={"Retry-After": "3600"},
            )
    await db.reset_attempts.update_one(
        {"email": rl_key},
        {"$inc": {"attempts": 1}, "$set": {"last_attempt": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )

    # Generic error for both "not found" and "wrong DOB" to avoid revealing
    # which admission numbers exist.
    invalid = HTTPException(status_code=400, detail="Admission number or date of birth is incorrect.")

    student = await db.students.find_one(
        {"admission_number": {"$regex": f"^{re.escape(admission_number)}$", "$options": "i"},
         "is_active": True},
        {"_id": 0, "user_id": 1, "date_of_birth": 1, "first_name": 1},
    )
    if not student or (student.get("date_of_birth") or "") != date_of_birth:
        raise invalid

    user_id = student.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=400,
            detail="No login account exists for this student yet. Please contact the school office.",
        )

    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"password_hash": hash_password(new_password)}},
    )
    # Identity verified → clear the rate-limit counter and force re-login.
    await db.reset_attempts.delete_one({"email": rl_key})
    await revoke_all_refresh_tokens(user_id)
    await create_audit_log("user", user_id, "password_reset",
                           {"admission_number": admission_number, "method": "student_self_service"},
                           _system_actor(user_id, "student_reset"))
    logger.info("Student self-service password reset for user %s (adm %s)", user_id, admission_number)

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
        logger.warning("Failed password change attempt for user %s", user["user_id"])
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": hash_password(new_password)}}
    )
    # Invalidate all existing refresh tokens — force re-login on all devices
    await revoke_all_refresh_tokens(user["user_id"])
    await create_audit_log("user", user["user_id"], "password_change", {}, user)
    logger.info("Password changed and all refresh tokens revoked for user %s", user["user_id"])

    return {"message": "Password changed successfully"}


# ==================== USER MANAGEMENT ====================

@router.get("/users")
async def get_users(
    request: Request,
    response: Response,
    role: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 30,
):
    await require_roles(UserRole.ADMIN)(request)
    import asyncio as _asyncio
    import re as _re
    query = {}
    if role:
        query["role"] = role
    if search and search.strip():
        # Case-insensitive name/email match — admin needs to find a user from
        # 1000+ accounts without scrolling through paged results.
        rx = _re.compile(_re.escape(search.strip()), _re.IGNORECASE)
        query["$or"] = [{"name": rx}, {"email": rx}]
    # Active-period scoping: accounts created on or before the session ends, and
    # not deactivated before it starts (deactivated_at stamped on deactivation).
    win_start, win_end = await session_window(request)
    if win_start:
        from datetime import datetime as _dt, timedelta as _td
        end_excl = (_dt.strptime(win_end, "%Y-%m-%d").date() + _td(days=1)).isoformat()
        period = {
            "created_at": {"$lt": end_excl},
            "$and": [{"$or": [
                {"deactivated_at": None}, {"deactivated_at": {"$exists": False}},
                {"deactivated_at": {"$gte": win_start}},
            ]}],
        }
        # Merge without clobbering a search $or.
        if "$or" in query:
            query = {"$and": [query, period]}
        else:
            query.update(period)
    total, users = await _asyncio.gather(
        db.users.count_documents(query),
        db.users.find(query, {"_id": 0, "password_hash": 0})
            .sort("created_at", -1)
            .skip((page - 1) * limit)
            .limit(limit)
            .to_list(limit),
    )
    pages = max(1, -(-total // limit))
    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Total-Pages"] = str(pages)
    response.headers["X-Page"] = str(page)
    for u in users:
        if isinstance(u.get("created_at"), str):
            u["created_at"] = datetime.fromisoformat(u["created_at"])
    return [UserResponse(**u).model_dump() for u in users]


_USER_UPDATABLE_FIELDS = {"name", "phone", "picture", "is_active"}

@router.put("/users/{user_id}")
async def update_user(user_id: str, request: Request):
    current_user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    # Whitelist: never allow direct writes to security-sensitive fields via this endpoint
    _FORBIDDEN = {"password_hash", "user_id", "role", "email", "created_at"}
    for field in _FORBIDDEN:
        body.pop(field, None)

    # Admin cannot change their own active status
    if user_id == current_user["user_id"]:
        body.pop("is_active", None)

    allowed_body = {k: v for k, v in body.items() if k in _USER_UPDATABLE_FIELDS}
    if not allowed_body:
        raise HTTPException(status_code=400, detail="No valid updatable fields provided.")

    await db.users.update_one({"user_id": user_id}, {"$set": allowed_body})

    # Cascade is_active to the linked student / employee record so the two
    # sides stay in sync. Without this, the admin Users page can deactivate a
    # user while the Students/Employees row stays active (SFS2026/0002 bug).
    if "is_active" in allowed_body:
        target = await db.users.find_one({"user_id": user_id}, {"_id": 0, "role": 1, "email": 1})
        role = (target or {}).get("role")
        if role == UserRole.STUDENT:
            await db.students.update_one(
                {"$or": [{"user_id": user_id}, {"email": target.get("email")}]},
                {"$set": {"is_active": allowed_body["is_active"]}}
            )
        elif role in (UserRole.TEACHER, UserRole.ACCOUNTANT):
            await db.employees.update_one(
                {"$or": [{"user_id": user_id}, {"email": target.get("email")}]},
                {"$set": {"is_active": allowed_body["is_active"]}}
            )

    await create_audit_log("user", user_id, "update", allowed_body, current_user)

    updated = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    if isinstance(updated.get("created_at"), str):
        updated["created_at"] = datetime.fromisoformat(updated["created_at"])
    return UserResponse(**updated)


@router.put("/users/{user_id}/role")
async def update_user_role(user_id: str, request: Request):
    admin = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()
    new_role = body.get("role")

    if new_role not in [UserRole.ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=400, detail="Invalid role")

    # Prevent admin from demoting themselves
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=400, detail="You cannot change your own role.")

    existing = await db.users.find_one({"user_id": user_id}, {"_id": 0, "role": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found.")

    old_role = existing.get("role")
    await db.users.update_one({"user_id": user_id}, {"$set": {"role": new_role}})
    await create_audit_log("user", user_id, "role_change",
                           {"old_role": old_role, "new_role": new_role}, admin)
    logger.info("Role changed: user=%s %s → %s by admin=%s", user_id, old_role, new_role, admin["user_id"])
    return {"message": "Role updated"}


@router.post("/users/{user_id}/reset-password")
async def admin_reset_user_password(user_id: str, request: Request):
    """Admin: set or generate a password for ANY user (student, teacher,
    parent, accountant, admin). Returns the plaintext so the admin can share it.
    """
    admin = await require_roles(UserRole.ADMIN)(request)
    try:
        body = await request.json()
    except Exception:
        body = {}

    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    new_password = (body.get("password") or "").strip() or secrets.token_urlsafe(8)
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"password_hash": hash_password(new_password), "is_active": True}},
    )
    # Mirror the plaintext onto the linked student/employee record so it shows
    # in their detail panel (same UX as the Students/Employees password views).
    await db.students.update_one({"user_id": user_id}, {"$set": {"temp_password": new_password}})
    await db.employees.update_one({"user_id": user_id}, {"$set": {"temp_password": new_password}})
    # Force re-login everywhere with the new password.
    try:
        await revoke_all_refresh_tokens(user_id)
    except Exception:
        pass
    await create_audit_log("user", user_id, "password_reset", {"by_admin": True}, admin)
    return {"message": "Password updated", "password": new_password, "email": target.get("email")}


@router.get("/users/search")
async def search_users(request: Request, q: Optional[str] = None, role: Optional[str] = None):
    user = await get_current_user(request)
    # Only staff can enumerate users — students/parents must not be able to query emails
    if user["role"] not in (UserRole.ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT):
        raise HTTPException(status_code=403, detail="Access denied.")
    query = {"is_active": True}
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}}
        ]
    if role:
        query["role"] = role

    users = await db.users.find(query, {"_id": 0, "password_hash": 0}).to_list(50)
    results = [
        {
            "user_id": u["user_id"],
            "name": u["name"],
            "email": u.get("email", ""),
            "role": u["role"]
        }
        for u in users
    ]

    # Also search students collection when query includes student role or no role filter
    if q and (not role or role == "student"):
        student_query: dict = {"is_active": True}
        student_query["$or"] = [
            {"first_name": {"$regex": q, "$options": "i"}},
            {"last_name": {"$regex": q, "$options": "i"}},
            {"admission_number": {"$regex": q, "$options": "i"}},
        ]
        students = await db.students.find(student_query, {"_id": 0}).to_list(30)
        seen_user_ids = {r["user_id"] for r in results}
        for s in students:
            uid = s.get("user_id") or s["student_id"]
            if uid not in seen_user_ids:
                seen_user_ids.add(uid)
                results.append({
                    "user_id": uid,
                    "name": f"{s['first_name']} {s['last_name']}",
                    "email": s.get("email", ""),
                    "role": "student",
                    "student_id": s["student_id"],
                    "class_name": s.get("class_name", ""),
                    "section": s.get("section", ""),
                    "admission_number": s.get("admission_number", ""),
                })

    return results[:50]
