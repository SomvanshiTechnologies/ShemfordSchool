"""
seed_prior_sessions.py

Creates the `sessions` collection rows and seeds a small set of students +
fee ledger entries for prior academic years (2023-2024, 2024-2025) so that
switching the active session in the ERP shows real, isolated data per year.

- 2025-2026 stays the active session (existing bulk-seeded data).
- 2024-2025 and 2023-2024 get ~15 students each with a few ledger entries,
  marked status='archived' (read-only) so archive protection can be demoed.

Idempotent: students keyed by admission_number; sessions by session_name.

Usage (from backend/):
    MONGO_URL="mongodb://localhost:27017/?directConnection=true" .venv/Scripts/python.exe seed_prior_sessions.py
"""
import os
import asyncio
import random
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne

load_dotenv()
db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

FIRST = ["Aarav", "Vivaan", "Aditya", "Ananya", "Diya", "Saanvi", "Ishaan", "Kabir",
         "Anaya", "Riya", "Vihaan", "Reyansh", "Myra", "Aadhya", "Kiaan", "Sara"]
LAST = ["Sharma", "Verma", "Gupta", "Patel", "Singh", "Kumar", "Joshi", "Mehta",
        "Nair", "Reddy", "Rao", "Iyer", "Bose", "Kapoor", "Malhotra"]
CLASSES = ["3rd", "4th", "5th", "6th", "7th", "8th"]
SECTIONS = ["Blue", "Green", "Red", "Yellow"]
ACTIVE = "2025-2026"
PRIOR = ["2024-2025", "2023-2024"]

# Per-session config so each archived year has visibly DISTINCT data — different
# student counts and fee amounts (fees were lower in earlier years), not the
# same seed values across sessions.
SESSION_CONFIG = {
    "2024-2025": {"n": 25, "tuition": 2400, "annual_charge": 4800, "admission": 9500, "exam_fee": 1400},
    "2023-2024": {"n": 15, "tuition": 1800, "annual_charge": 3500, "admission": 7500, "exam_fee": 900},
}
_DEFAULT_CFG = {"n": 15, "tuition": 2500, "annual_charge": 5000, "admission": 10000, "exam_fee": 1500}


async def ensure_sessions():
    now = datetime.now(timezone.utc).isoformat()
    for name in [ACTIVE] + PRIOR:
        sy = int(name.split("-")[0])
        is_active = (name == ACTIVE)
        status = "active" if is_active else "archived"
        await db.sessions.update_one(
            {"session_name": name},
            {"$setOnInsert": {
                "session_id": f"sess_{uuid.uuid4().hex[:12]}",
                "created_at": now,
            }, "$set": {
                "session_name": name,
                "start_date": f"{sy}-04-01",
                "end_date": f"{sy + 1}-03-31",
                "status": status,
                "is_active": is_active,
                "updated_at": now,
            }},
            upsert=True,
        )
    # Make sure exactly one is active
    await db.sessions.update_many({"session_name": {"$ne": ACTIVE}}, {"$set": {"is_active": False}})
    await db.sessions.update_one({"session_name": ACTIVE}, {"$set": {"is_active": True, "status": "active"}})
    await db.school_settings.update_one({"_id": "session"}, {"$set": {"active_session": ACTIVE}}, upsert=True)
    print(f"Sessions ready: active={ACTIVE}, archived={PRIOR}")


