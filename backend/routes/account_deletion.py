"""
Account deletion with admin approval.

Flow:
  1. Any logged-in user submits a deletion request (status="pending").
  2. An admin reviews the queue and approves or rejects it.
  3. On approval, every record keyed to the user's OWN identity
     (user_id / their student_id / their employee_id) is HARD-deleted.

Scope boundary (intentional): we do NOT cascade-delete records that merely
reference this user as an *actor* on someone else's data — e.g. marks a teacher
entered for other students, fees an accountant collected, or a parent's children
(students.parent_id). Those belong to other people; wiping them would destroy
third-party data. Only the deleted person's own records are removed. The
account_deletion_requests document itself is kept (status="approved") as the
tombstone/record of the deletion, and the approving admin's audit-log entry
survives the purge.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone, timedelta

from database import db
from models import UserRole, AccountDeletionRequest
from auth_utils import get_current_user, require_roles, create_audit_log

REVOKE_WINDOW_DAYS = 15        # days from request to revoke (before admin approval)
POST_APPROVAL_REVOKE_DAYS = 30  # days after admin approval during which user can still revoke

router = APIRouter()


async def _json(request: Request) -> dict:
    try:
        return await request.json()
    except Exception:
        return {}


async def _is_last_active_admin(user_id: str) -> bool:
    """True when this user is an admin and the only active admin left — such an
    account must never be deletable or the school would be locked out."""
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0, "role": 1})
    if not target or target.get("role") != UserRole.ADMIN:
        return False
    return (await db.users.count_documents({"role": UserRole.ADMIN, "is_active": True})) <= 1


async def _purge_user(target: dict) -> dict:
    """Hard-delete the user and every record keyed to their own identity.
    Returns a {collection: deleted_count} summary."""
    user_id = target["user_id"]
    counts: dict = {}

    async def _del(coll: str, flt: dict):
        res = await db[coll].delete_many(flt)
        if res.deleted_count:
            counts[coll] = counts.get(coll, 0) + res.deleted_count

    student = await db.students.find_one({"user_id": user_id}, {"_id": 0, "student_id": 1})
    employee = await db.employees.find_one({"user_id": user_id}, {"_id": 0, "employee_id": 1})
    student_id = student.get("student_id") if student else None
    employee_id = employee.get("employee_id") if employee else None

    # Account + auth/session artifacts (keyed by user_id)
    await _del("users", {"user_id": user_id})
    await _del("user_sessions", {"user_id": user_id})
    await _del("refresh_tokens", {"user_id": user_id})
    await _del("password_resets", {"user_id": user_id})

    # Personal content owned by the user
    await _del("messages", {"$or": [{"sender_id": user_id}, {"recipient_id": user_id}]})
    await _del("voice_notes", {"uploaded_by": user_id})
    await _del("announcements", {"created_by": user_id})
    await _del("issues", {"raised_by": user_id})
    await _del("audit_logs", {"performed_by": user_id})

    # Student-scoped data (about this student)
    if student_id:
        for coll, flt in [
            ("students", {"student_id": student_id}),
            ("student_ledger", {"student_id": student_id}),
            ("fee_payments", {"student_id": student_id}),
            ("fee_installments", {"student_id": student_id}),
            ("student_session_history", {"student_id": student_id}),
            ("student_documents", {"student_id": student_id}),
            ("attendance", {"entity_id": student_id}),
            ("mark_records", {"student_id": student_id}),
            ("upgradation_records", {"student_id": student_id}),
            ("razorpay_orders", {"student_id": student_id}),
            ("pos_orders", {"student_id": student_id}),
            ("onboarding", {"student_id": student_id}),
        ]:
            await _del(coll, flt)

    # Employee-scoped data (about this employee)
    if employee_id:
        for coll, flt in [
            ("employees", {"employee_id": employee_id}),
            ("payroll", {"employee_id": employee_id}),
            ("attendance", {"entity_id": employee_id}),
        ]:
            await _del(coll, flt)

    return counts


@router.post("/account-deletion/request")
async def request_account_deletion(request: Request):
    """Submit a request to delete the caller's own account (awaits admin approval)."""
    user = await get_current_user(request)
    body = await _json(request)
    reason = (body.get("reason") or "").strip() or None

    existing = await db.account_deletion_requests.find_one(
        {"user_id": user["user_id"], "status": "pending"}, {"_id": 0}
    )
    if existing:
        raise HTTPException(status_code=400, detail="You already have a pending deletion request.")

    if await _is_last_active_admin(user["user_id"]):
        raise HTTPException(status_code=400, detail="Cannot delete the only administrator account.")

    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(days=REVOKE_WINDOW_DAYS)).isoformat()
    req = AccountDeletionRequest(
        user_id=user["user_id"],
        user_name=user.get("name"),
        user_email=user.get("email"),
        user_role=user.get("role"),
        reason=reason,
        expires_at=expires_at,
    )
    doc = req.model_dump()
    doc["requested_at"] = doc["requested_at"].isoformat()

    # Deactivate the account immediately so the user cannot log in while
    # deletion is pending. They can restore it via the revoke flow.
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"is_active": False}})

    await db.account_deletion_requests.insert_one(dict(doc))
    await create_audit_log("account_deletion", req.request_id, "request", {"reason": reason}, user)
    return {"message": "Account deletion request submitted. Your account is now deactivated — you have 15 days to revoke this.", "request": doc}


