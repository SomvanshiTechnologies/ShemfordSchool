"""
Shemford Futuristic School — Class Upgradation / Promotion

Upgradation flow:
  1. Charge upgradation fee (creates ledger entry)
  2. Admin records payment of upgradation fee
  3. Student is moved to new class + section (+ optional new stream)
  4. New yearly fee ledger entries are created for the new academic year
  5. Monthly tuition entries continue at new rate from the promotion month
"""
from fastapi import APIRouter, HTTPException, Request
from typing import Optional
from datetime import datetime, timezone

from database import db
from models import UserRole, StudentLedgerEntry, UpgradationRecord
from auth_utils import get_current_user, require_roles, create_audit_log
from routes.fees import (
    get_fee_config, create_admission_ledger, refresh_overdue_for_student,
    get_remaining_months, current_academic_year, get_next_receipt_number,
)
from models import FeePayment

router = APIRouter()


async def _validate_upgrade_target(student: dict, to_class: str, to_section: str, to_stream: Optional[str],
                                   academic_year: str, allow_capacity_override: bool):
    """Shared validator used by both request-creation and approval — keeps the rules in one place."""
    cls = await db.class_structures.find_one({"name": to_class, "is_active": True}, {"_id": 0})
    if not cls:
        raise HTTPException(status_code=400, detail=f"Class '{to_class}' not found")

    section_info = next((s for s in cls.get("sections", []) if s["section_name"] == to_section), None)
    if not section_info:
        raise HTTPException(status_code=400, detail=f"Section '{to_section}' not in {to_class}")

    current_count = await db.students.count_documents(
        {"class_name": to_class, "section": to_section, "is_active": True}
    )
    capacity = section_info.get("capacity", 40)
    if current_count >= capacity and not allow_capacity_override:
        raise HTTPException(status_code=400, detail=f"Section {to_section} is full ({current_count}/{capacity})")

    cfg = await get_fee_config(to_class, academic_year, to_stream)
    if not cfg:
        fallback_year = current_academic_year()
        cfg = await get_fee_config(to_class, fallback_year, to_stream)
        if not cfg:
            raise HTTPException(
                status_code=400,
                detail=f"No fee config for {to_class}" + (f" ({to_stream})" if to_stream else "") +
                       f" in {academic_year} or {fallback_year}. "
                       "Please create a fee configuration first under Fees → Fee Config."
            )
    return cfg


