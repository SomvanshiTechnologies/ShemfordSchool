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
import re as _re


def _stream_section(to_class: str, to_section: str, to_stream: Optional[str]) -> str:
    """For 11th/12th the section IS the stream (Science/Humanities). Normalize a
    legacy/mismatched section (e.g. a colour like 'Indigo') to the stream so
    validation and the student move use the correct section."""
    if _re.match(r"^(class\s*)?(11|12)(th)?$", (to_class or "").strip(), _re.I) and to_stream:
        return to_stream.strip().title()
    return to_section

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

    # Stream sections (Science/Humanities for 11th/12th) are not capacity-limited
    # like colour sections — they're streams holding many students. Only enforce
    # capacity for non-stream classes.
    is_stream = bool(_re.match(r"^(class\s*)?(11|12)(th)?$", (to_class or "").strip(), _re.I))
    if not is_stream:
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

    # For 11th/12th the section is the stream — store the normalized section.
    to_section = _stream_section(to_class, to_section, to_stream)

    # Does the student have any outstanding fees? A clean account upgrades
    # immediately (no approval step); an account with dues is QUEUED for admin
    # approval and shown in Upgradation History. The admin collects the dues,
    # then approves — and the approve step re-checks before promoting.
    # Dues in the TARGET (future) session — including the upgradation fee the
    # promotion itself charges — must NOT gate the upgrade. Only the student's
    # current-and-prior session dues count.
    has_pending_dues = False
    pending_dues_msg = ""
    if not body.get("force_upgrade", False):
        pending_agg = await db.student_ledger.aggregate([
            {"$match": {"student_id": student_id, "status": {"$in": ["pending", "overdue"]},
                        "academic_year": {"$ne": academic_year}}},
            {"$group": {"_id": "$academic_year", "count": {"$sum": 1}, "total": {"$sum": "$net_amount"}}},
            {"$sort": {"_id": 1}},
        ]).to_list(20)
        if pending_agg:
            has_pending_dues = True
            total_amount = sum(r["total"] for r in pending_agg)
            year_parts = [
                f"{r['_id']} (₹{r['total']:,.0f})" if r.get("_id") else f"₹{r['total']:,.0f}"
                for r in pending_agg
            ]
            pending_dues_msg = (
                f"Fees pending for {', '.join(year_parts)} (₹{total_amount:,.0f} total). "
                f"Collect the dues, then approve this request to complete the upgrade."
            )

    # An already-APPROVED upgrade for this year is a hard block. A PENDING
    # request is not — if the student now has no dues we complete that queued
    # request right away instead of forcing a separate approval step.
    blocking = await db.upgradation_records.find_one({
        "student_id": student_id,
        "academic_year": academic_year,
        "status": {"$in": ["pending_approval", "approved"]},
    })
    if blocking and blocking.get("status") == "approved":
        raise HTTPException(
            status_code=409,
            detail=f"Student was already upgraded to {blocking['to_class']} in {academic_year}."
        )
    if blocking and blocking.get("status") == "pending_approval":
        if has_pending_dues:
            # Still owes fees — keep it queued for manual approval after collection.
            raise HTTPException(
                status_code=409,
                detail=(pending_dues_msg or
                        "An upgrade request for this student is already awaiting approval. "
                        "Collect the pending dues, then approve it from Upgradation History."),
            )
        # No dues now — refresh the queued request to the freshly selected
        # target and complete it immediately (no manual approval needed).
        await _validate_upgrade_target(student, to_class, to_section, to_stream, academic_year,
                                       allow_capacity_override=body.get("admin_override", False))
        await db.upgradation_records.update_one(
            {"upgradation_id": blocking["upgradation_id"]},
            {"$set": {
                "from_class": student["class_name"],
                "from_section": student["section"],
                "from_stream": student.get("stream"),
                "to_class": to_class,
                "to_section": to_section,
                "to_stream": to_stream,
                "academic_year": academic_year,
                "notes": notes,
            }},
        )
        refreshed = await db.upgradation_records.find_one(
            {"upgradation_id": blocking["upgradation_id"]}, {"_id": 0})
        approval = await _perform_upgrade_approval(refreshed, user, auto=True)
        return {
            "upgradation": {**refreshed, **approval},
            "status": "approved",
            "auto_approved": True,
            "message": f"Upgrade auto-approved (no pending dues). Student moved to {to_class}." +
                       (f" Upgrade fee ₹{approval['upgradation_fee']:,.2f} added to pending fees."
                        if approval['upgradation_fee'] > 0 else ""),
            "upgradation_fee": approval["upgradation_fee"],
            "upgradation_fee_paid": False,
            "ledger_entries_created": approval["ledger_entries_created"],
        }

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

    # Auto-approve when the student has no pending dues — no point making
    # admin click "approve" again on a clean account.
    if not has_pending_dues and not body.get("force_upgrade", False):
        approval = await _perform_upgrade_approval(upg_dict, user, auto=True)
        return {
            "upgradation": {**upg_dict, **approval},
            "status": "approved",
            "auto_approved": True,
            "message": f"Upgrade auto-approved (no pending dues). Student moved to {to_class}." +
                       (f" Upgrade fee ₹{approval['upgradation_fee']:,.2f} added to pending fees."
                        if approval['upgradation_fee'] > 0 else ""),
            "upgradation_fee": approval["upgradation_fee"],
            "upgradation_fee_paid": False,
            "ledger_entries_created": approval["ledger_entries_created"],
        }

    return {
        "upgradation": upg_dict,
        "status": "pending_approval",
        "auto_approved": False,
        "has_pending_dues": has_pending_dues,
        "message": (pending_dues_msg or "Upgrade request created.") + " Awaiting admin approval.",
        # legacy keys some callers may still read
        "upgradation_fee": upgradation_fee,
        "upgradation_fee_paid": False,
    }


