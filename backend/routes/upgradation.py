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
from auth_utils import get_current_user, require_roles, create_audit_log, request_session
from routes.fees import (
    get_fee_config, create_admission_ledger, refresh_overdue_for_student,
    get_remaining_months, current_academic_year, get_next_receipt_number,
    active_session,
)
from models import FeePayment

router = APIRouter()


async def _backfill_from_academic_year():
    """
    One-time migration: stamp from_academic_year on every upgradation_record
    that is missing it by computing academic_year − 1 year.
    e.g. academic_year="2026-2027" → from_academic_year="2025-2026"
    Safe to re-run (only touches records where from_academic_year is absent).
    """
    legacy = await db.upgradation_records.find(
        {"from_academic_year": {"$in": [None, ""]}, "academic_year": {"$exists": True}},
        {"_id": 1, "academic_year": 1},
    ).to_list(10000)
    # Also catch records where the field simply doesn't exist in the document
    legacy += await db.upgradation_records.find(
        {"from_academic_year": {"$exists": False}, "academic_year": {"$exists": True}},
        {"_id": 1, "academic_year": 1},
    ).to_list(10000)

    ops = []
    for rec in legacy:
        ay = rec.get("academic_year", "")
        m = _re.match(r"^(\d{4})-(\d{4})$", ay)
        if not m:
            continue
        y1, y2 = int(m.group(1)), int(m.group(2))
        from_ay = f"{y1 - 1}-{y2 - 1}"
        ops.append((rec["_id"], from_ay))

    for oid, from_ay in ops:
        await db.upgradation_records.update_one(
            {"_id": oid},
            {"$set": {"from_academic_year": from_ay}},
        )

    return len(ops)


async def _backfill_streams():
    """
    One-time migration: copy section → stream (and set from_stream / to_stream) for
    11th/12th records and students where stream was never stored.
    Valid stream names are read from class_structures (admin-configured, not hardcoded).
    Safe to re-run — only touches records where stream is absent/null.
    """
    stream_cls_pat = _re.compile(r"^(class\s*)?(11|12)(th)?$", _re.I)

    # Gather valid section (= stream) names for 11th/12th from class_structures
    stream_classes = await db.class_structures.find(
        {}, {"_id": 0, "name": 1, "sections": 1}
    ).to_list(200)
    valid_streams = set()
    for cls in stream_classes:
        if stream_cls_pat.match((cls.get("name") or "").strip()):
            for sec in (cls.get("sections") or []):
                sname = (sec.get("section_name") or "").strip()
                if sname:
                    valid_streams.add(sname.lower())

    if not valid_streams:
        return 0

    n = 0
    # Fix upgradation_records
    async for rec in db.upgradation_records.find({}):
        updates = {}
        to_cls = (rec.get("to_class") or "").strip()
        if stream_cls_pat.match(to_cls) and not rec.get("to_stream"):
            sec = (rec.get("to_section") or "").strip()
            if sec.lower() in valid_streams:
                updates["to_stream"] = sec.title()
        from_cls = (rec.get("from_class") or "").strip()
        if stream_cls_pat.match(from_cls) and not rec.get("from_stream"):
            sec = (rec.get("from_section") or "").strip()
            if sec.lower() in valid_streams:
                updates["from_stream"] = sec.title()
        if updates:
            await db.upgradation_records.update_one(
                {"_id": rec["_id"]}, {"$set": updates}
            )
            n += 1

    # Fix students in 11th/12th with null stream
    async for stu in db.students.find({"stream": None, "is_active": True}):
        cls_name = (stu.get("class_name") or "").strip()
        if stream_cls_pat.match(cls_name):
            sec = (stu.get("section") or "").strip()
            if sec.lower() in valid_streams:
                await db.students.update_one(
                    {"student_id": stu["student_id"]},
                    {"$set": {"stream": sec.title()}}
                )
                n += 1

    return n