@router.get("/account-deletion/my-request")
async def my_deletion_request(request: Request):
    """The caller's most recent deletion request (or null), for showing status."""
    user = await get_current_user(request)
    doc = await db.account_deletion_requests.find_one(
        {"user_id": user["user_id"]}, {"_id": 0}, sort=[("requested_at", -1)]
    )
    return {"request": doc}


@router.get("/account-deletion/requests")
async def list_deletion_requests(request: Request, status: Optional[str] = None):
    """Admin: the deletion-request queue. Optionally filter by status."""
    await require_roles(UserRole.ADMIN)(request)
    if status:
        flt = {"status": status}
    else:
        # Default: pending deletions + pending revokes + approved (30-day grace period)
        flt = {"status": {"$in": ["pending", "revoke_pending", "approved"]}}
    rows = await db.account_deletion_requests.find(flt, {"_id": 0}).sort("requested_at", -1).to_list(1000)
    return rows


@router.post("/account-deletion/{request_id}/approve")
async def approve_deletion(request_id: str, request: Request):
    """
    Admin: approve a deletion request.
    The account is NOT deleted immediately — a 30-day grace period begins during
    which the user can still revoke. Hard-deletion happens via /execute after the
    window expires (or when the admin explicitly triggers it).
    """
    admin = await require_roles(UserRole.ADMIN)(request)
    req = await db.account_deletion_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Deletion request not found.")
    if req.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Request already {req.get('status')}.")
    if req["user_id"] == admin["user_id"]:
        raise HTTPException(status_code=400, detail="You cannot approve your own deletion request. Ask another admin.")
    if await _is_last_active_admin(req["user_id"]):
        raise HTTPException(status_code=400, detail="Cannot delete the only administrator account.")

    now = datetime.now(timezone.utc)
    final_deletion_at = (now + timedelta(days=POST_APPROVAL_REVOKE_DAYS)).isoformat()
    now_iso = now.isoformat()

    await db.account_deletion_requests.update_one(
        {"request_id": request_id},
        {"$set": {
            "status": "approved",
            "reviewed_by": admin["user_id"],
            "reviewed_by_name": admin.get("name"),
            "reviewed_at": now_iso,
            "final_deletion_at": final_deletion_at,
        }},
    )
    await create_audit_log("account_deletion", request_id, "approve", {
        "user_id": req["user_id"],
        "user_name": req.get("user_name"),
        "final_deletion_at": final_deletion_at,
    }, admin)
    return {
        "message": f"Deletion approved. The account will be permanently deleted on {final_deletion_at[:10]} unless the user revokes within 30 days.",
        "request_id": request_id,
        "final_deletion_at": final_deletion_at,
    }


@router.post("/account-deletion/{request_id}/execute")
async def execute_deletion(request_id: str, request: Request):
    """
    Admin: permanently hard-delete the account.
    Only available after final_deletion_at has passed (or with force=true to override).
    """
    admin = await require_roles(UserRole.ADMIN)(request)
    body = await _json(request)
    req = await db.account_deletion_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Deletion request not found.")
    if req.get("status") != "approved":
        raise HTTPException(status_code=400, detail=f"Request is not in approved state (current: {req.get('status')}).")

    final_at = req.get("final_deletion_at")
    if final_at and not body.get("force"):
        try:
            exp = datetime.fromisoformat(final_at.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) < exp:
                days_left = (exp - datetime.now(timezone.utc)).days + 1
                raise HTTPException(
                    status_code=400,
                    detail=f"{days_left} day(s) remaining in the revoke window. Pass force=true to delete immediately."
                )
        except ValueError:
            pass

    target = await db.users.find_one({"user_id": req["user_id"]}, {"_id": 0})
    counts = await _purge_user(target) if target else {}

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.account_deletion_requests.update_one(
        {"request_id": request_id},
        {"$set": {"status": "executed", "executed_at": now_iso, "deleted_counts": counts}},
    )
    await create_audit_log("account_deletion", request_id, "execute", {
        "deleted_user_id": req["user_id"],
        "deleted_counts": counts,
    }, admin)
    return {
        "message": f"Account permanently deleted. Removed {sum(counts.values())} record(s).",
        "request_id": request_id,
        "deleted_counts": counts,
    }


@router.post("/account-deletion/{request_id}/reject")
async def reject_deletion(request_id: str, request: Request):
    """Admin: reject a pending deletion request, optionally with a reason."""
    admin = await require_roles(UserRole.ADMIN)(request)
    body = await _json(request)
    reason = (body.get("reason") or "").strip() or None
    req = await db.account_deletion_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Deletion request not found.")
    if req.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Request already {req.get('status')}.")
    now = datetime.now(timezone.utc).isoformat()
    await db.account_deletion_requests.update_one(
        {"request_id": request_id},
        {"$set": {
            "status": "rejected",
            "reviewed_by": admin["user_id"],
            "reviewed_by_name": admin.get("name"),
            "reviewed_at": now,
            "rejection_reason": reason,
        }},
    )
    await create_audit_log("account_deletion", request_id, "reject", {"reason": reason}, admin)
    return {"message": "Deletion request rejected.", "request_id": request_id}