async def seed_session_students(year: str):
    now = datetime.now(timezone.utc).isoformat()
    sy = year.split("-")[0]
    cfg = SESSION_CONFIG.get(year, _DEFAULT_CFG)
    n = cfg["n"]
    random.seed(int(sy))  # deterministic, distinct draws per session

    # 1. Ensure n students exist for the year (create only the missing ones).
    existing = await db.students.find(
        {"academic_year": year}, {"_id": 0, "student_id": 1}
    ).to_list(1000)
    stu_ops = []
    for i in range(len(existing), n):
        sid = f"STU{sy}{uuid.uuid4().hex[:6].upper()}"
        adm = f"SHM/{sy}/{9000 + i}"
        stu_ops.append(UpdateOne(
            {"admission_number": adm},
            {"$setOnInsert": {"student_id": sid, "created_at": now},
             "$set": {
                "admission_number": adm,
                "first_name": random.choice(FIRST),
                "last_name": random.choice(LAST),
                "gender": random.choice(["male", "female"]),
                "class_name": random.choice(CLASSES),
                "section": random.choice(SECTIONS),
                "academic_year": year,
                "roll_number": f"{sy[-2:]}{i + 1:03d}",
                "is_active": True,
                "fee_status": random.choice(["paid", "paid", "pending", "overdue"]),
                "phone": f"98{random.randint(10000000, 99999999)}",
             }},
            upsert=True,
        ))
    if stu_ops:
        await db.students.bulk_write(stu_ops, ordered=False)

    # 2. Seed ledger for ALL of the year's students (real student_ids), keyed
    #    so re-runs don't duplicate.
    students = await db.students.find(
        {"academic_year": year}, {"_id": 0, "student_id": 1, "admission_number": 1, "class_name": 1}
    ).to_list(1000)
    ledger_ops = []
    for stu in students:
        sid, adm, cls = stu["student_id"], stu.get("admission_number", ""), stu.get("class_name", "")
        for comp, amt, ftype in [("annual_charge", cfg["annual_charge"], "yearly"),
                                 ("admission", cfg["admission"], "one_time"),
                                 ("exam_fee", cfg["exam_fee"], "yearly")]:
            paid = random.random() < 0.6
            ledger_ops.append(UpdateOne(
                {"student_id": sid, "academic_year": year, "fee_component": comp},
                {"$setOnInsert": {"ledger_id": f"led_{uuid.uuid4().hex[:12]}", "created_at": now},
                 "$set": {
                    "student_id": sid, "admission_number": adm, "class_name": cls,
                    "academic_year": year, "fee_component": comp, "fee_type": ftype,
                    "description": f"{comp.replace('_', ' ').title()} ({year})",
                    "gross_amount": amt, "net_amount": amt,
                    "amount_paid": amt if paid else 0, "remaining_balance": 0 if paid else amt,
                    "due_date": f"{sy}-04-10",
                    "status": "paid" if paid else "overdue",
                 }},
                upsert=True,
            ))
        for k in range(12):
            m = ((k + 3) % 12) + 1
            yy = int(sy) if m >= 4 else int(sy) + 1
            mm = f"{m:02d}"
            paid = random.random() < 0.65
            ledger_ops.append(UpdateOne(
                {"student_id": sid, "academic_year": year, "fee_component": "tuition", "due_date": f"{yy}-{mm}-10"},
                {"$setOnInsert": {"ledger_id": f"led_{uuid.uuid4().hex[:12]}", "created_at": now},
                 "$set": {
                    "student_id": sid, "admission_number": adm, "class_name": cls,
                    "academic_year": year, "fee_component": "tuition", "fee_type": "monthly",
                    "description": f"Tuition Fee {yy}-{mm}",
                    "gross_amount": cfg["tuition"], "net_amount": cfg["tuition"],
                    "amount_paid": cfg["tuition"] if paid else 0, "remaining_balance": 0 if paid else cfg["tuition"],
                    "due_date": f"{yy}-{mm}-10",
                    "status": "paid" if paid else "overdue",
                 }},
                upsert=True,
            ))
    if ledger_ops:
        await db.student_ledger.bulk_write(ledger_ops, ordered=False)
    print(f"[{year}] {len(students)} students, {len(ledger_ops)} ledger entries upserted "
          f"({len(stu_ops)} new students)")


SUBJECTS = ["English", "Hindi", "Math", "Science", "Social Studies"]


async def seed_session_attendance(year: str):
    """~12 school days of attendance for the year's students."""
    sy = int(year.split("-")[0])
    students = await db.students.find(
        {"academic_year": year}, {"_id": 0, "student_id": 1, "class_name": 1, "section": 1}
    ).to_list(1000)
    if not students:
        return
    # A dozen dates spread across the session (Apr-year .. Feb-next).
    dates = [f"{sy if m >= 4 else sy + 1}-{m:02d}-15" for m in [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]]
    now = datetime.now(timezone.utc).isoformat()
    ops = []
    for stu in students:
        for d in dates:
            ops.append(UpdateOne(
                {"entity_type": "student", "entity_id": stu["student_id"], "date": d},
                {"$set": {
                    "attendance_id": f"att_{uuid.uuid4().hex[:12]}",
                    "entity_type": "student", "entity_id": stu["student_id"], "date": d,
                    "status": random.choice(["present"] * 9 + ["absent", "leave"]),
                    "class_name": stu.get("class_name"), "section": stu.get("section"),
                    "marked_by": "seed-script", "is_locked": True, "created_at": now, "_seeded": True,
                }},
                upsert=True,
            ))
    if ops:
        await db.attendance.bulk_write(ops, ordered=False)
    print(f"[{year}] {len(ops)} attendance records upserted")