async def _validate_upgrade_target(student: dict, to_class: str, to_section: str, to_stream: Optional[str],
                                   academic_year: str, allow_capacity_override: bool):
    """Shared validator used by both request-creation and approval — keeps the rules in one place."""
    cls = await db.class_structures.find_one({"name": to_class, "is_active": True}, {"_id": 0})
    if not cls:
        raise HTTPException(status_code=400, detail=f"Class '{to_class}' not found")

    is_stream = bool(_re.match(r"^(class\s*)?(11|12)(th)?$", (to_class or "").strip(), _re.I))

    if is_stream:
        # For 11th/12th the section IS the stream. Validate against the class's
        # configured streams (case-insensitive) rather than the literal sections
        # list — that list may still carry legacy colour sections or differ in
        # case ("Science" vs "science"). Streams aren't capacity-limited like
        # colour sections, so no capacity check.
        valid = {str(s).strip().lower() for s in (cls.get("streams") or [])} \
            or {(s.get("section_name") or "").strip().lower() for s in cls.get("sections", [])}
        if (to_section or "").strip().lower() not in valid:
            raise HTTPException(status_code=400, detail=f"Section '{to_section}' not in {to_class}")
    else:
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
    academic_year = body.get("academic_year") or await active_session()
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
                f"{r['_id']} (Rs.{r['total']:,.0f})" if r.get("_id") else f"Rs.{r['total']:,.0f}"
                for r in pending_agg
            ]
            pending_dues_msg = (
                f"Fees pending for {', '.join(year_parts)} (Rs.{total_amount:,.0f} total). "
                f"Collect the dues, then approve this request to complete the upgrade."
            )

    # An already-APPROVED upgrade for this year is a hard block. A PENDING
    # request is not — if the student now has no dues we complete that queued
    # request right away instead of forcing a separate approval step.
    # Query without status filter to catch orphaned records from previous attempts.
    blocking = await db.upgradation_records.find_one({
        "student_id": student_id,
        "academic_year": academic_year,
    })
    if blocking and blocking.get("status") == "approved":
        raise HTTPException(
            status_code=409,
            detail=f"Student was already upgraded to {blocking['to_class']} in {academic_year}."
        )
    if blocking and blocking.get("status") not in ("pending_approval", "approved", None):
        # Orphaned record from a failed/cancelled previous attempt — remove it so a
        # fresh request can proceed.
        await db.upgradation_records.delete_one({"upgradation_id": blocking["upgradation_id"]})
        blocking = None
    if blocking and blocking.get("status") == "pending_approval":
        if has_pending_dues and not body.get("upgradation_fee_pre_paid", False):
            # Still owes fees — keep it queued for manual approval after collection.
            raise HTTPException(
                status_code=409,
                detail=(pending_dues_msg or
                        "An upgrade request for this student is already awaiting approval. "
                        "Collect the pending dues, then approve it from Upgradation History."),
            )
        if body.get("upgradation_fee_pre_paid", False):
            # Fee collected first — remove the queued request so we can promote directly
            await db.upgradation_records.delete_one({"upgradation_id": blocking["upgradation_id"]})
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
                "from_academic_year": student.get("academic_year"),
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
                       (f" Upgrade fee Rs.{approval['upgradation_fee']:,.2f} added to pending fees."
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
        from_academic_year=student.get("academic_year"),
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

    # Upgradation fee was collected BEFORE the upgrade request — promote directly
    # without recording in history (same path as no-dues auto-approve).
    if body.get("upgradation_fee_pre_paid", False):
        upg_dict.pop("_id", None)
        await create_audit_log("upgradation", upg.upgradation_id, "direct-upgrade-fee-paid", {
            "student_id": student_id,
            "to": f"{to_class}/{to_section}/{to_stream}",
            "academic_year": academic_year,
        }, user)
        approval = await _perform_upgrade_approval(upg_dict, user, auto=True)
        return {
            "upgradation": {**upg_dict, **approval},
            "status": "approved",
            "auto_approved": True,
            "message": f"Student upgraded to {to_class}.",
            "upgradation_fee": approval["upgradation_fee"],
            "upgradation_fee_paid": True,
            "ledger_entries_created": approval["ledger_entries_created"],
        }

    # Clean account (no pending dues) → upgrade immediately WITHOUT recording it
    # in Upgradation History. History is the approval queue for dues-driven
    # upgrades only — a direct promotion shouldn't appear there. The move is
    # still captured in the audit log.
    if not has_pending_dues and not body.get("force_upgrade", False):
        upg_dict.pop("_id", None)
        await create_audit_log("upgradation", upg.upgradation_id, "direct-upgrade", {
            "student_id": student_id,
            "to": f"{to_class}/{to_section}/{to_stream}",
            "academic_year": academic_year,
        }, user)
        approval = await _perform_upgrade_approval(upg_dict, user, auto=True)
        return {
            "upgradation": {**upg_dict, **approval},
            "status": "approved",
            "auto_approved": True,
            "message": f"Student upgraded to {to_class}." +
                       (f" Upgrade fee Rs.{approval['upgradation_fee']:,.2f} added to pending fees."
                        if approval['upgradation_fee'] > 0 else ""),
            "upgradation_fee": approval["upgradation_fee"],
            "upgradation_fee_paid": False,
            "ledger_entries_created": approval["ledger_entries_created"],
        }

    # Has dues / forced → persist a pending-approval record (this is what shows
    # in Upgradation History) and wait for the admin to approve it.
    try:
        await db.upgradation_records.insert_one(upg_dict)
    except Exception as exc:
        if "duplicate key" in str(exc).lower() or "11000" in str(exc):
            raise HTTPException(
                status_code=409,
                detail=f"An upgrade request for {academic_year} already exists for this student."
            )
        raise
    upg_dict.pop("_id", None)

    await create_audit_log("upgradation", upg.upgradation_id, "request", {
        "student_id": student_id,
        "to": f"{to_class}/{to_section}/{to_stream}",
        "academic_year": academic_year,
    }, user)

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

    # Resolve effective section and stream for 11th/12th.
    # Legacy records may have to_stream = null and to_section = a colour name (e.g. "Blue")
    # because the student was assigned a colour section when first enrolled in 11th.
    # Recovery order: to_stream → (to_section if it is a valid stream) → student.stream.
    # A student moving from 11th to 12th always stays in the same stream.
    eff_section = _stream_section(upg["to_class"], upg.get("to_section", ""), upg.get("to_stream"))
    resolved_stream = upg.get("to_stream")  # may be None for legacy records

    is_stream_cls = bool(_re.match(r"^(class\s*)?(11|12)(th)?$", (upg.get("to_class") or "").strip(), _re.I))
    if is_stream_cls and not resolved_stream:
        # _stream_section returned to_section unchanged because to_stream was null.
        # If to_section doesn't look like a stream (e.g. it's a colour), fall back
        # to the student's current stream field.
        fallback = (student.get("stream") or "").strip()
        if fallback:
            resolved_stream = fallback.lower()
            eff_section = fallback.title()
            # Heal the stored record so history display is correct going forward
            await db.upgradation_records.update_one(
                {"upgradation_id": upgradation_id},
                {"$set": {"to_stream": resolved_stream, "to_section": eff_section,
                          "from_stream": (student.get("stream") or fallback).lower()}}
            )
        else:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot approve: stream not set for student in {upg.get('from_class', '11th')}. "
                    "Please open the student's profile in the Students module, set their Stream "
                    "(Science or Humanities), save, then retry approval."
                )
            )

    cfg = await _validate_upgrade_target(
        student, upg["to_class"], eff_section, resolved_stream,
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
            "status": {"$in": ["pending", "overdue", "partially_paid", "paid"]},
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

    # Detect partial-completion: a previous approval attempt moved the student
    # but crashed before marking the upgradation_record as 'approved'.
    # In this state the from-session history snapshot was already written (or
    # would be wrong if re-written now), so skip it.
    already_moved = (
        student.get("class_name") == upg["to_class"]
        and student.get("academic_year") == upg["academic_year"]
    )

    # Phase 3 — snapshot the OUTGOING (from-session) enrollment into
    # student_session_history before moving the student, preserving the
    # previous academic year's class/section/roll. Idempotent on
    # (student_id, academic_year). Skipped when the student was already moved
    # by a prior partial run (snapshot data would be stale/wrong).
    now_hist = datetime.now(timezone.utc).isoformat()
    if not already_moved:
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
         "stream": resolved_stream, "academic_year": upg["academic_year"],
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
            "stream": resolved_stream,
            "academic_year": upg["academic_year"],
            "roll_number": new_roll,
            "fee_status": "pending",
            "last_upgraded_at": datetime.now(timezone.utc).isoformat(),
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
            "stream": resolved_stream,
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

    # Note: approval is NOT blocked by pending dues. The admin can see the
    # outstanding amount in the Upgradation History queue (and optionally collect
    # it there). If they approve anyway, the student is promoted and any unpaid
    # dues remain on the ledger — the student/parent settles them from My Fees.
    result = await _perform_upgrade_approval(upg, user, auto=False)
    result["message"] = (
        f"Upgrade approved. Student moved to {upg['to_class']}." +
        (f" Upgrade fee Rs.{result['upgradation_fee']:,.2f} added to pending fees."
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


@router.post("/upgradation/{upgradation_id}/rollback")
async def rollback_upgrade(upgradation_id: str, request: Request):
    """
    Rollback a pending upgrade that was partially applied — restores the student
    to their original class/section/stream/academic_year from the upgradation
    record's from_* fields, removes any incomplete session history, and marks
    the record as rejected.
    """
    user = await require_roles(UserRole.ADMIN)(request)

    upg = await db.upgradation_records.find_one({"upgradation_id": upgradation_id}, {"_id": 0})
    if not upg:
        raise HTTPException(status_code=404, detail="Upgrade request not found")
    if upg.get("status") not in ("pending_approval", None):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot rollback — request is already '{upg.get('status')}'."
        )

    student = await db.students.find_one({"student_id": upg["student_id"]}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    from_class = upg.get("from_class") or student.get("class_name")
    from_section = upg.get("from_section") or student.get("section")
    from_stream = upg.get("from_stream") or student.get("stream")
    from_ay = upg.get("from_academic_year") or student.get("academic_year")

    if not from_ay:
        raise HTTPException(status_code=400, detail="Cannot rollback: from_academic_year is not recorded in the upgrade request.")

    # Restore student to pre-upgrade state
    await db.students.update_one(
        {"student_id": upg["student_id"]},
        {"$set": {
            "class_name": from_class,
            "section": from_section,
            "stream": from_stream,
            "academic_year": from_ay,
            "fee_status": student.get("fee_status", "pending"),
        }}
    )

    # Remove the partially-written to-session history record (if any)
    await db.student_session_history.delete_one({
        "student_id": upg["student_id"],
        "academic_year": upg["academic_year"],
    })

    # Mark upgradation record as rolled back
    await db.upgradation_records.update_one(
        {"upgradation_id": upgradation_id},
        {"$set": {
            "status": "rejected",
            "rejection_reason": "Rolled back by admin — partial upgrade reversed",
            "approved_by": user["user_id"],
            "approved_at": datetime.now(timezone.utc).isoformat(),
        }}
    )

    await create_audit_log("upgradation", upgradation_id, "rollback", {
        "student_id": upg["student_id"],
        "restored_to": f"{from_class}/{from_section}/{from_ay}",
    }, user)

    return {
        "upgradation_id": upgradation_id,
        "status": "rolled_back",
        "message": f"Student restored to {from_class} / {from_ay}.",
    }


@router.post("/students/{student_id}/upgrade/create-fee-entry")
async def create_upgrade_fee_entry(student_id: str, request: Request):
    """
    Pre-creates the upgradation fee ledger entry so the admin can collect it
    via /fees/pay BEFORE requesting the upgrade. Reuses any existing unpaid entry.
    Returns {ledger_id, upgradation_fee}.
    """
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    student = await db.students.find_one({"student_id": student_id, "is_active": True}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    to_class = body.get("to_class")
    to_section = body.get("to_section")
    to_stream = body.get("to_stream")
    academic_year = body.get("academic_year") or await active_session()

    if not to_class or not to_section:
        raise HTTPException(status_code=400, detail="to_class and to_section are required")

    to_section = _stream_section(to_class, to_section, to_stream)
    cfg = await _validate_upgrade_target(student, to_class, to_section, to_stream, academic_year,
                                          allow_capacity_override=False)
    upgradation_fee = cfg.get("upgradation_fee", 0)

    if upgradation_fee <= 0:
        return {"ledger_id": None, "upgradation_fee": 0}

    # Reuse existing unpaid entry to avoid duplicate charges
    existing = await db.student_ledger.find_one({
        "student_id": student_id,
        "academic_year": academic_year,
        "fee_component": "upgradation",
        "status": {"$in": ["pending", "overdue", "partially_paid"]},
    }, {"_id": 0, "ledger_id": 1})
    if existing:
        ledger_id = existing["ledger_id"]
    else:
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
            description=f"Upgradation Fee ({student['class_name']} → {to_class})",
            gross_amount=upgradation_fee,
            net_amount=upgradation_fee,
            due_date=due_date,
            status="pending",
        )
        d = entry.model_dump()
        d["created_at"] = d["created_at"].isoformat()
        await db.student_ledger.insert_one(d)
        ledger_id = entry.ledger_id

    # Link the ledger entry back to any matching pending_approval record so
    # get_upgradation_history can sync fee-paid status from the live ledger.
    await db.upgradation_records.update_many(
        {
            "student_id": student_id,
            "academic_year": academic_year,
            "status": "pending_approval",
            "upgradation_fee_ledger_id": None,
        },
        {"$set": {"upgradation_fee_ledger_id": ledger_id}},
    )

    return {"ledger_id": ledger_id, "upgradation_fee": upgradation_fee}


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
                detail=f"Amount Rs.{requested_amount:,.2f} exceeds remaining Rs.{remaining:,.2f} on this entry.")
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
    msg = (f"Partial payment of Rs.{pay_amount:,.2f} recorded. "
           f"Rs.{new_remaining:,.2f} still due. Receipt: {receipt_number}") if is_partial else (
          f"Upgradation fee of Rs.{pay_amount:,.2f} paid. Receipt: {receipt_number}")
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
    status: Optional[str] = None,
    limit: int = 500,
):
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    q = {}
    if student_id:
        q["student_id"] = student_id
    if academic_year:
        q["academic_year"] = academic_year
    else:
        # Scope to the session the admin is viewing — the FROM session
        # (the year the student was promoted out of).
        sess = request_session(request)
        if sess:
            q["from_academic_year"] = sess
    if status:
        q["status"] = status
    sort_field = "approved_at" if status == "approved" else "created_at"
    records = await db.upgradation_records.find(q, {"_id": 0}).sort(sort_field, -1).to_list(limit)

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

    # For records whose ledger_id is not set yet (e.g. "Send for Approval" path),
    # do a fallback bulk lookup by student_id + academic_year + fee_component.
    unlinked = [
        r for r in records
        if not r.get("upgradation_fee_ledger_id") and r.get("upgradation_fee", 0) > 0
    ]
    fallback_map = {}  # (student_id, academic_year) -> ledger entry
    if unlinked:
        keys = list({(r["student_id"], r["academic_year"]) for r in unlinked})
        student_id_list = list({k[0] for k in keys})
        ay_list = list({k[1] for k in keys})
        fallback_rows = await db.student_ledger.find(
            {
                "student_id": {"$in": student_id_list},
                "academic_year": {"$in": ay_list},
                "fee_component": "upgradation",
            },
            {"_id": 0, "student_id": 1, "academic_year": 1,
             "ledger_id": 1, "status": 1, "paid_date": 1, "payment_id": 1, "receipt_number": 1},
        ).to_list(500)
        for row in fallback_rows:
            fallback_map[(row["student_id"], row["academic_year"])] = row
        # Also link the ledger_id back to the upgradation_records so future calls are fast
        for row in fallback_rows:
            await db.upgradation_records.update_many(
                {
                    "student_id": row["student_id"],
                    "academic_year": row["academic_year"],
                    "upgradation_fee_ledger_id": None,
                },
                {"$set": {"upgradation_fee_ledger_id": row["ledger_id"]}},
            )

    # Bulk-fetch each student's outstanding dues (pending/overdue), grouped by
    # student + academic_year, so the approval queue can flag students who still
    # owe fees. The TARGET year is excluded per-record below (the upgradation fee
    # the promotion itself charges must not count as a blocking due).
    student_ids = list({r["student_id"] for r in records})
    dues_map = {}  # student_id -> { academic_year: total }
    if student_ids:
        dues_rows = await db.student_ledger.aggregate([
            {"$match": {"student_id": {"$in": student_ids},
                        "status": {"$in": ["pending", "overdue"]}}},
            {"$group": {"_id": {"sid": "$student_id", "ay": "$academic_year"},
                        "total": {"$sum": "$net_amount"}}},
        ]).to_list(5000)
        for row in dues_rows:
            sid = row["_id"]["sid"]
            dues_map.setdefault(sid, {})[row["_id"].get("ay")] = row["total"]

    result = []
    for r in records:
        # Sync fee-paid status from the live ledger (DB-driven, never stale)
        lid = r.get("upgradation_fee_ledger_id")
        entry = (ledger_map.get(lid) if lid
                 else fallback_map.get((r["student_id"], r.get("academic_year"))))
        if entry:
            r["upgradation_fee_paid"] = entry.get("status") == "paid"
            r["upgradation_fee_status"] = entry.get("status", "pending")
            r["upgradation_fee_paid_date"] = entry.get("paid_date")
            r["upgradation_fee_payment_id"] = entry.get("payment_id")
            r["upgradation_fee_receipt"] = entry.get("receipt_number")
            # Stamp the ledger_id on the record if it was missing
            if not lid:
                r["upgradation_fee_ledger_id"] = entry["ledger_id"]
        elif r.get("upgradation_fee", 0) > 0:
            r["upgradation_fee_status"] = "paid" if r.get("upgradation_fee_paid") else "pending"
        else:
            r["upgradation_fee_status"] = "no_fee"

        # Student's outstanding dues EXCLUDING the target (promotion) year.
        by_year = dues_map.get(r["student_id"], {})
        dues_total = sum(v for ay, v in by_year.items() if ay != r.get("academic_year"))
        r["student_dues_total"] = round(dues_total, 2)

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