@router.post("/account-deletion/{request_id}/cancel")
async def cancel_deletion(request_id: str, request: Request):
    """The requester withdraws their own pending deletion request (while still logged in)."""
    user = await get_current_user(request)
    req = await db.account_deletion_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Deletion request not found.")
    if req["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only cancel your own request.")
    if req.get("status") not in ("pending",):
        raise HTTPException(status_code=400, detail=f"Request already {req.get('status')}.")
    await db.account_deletion_requests.update_one(
        {"request_id": request_id},
        {"$set": {"status": "cancelled", "reviewed_at": datetime.now(timezone.utc).isoformat()}},
    )
    # Reactivate the account since deletion was cancelled
    await db.users.update_one({"user_id": req["user_id"]}, {"$set": {"is_active": True}})
    await create_audit_log("account_deletion", request_id, "cancel", {}, user)
    return {"message": "Deletion request cancelled. Your account has been reactivated.", "request_id": request_id}


@router.post("/account-deletion/{request_id}/revoke-request")
async def revoke_deletion_request(request_id: str, request: Request):
    """
    The user requests to revoke (undo) their deletion within the 15-day window.
    No auth required since the account is deactivated — identity confirmed via
    the request_id (UUID with 122-bit entropy) returned to the user on login failure.
    Sets status to 'revoke_pending'; account stays deactivated until admin approves.
    """
    req = await db.account_deletion_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Deletion request not found.")
    status = req.get("status")
    if status not in ("pending", "approved"):
        raise HTTPException(status_code=400, detail=f"Cannot revoke — request status is '{status}'.")

    # Determine which expiry window to check
    if status == "approved":
        window_field = "final_deletion_at"
        window_msg = "The 30-day post-approval revoke window has expired. The account will be permanently deleted."
    else:
        window_field = "expires_at"
        window_msg = "The 15-day revoke window has expired."

    expiry = req.get(window_field)
    if expiry:
        try:
            exp = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > exp:
                raise HTTPException(status_code=400, detail=window_msg)
        except ValueError:
            pass

    now = datetime.now(timezone.utc).isoformat()
    await db.account_deletion_requests.update_one(
        {"request_id": request_id},
        {"$set": {"status": "revoke_pending", "revoke_requested_at": now}},
    )
    system_actor = {"user_id": req["user_id"], "name": req.get("user_name", "user")}
    await create_audit_log("account_deletion", request_id, "revoke_request", {}, system_actor)
    return {"message": "Revoke request submitted. Your account will be restored once an admin approves it.", "request_id": request_id}


@router.post("/account-deletion/{request_id}/approve-revoke")
async def approve_revoke(request_id: str, request: Request):
    """Admin: approve a revoke request — reactivates the user's account."""
    admin = await require_roles(UserRole.ADMIN)(request)
    req = await db.account_deletion_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Deletion request not found.")
    if req.get("status") != "revoke_pending":
        raise HTTPException(status_code=400, detail=f"Request is not in revoke_pending state (current: {req.get('status')}).")

    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"user_id": req["user_id"]}, {"$set": {"is_active": True}})
    await db.account_deletion_requests.update_one(
        {"request_id": request_id},
        {"$set": {
            "status": "revoke_approved",
            "reviewed_by": admin["user_id"],
            "reviewed_by_name": admin.get("name"),
            "reviewed_at": now,
        }},
    )
    await create_audit_log("account_deletion", request_id, "approve_revoke", {
        "user_id": req["user_id"],
        "user_name": req.get("user_name"),
    }, admin)
    return {"message": f"Account restored. {req.get('user_name', 'User')} can now log in.", "request_id": request_id}


@router.post("/account-deletion/{request_id}/reject-revoke")
async def reject_revoke(request_id: str, request: Request):
    """Admin: reject a revoke request — deletion proceeds as originally requested."""
    admin = await require_roles(UserRole.ADMIN)(request)
    body = await _json(request)
    reason = (body.get("reason") or "").strip() or None
    req = await db.account_deletion_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Deletion request not found.")
    if req.get("status") != "revoke_pending":
        raise HTTPException(status_code=400, detail=f"Request is not in revoke_pending state.")

    now = datetime.now(timezone.utc).isoformat()
    await db.account_deletion_requests.update_one(
        {"request_id": request_id},
        {"$set": {
            "status": "pending",  # back to pending — admin will approve deletion separately
            "reviewed_by": admin["user_id"],
            "reviewed_by_name": admin.get("name"),
            "reviewed_at": now,
            "rejection_reason": reason,
        }},
    )
    await create_audit_log("account_deletion", request_id, "reject_revoke", {"reason": reason}, admin)
    return {"message": "Revoke request rejected. Deletion request remains pending.", "request_id": request_id}