@router.post("/students/{student_id}/upgrade")
async def request_upgrade(student_id: str, request: Request):
    """
    STAGE 1 — Create an upgrade REQUEST.

    The request is stored with status="pending_approval". The student record is
    NOT modified and no ledger entries are created until an admin approves.
    """
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    student = await db.students.find_one({"student_id": student_id, "is_active": True}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    to_class = body.get("to_class")
    to_section = body.get("to_section")
    to_stream = body.get("to_stream")
    academic_year = body.get("academic_year", current_academic_year())
    notes = body.get("notes", "")

    if not to_class or not to_section:
        raise HTTPException(status_code=400, detail="to_class and to_section are required")

    # Block if there is already an approved upgrade for the same academic year,
    # OR a pending request waiting for review.
    blocking = await db.upgradation_records.find_one({
        "student_id": student_id,
        "academic_year": academic_year,
        "status": {"$in": ["pending_approval", "approved"]},
    })
    if blocking:
        st = blocking.get("status")
        if st == "pending_approval":
            raise HTTPException(status_code=409, detail=f"An upgrade request for this student is already awaiting approval.")
        raise HTTPException(
            status_code=409,
            detail=f"Student was already upgraded to {blocking['to_class']} in {academic_year}."
        )

    if not body.get("force_upgrade", False):
        pending_agg = await db.student_ledger.aggregate([
            {"$match": {"student_id": student_id, "status": {"$in": ["pending", "overdue"]}}},
            {"$group": {"_id": "$academic_year", "count": {"$sum": 1}, "total": {"$sum": "$net_amount"}}},
            {"$sort": {"_id": 1}},
        ]).to_list(20)
        if pending_agg:
            total_amount = sum(r["total"] for r in pending_agg)
            year_parts = [
                f"{r['_id']} (₹{r['total']:,.0f})" if r.get("_id") else f"₹{r['total']:,.0f}"
                for r in pending_agg
            ]
            years_str = ", ".join(year_parts)
            raise HTTPException(
                status_code=400,
                detail=f"Fees pending for {years_str} (₹{total_amount:,.0f} total). "
                       f"Please collect the pending fees from the Fees section before upgrading this student."
            )

    cfg = await _validate_upgrade_target(student, to_class, to_section, to_stream, academic_year,
                                          allow_capacity_override=body.get("admin_override", False))
    upgradation_fee = cfg.get("upgradation_fee", 0)

    upg = UpgradationRecord(
        student_id=student_id,
        from_class=student["class_name"],
        to_class=to_class,
        from_stream=student.get("stream"),
        to_stream=to_stream,
        from_section=student["section"],
        to_section=to_section,
        academic_year=academic_year,
        upgradation_fee=upgradation_fee,
        upgradation_fee_paid=False,
        status="pending_approval",
        requested_by=user["user_id"],
        performed_by=user["user_id"],
        notes=notes,
    )
    upg_dict = upg.model_dump()
    upg_dict["created_at"] = upg_dict["created_at"].isoformat()
    await db.upgradation_records.insert_one(upg_dict)
    upg_dict.pop("_id", None)

    await create_audit_log("upgradation", upg.upgradation_id, "request", {
        "student_id": student_id,
        "to": f"{to_class}/{to_section}/{to_stream}",
        "academic_year": academic_year,
    }, user)

    return {
        "upgradation": upg_dict,
        "status": "pending_approval",
        "message": "Upgrade request created. Awaiting admin approval.",
        # legacy keys some callers may still read
        "upgradation_fee": upgradation_fee,
        "upgradation_fee_paid": False,
    }


@router.post("/upgradation/{upgradation_id}/approve")
async def approve_upgrade(upgradation_id: str, request: Request):
    """
    STAGE 2 — Approve a pending upgrade request.
    Actually moves the student to the new class, creates the ledger entries.
    """
    user = await require_roles(UserRole.ADMIN)(request)

    upg = await db.upgradation_records.find_one({"upgradation_id": upgradation_id}, {"_id": 0})
    if not upg:
        raise HTTPException(status_code=404, detail="Upgrade request not found")
    # Treat missing-status records (legacy data) as pending so admin can approve them.
    current_status = upg.get("status") or "pending_approval"
    if current_status not in ("pending_approval",):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve — request is already '{current_status}'."
        )

    student = await db.students.find_one({"student_id": upg["student_id"], "is_active": True}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student no longer exists / inactive")

    # Re-run target validation in case classes / capacity changed since the request
    cfg = await _validate_upgrade_target(
        student, upg["to_class"], upg["to_section"], upg.get("to_stream"),
        upg["academic_year"], allow_capacity_override=False,
    )
    upgradation_fee = cfg.get("upgradation_fee", upg.get("upgradation_fee", 0))

    # Legacy records may already have a ledger entry from the old immediate-upgrade flow.
    # Don't create a duplicate — reuse the existing one.
    upg_ledger_id = upg.get("upgradation_fee_ledger_id")
    if upgradation_fee > 0 and not upg_ledger_id:
        due_day = cfg.get("due_day", 10)
        now = datetime.now()
        due_date = f"{now.year}-{str(now.month).zfill(2)}-{str(due_day).zfill(2)}"
        entry = StudentLedgerEntry(
            student_id=upg["student_id"],
            admission_number=student.get("admission_number", ""),
            class_name=upg["to_class"],
            stream=upg.get("to_stream"),
            academic_year=upg["academic_year"],
            fee_component="upgradation",
            fee_type="one_time",
            description=f"Upgradation Fee ({upg['from_class']} → {upg['to_class']})",
            gross_amount=upgradation_fee,
            net_amount=upgradation_fee,
            due_date=due_date,
            status="pending",
        )
        d = entry.model_dump()
        d["created_at"] = d["created_at"].isoformat()
        await db.student_ledger.insert_one(d)
        upg_ledger_id = entry.ledger_id

    # Move the student to the new class
    await db.students.update_one(
        {"student_id": upg["student_id"]},
        {"$set": {
            "class_name": upg["to_class"],
            "section": upg["to_section"],
            "stream": upg.get("to_stream"),
            "academic_year": upg["academic_year"],
            "fee_status": "pending",
        }}
    )

    updated_student = await db.students.find_one({"student_id": upg["student_id"]}, {"_id": 0})
    today_str = datetime.now().strftime("%Y-%m-%d")
    ledger_count = await create_admission_ledger(updated_student, cfg, upg["academic_year"], today_str[:7])
    await refresh_overdue_for_student(upg["student_id"])

    approved_at = datetime.now(timezone.utc).isoformat()
    await db.upgradation_records.update_one(
        {"upgradation_id": upgradation_id},
        {"$set": {
            "status": "approved",
            "approved_by": user["user_id"],
            "approved_at": approved_at,
            "upgradation_fee": upgradation_fee,
            "upgradation_fee_ledger_id": upg_ledger_id,
        }}
    )

    await create_audit_log("upgradation", upgradation_id, "approve", {
        "student_id": upg["student_id"],
        "to": f"{upg['to_class']}/{upg['to_section']}/{upg.get('to_stream')}",
        "academic_year": upg["academic_year"],
    }, user)

    return {
        "upgradation_id": upgradation_id,
        "status": "approved",
        "approved_by": user["user_id"],
        "approved_at": approved_at,
        "ledger_entries_created": ledger_count,
        "upgradation_fee": upgradation_fee,
        "message": f"Upgrade approved. Student moved to {upg['to_class']}." +
                   (f" Upgrade fee ₹{upgradation_fee:,.2f} added to pending fees." if upgradation_fee > 0 else ""),
    }


@router.post("/upgradation/{upgradation_id}/reject")
async def reject_upgrade(upgradation_id: str, request: Request):
    """STAGE 2 (alt) — Reject a pending upgrade request. Student remains in current class."""
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()
    reason = (body.get("reason") or "").strip()

    upg = await db.upgradation_records.find_one({"upgradation_id": upgradation_id}, {"_id": 0})
    if not upg:
        raise HTTPException(status_code=404, detail="Upgrade request not found")
    current_status = upg.get("status") or "pending_approval"
    if current_status not in ("pending_approval",):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reject — request is already '{current_status}'."
        )

    rejected_at = datetime.now(timezone.utc).isoformat()
    await db.upgradation_records.update_one(
        {"upgradation_id": upgradation_id},
        {"$set": {
            "status": "rejected",
            "approved_by": user["user_id"],
            "approved_at": rejected_at,
            "rejection_reason": reason or None,
        }}
    )

    await create_audit_log("upgradation", upgradation_id, "reject", {
        "student_id": upg["student_id"],
        "reason": reason,
    }, user)

    return {
        "upgradation_id": upgradation_id,
        "status": "rejected",
        "message": "Upgrade request rejected.",
    }


