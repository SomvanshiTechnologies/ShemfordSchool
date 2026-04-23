"""
Migration: generate missing student_ledger entries for all students.
Safe to run multiple times — create_admission_ledger skips existing entries.
Run: python migrate_ledger.py
"""
import asyncio
import os
import logging
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

ACADEMIC_MONTHS = ["04", "05", "06", "07", "08", "09", "10", "11", "12", "01", "02", "03"]

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


def get_academic_year_months(academic_year: str):
    start_year = int(academic_year.split("-")[0])
    months = []
    for m in ACADEMIC_MONTHS:
        yr = start_year if int(m) >= 4 else start_year + 1
        months.append(f"{yr}-{m}")
    return months


def get_remaining_months(academic_year: str, from_month: str):
    all_months = get_academic_year_months(academic_year)
    remaining = [m for m in all_months if m >= from_month]
    return remaining if remaining else all_months


async def get_fee_config(db, class_name: str, academic_year: str, stream=None):
    query = {"class_name": class_name, "academic_year": academic_year, "is_active": True}
    if stream:
        cfg = await db.fee_component_configs.find_one({**query, "stream": stream}, {"_id": 0})
        if cfg:
            return cfg
    return await db.fee_component_configs.find_one({**query, "stream": None}, {"_id": 0})