async def _perform_upgrade_approval(upg: dict, user: dict, *, auto: bool = False):
    """
    Shared approval routine — moves the student to the new class, creates
    the upgradation fee ledger entry, refreshes overdue flags, and marks
    the upgradation_record as 'approved'. Used by:
      - manual admin approval via /upgradation/{id}/approve
      - automatic approval from request_upgrade when the student has no
        pending dues (auto=True)
    """
    upgradation_id = upg["upgradation_id"]
    student = await db.students.find_one({"student_id": upg["student_id"], "is_active": True}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student no longer exists / inactive")

    # For 11th/12th the section is the stream — normalize any legacy/colour
    # section so validation and the move use a valid section.
    eff_section = _stream_section(upg["to_class"], upg["to_section"], upg.get("to_stream"))
    cfg = await _validate_upgrade_target(
        student, upg["to_class"], eff_section, upg.get("to_stream"),
        upg["academic_year"], allow_capacity_override=False,
    )
    upgradation_fee = cfg.get("upgradation_fee", upg.get("upgradation_fee", 0))

    upg_ledger_id = upg.get("upgradation_fee_ledger_id")
    if upgradation_fee > 0 and not upg_ledger_id:
        # Reuse an existing unpaid upgradation-fee entry for this target year
        # (e.g. left over from a prior aborted attempt) instead of creating a
        # duplicate.
        existing_fee = await db.student_ledger.find_one({
            "student_id": upg["student_id"],
            "academic_year": upg["academic_year"],
            "fee_component": "upgradation",
            "status": {"$in": ["pending", "overdue", "partially_paid"]},
        }, {"_id": 0, "ledger_id": 1})
        if existing_fee:
            upg_ledger_id = existing_fee["ledger_id"]
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

    # Phase 3 — snapshot the OUTGOING (from-session) enrollment into
    # student_session_history before moving the student, preserving the
    # previous academic year's class/section/roll. Idempotent on
    # (student_id, academic_year).
    now_hist = datetime.now(timezone.utc).isoformat()
    await db.student_session_history.update_one(
        {"student_id": upg["student_id"], "academic_year": student.get("academic_year")},
        {"$set": {
            "student_id": upg["student_id"],
            "admission_number": student.get("admission_number"),
            "academic_year": student.get("academic_year"),
            "class_name": student.get("class_name"),
            "section": student.get("section"),
            "stream": student.get("stream"),
            "roll_number": student.get("roll_number"),
            "promoted_from": student.get("class_name"),
            "promoted_to": upg["to_class"],
            "status": "promoted",
            "recorded_at": now_hist,
        }},
        upsert=True,
    )

    # Assign the next available roll number in the destination class for the new
    # year. Roll numbers are per-year-per-class — carrying the old class's roll
    # over can collide with a student already holding it in the new class.
    dest = await db.students.find(
        {"class_name": upg["to_class"], "section": eff_section,
         "stream": upg.get("to_stream"), "academic_year": upg["academic_year"],
         "is_active": True, "student_id": {"$ne": upg["student_id"]}},
        {"_id": 0, "roll_number": 1},
    ).to_list(5000)
    used_rolls = []
    for d in dest:
        try:
            used_rolls.append(int(d.get("roll_number")))
        except (TypeError, ValueError):
            continue
    new_roll = str(max(used_rolls) + 1) if used_rolls else "1"

    await db.students.update_one(
        {"student_id": upg["student_id"]},
        {"$set": {
            "class_name": upg["to_class"],
            "section": eff_section,
            "stream": upg.get("to_stream"),
            "academic_year": upg["academic_year"],
            "roll_number": new_roll,
            "fee_status": "pending",
        }}
    )

    # Record the INCOMING (to-session) enrollment so the new year appears in
    # the student's session timeline immediately.
    await db.student_session_history.update_one(
        {"student_id": upg["student_id"], "academic_year": upg["academic_year"]},
        {"$set": {
            "student_id": upg["student_id"],
            "admission_number": student.get("admission_number"),
            "academic_year": upg["academic_year"],
            "class_name": upg["to_class"],
            "section": eff_section,
            "stream": upg.get("to_stream"),
            "roll_number": new_roll,
            "promoted_from": student.get("class_name"),
            "promoted_to": upg["to_class"],
            "status": "current",
            "recorded_at": now_hist,
        }},
        upsert=True,
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
            "auto_approved": auto,
            "upgradation_fee": upgradation_fee,
            "upgradation_fee_ledger_id": upg_ledger_id,
        }}
    )

    await create_audit_log("upgradation", upgradation_id, "auto-approve" if auto else "approve", {
        "student_id": upg["student_id"],
        "to": f"{upg['to_class']}/{upg['to_section']}/{upg.get('to_stream')}",
        "academic_year": upg["academic_year"],
    }, user)

    return {
        "upgradation_id": upgradation_id,
        "status": "approved",
        "approved_by": user["user_id"],
        "approved_at": approved_at,
        "auto_approved": auto,
        "ledger_entries_created": ledger_count,
        "upgradation_fee": upgradation_fee,
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

    # Re-check dues at approval time: a student must not be promoted while any
    # fee is still pending/overdue. The admin collects the dues first, then
    # approves. Dues in the TARGET (future) year — including the upgradation fee
    # the promotion charges — are excluded; only current-and-prior dues gate it.
    pending_agg = await db.student_ledger.aggregate([
        {"$match": {"student_id": upg["student_id"], "status": {"$in": ["pending", "overdue"]},
                    "academic_year": {"$ne": upg["academic_year"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$net_amount"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    if pending_agg and pending_agg[0]["count"] > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve — student still has ₹{pending_agg[0]['total']:,.0f} in pending dues. "
                   f"Collect the dues first, then approve.",
        )

    result = await _perform_upgrade_approval(upg, user, auto=False)
    result["message"] = (
        f"Upgrade approved. Student moved to {upg['to_class']}." +
        (f" Upgrade fee ₹{result['upgradation_fee']:,.2f} added to pending fees."
         if result['upgradation_fee'] > 0 else "")
    )
    return result



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
    """
    Record payment of the upgradation fee.

    Supports:
    - Partial payment via optional `amount` (<= remaining_balance). The
      ledger entry stays 'partially_paid' until cleared.
    - Split payment via `payment_method='split'` + `split_payments={cash, online}`
      summing to the paid amount.
    The upgradation_record is marked fee-paid only when the ledger entry
    is fully cleared.
    """
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    body = await request.json()

    ledger_entry = await db.student_ledger.find_one({
        "student_id": student_id,
        "fee_component": "upgradation",
        "status": {"$in": ["pending", "overdue"]}
    }, {"_id": 0})
    if not ledger_entry:
        raise HTTPException(status_code=404, detail="No pending upgradation fee found")

    # How much of the entry is still due?
    rb = ledger_entry.get("remaining_balance")
    remaining = float(rb) if rb is not None and rb > 0 else float(ledger_entry.get("net_amount", 0))

    # Resolve payment amount — partial when `amount` < remaining.
    requested_amount = body.get("amount")
    if requested_amount is not None:
        try:
            requested_amount = round(float(requested_amount), 2)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid amount")
        if requested_amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be greater than 0")
        if requested_amount > remaining + 0.001:
            raise HTTPException(status_code=400,
                detail=f"Amount ₹{requested_amount:,.2f} exceeds remaining ₹{remaining:,.2f} on this entry.")
        pay_amount = requested_amount
    else:
        pay_amount = remaining
    is_partial = pay_amount < remaining - 0.001

    receipt_number = await get_next_receipt_number()
    payment = FeePayment(
        student_id=student_id,
        installment_ids=[ledger_entry["ledger_id"]],
        amount=pay_amount,
        payment_method=body.get("payment_method", "cash"),
        transaction_id=body.get("transaction_id"),
        collected_by=user["user_id"],
        remarks=body.get("remarks", "Upgradation fee"),
        academic_year=ledger_entry.get("academic_year", ""),
    )
    pay_dict = payment.model_dump()
    pay_dict["receipt_number"] = receipt_number
    pay_dict["created_at"] = pay_dict["created_at"].isoformat()

    # Split-payment breakdown — sums must equal pay_amount.
    split_payments = body.get("split_payments")
    if split_payments and isinstance(split_payments, dict):
        try:
            split_total = round(sum(float(v) for v in split_payments.values()), 2)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid split_payments format")
        if abs(split_total - pay_amount) > 0.01:
            raise HTTPException(status_code=400,
                detail=f"Split payment total ({split_total}) does not match amount ({pay_amount})")
        pay_dict["split_payments"] = {k: float(v) for k, v in split_payments.items() if float(v) > 0}

    await db.fee_payments.insert_one(pay_dict)

    today = datetime.now().strftime("%Y-%m-%d")
    prev_paid = float(ledger_entry.get("amount_paid") or 0)
    new_paid = round(prev_paid + pay_amount, 2)
    new_remaining = round(float(ledger_entry.get("net_amount", 0)) - new_paid, 2)
    if new_remaining < 0.005:
        new_status = "paid"
        new_remaining = 0
        ledger_set = {
            "status": new_status,
            "amount_paid": new_paid,
            "remaining_balance": 0,
            "paid_date": today,
            "payment_id": payment.payment_id,
            "receipt_number": receipt_number,
        }
    else:
        # Partial: keep status as pending (or overdue if past due_date) —
        # only amount_paid + remaining_balance change.
        past_due = ledger_entry.get("due_date") and ledger_entry["due_date"] < today
        new_status = "overdue" if past_due else "pending"
        ledger_set = {
            "status": new_status,
            "amount_paid": new_paid,
            "remaining_balance": new_remaining,
            # Stamp latest receipt so admin can preview the partial receipt
            "paid_date": today,
            "payment_id": payment.payment_id,
            "receipt_number": receipt_number,
        }
    await db.student_ledger.update_one(
        {"ledger_id": ledger_entry["ledger_id"]},
        {"$set": ledger_set}
    )

    # Mark upgradation record as fee paid ONLY when fully cleared
    if new_status == "paid":
        await db.upgradation_records.update_many(
            {"student_id": student_id, "upgradation_fee_ledger_id": ledger_entry["ledger_id"]},
            {"$set": {"upgradation_fee_paid": True, "upgradation_payment_id": payment.payment_id}}
        )

    # Recompute the student's overall fee_status (paid/pending/overdue) from the ledger
    await refresh_overdue_for_student(student_id)

    pay_dict.pop("_id", None)
    msg = (f"Partial payment of ₹{pay_amount:,.2f} recorded. "
           f"₹{new_remaining:,.2f} still due. Receipt: {receipt_number}") if is_partial else (
          f"Upgradation fee of ₹{pay_amount:,.2f} paid. Receipt: {receipt_number}")
    return {
        "payment": pay_dict,
        "receipt_number": receipt_number,
        "amount": pay_amount,
        "is_partial": is_partial,
        "remaining_balance": new_remaining,
        "message": msg,
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
