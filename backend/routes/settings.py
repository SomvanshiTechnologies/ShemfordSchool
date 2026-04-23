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
