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


@router.post("/students/{student_id}/upgrade")
async def upgrade_student(student_id: str, request: Request):
    """
    Upgrade a student to a new class/section/stream.
    Creates upgradation fee ledger entry and new yearly/monthly entries for the new class.
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

    # Validate target class and section
    cls = await db.class_structures.find_one({"name": to_class, "is_active": True}, {"_id": 0})
    if not cls:
        raise HTTPException(status_code=400, detail=f"Class '{to_class}' not found")

    section_info = next((s for s in cls.get("sections", []) if s["section_name"] == to_section), None)
    if not section_info:
        raise HTTPException(status_code=400, detail=f"Section '{to_section}' not in {to_class}")

    # Check capacity
    current_count = await db.students.count_documents(
        {"class_name": to_class, "section": to_section, "is_active": True}
    )
    capacity = section_info.get("capacity", 40)
    if current_count >= capacity and not body.get("admin_override", False):
        raise HTTPException(status_code=400, detail=f"Section {to_section} is full ({current_count}/{capacity})")

    # Get fee config for new class
    cfg = await get_fee_config(to_class, academic_year, to_stream)
    if not cfg:
        raise HTTPException(
            status_code=400,
            detail=f"No fee config for {to_class}" + (f" ({to_stream})" if to_stream else "") +
                   f" in {academic_year}. " +
                   "Please run POST /fees/components/ensure-defaults to create default fee configurations."
        )

    from_class = student["class_name"]
    from_stream = student.get("stream")
    from_section = student["section"]

    # ── Create upgradation fee ledger entry ──────────────────────────────────
    upgradation_fee = cfg.get("upgradation_fee", 0)
    upg_ledger_id = None
    if upgradation_fee > 0:
        today = datetime.now().strftime("%Y-%m-%d")
        due_day = cfg.get("due_day", 10)
        now = datetime.now()
        due_date = f"{now.year}-{str(now.month).zfill(2)}-{str(due_day).zfill(2)}"
        entry = StudentLedgerEntry(
            student_id=student_id,
            admission_number=student.get("admission_number", ""),
            class_name=to_class,
            stream=to_stream,
            academic_year=academic_year,
            fee_component="upgradation",
            fee_type="one_time",
            description=f"Upgradation Fee ({from_class} → {to_class})",
            gross_amount=upgradation_fee,
            net_amount=upgradation_fee,
            due_date=due_date,
            status="pending",
        )
        d = entry.model_dump()
        d["created_at"] = d["created_at"].isoformat()
        await db.student_ledger.insert_one(d)
        upg_ledger_id = entry.ledger_id

    # ── Create upgradation record ─────────────────────────────────────────────
    upg = UpgradationRecord(
        student_id=student_id,
        from_class=from_class,
        to_class=to_class,
        from_stream=from_stream,
        to_stream=to_stream,
        from_section=from_section,
        to_section=to_section,
        academic_year=academic_year,
        upgradation_fee=upgradation_fee,
        upgradation_fee_ledger_id=upg_ledger_id,
        upgradation_fee_paid=False,
        performed_by=user["user_id"],
        notes=notes,
    )
    upg_dict = upg.model_dump()
    upg_dict["created_at"] = upg_dict["created_at"].isoformat()
    await db.upgradation_records.insert_one(upg_dict)
    upg_dict.pop("_id", None)

    # ── Update student record ─────────────────────────────────────────────────
    await db.students.update_one(
        {"student_id": student_id},
        {"$set": {
            "class_name": to_class,
            "section": to_section,
            "stream": to_stream,
            "academic_year": academic_year,
            "fee_status": "pending",
        }}
    )

    # ── Reload updated student ────────────────────────────────────────────────
    updated_student = await db.students.find_one({"student_id": student_id}, {"_id": 0})

    # ── Create new yearly fee ledger entries for new class ───────────────────
    today_str = datetime.now().strftime("%Y-%m-%d")
    admission_month = today_str[:7]
    ledger_count = await create_admission_ledger(updated_student, cfg, academic_year, admission_month)

    await refresh_overdue_for_student(student_id)

    await create_audit_log("upgradation", upg.upgradation_id, "upgrade", {
        "student_id": student_id,
        "from": f"{from_class}/{from_section}/{from_stream}",
        "to": f"{to_class}/{to_section}/{to_stream}",
        "academic_year": academic_year,
    }, user)

    return {
        "upgradation": upg_dict,
        "student_id": student_id,
        "new_class": to_class,
        "new_section": to_section,
        "new_stream": to_stream,
        "upgradation_fee": upgradation_fee,
        "ledger_entries_created": ledger_count,
        "message": f"Student upgraded from {from_class} to {to_class}. "
                   + (f"Upgradation fee of ₹{upgradation_fee:,.2f} pending." if upgradation_fee > 0 else ""),
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

    # Enrich with student names
    result = []
    for r in records:
        s = await db.students.find_one({"student_id": r["student_id"]}, {"_id": 0,
            "first_name": 1, "last_name": 1, "admission_number": 1})
        if s:
            r["student_name"] = f"{s['first_name']} {s['last_name']}"
            r["admission_number"] = s["admission_number"]
        result.append(r)
    return result