async def seed_session_marks(year: str):
    """One 'Annual Examination' exam per class present in the year, + marks."""
    students = await db.students.find(
        {"academic_year": year}, {"_id": 0, "student_id": 1, "class_name": 1, "section": 1}
    ).to_list(1000)
    if not students:
        return
    now = datetime.now(timezone.utc).isoformat()
    classes = sorted({s["class_name"] for s in students if s.get("class_name")})
    exam_by_class = {}
    for cls in classes:
        exam_id = f"exam_{uuid.uuid4().hex[:10]}"
        await db.exam_definitions.update_one(
            {"name": f"Annual Examination {year}", "class_name": cls, "academic_year": year},
            {"$setOnInsert": {"exam_id": exam_id, "created_at": now},
             "$set": {
                "name": f"Annual Examination {year}", "class_name": cls, "academic_year": year,
                "exam_type": "term", "is_published": True, "is_locked": False,
                "subjects": [{"subject": s, "max_marks": 100} for s in SUBJECTS],
             }},
            upsert=True,
        )
        doc = await db.exam_definitions.find_one(
            {"name": f"Annual Examination {year}", "class_name": cls, "academic_year": year}, {"_id": 0, "exam_id": 1})
        exam_by_class[cls] = doc["exam_id"]

    ops = []
    for stu in students:
        eid = exam_by_class.get(stu["class_name"])
        if not eid:
            continue
        for subj in SUBJECTS:
            obtained = random.randint(45, 98)
            ops.append(UpdateOne(
                {"student_id": stu["student_id"], "exam_id": eid, "subject": subj},
                {"$setOnInsert": {"mark_id": f"mark_{uuid.uuid4().hex[:12]}", "created_at": now},
                 "$set": {
                    "student_id": stu["student_id"], "exam_id": eid, "class_name": stu["class_name"],
                    "section": stu.get("section"), "subject": subj, "exam_type": "term",
                    "term": f"Annual Examination {year}", "academic_year": year,
                    "marks_obtained": obtained, "max_marks": 100,
                    "grade": "A1" if obtained >= 91 else "A2" if obtained >= 81 else "B1" if obtained >= 71 else "B2" if obtained >= 61 else "C1",
                    "entered_by": "seed-script", "is_locked": False,
                 }},
                upsert=True,
            ))
    if ops:
        await db.mark_records.bulk_write(ops, ordered=False)
    print(f"[{year}] {len(classes)} exams, {len(ops)} mark records upserted")


async def seed_session_payments(year: str):
    """Create fee_payments for the PAID ledger entries so the Collection report
    and dashboard 'collection' figures are populated (and distinct) per session.
    One payment per paid entry, linked via installment_ids so fee categories
    resolve; payment_date = due_date (inside the session); methods rotated."""
    random.seed(int(year.split("-")[0]) + 7)
    paid = await db.student_ledger.find(
        {"academic_year": year, "status": "paid"},
        {"_id": 0, "ledger_id": 1, "student_id": 1, "net_amount": 1, "due_date": 1},
    ).to_list(50000)
    if not paid:
        print(f"[{year}] no paid ledger entries — no payments to seed")
        return
    sy = year.split("-")[0]
    methods = ["cash", "online", "cheque", "bank_transfer", "upi"]
    ops = []
    for i, e in enumerate(paid):
        pay_id = f"pay_seed_{e['ledger_id']}"  # deterministic → idempotent re-runs
        ops.append(UpdateOne(
            {"payment_id": pay_id},
            {"$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()},
             "$set": {
                "payment_id": pay_id,
                "student_id": e["student_id"],
                "installment_ids": [e["ledger_id"]],
                "amount": float(e.get("net_amount", 0)),
                "payment_date": e.get("due_date") or f"{sy}-04-10",
                "payment_method": methods[i % len(methods)],
                "receipt_number": f"RCP-{year}-{i + 1:05d}",
                "academic_year": year,
                "_seeded": True,
             }},
            upsert=True,
        ))
    if ops:
        await db.fee_payments.bulk_write(ops, ordered=False)
    print(f"[{year}] {len(ops)} fee_payments upserted")


async def main():
    await ensure_sessions()
    for y in PRIOR:
        await seed_session_students(y)
        await seed_session_attendance(y)
        await seed_session_marks(y)
        await seed_session_payments(y)
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