async def create_ledger_for_student(db, student: dict, cfg: dict, academic_year: str, admission_month: str):
    from uuid import uuid4

    student_id = student["student_id"]
    admission_number = student.get("admission_number", "")
    class_name = student["class_name"]
    stream = student.get("stream")
    is_sibling = student.get("is_sibling", False)
    due_day = cfg.get("due_day", 10)

    sibling_adm_disc = cfg.get("sibling_admission_discount_amount", 0) if is_sibling else 0
    sibling_tuit_disc = cfg.get("sibling_tuition_discount_amount", 0) if is_sibling else 0

    remaining_months = get_remaining_months(academic_year, f"{admission_month}-01")
    docs = []
    now_iso = datetime.utcnow().isoformat()

    # One-time fees
    for cfg_field, label in [
        ("registration_fee", "Registration Fee"),
        ("admission_fee", "Admission Fee"),
        ("caution_deposit", "Caution Deposit (Refundable)"),
    ]:
        gross = cfg.get(cfg_field, 0)
        if gross <= 0:
            continue
        existing = await db.student_ledger.find_one({
            "student_id": student_id, "fee_component": CFG_FIELD_TO_COMPONENT[cfg_field], "fee_type": "one_time"
        }, {"_id": 0, "ledger_id": 1})
        if existing:
            continue
        disc = 0
        if cfg_field == "admission_fee" and sibling_adm_disc > 0:
            disc = min(sibling_adm_disc, gross)  # Don't discount more than the fee
        net = gross - disc
        yr, mn = admission_month.split("-")
        due_date = f"{yr}-{mn}-{str(due_day).zfill(2)}"
        docs.append({
            "ledger_id": f"ldg_{uuid4().hex[:12]}",
            "student_id": student_id, "admission_number": admission_number,
            "class_name": class_name, "stream": stream, "academic_year": academic_year,
            "fee_component": CFG_FIELD_TO_COMPONENT[cfg_field],
            "fee_type": "one_time", "description": label,
            "month": None, "gross_amount": gross,
            "concession_amount": disc, "concession_reason": f"Sibling discount (₹{disc})" if disc > 0 else None,
            "late_fee_applied": 0, "net_amount": net,
            "remaining_balance": net, "amount_paid": 0,
            "due_date": due_date, "status": "pending",
            "payment_id": None, "receipt_number": None, "paid_date": None,
            "created_at": now_iso,
        })

    # Yearly fees
    for comp, label in [
        ("annual_charge", "Annual Charge"), ("activity_fee", "Activity Fee"),
        ("exam_fee", "Exam Fee"), ("lab_fee", "Lab Fee"), ("ai_robotics_fee", "AI & Robotics Fee"),
    ]:
        gross = cfg.get(comp, 0)
        if gross <= 0:
            continue
        existing = await db.student_ledger.find_one({
            "student_id": student_id, "fee_component": comp, "fee_type": "yearly", "academic_year": academic_year
        }, {"_id": 0, "ledger_id": 1})
        if existing:
            continue
        yr, mn = admission_month.split("-")
        due_date = f"{yr}-{mn}-{str(due_day).zfill(2)}"
        docs.append({
            "ledger_id": f"ldg_{uuid4().hex[:12]}",
            "student_id": student_id, "admission_number": admission_number,
            "class_name": class_name, "stream": stream, "academic_year": academic_year,
            "fee_component": comp, "fee_type": "yearly",
            "description": f"{label} {academic_year}",
            "month": None, "gross_amount": gross,
            "concession_amount": 0, "concession_reason": None,
            "late_fee_applied": 0, "net_amount": gross,
            "remaining_balance": gross, "amount_paid": 0,
            "due_date": due_date, "status": "pending",
            "payment_id": None, "receipt_number": None, "paid_date": None,
            "created_at": now_iso,
        })

    # Monthly tuition
    tuition = cfg.get("monthly_tuition", 0)
    if tuition > 0:
        disc_amt = min(sibling_tuit_disc, tuition) if sibling_tuit_disc > 0 else 0  # Don't discount more than tuition
        net_tuition = tuition - disc_amt
        month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        for month_str in remaining_months:
            existing = await db.student_ledger.find_one({
                "student_id": student_id, "fee_component": "tuition",
                "month": month_str, "academic_year": academic_year
            }, {"_id": 0, "ledger_id": 1})
            if existing:
                continue
            yr, mn = month_str.split("-")
            due_date = f"{yr}-{mn}-{str(due_day).zfill(2)}"
            desc = f"Tuition — {month_names[int(mn)]} {yr}"
            docs.append({
                "ledger_id": f"ldg_{uuid4().hex[:12]}",
                "student_id": student_id, "admission_number": admission_number,
                "class_name": class_name, "stream": stream, "academic_year": academic_year,
                "fee_component": "tuition", "fee_type": "monthly", "description": desc,
                "month": month_str, "gross_amount": tuition,
                "concession_amount": disc_amt,
                "concession_reason": f"Sibling discount (₹{disc_amt})" if disc_amt > 0 else None,
                "late_fee_applied": 0, "net_amount": net_tuition,
                "remaining_balance": net_tuition, "amount_paid": 0,
                "due_date": due_date, "status": "pending",
                "payment_id": None, "receipt_number": None, "paid_date": None,
                "created_at": now_iso,
            })

    if docs:
        await db.student_ledger.insert_many(docs)
    return len(docs)


async def migrate():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "shemford_school")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    students = await db.students.find({"is_active": True}, {"_id": 0}).to_list(5000)
    logger.info("Total active students: %d", len(students))

    total_created = 0
    skipped = 0
    no_config = 0

    for student in students:
        # Check if student already has ledger entries
        count = await db.student_ledger.count_documents({"student_id": student["student_id"]})
        if count > 0:
            skipped += 1
            continue

        academic_year = student.get("academic_year", "2025-2026")
        cfg = await get_fee_config(db, student["class_name"], academic_year, student.get("stream"))
        if not cfg:
            logger.warning("  No fee config: %s %s class=%s year=%s stream=%s",
                           student["first_name"], student["last_name"],
                           student["class_name"], academic_year, student.get("stream"))
            no_config += 1
            continue

        admission_date = student.get("admission_date", datetime.now().strftime("%Y-%m-%d"))
        admission_month = admission_date[:7]
        created = await create_ledger_for_student(db, student, cfg, academic_year, admission_month)
        total_created += created
        logger.info("  Generated %d entries for %s %s (%s)",
                    created, student["first_name"], student["last_name"], student["student_id"])

    logger.info("\nDone. Created: %d entries | Already had entries: %d | No config: %d",
                total_created, skipped, no_config)
    client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
