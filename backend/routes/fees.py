"""
Shemford Futuristic School — Component-Based Fee Management System

Fee structure:
  One-time  : Registration, Admission, Caution Deposit
  Yearly    : Annual Charge, Activity Fee, Exam Fee, Lab Fee
  Monthly   : Tuition (12 months; 1st month collected at admission, rest month-by-month)

Admission flow:
  - Collect one-time + yearly + 1st month tuition → generate admission number → create ledger
  - Remaining 11 monthly tuition entries auto-generated after admission

Sibling discount:
  - 50% off admission fee
  - 15% off monthly tuition

Stream support (class 11/12):
  - Science, Arts, Commerce each have separate fee configs

Annual increase:
  - Admin can apply N% increase to all or selected classes for next session
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from typing import Optional, List
from datetime import datetime, timezone, date
import io
import logging
import uuid
from pymongo import UpdateOne

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.enums import TA_CENTER, TA_LEFT

from database import db, client as mongo_client
from models import (
    UserRole, FeeComponentConfig, StudentLedgerEntry, FeePayment,
    FeeComponentType, FEE_COMPONENT_FREQUENCY
)
from auth_utils import get_current_user, require_roles, create_audit_log

router = APIRouter()
logger = logging.getLogger(__name__)

# Maps fee-config field names → canonical fee_component identifiers (FeeComponentType values)
CFG_FIELD_TO_COMPONENT = {
    "registration_fee": "registration",
    "admission_fee":    "admission",
    "caution_deposit":  "caution_deposit",
    "annual_charge":    "annual_charge",
    "activity_fee":     "activity_fee",
    "exam_fee":         "exam_fee",
    "lab_fee":          "lab_fee",
    "ai_robotics_fee":  "ai_robotics_fee",
    "monthly_tuition":  "tuition",
    "upgradation_fee":  "upgradation",
}

ACADEMIC_MONTHS = ["04", "05", "06", "07", "08", "09", "10", "11", "12", "01", "02", "03"]

# ─── helpers ─────────────────────────────────────────────────────────────────

import re

def validate_academic_year(y: str):
    """Raise HTTPException if academic_year is not in YYYY-YYYY+1 format. (#14)"""
    if not re.match(r"^\d{4}-\d{4}$", y):
        raise HTTPException(status_code=400, detail="academic_year must be in YYYY-YYYY format (e.g. 2025-2026)")
    start, end = int(y[:4]), int(y[5:])
    if end != start + 1:
        raise HTTPException(status_code=400, detail="academic_year end year must be start year + 1 (e.g. 2025-2026)")


_FEE_AMOUNT_FIELDS = [
    "registration_fee", "admission_fee", "caution_deposit", "annual_charge",
    "activity_fee", "exam_fee", "lab_fee", "ai_robotics_fee",
    "monthly_tuition", "upgradation_fee", "late_fee",
]


def validate_fee_amounts(body: dict):
    """Raise HTTPException if any fee field is negative. (#13)"""
    for field in _FEE_AMOUNT_FIELDS:
        if field in body:
            val = float(body[field])
            if val < 0:
                raise HTTPException(status_code=400, detail=f"{field} cannot be negative")


def get_academic_year_months(academic_year: str) -> List[str]:
    start_year = int(academic_year.split("-")[0])
    months = []
    for m in ACADEMIC_MONTHS:
        yr = start_year if int(m) >= 4 else start_year + 1
        months.append(f"{yr}-{m}")
    return months


def get_remaining_months(academic_year: str, from_date: str) -> List[str]:
    all_months = get_academic_year_months(academic_year)
    from_month = from_date[:7]
    remaining = [m for m in all_months if m >= from_month]
    return remaining if remaining else all_months


def current_academic_year() -> str:
    now = datetime.now()
    if now.month >= 4:
        return f"{now.year}-{now.year + 1}"
    return f"{now.year - 1}-{now.year}"


def get_fy_prefix() -> str:
    now = datetime.now()
    if now.month >= 4:
        return f"{now.year}-{str(now.year + 1)[-2:]}"
    return f"{now.year - 1}-{str(now.year)[-2:]}"


async def get_next_receipt_number() -> str:
    fy = get_fy_prefix()
    counter = await db.counters.find_one_and_update(
        {"_id": f"receipt_{fy}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return f"REC/{fy}/{str(counter['seq']).zfill(4)}"


async def get_fee_config(class_name: str, academic_year: str, stream: Optional[str] = None) -> Optional[dict]:
    """
    Fetch the component fee config for a class + stream + year.
    Falls back to no-stream config if stream-specific one not found.
    """
    query = {"class_name": class_name, "academic_year": academic_year, "is_active": True}
    if stream:
        cfg = await db.fee_component_configs.find_one({**query, "stream": stream}, {"_id": 0})
        if cfg:
            logger.info(f"Fee config found: class={class_name} stream={stream} year={academic_year}")
            return cfg
        logger.warning(f"Fee config NOT found for class={class_name} stream={stream} year={academic_year}, trying no-stream fallback")
    # fallback — config without stream
    cfg = await db.fee_component_configs.find_one({**query, "stream": None}, {"_id": 0})
    if cfg:
        logger.info(f"Fee config found (no-stream fallback): class={class_name} year={academic_year}")
    else:
        logger.warning(f"Fee config NOT found at all: class={class_name} stream={stream} year={academic_year}")
    return cfg


async def check_sibling(student_id: str, parent_id: Optional[str], parent_email: Optional[str]) -> bool:
    """Return True if this student has an active sibling already enrolled."""
    if not parent_id and not parent_email:
        return False
    q = {"is_active": True, "student_id": {"$ne": student_id}}
    if parent_id:
        q["parent_id"] = parent_id
    elif parent_email:
        q["parent_email"] = parent_email
    return await db.students.count_documents(q) > 0


async def refresh_overdue_for_student(student_id: str):
    """Mark pending ledger entries as overdue when past due date; apply late fee."""
    today = datetime.now().strftime("%Y-%m-%d")

    await db.student_ledger.update_many(
        {"student_id": student_id, "status": "pending", "due_date": {"$lt": today}},
        {"$set": {"status": "overdue"}}
    )

    # Apply late fees for overdue tuition entries (if class config has it enabled)
    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if student:
        cfg = await get_fee_config(
            student.get("class_name", ""),
            student.get("academic_year", current_academic_year()),
            student.get("stream")
        )
        if cfg and cfg.get("late_fee_enabled") and cfg.get("late_fee", 0) > 0:
            late_fee_amount = cfg["late_fee"]
            overdue_no_late = await db.student_ledger.find({
                "student_id": student_id,
                "status": "overdue",
                "late_fee_applied": 0,
                "fee_component": "tuition"
            }, {"_id": 0}).to_list(100)
            for entry in overdue_no_late:
                new_net = entry["gross_amount"] - entry.get("concession_amount", 0) + late_fee_amount
                await db.student_ledger.update_one(
                    {"ledger_id": entry["ledger_id"]},
                    {"$set": {"late_fee_applied": late_fee_amount, "net_amount": new_net}}
                )

    # Update student fee_status
    overdue = await db.student_ledger.count_documents({"student_id": student_id, "status": "overdue"})
    pending = await db.student_ledger.count_documents({"student_id": student_id, "status": {"$in": ["pending", "overdue"]}})
    if overdue > 0:
        await db.students.update_one({"student_id": student_id}, {"$set": {"fee_status": "overdue", "app_locked": True}})
    elif pending > 0:
        await db.students.update_one({"student_id": student_id}, {"$set": {"fee_status": "pending", "app_locked": False}})
    else:
        await db.students.update_one({"student_id": student_id}, {"$set": {"fee_status": "paid", "app_locked": False}})


def build_admission_fee_breakdown(cfg: dict, is_sibling: bool) -> List[dict]:
    """
    Build the full fee breakdown for admission time:
    one-time fees + yearly fees + 1st month tuition.
    """
    sibling_adm_disc = cfg.get("sibling_admission_discount_amount", 0) if is_sibling else 0
    sibling_tuit_disc = cfg.get("sibling_tuition_discount_amount", 0) if is_sibling else 0

    items = []
    # One-time fees
    for cfg_field, label in [
        ("registration_fee", "Registration Fee"),
        ("admission_fee", "Admission Fee"),
        ("caution_deposit", "Caution Deposit (Refundable)"),
    ]:
        amount = cfg.get(cfg_field, 0)
        if amount > 0:
            discount = 0
            if cfg_field == "admission_fee" and sibling_adm_disc:
                discount = min(sibling_adm_disc, amount)  # Don't discount more than the fee amount
            items.append({
                "fee_component": CFG_FIELD_TO_COMPONENT[cfg_field],
                "fee_type": "one_time",
                "label": label,
                "gross_amount": amount,
                "discount_amount": discount,
                "net_amount": amount - discount,
                "sibling_discount_amount": discount if cfg_field == "admission_fee" else 0,
            })
    # Yearly fees
    for comp, label in [
        ("annual_charge", "Annual Charge"),
        ("activity_fee", "Activity Fee"),
        ("exam_fee", "Exam Fee"),
        ("lab_fee", "Lab Fee"),
        ("ai_robotics_fee", "AI & Robotics Fee"),
    ]:
        amount = cfg.get(comp, 0)
        if amount > 0:
            items.append({
                "fee_component": comp,
                "fee_type": "yearly",
                "label": label,
                "gross_amount": amount,
                "discount_amount": 0,
                "net_amount": amount,
                "sibling_discount_amount": 0,
            })
    # 1st month tuition
    tuition = cfg.get("monthly_tuition", 0)
    if tuition > 0:
        disc = min(sibling_tuit_disc, tuition) if sibling_tuit_disc else 0  # Don't discount more than tuition
        items.append({
            "fee_component": "tuition",
            "fee_type": "monthly",
            "label": "Tuition (1st Month)",
            "gross_amount": tuition,
            "discount_amount": disc,
            "net_amount": tuition - disc,
            "sibling_discount_amount": disc,
        })
    return items


def _due_date(year_month: str, due_day: int) -> str:
    """
    Compute due date for a fee entry: YYYY-MM-{due_day}.
    If the due date would be in the past (entry created late), push it to next month so the
    entry isn't immediately overdue on creation.
    """
    yr, mn = year_month.split("-")
    candidate = f"{yr}-{mn}-{str(due_day).zfill(2)}"
    today = datetime.now().strftime("%Y-%m-%d")
    if candidate < today:
        m, y = int(mn), int(yr)
        if m == 12:
            m, y = 1, y + 1
        else:
            m += 1
        candidate = f"{y}-{str(m).zfill(2)}-{str(due_day).zfill(2)}"
    return candidate


async def create_admission_ledger(student: dict, cfg: dict, academic_year: str, admission_month: str):
    """
    Create all ledger entries for a newly admitted student:
    - One-time fees
    - Yearly fees
    - 1st month tuition
    - Remaining 11 monthly tuition entries (status=pending)
    """
    student_id = student["student_id"]
    admission_number = student.get("admission_number", "")
    class_name = student["class_name"]
    stream = student.get("stream")
    is_sibling = student.get("is_sibling", False)
    due_day = cfg.get("due_day", 10)

    sibling_adm_disc = cfg.get("sibling_admission_discount_amount", 0) if is_sibling else 0
    sibling_tuit_disc = cfg.get("sibling_tuition_discount_amount", 0) if is_sibling else 0

    all_months = get_academic_year_months(academic_year)
    # Month index of admission month
    remaining_months = get_remaining_months(academic_year, f"{admission_month}-01")

    ledger_entries = []

    # — One-time fees —
    for cfg_field, label in [
        ("registration_fee", "Registration Fee"),
        ("admission_fee", "Admission Fee"),
        ("caution_deposit", "Caution Deposit (Refundable)"),
    ]:
        gross = cfg.get(cfg_field, 0)
        if gross <= 0:
            continue
        # One-time fees (Registration, Admission, Caution Deposit) are charged ONCE per student.
        # Skip if the student already has this fee in ANY class/year — even if paid in a previous class.
        if await db.student_ledger.find_one({"student_id": student_id, "fee_component": CFG_FIELD_TO_COMPONENT[cfg_field]}, {"_id": 1}):
            continue
        disc = 0
        disc_reason = None
        if cfg_field == "admission_fee" and sibling_adm_disc > 0:
            disc = min(sibling_adm_disc, gross)  # Don't discount more than the fee
            disc_reason = f"Sibling discount (₹{disc})" if disc > 0 else None
        net = gross - disc
        yr, mn = admission_month.split("-")
        due_date = f"{yr}-{mn}-{str(due_day).zfill(2)}"
        entry = StudentLedgerEntry(
            student_id=student_id,
            admission_number=admission_number,
            class_name=class_name,
            stream=stream,
            academic_year=academic_year,
            fee_component=CFG_FIELD_TO_COMPONENT[cfg_field],
            fee_type="one_time",
            description=label,
            gross_amount=gross,
            concession_amount=disc,
            concession_reason=disc_reason,
            net_amount=net,
            due_date=due_date,
            status="pending",
        )
        ledger_entries.append(entry)

    # — Yearly fees —
    for comp, label in [
        ("annual_charge", "Annual Charge"),
        ("activity_fee", "Activity Fee"),
        ("exam_fee", "Exam Fee"),
        ("lab_fee", "Lab Fee"),
        ("ai_robotics_fee", "AI & Robotics Fee"),
    ]:
        gross = cfg.get(comp, 0)
        if gross <= 0:
            continue
        if await db.student_ledger.find_one({"student_id": student_id, "fee_component": comp, "academic_year": academic_year, "class_name": class_name}, {"_id": 1}):
            continue
        due_date = _due_date(admission_month, due_day)
        entry = StudentLedgerEntry(
            student_id=student_id,
            admission_number=admission_number,
            class_name=class_name,
            stream=stream,
            academic_year=academic_year,
            fee_component=comp,
            fee_type="yearly",
            description=f"{label} {academic_year}",
            gross_amount=gross,
            net_amount=gross,
            due_date=due_date,
            status="pending",
        )
        ledger_entries.append(entry)

    # — Monthly tuition (all remaining months) —
    tuition = cfg.get("monthly_tuition", 0)
    if tuition > 0:
        disc_amt = min(sibling_tuit_disc, tuition) if sibling_tuit_disc > 0 else 0  # Don't discount more than tuition
        disc_reason = f"Sibling discount (₹{disc_amt})" if disc_amt > 0 else None
        net_tuition = tuition - disc_amt

        for month_str in remaining_months:
            existing = await db.student_ledger.find_one({
                "student_id": student_id,
                "fee_component": "tuition",
                "month": month_str,
                "academic_year": academic_year
            }, {"_id": 0})
            if existing:
                continue
            yr, mn = month_str.split("-")
            due_date = f"{yr}-{mn}-{str(due_day).zfill(2)}"
            month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            desc = f"Tuition — {month_names[int(mn)]} {yr}"
            entry = StudentLedgerEntry(
                student_id=student_id,
                admission_number=admission_number,
                class_name=class_name,
                stream=stream,
                academic_year=academic_year,
                fee_component="tuition",
                fee_type="monthly",
                description=desc,
                month=month_str,
                gross_amount=tuition,
                concession_amount=disc_amt,
                concession_reason=disc_reason,
                net_amount=net_tuition,
                due_date=due_date,
                status="pending",
            )
            ledger_entries.append(entry)

    # Bulk insert
    if ledger_entries:
        docs = []
        for e in ledger_entries:
            d = e.model_dump()
            d["created_at"] = d["created_at"].isoformat()
            docs.append(d)
        await db.student_ledger.insert_many(docs)

    return len(ledger_entries)


# ─── Fee Component Config endpoints ──────────────────────────────────────────

@router.get("/fees/components")
async def list_fee_component_configs(
    request: Request,
    academic_year: Optional[str] = None,
    class_name: Optional[str] = None,
):
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    query = {"is_active": True}
    if academic_year:
        query["academic_year"] = academic_year
    if class_name:
        query["class_name"] = class_name
    configs = await db.fee_component_configs.find(query, {"_id": 0}).sort(
        [("class_name", 1), ("stream", 1)]
    ).to_list(500)
    return configs


@router.post("/fees/components")
async def create_fee_component_config(request: Request):
    """Create or replace fee component config for a class+stream+year."""
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    academic_year = body.get("academic_year", current_academic_year())
    class_name = body.get("class_name")
    stream = body.get("stream")  # None for non-11/12 classes

    if not class_name:
        raise HTTPException(status_code=400, detail="class_name is required")

    validate_academic_year(academic_year)  # #14
    validate_fee_amounts(body)             # #13

    # Deactivate existing config for this class+stream+year
    await db.fee_component_configs.update_many(
        {"class_name": class_name, "stream": stream, "academic_year": academic_year},
        {"$set": {"is_active": False}}
    )

    cfg = FeeComponentConfig(
        class_name=class_name,
        stream=stream,
        academic_year=academic_year,
        registration_fee=float(body.get("registration_fee", 0)),
        admission_fee=float(body.get("admission_fee", 0)),
        caution_deposit=float(body.get("caution_deposit", 0)),
        annual_charge=float(body.get("annual_charge", 0)),
        activity_fee=float(body.get("activity_fee", 0)),
        exam_fee=float(body.get("exam_fee", 0)),
        lab_fee=float(body.get("lab_fee", 0)),
        ai_robotics_fee=float(body.get("ai_robotics_fee", 0)),
        monthly_tuition=float(body.get("monthly_tuition", 0)),
        upgradation_fee=float(body.get("upgradation_fee", 0)),
        due_day=int(body.get("due_day", 10)),
        late_fee=float(body.get("late_fee", 0)),
        late_fee_enabled=bool(body.get("late_fee_enabled", False)),
        sibling_admission_discount_amount=float(body.get("sibling_admission_discount_amount", 0)),
        sibling_tuition_discount_amount=float(body.get("sibling_tuition_discount_amount", 0)),
        notes=body.get("notes"),
        created_by=user["user_id"],
    )
    d = cfg.model_dump()
    d["created_at"] = d["created_at"].isoformat()
    await db.fee_component_configs.insert_one(d)
    d.pop("_id", None)

    await create_audit_log("fee_component_config", cfg.config_id, "create", {
        "class_name": class_name, "stream": stream, "academic_year": academic_year
    }, user)
    return d


@router.put("/fees/components/{config_id}")
async def update_fee_component_config(config_id: str, request: Request):
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    cfg = await db.fee_component_configs.find_one({"config_id": config_id}, {"_id": 0})
    if not cfg:
        raise HTTPException(status_code=404, detail="Fee config not found")

    validate_fee_amounts(body)  # #13

    allowed_fields = [
        "registration_fee", "admission_fee", "caution_deposit",
        "annual_charge", "activity_fee", "exam_fee", "lab_fee", "ai_robotics_fee",
        "monthly_tuition", "upgradation_fee",
        "due_day", "late_fee", "late_fee_enabled",
        "sibling_admission_discount_amount", "sibling_tuition_discount_amount", "notes"
    ]
    update = {k: body[k] for k in allowed_fields if k in body}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.fee_component_configs.update_one({"config_id": config_id}, {"$set": update})

    updated = await db.fee_component_configs.find_one({"config_id": config_id}, {"_id": 0})
    await create_audit_log("fee_component_config", config_id, "update", update, user)
    return updated


@router.post("/fees/components/increase")
async def apply_annual_increase(request: Request):
    """
    Apply a percentage increase to all fee amounts for a given academic year,
    creating new configs for the next session.
    """
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    from_year = body.get("from_year", current_academic_year())
    increase_pct = float(body.get("increase_percent", 10))
    class_names = body.get("class_names")  # None = all classes

    if not (0 < increase_pct <= 100):
        raise HTTPException(status_code=400, detail="increase_percent must be 1–100")

    # Build next year string
    start = int(from_year.split("-")[0])
    to_year = f"{start + 1}-{start + 2}"

    query = {"academic_year": from_year, "is_active": True}
    if class_names:
        query["class_name"] = {"$in": class_names}

    source_configs = await db.fee_component_configs.find(query, {"_id": 0}).to_list(500)
    if not source_configs:
        raise HTTPException(status_code=404, detail=f"No configs found for {from_year}")

    factor = 1 + increase_pct / 100
    fee_fields = [
        "registration_fee", "admission_fee", "caution_deposit",
        "annual_charge", "activity_fee", "exam_fee", "lab_fee", "ai_robotics_fee",
        "monthly_tuition", "upgradation_fee", "late_fee"
    ]
    created = 0
    for src in source_configs:
        # Deactivate existing for to_year
        await db.fee_component_configs.update_many(
            {"class_name": src["class_name"], "stream": src.get("stream"), "academic_year": to_year},
            {"$set": {"is_active": False}}
        )
        new_cfg = {k: src[k] for k in src if k not in ("_id", "config_id", "created_at", "updated_at")}
        new_cfg["config_id"] = f"fcc_{uuid.uuid4().hex[:10]}"
        new_cfg["academic_year"] = to_year
        new_cfg["created_by"] = user["user_id"]
        new_cfg["created_at"] = datetime.now(timezone.utc).isoformat()
        new_cfg["updated_at"] = None
        for f in fee_fields:
            if f in new_cfg and new_cfg[f] > 0:
                new_cfg[f] = round(new_cfg[f] * factor, 2)
        new_cfg["notes"] = f"Auto-generated from {from_year} with {increase_pct}% increase"
        await db.fee_component_configs.insert_one(new_cfg)
        created += 1

    return {
        "message": f"Created {created} fee configs for {to_year} with {increase_pct}% increase",
        "from_year": from_year,
        "to_year": to_year,
        "configs_created": created
    }


@router.post("/fees/components/ensure-defaults")
async def ensure_default_fee_configs(request: Request):
    """
    Ensure fee configurations exist for all classes in current academic year.
    If missing, creates them from default seed data.
    Useful when upgrading or fixing missing fee configs.
    """
    user = await require_roles(UserRole.ADMIN)(request)
    academic_year = current_academic_year()
    
    # Default fee configuration values (from seed_fee_structure_2025_26.py)
    COMMON = {
        "registration_fee": 500,
        "admission_fee": 2500,
        "caution_deposit": 1000,
        "annual_charge": 3600,
        "upgradation_fee": 0,
        "due_day": 10,
        "late_fee": 0,
        "late_fee_enabled": False,
        "sibling_admission_discount_amount": 1000,
        "sibling_tuition_discount_amount": 300,
    }
    
    CLASS_FEES = {
        "SF. SR.": {"activity_fee": 1500, "exam_fee": 300, "lab_fee": 0, "ai_robotics_fee": 0, "monthly_tuition": 1000},
        "LKG": {"activity_fee": 2000, "exam_fee": 300, "lab_fee": 0, "ai_robotics_fee": 0, "monthly_tuition": 1100},
        "UKG": {"activity_fee": 2000, "exam_fee": 300, "lab_fee": 0, "ai_robotics_fee": 0, "monthly_tuition": 1100},
        "1st": {"activity_fee": 2400, "exam_fee": 300, "lab_fee": 1500, "ai_robotics_fee": 0, "monthly_tuition": 1150},
        "2nd": {"activity_fee": 2400, "exam_fee": 300, "lab_fee": 1500, "ai_robotics_fee": 0, "monthly_tuition": 1150},
        "3rd": {"activity_fee": 2900, "exam_fee": 300, "lab_fee": 1500, "ai_robotics_fee": 0, "monthly_tuition": 1250},
        "4th": {"activity_fee": 2900, "exam_fee": 300, "lab_fee": 1500, "ai_robotics_fee": 0, "monthly_tuition": 1250},
        "5th": {"activity_fee": 3400, "exam_fee": 300, "lab_fee": 1500, "ai_robotics_fee": 0, "monthly_tuition": 1350},
        "6th": {"activity_fee": 3400, "exam_fee": 300, "lab_fee": 1500, "ai_robotics_fee": 0, "monthly_tuition": 1350},
        "7th": {"activity_fee": 3900, "exam_fee": 300, "lab_fee": 1500, "ai_robotics_fee": 0, "monthly_tuition": 1400},
        "8th": {"activity_fee": 3900, "exam_fee": 300, "lab_fee": 1500, "ai_robotics_fee": 0, "monthly_tuition": 1400},
        "9th": {"activity_fee": 4500, "exam_fee": 450, "lab_fee": 1500, "ai_robotics_fee": 2400, "monthly_tuition": 1900},
        "10th": {"activity_fee": 4500, "exam_fee": 450, "lab_fee": 1500, "ai_robotics_fee": 2400, "monthly_tuition": 1900},
    }
    
    now = datetime.now(timezone.utc).isoformat()
    created = 0
    skipped = 0
    
    for class_name, overrides in CLASS_FEES.items():
        # Check if config already exists
        existing = await db.fee_component_configs.find_one({
            "class_name": class_name,
            "stream": None,
            "academic_year": academic_year,
            "is_active": True
        }, {"_id": 0})
        
        if existing:
            skipped += 1
            continue
        
        # Create new config
        cfg = {
            "config_id": f"fcc_{uuid.uuid4().hex[:10]}",
            "class_name": class_name,
            "stream": None,
            "academic_year": academic_year,
            **COMMON,
            **overrides,
            "is_active": True,
            "notes": "Auto-created by ensure-defaults endpoint",
            "created_by": user["user_id"],
            "created_at": now,
        }
        await db.fee_component_configs.insert_one(cfg)
        created += 1
        logger.info(f"Created missing fee config for {class_name}")
    
    await create_audit_log("fee_component_config", "batch", "ensure_defaults", {
        "academic_year": academic_year,
        "created": created,
        "skipped": skipped
    }, user)
    
    return {
        "message": f"Ensured fee configs for {academic_year}",
        "created": created,
        "skipped": skipped,
        "academic_year": academic_year
    }


# ─── Student Ledger endpoints ─────────────────────────────────────────────────

@router.get("/fees/ledger/{student_id}")
async def get_student_ledger(student_id: str, request: Request):
    user = await get_current_user(request)

    # Role checks
    if user["role"] == UserRole.PARENT:
        # Use both parent_email (primary) and parent_id (legacy fallback) to locate children
        children = await db.students.find(
            {"$or": [{"parent_email": user["email"]}, {"parent_id": user["user_id"]}], "is_active": True},
            {"_id": 0, "student_id": 1}
        ).to_list(20)
        if student_id not in {c["student_id"] for c in children}:
            raise HTTPException(status_code=403, detail="Not authorized. This student is not linked to your account.")
    elif user["role"] == UserRole.STUDENT:
        stu = await db.students.find_one({"user_id": user["user_id"]}, {"_id": 0, "student_id": 1})
        if not stu or stu["student_id"] != student_id:
            raise HTTPException(status_code=403, detail="Not authorized. You can only view your own fees.")
    elif user["role"] == UserRole.TEACHER:
        raise HTTPException(status_code=403, detail="Teachers cannot access student fee data.")

    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # (#5) Do NOT call refresh_overdue_for_student here — it caused late-fee accumulation
    # on every ledger GET. Overdue status is updated by:
    #   1. The due-chart endpoint (bulk update on load)
    #   2. POST /fees/refresh-overdue (explicit admin trigger)
    # Quick in-memory check only — no DB write:
    today = datetime.now().strftime("%Y-%m-%d")
    await db.student_ledger.update_many(
        {"student_id": student_id, "status": "pending", "due_date": {"$lt": today}},
        {"$set": {"status": "overdue"}}
    )

    entries = await db.student_ledger.find(
        {"student_id": student_id}, {"_id": 0}
    ).sort([("fee_type", 1), ("due_date", 1)]).to_list(500)

    # Auto-generate ledger entries when a student has none (e.g. seeded before fee config existed)
    if not entries:
        academic_year_val = student.get("academic_year", current_academic_year())
        cfg = await get_fee_config(student["class_name"], academic_year_val, student.get("stream"))
        if cfg:
            admission_date = student.get("admission_date", datetime.now().strftime("%Y-%m-%d"))
            admission_month = admission_date[:7]
            generated = await create_admission_ledger(student, cfg, academic_year_val, admission_month)
            if generated > 0:
                entries = await db.student_ledger.find(
                    {"student_id": student_id}, {"_id": 0}
                ).sort([("fee_type", 1), ("due_date", 1)]).to_list(500)
                logger.info("Auto-generated %d ledger entries for student %s", generated, student_id)
        else:
            logger.warning("No fee config found for student %s class=%s year=%s — cannot auto-generate ledger",
                           student_id, student["class_name"], student.get("academic_year"))

    payments = await db.fee_payments.find(
        {"student_id": student_id}, {"_id": 0}
    ).sort("payment_date", -1).to_list(500)

    # Summaries
    def _sum(entries, statuses, field="net_amount"):
        return round(sum(e[field] for e in entries if e["status"] in statuses), 2)

    total_gross = round(sum(e["gross_amount"] for e in entries), 2)
    total_concession = round(sum(e.get("concession_amount", 0) for e in entries), 2)
    total_paid_amount = round(sum(p["amount"] for p in payments), 2)
    total_pending = round(
        _sum(entries, ["pending", "overdue"]) +
        sum(e.get("remaining_balance", 0) for e in entries if e["status"] == "partially_paid"),
        2
    )
    total_overdue = _sum(entries, ["overdue"])
    months_paid = sum(1 for e in entries if e["fee_component"] == "tuition" and e["status"] == "paid")
    months_pending = sum(1 for e in entries if e["fee_component"] == "tuition" and e["status"] in ["pending", "overdue", "partially_paid"])

    # Group by fee_type for display
    grouped = {"one_time": [], "yearly": [], "monthly": []}
    for e in entries:
        ft = e.get("fee_type", "monthly")
        grouped.get(ft, grouped["monthly"]).append(e)

    return {
        "student": {
            "student_id": student["student_id"],
            "name": f"{student['first_name']} {student['last_name']}",
            "admission_number": student.get("admission_number", ""),
            "class_name": student["class_name"],
            "section": student["section"],
            "stream": student.get("stream"),
            "academic_year": student.get("academic_year", ""),
            "fee_status": student.get("fee_status", "pending"),
        },
        "summary": {
            "total_gross": total_gross,
            "total_concession": total_concession,
            "total_paid": total_paid_amount,
            "total_pending": total_pending,
            "total_overdue": total_overdue,
            "months_paid": months_paid,
            "months_pending": months_pending,
        },
        "ledger": grouped,
        "payments": payments,
    }


@router.post("/fees/clear-locks/{student_id}")
async def clear_payment_locks(student_id: str, request: Request):
    """Admin: release all stale payment locks for a student."""
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    result = await db.student_ledger.update_many(
        {"student_id": student_id, "payment_lock": {"$exists": True}},
        {"$unset": {"payment_lock": ""}}
    )
    return {"cleared": result.modified_count}


@router.post("/fees/ledger/generate/{student_id}")
async def generate_student_ledger(student_id: str, request: Request):
    """Admin: create any missing ledger entries for a student (idempotent)."""
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)

    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    academic_year = student.get("academic_year", current_academic_year())
    cfg = await get_fee_config(student["class_name"], academic_year, student.get("stream"))
    if not cfg:
        raise HTTPException(status_code=404, detail="No fee config found for this class/year")

    admission_date = student.get("admission_date", datetime.now().strftime("%Y-%m-%d"))
    admission_month = admission_date[:7]

    created = await create_admission_ledger(student, cfg, academic_year, admission_month)
    return {"message": f"Generated {created} ledger entries", "student_id": student_id}


# ─── Admission Fee Collection ─────────────────────────────────────────────────

@router.post("/fees/admission-payment")
async def record_admission_payment(request: Request):
    """
    Record the admission-time payment:
    one-time fees + yearly fees + 1st month tuition.
    Marks those ledger entries as paid and generates a receipt.
    """
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    body = await request.json()

    student_id = body.get("student_id")
    payment_method = body.get("payment_method", "cash")
    transaction_id = body.get("transaction_id")
    remarks = body.get("remarks", "Admission fee collection")

    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Fetch pending one-time + yearly + first-month tuition
    academic_year = student.get("academic_year", current_academic_year())
    all_months = get_academic_year_months(academic_year)
    first_month = all_months[0]
    admission_month = student.get("admission_date", "")[:7] or first_month

    pending_entries = await db.student_ledger.find({
        "student_id": student_id,
        "status": "pending",
        "fee_type": {"$in": ["one_time", "yearly"]}
    }, {"_id": 0}).to_list(100)

    # Also first-month tuition
    first_tuition = await db.student_ledger.find_one({
        "student_id": student_id,
        "fee_component": "tuition",
        "month": admission_month,
        "status": "pending"
    }, {"_id": 0})
    if first_tuition:
        pending_entries.append(first_tuition)

    if not pending_entries:
        raise HTTPException(status_code=400, detail="No pending admission fees found")

    total_amount = round(sum(e["net_amount"] for e in pending_entries), 2)
    receipt_number = await get_next_receipt_number()

    payment = FeePayment(
        student_id=student_id,
        installment_ids=[e["ledger_id"] for e in pending_entries],
        amount=total_amount,
        payment_method=payment_method,
        transaction_id=transaction_id,
        collected_by=user["user_id"],
        remarks=remarks,
        academic_year=academic_year,
    )
    pay_dict = payment.model_dump()
    pay_dict["receipt_number"] = receipt_number
    pay_dict["created_at"] = pay_dict["created_at"].isoformat()

    today = datetime.now().strftime("%Y-%m-%d")
    ledger_updates = [
        UpdateOne(
            {"ledger_id": entry["ledger_id"]},
            {"$set": {
                "status": "paid",
                "paid_date": today,
                "payment_id": payment.payment_id,
                "receipt_number": receipt_number,
            }}
        )
        for entry in pending_entries
    ]

    try:
        async with await mongo_client.start_session() as session:
            async with session.start_transaction():
                await db.fee_payments.insert_one(pay_dict, session=session)
                await db.student_ledger.bulk_write(ledger_updates, session=session)
    except Exception:
        # Replica set not available (standalone dev instance) — fall back to non-atomic
        await db.fee_payments.insert_one(pay_dict)
        await db.student_ledger.bulk_write(ledger_updates)

    # Update onboarding record if exists
    await db.onboarding.update_many(
        {"student_id": student_id},
        {"$set": {
            "admission_fee_paid": True,
            "admission_fee_receipt": receipt_number,
            "admission_fee_payment_id": payment.payment_id,
        }}
    )

    await refresh_overdue_for_student(student_id)
    await create_audit_log("fee_payment", payment.payment_id, "admission_payment", {
        "student_id": student_id, "amount": total_amount, "method": payment_method
    }, user)

    pay_dict.pop("_id", None)
    return {
        "payment": pay_dict,
        "receipt_number": receipt_number,
        "amount": total_amount,
        "entries_paid": len(pending_entries),
        "message": f"Admission fee of ₹{total_amount:,.2f} recorded. Receipt: {receipt_number}"
    }


# ─── Monthly tuition generation ───────────────────────────────────────────────

@router.post("/fees/generate-monthly")
async def generate_monthly_fees(request: Request):
    """
    Generate monthly tuition entries for all active students for a given month.
    Meant to be run at the start of each month (or as a scheduled job).
    Idempotent — will not duplicate entries.
    """
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    body = await request.json()

    month_str = body.get("month")  # "2025-05"
    academic_year = body.get("academic_year", current_academic_year())

    if not month_str:
        now = datetime.now()
        month_str = f"{now.year}-{str(now.month).zfill(2)}"

    students = await db.students.find({"is_active": True}, {"_id": 0}).to_list(5000)
    created = 0
    skipped = 0

    yr, mn = month_str.split("-")
    month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    desc = f"Tuition — {month_names[int(mn)]} {yr}"

    for student in students:
        # Skip if already has a tuition entry for this month
        existing = await db.student_ledger.find_one({
            "student_id": student["student_id"],
            "fee_component": "tuition",
            "month": month_str,
            "academic_year": academic_year,
        }, {"_id": 0})
        if existing:
            skipped += 1
            continue

        cfg = await get_fee_config(student["class_name"], academic_year, student.get("stream"))
        if not cfg or not cfg.get("monthly_tuition", 0):
            skipped += 1
            continue

        is_sibling = student.get("is_sibling", False)
        tuition = cfg["monthly_tuition"]
        disc_amt = cfg.get("sibling_tuition_discount_amount", 0) if is_sibling else 0
        disc_amt = min(disc_amt, tuition)  # Don't discount more than tuition
        net = tuition - disc_amt
        due_day = cfg.get("due_day", 10)
        due_date = f"{yr}-{mn}-{str(due_day).zfill(2)}"

        entry = StudentLedgerEntry(
            student_id=student["student_id"],
            admission_number=student.get("admission_number", ""),
            class_name=student["class_name"],
            stream=student.get("stream"),
            academic_year=academic_year,
            fee_component="tuition",
            fee_type="monthly",
            description=desc,
            month=month_str,
            gross_amount=tuition,
            concession_amount=disc_amt,
            concession_reason=f"Sibling discount (₹{disc_amt})" if disc_amt > 0 else None,
            net_amount=net,
            due_date=due_date,
            status="pending",
        )
        d = entry.model_dump()
        d["created_at"] = d["created_at"].isoformat()
        await db.student_ledger.insert_one(d)
        created += 1

    return {
        "message": f"Generated tuition entries for {month_str}",
        "created": created,
        "skipped": skipped,
        "month": month_str,
    }


# ─── Pay endpoint ──────────────────────────────────────────────────────────────

@router.post("/fees/pay")
async def pay_fee(request: Request):
    """
    Record a fee payment against specific ledger entry IDs or the next pending month.
    Rules:
    - Must pay oldest overdue/pending first (no skip)
    - No partial payment per entry
    - Amount must exactly match selected entries
    """
    user = await get_current_user(request)
    body = await request.json()

    student_id = body.get("student_id")
    payment_method = body.get("payment_method", "cash")
    transaction_id = body.get("transaction_id")
    remarks = body.get("remarks")
    ledger_ids = body.get("ledger_ids")  # optional list of specific entry IDs
    # Optional back-dated payment date (admin only). Must not be in the future.
    custom_payment_date = body.get("payment_date")
    # Split payments: { "cash": 1500, "online": 500 } — sums must equal total
    split_payments = body.get("split_payments")

    # Auth
    if user["role"] == UserRole.PARENT:
        children = await db.students.find(
            {"$or": [{"parent_email": user["email"]}, {"parent_id": user["user_id"]}], "is_active": True},
            {"_id": 0, "student_id": 1}
        ).to_list(20)
        if student_id not in {c["student_id"] for c in children}:
            raise HTTPException(status_code=403, detail="Not authorized.")
    elif user["role"] not in [UserRole.ADMIN, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    await refresh_overdue_for_student(student_id)

    if ledger_ids:
        entries_to_pay = await db.student_ledger.find({
            "student_id": student_id,
            "ledger_id": {"$in": ledger_ids},
            "status": {"$in": ["pending", "overdue"]}
        }, {"_id": 0}).sort("due_date", 1).to_list(100)
        if len(entries_to_pay) != len(ledger_ids):
            raise HTTPException(status_code=400, detail="Some ledger entries not found or already paid")
    else:
        # Default: pay all monthly tuition entries in order
        entries_to_pay = await db.student_ledger.find({
            "student_id": student_id,
            "fee_component": "tuition",
            "status": {"$in": ["pending", "overdue"]}
        }, {"_id": 0}).sort("due_date", 1).limit(1).to_list(1)

    if not entries_to_pay:
        raise HTTPException(status_code=400, detail="No pending fees to pay")

    total = round(sum(e["net_amount"] for e in entries_to_pay), 2)
    receipt_number = await get_next_receipt_number()

    payment = FeePayment(
        student_id=student_id,
        installment_ids=[e["ledger_id"] for e in entries_to_pay],
        amount=total,
        payment_method=payment_method,
        transaction_id=transaction_id,
        collected_by=user["user_id"],
        remarks=remarks,
        academic_year=entries_to_pay[0].get("academic_year", ""),
    )
    pay_dict = payment.model_dump()
    pay_dict["receipt_number"] = receipt_number
    pay_dict["created_at"] = pay_dict["created_at"].isoformat()

    today_str = datetime.now().strftime("%Y-%m-%d")
    # Resolve payment date (back-date if admin/accountant explicitly set one)
    paid_date = today_str
    if custom_payment_date and user["role"] in (UserRole.ADMIN, UserRole.ACCOUNTANT):
        try:
            d = datetime.strptime(custom_payment_date, "%Y-%m-%d").date()
            if d <= datetime.now().date():
                paid_date = custom_payment_date
                pay_dict["payment_date"] = custom_payment_date
        except ValueError:
            pass

    # Attach split payment breakdown if provided
    if split_payments and isinstance(split_payments, dict):
        try:
            split_total = round(sum(float(v) for v in split_payments.values()), 2)
            if abs(split_total - total) < 0.01:
                pay_dict["split_payments"] = {k: float(v) for k, v in split_payments.items() if float(v) > 0}
            else:
                raise HTTPException(status_code=400, detail=f"Split payment total ({split_total}) does not match fee total ({total})")
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid split_payments format")

    ledger_updates = [
        UpdateOne(
            {"ledger_id": entry["ledger_id"]},
            {"$set": {
                "status": "paid",
                "paid_date": paid_date,
                "payment_id": payment.payment_id,
                "receipt_number": receipt_number,
            }}
        )
        for entry in entries_to_pay
    ]

    try:
        async with await mongo_client.start_session() as session:
            async with session.start_transaction():
                await db.fee_payments.insert_one(pay_dict, session=session)
                await db.student_ledger.bulk_write(ledger_updates, session=session)
    except Exception:
        # Replica set not available (standalone dev instance) — fall back to non-atomic
        await db.fee_payments.insert_one(pay_dict)
        await db.student_ledger.bulk_write(ledger_updates)

    await refresh_overdue_for_student(student_id)
    await create_audit_log("fee_payment", payment.payment_id, "pay", {
        "student_id": student_id, "amount": total, "method": payment_method
    }, user)

    pay_dict.pop("_id", None)
    return {
        "payment": pay_dict,
        "receipt_number": receipt_number,
        "amount": total,
        "entries_paid": len(entries_to_pay),
        "message": f"Payment of ₹{total:,.2f} recorded. Receipt: {receipt_number}"
    }


# ─── Due Chart ────────────────────────────────────────────────────────────────

@router.get("/fees/due-chart")
async def get_due_chart(request: Request, class_name: Optional[str] = None, search: Optional[str] = None):
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)

    today = datetime.now().strftime("%Y-%m-%d")

    # 1. Bulk-mark all past-due pending entries as overdue in one query
    await db.student_ledger.update_many(
        {"status": "pending", "due_date": {"$lt": today}},
        {"$set": {"status": "overdue"}}
    )

    # 2. Aggregate pending/overdue totals per student from ledger in one query
    ledger_pipeline = [
        {"$match": {"status": {"$in": ["pending", "overdue"]}}},
        {"$group": {
            "_id": "$student_id",
            "total_due":       {"$sum": "$net_amount"},
            "entries_pending": {"$sum": 1},
            "entries_overdue": {"$sum": {"$cond": [{"$eq": ["$status", "overdue"]}, 1, 0]}},
            "oldest_due":      {"$min": "$due_date"},
        }},
    ]
    ledger_rows = await db.student_ledger.aggregate(ledger_pipeline).to_list(10000)
    if not ledger_rows:
        return []

    student_ids = [r["_id"] for r in ledger_rows]

    # 3. Fetch matching students in one query
    student_query: dict = {"is_active": True, "student_id": {"$in": student_ids}}
    if class_name:
        student_query["class_name"] = class_name

    students = await db.students.find(student_query, {
        "_id": 0, "student_id": 1, "first_name": 1, "last_name": 1,
        "class_name": 1, "section": 1, "stream": 1, "admission_number": 1, "fee_status": 1,
    }).to_list(5000)

    student_map = {s["student_id"]: s for s in students}
    due_chart = []
    for row in ledger_rows:
        s = student_map.get(row["_id"])
        if not s:
            continue  # inactive or filtered out by class_name
        due_chart.append({
            "student_id":       row["_id"],
            "admission_number": s.get("admission_number", ""),
            "name":             f"{s['first_name']} {s['last_name']}",
            "class_name":       s["class_name"],
            "section":          s["section"],
            "stream":           s.get("stream"),
            "total_due":        round(row["total_due"], 2),
            "entries_pending":  row["entries_pending"],
            "entries_overdue":  row["entries_overdue"],
            "fee_status":       s.get("fee_status", "pending"),
            "oldest_due":       row["oldest_due"] or "",
        })

    due_chart.sort(key=lambda x: x["total_due"], reverse=True)

    # (#26) Server-side name / admission number search
    if search:
        s = search.strip().lower()
        due_chart = [
            r for r in due_chart
            if s in r["name"].lower() or s in r.get("admission_number", "").lower()
        ]

    return due_chart


@router.post("/fees/refresh-overdue")
async def refresh_all_overdue(request: Request):
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    today = datetime.now().strftime("%Y-%m-%d")

    # Bulk mark all past-due pending entries as overdue
    result = await db.student_ledger.update_many(
        {"status": "pending", "due_date": {"$lt": today}},
        {"$set": {"status": "overdue"}}
    )

    # Bulk-update student fee_status based on ledger state
    overdue_sids = await db.student_ledger.distinct("student_id", {"status": "overdue"})
    if overdue_sids:
        await db.students.update_many(
            {"student_id": {"$in": overdue_sids}, "is_active": True},
            {"$set": {"fee_status": "overdue", "app_locked": True}}
        )

    pending_only_sids = await db.student_ledger.distinct(
        "student_id",
        {"status": "pending", "student_id": {"$nin": overdue_sids}}
    )
    if pending_only_sids:
        await db.students.update_many(
            {"student_id": {"$in": pending_only_sids}, "is_active": True},
            {"$set": {"fee_status": "pending", "app_locked": False}}
        )

    return {
        "message": f"Overdue refresh complete. {result.modified_count} entries marked overdue.",
        "entries_marked_overdue": result.modified_count,
    }


# ─── Concessions ──────────────────────────────────────────────────────────────

@router.post("/fees/concession")
async def apply_concession(request: Request):
    user = await require_roles(UserRole.ADMIN)(request)
    body = await request.json()

    student_id = body.get("student_id")
    concession_percent = float(body.get("concession_percent", 0))
    reason = body.get("reason", "Scholarship/Concession")
    components = body.get("components")  # None = all pending; or list like ["tuition"]

    if not (0 <= concession_percent <= 100):
        raise HTTPException(status_code=400, detail="Concession must be 0–100%")

    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    q = {"student_id": student_id, "status": {"$in": ["pending", "overdue"]}}
    if components:
        q["fee_component"] = {"$in": components}

    pending = await db.student_ledger.find(q, {"_id": 0}).to_list(200)
    ops = []
    for entry in pending:
        existing_conc = entry.get("concession_amount", 0)
        existing_reason = entry.get("concession_reason") or ""
        gross = entry["gross_amount"]

        # (#1) Preserve existing sibling discount — stack admin concession on top of it
        if "sibling" in existing_reason.lower() and existing_conc > 0:
            base_after_sibling = gross - existing_conc
            admin_conc = round(base_after_sibling * concession_percent / 100, 2)
            total_conc = min(existing_conc + admin_conc, gross)
            combined_reason = f"{existing_reason} + {reason}"
        else:
            total_conc = round(gross * concession_percent / 100, 2)
            combined_reason = reason

        new_net = max(0, gross - total_conc + entry.get("late_fee_applied", 0))
        ops.append(UpdateOne(
            {"ledger_id": entry["ledger_id"]},
            {"$set": {
                "concession_amount": total_conc,
                "concession_reason": combined_reason,
                "net_amount": new_net,
            }}
        ))
    if ops:
        await db.student_ledger.bulk_write(ops)
    updated = len(ops)

    await create_audit_log("concession", student_id, "apply_concession", {
        "percent": concession_percent, "reason": reason, "entries": updated
    }, user)
    return {"message": f"{concession_percent}% concession applied to {updated} entries", "entries_updated": updated}


@router.get("/fees/concessions")
async def list_concessions(request: Request):
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    pipeline = [
        {"$match": {"concession_amount": {"$gt": 0}, "status": {"$in": ["pending", "overdue", "paid"]}}},
        {"$group": {
            "_id": "$student_id",
            "total_concession": {"$sum": "$concession_amount"},
            "reason":           {"$first": "$concession_reason"},
            "entries":          {"$sum": 1},
        }},
    ]
    results = await db.student_ledger.aggregate(pipeline).to_list(1000)
    if not results:
        return []

    # Batch-fetch all students in one query
    student_ids = [r["_id"] for r in results]
    students = await db.students.find(
        {"student_id": {"$in": student_ids}},
        {"_id": 0, "student_id": 1, "first_name": 1, "last_name": 1,
         "class_name": 1, "section": 1, "admission_number": 1}
    ).to_list(1000)
    student_map = {s["student_id"]: s for s in students}

    out = []
    for r in results:
        s = student_map.get(r["_id"])
        if s:
            out.append({
                "student_id":       r["_id"],
                "student_name":     f"{s['first_name']} {s['last_name']}",
                "class_name":       s["class_name"],
                "section":          s["section"],
                "admission_number": s.get("admission_number", ""),
                "total_concession": r["total_concession"],
                "reason":           r["reason"],
                "entries":          r["entries"],
            })
    return out


# ─── Receipt PDF ──────────────────────────────────────────────────────────────

@router.get("/fees/receipt/{payment_id}/pdf")
async def download_receipt_pdf(payment_id: str, request: Request):
    await get_current_user(request)

    payment = await db.fee_payments.find_one({"payment_id": payment_id}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    student = await db.students.find_one({"student_id": payment["student_id"]}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Fetch ledger entries paid in this payment
    ledger_ids = payment.get("installment_ids", [])
    entries = await db.student_ledger.find(
        {"ledger_id": {"$in": ledger_ids}}, {"_id": 0}
    ).to_list(100)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4,
                            topMargin=0.5 * inch, bottomMargin=0.5 * inch,
                            leftMargin=0.7 * inch, rightMargin=0.7 * inch)
    elements = []
    styles = getSampleStyleSheet()

    orange = colors.HexColor("#E88A1A")
    title_style = ParagraphStyle("Title", parent=styles["Heading1"],
                                 fontSize=16, alignment=TA_CENTER, textColor=orange)
    sub_style = ParagraphStyle("Sub", parent=styles["Normal"],
                                fontSize=9, alignment=TA_CENTER, textColor=colors.grey)
    normal_bold = ParagraphStyle("NB", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9)

    elements.append(Paragraph("SHEMFORD FUTURISTIC SCHOOL", title_style))
    elements.append(Paragraph("Katwa, West Bengal | CBSE Affiliated | Empowering Futures", sub_style))
    elements.append(Spacer(1, 10))

    # Divider
    div_table = Table([["FEE RECEIPT"]], colWidths=[7 * inch])
    div_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), orange),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(div_table)
    elements.append(Spacer(1, 10))

    info_data = [
        ["Receipt No.", payment.get("receipt_number", ""), "Date", payment.get("payment_date", "")],
        ["Student Name", f"{student['first_name']} {student['last_name']}",
         "Admission No.", student.get("admission_number", "")],
        ["Class", f"{student['class_name']} – {student.get('section', '')}",
         "Stream", student.get("stream", "—").title() if student.get("stream") else "—"],
        ["Payment Method", payment.get("payment_method", "").upper(),
         "Txn ID", payment.get("transaction_id", "—") or "—"],
    ]
    info_table = Table(info_data, colWidths=[1.4 * inch, 2.1 * inch, 1.4 * inch, 2.1 * inch])
    info_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f5f5f5")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f5f5f5")),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"), ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.lightgrey), ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 12))

    fee_data = [["Description", "Fee Type", "Gross (₹)", "Discount (₹)", "Late Fee (₹)", "Net (₹)"]]
    for e in entries:
        fee_data.append([
            e.get("description", ""),
            e.get("fee_type", "").replace("_", " ").title(),
            f"{e['gross_amount']:,.2f}",
            f"{e.get('concession_amount', 0):,.2f}" if e.get("concession_amount", 0) > 0 else "—",
            f"{e.get('late_fee_applied', 0):,.2f}" if e.get("late_fee_applied", 0) > 0 else "—",
            f"{e['net_amount']:,.2f}",
        ])
    fee_data.append(["", "", "", "", "TOTAL PAID", f"{payment['amount']:,.2f}"])

    col_w = [2.6 * inch, 1.0 * inch, 0.9 * inch, 0.9 * inch, 0.9 * inch, 0.9 * inch]
    fee_table = Table(fee_data, colWidths=col_w)
    fee_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), orange),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.lightgrey),
        ("PADDING", (0, 0), (-1, -1), 5),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#f5f5f5")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#fafafa")]),
    ]))
    elements.append(fee_table)
    elements.append(Spacer(1, 30))

    if payment.get("remarks"):
        elements.append(Paragraph(f"Remarks: {payment['remarks']}", styles["Normal"]))
        elements.append(Spacer(1, 10))

    elements.append(Paragraph(
        "This is a computer-generated receipt and is valid without a physical signature.",
        sub_style
    ))

    doc.build(elements)
    buffer.seek(0)
    filename = f"receipt_{payment.get('receipt_number', payment_id).replace('/', '_')}.pdf"
    return StreamingResponse(
        buffer, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ─── Payment history ──────────────────────────────────────────────────────────

@router.get("/fees/payments")
async def get_fee_payments(request: Request, student_id: Optional[str] = None):
    user = await get_current_user(request)
    query = {}

    if user["role"] == UserRole.PARENT:
        children = await db.students.find(
            {"$or": [{"parent_email": user.get("email", "")}, {"parent_id": user["user_id"]}], "is_active": True},
            {"_id": 0, "student_id": 1}
        ).to_list(20)
        child_ids = [c["student_id"] for c in children]
        if not child_ids:
            return []
        query["student_id"] = student_id if student_id and student_id in child_ids else {"$in": child_ids}
    elif user["role"] == UserRole.STUDENT:
        stu = await db.students.find_one({"user_id": user["user_id"]}, {"_id": 0, "student_id": 1})
        if not stu:
            return []
        query["student_id"] = stu["student_id"]
    elif user["role"] in [UserRole.ADMIN, UserRole.ACCOUNTANT]:
        if student_id:
            query["student_id"] = student_id
        # No student_id = admin sees all payments (no filter)
    elif user["role"] == UserRole.TEACHER:
        raise HTTPException(status_code=403, detail="Teachers cannot access fee data")

    return await db.fee_payments.find(query, {"_id": 0}).sort("payment_date", -1).to_list(1000)


# ─── Legacy compatibility endpoints ───────────────────────────────────────────

@router.get("/fees/class-config")
async def get_class_fee_config_legacy(request: Request):
    """Legacy endpoint — returns component configs in the old class-config format."""
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    academic_year = current_academic_year()
    configs = await db.fee_component_configs.find(
        {"academic_year": academic_year, "is_active": True}, {"_id": 0}
    ).sort("class_name", 1).to_list(500)
    return configs


@router.get("/fees/student/{student_id}")
async def get_student_fees_legacy(student_id: str, request: Request):
    """Legacy compatibility — delegates to /fees/ledger/{student_id}."""
    return await get_student_ledger(student_id, request)


@router.get("/fees/structure")
async def get_fee_structures(request: Request, class_name: Optional[str] = None):
    await get_current_user(request)
    academic_year = current_academic_year()
    q = {"academic_year": academic_year, "is_active": True}
    if class_name:
        q["class_name"] = class_name
    return await db.fee_component_configs.find(q, {"_id": 0}).sort("class_name", 1).to_list(500)


# ─── Student Search (for Collect Fees tab search bar) ─────────────────────────

@router.get("/fees/search-students")
async def search_students_for_fees(
    request: Request,
    q: str = "",
    academic_year: Optional[str] = None,
):
    """
    Search students by name, roll number, or admission number.
    Used by the fee collection search bar. Returns up to 10 results.
    Roles: admin, accountant, teacher.
    """
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.TEACHER)(request)

    if not q or len(q.strip()) < 1:
        return []

    escaped = re.escape(q.strip())

    query: dict = {
        "is_active": True,
        "$or": [
            {"first_name": {"$regex": escaped, "$options": "i"}},
            {"last_name": {"$regex": escaped, "$options": "i"}},
            {"roll_number": {"$regex": escaped, "$options": "i"}},
            {"admission_number": {"$regex": escaped, "$options": "i"}},
        ],
    }
    if academic_year:
        query["academic_year"] = academic_year

    students = await db.students.find(
        query,
        {
            "_id": 0,
            "student_id": 1,
            "first_name": 1,
            "last_name": 1,
            "admission_number": 1,
            "roll_number": 1,
            "class_name": 1,
            "section": 1,
            "stream": 1,
            "fee_status": 1,
        },
    ).limit(10).to_list(10)

    return [
        {
            "student_id": s["student_id"],
            "name": f"{s['first_name']} {s['last_name']}",
            "admission_number": s.get("admission_number", ""),
            "roll_number": s.get("roll_number", ""),
            "class_name": s.get("class_name", ""),
            "section": s.get("section", ""),
            "stream": s.get("stream"),
            "fee_status": s.get("fee_status", "pending"),
        }
        for s in students
    ]