@router.post("/students/{student_id}/upgrade/pay-fee")
async def pay_upgradation_fee(student_id: str, request: Request):
    """Record payment of the upgradation fee."""
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    body = await request.json()

    ledger_entry = await db.student_ledger.find_one({
        "student_id": student_id,
        "fee_component": "upgradation",
        "status": {"$in": ["pending", "overdue"]}
    }, {"_id": 0})
    if not ledger_entry:
        raise HTTPException(status_code=404, detail="No pending upgradation fee found")

    receipt_number = await get_next_receipt_number()
    payment = FeePayment(
        student_id=student_id,
        installment_ids=[ledger_entry["ledger_id"]],
        amount=ledger_entry["net_amount"],
        payment_method=body.get("payment_method", "cash"),
        transaction_id=body.get("transaction_id"),
        collected_by=user["user_id"],
        remarks=body.get("remarks", "Upgradation fee"),
        academic_year=ledger_entry.get("academic_year", ""),
    )
    pay_dict = payment.model_dump()
    pay_dict["receipt_number"] = receipt_number
    pay_dict["created_at"] = pay_dict["created_at"].isoformat()
    await db.fee_payments.insert_one(pay_dict)

    today = datetime.now().strftime("%Y-%m-%d")
    await db.student_ledger.update_one(
        {"ledger_id": ledger_entry["ledger_id"]},
        {"$set": {"status": "paid", "paid_date": today, "payment_id": payment.payment_id,
                  "receipt_number": receipt_number}}
    )

    # Mark upgradation record as fee paid
    await db.upgradation_records.update_many(
        {"student_id": student_id, "upgradation_fee_ledger_id": ledger_entry["ledger_id"]},
        {"$set": {"upgradation_fee_paid": True, "upgradation_payment_id": payment.payment_id}}
    )

    # Recompute the student's overall fee_status (paid/pending/overdue) from the ledger
    await refresh_overdue_for_student(student_id)

    pay_dict.pop("_id", None)
    return {
        "payment": pay_dict,
        "receipt_number": receipt_number,
        "message": f"Upgradation fee of ₹{ledger_entry['net_amount']:,.2f} paid. Receipt: {receipt_number}"
    }


