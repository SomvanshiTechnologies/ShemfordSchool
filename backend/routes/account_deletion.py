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
from datetime import datetime, timezone

from database import db
from models import UserRole, AccountDeletionRequest
from auth_utils import get_current_user, require_roles, create_audit_log

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

    req = AccountDeletionRequest(
        user_id=user["user_id"],
        user_name=user.get("name"),
        user_email=user.get("email"),
        user_role=user.get("role"),
        reason=reason,
    )
    doc = req.model_dump()
    doc["requested_at"] = doc["requested_at"].isoformat()
    await db.account_deletion_requests.insert_one(dict(doc))
    await create_audit_log("account_deletion", req.request_id, "request", {"reason": reason}, user)
    return {"message": "Account deletion request submitted for admin approval.", "request": doc}


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
    flt = {"status": status} if status else {}
    rows = await db.account_deletion_requests.find(flt, {"_id": 0}).sort("requested_at", -1).to_list(1000)
    return rows


@router.post("/account-deletion/{request_id}/approve")
async def approve_deletion(request_id: str, request: Request):
    """Admin: approve a deletion request and HARD-delete the user + their data."""
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

    target = await db.users.find_one({"user_id": req["user_id"]}, {"_id": 0})
    counts = await _purge_user(target) if target else {}

    now = datetime.now(timezone.utc).isoformat()
    await db.account_deletion_requests.update_one(
        {"request_id": request_id},
        {"$set": {
            "status": "approved",
            "reviewed_by": admin["user_id"],
            "reviewed_by_name": admin.get("name"),
            "reviewed_at": now,
            "deleted_counts": counts,
        }},
    )
    # Audit log is written by the approving admin (performed_by != deleted user),
    # so it survives the purge above.
    await create_audit_log("account_deletion", request_id, "approve", {
        "deleted_user_id": req["user_id"],
        "deleted_user_name": req.get("user_name"),
        "deleted_user_role": req.get("user_role"),
        "deleted_counts": counts,
    }, admin)
    return {
        "message": f"Account permanently deleted. Removed {sum(counts.values())} record(s) across {len(counts)} collection(s).",
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
    """The requester withdraws their own pending deletion request."""
    user = await get_current_user(request)
    req = await db.account_deletion_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Deletion request not found.")
    if req["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only cancel your own request.")
    if req.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Request already {req.get('status')}.")
    await db.account_deletion_requests.update_one(
        {"request_id": request_id},
        {"$set": {"status": "cancelled", "reviewed_at": datetime.now(timezone.utc).isoformat()}},
    )
    await create_audit_log("account_deletion", request_id, "cancel", {}, user)
    return {"message": "Deletion request cancelled.", "request_id": request_id}