@router.get("/upgradation/history")
async def get_upgradation_history(
    request: Request,
    student_id: Optional[str] = None,
    academic_year: Optional[str] = None,
):
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    q = {}
    if student_id:
        q["student_id"] = student_id
    if academic_year:
        q["academic_year"] = academic_year
    records = await db.upgradation_records.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)

    # Bulk-fetch linked ledger entries so fee-paid status reflects the LIVE
    # ledger state — payment can be made via the general /fees/pay flow
    # (cash / online via Razorpay) and we want the history to update automatically.
    ledger_ids = [r["upgradation_fee_ledger_id"] for r in records if r.get("upgradation_fee_ledger_id")]
    ledger_map = {}
    if ledger_ids:
        ledger_rows = await db.student_ledger.find(
            {"ledger_id": {"$in": ledger_ids}},
            {"_id": 0, "ledger_id": 1, "status": 1, "paid_date": 1, "payment_id": 1, "receipt_number": 1}
        ).to_list(len(ledger_ids))
        ledger_map = {row["ledger_id"]: row for row in ledger_rows}

    result = []
    for r in records:
        # Sync fee-paid status from the linked ledger entry (DB-driven, not cached)
        lid = r.get("upgradation_fee_ledger_id")
        if lid and lid in ledger_map:
            entry = ledger_map[lid]
            r["upgradation_fee_paid"] = entry.get("status") == "paid"
            r["upgradation_fee_status"] = entry.get("status", "pending")
            r["upgradation_fee_paid_date"] = entry.get("paid_date")
            r["upgradation_fee_payment_id"] = entry.get("payment_id")
            r["upgradation_fee_receipt"] = entry.get("receipt_number")
        elif r.get("upgradation_fee", 0) > 0:
            r["upgradation_fee_status"] = "paid" if r.get("upgradation_fee_paid") else "pending"
        else:
            r["upgradation_fee_status"] = "no_fee"

        s = await db.students.find_one({"student_id": r["student_id"]}, {"_id": 0,
            "first_name": 1, "last_name": 1, "admission_number": 1})
        if s:
            r["student_name"] = f"{s['first_name']} {s['last_name']}"
            r["admission_number"] = s["admission_number"]
        result.append(r)
    return result


@router.post("/students/{student_id}/graduate")
async def graduate_student(student_id: str, request: Request):
    """Mark a student as passed out / graduated. Deactivates the student record."""
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    student = await db.students.find_one({"student_id": student_id, "is_active": True}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Block pass-out if fees are still pending
    pending = await db.student_ledger.count_documents({
        "student_id": student_id,
        "status": {"$in": ["pending", "overdue"]},
    })
    if pending > 0 and not body.get("force", False):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot mark as passed out: student has {pending} pending/overdue fee entries. Clear all dues first."
        )

    academic_year = student.get("academic_year", current_academic_year())
    remarks = body.get("remarks", "")

    await db.students.update_one(
        {"student_id": student_id},
        {"$set": {
            "is_active": False,
            "passed_out": True,
            "passed_out_year": academic_year,
            "deactivation_reason": f"12th Passed Out {academic_year}",
        }}
    )

    await create_audit_log("student", student_id, "graduate", {
        "class": student["class_name"],
        "academic_year": academic_year,
        "remarks": remarks,
    }, user)

    return {
        "message": f"{student['first_name']} {student['last_name']} has passed out of "
                   f"{student['class_name']} ({academic_year}).",
        "student_id": student_id,
    }
