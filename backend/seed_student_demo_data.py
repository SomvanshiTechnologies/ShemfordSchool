"""
Demo-account seeding so the parent + student app screens are never blank.

Does THREE things for student@shemford.edu / parent@shemford.edu:

  1. Links the parent user to the student record (sets parent_id on the
     students doc). Without this the parent's app shows "No children linked".

  2. Seeds attendance for the LAST 90 DAYS (incl. the current month) so the
     My Attendance / Children's Attendance screens have data on whichever
     month the user happens to open today.

  3. Seeds a small current-academic-year fee ledger if none exists, so the
     My Fees screen shows pending + paid + overdue entries.

Idempotent: every write uses upsert / $setOnInsert. Safe to re-run.

Run (inside the backend container):
    sudo docker compose exec backend python seed_student_demo_data.py

Run (local dev with venv):
    python seed_student_demo_data.py
"""
import asyncio
import os
import random
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")

DAYS_BACK     = int(os.environ.get("DAYS_BACK", "90"))
STUDENT_EMAIL = os.environ.get("STUDENT_EMAIL", "student@shemford.edu")
PARENT_EMAIL  = os.environ.get("PARENT_EMAIL",  "parent@shemford.edu")


def current_academic_year() -> str:
    """India AY runs Apr→Mar. month >= April → this year + next, else last + this."""
    today = datetime.now()
    y = today.year
    return f"{y}-{y+1}" if today.month >= 4 else f"{y-1}-{y}"


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    student_user = await db.users.find_one({"email": STUDENT_EMAIL}, {"_id": 0})
    parent_user  = await db.users.find_one({"email": PARENT_EMAIL},  {"_id": 0})
    if not student_user:
        print(f"✗ {STUDENT_EMAIL} not found. Run seed_data.py first.")
        client.close(); return
    if not parent_user:
        print(f"✗ {PARENT_EMAIL} not found. Run seed_data.py first.")
        client.close(); return

    student = await db.students.find_one({"user_id": student_user["user_id"]}, {"_id": 0})
    if not student:
        print(f"✗ No linked students record for {STUDENT_EMAIL}. Run seed_test_student.py first.")
        client.close(); return

    sid = student["student_id"]
    cls = student.get("class_name")
    sec = student.get("section")
    ay  = current_academic_year()
    print(f"Student: {student.get('first_name')} {student.get('last_name')} ({sid}) — {cls}-{sec}")
    print(f"Parent : {parent_user.get('name') or PARENT_EMAIL}  ({parent_user['user_id']})")
    print(f"AY     : {ay}")

    # ── 1. Link parent ↔ student ─────────────────────────────────────────────
    update = {}
    if student.get("parent_id") != parent_user["user_id"]:
        update["parent_id"] = parent_user["user_id"]
    if student.get("parent_email") != PARENT_EMAIL:
        update["parent_email"] = PARENT_EMAIL
    if not student.get("parent_name"):
        update["parent_name"] = parent_user.get("name") or "Parent"
    if update:
        await db.students.update_one({"student_id": sid}, {"$set": update})
        print(f"✓ Parent link updated: {list(update.keys())}")
    else:
        print("✓ Parent link already in place.")

    # ── 2. Attendance — Mon–Sat working days for the last DAYS_BACK days ────
    today = datetime.now(timezone.utc).date()
    holidays = set()
    async for h in db.holidays.find({"is_active": True}, {"_id": 0, "date": 1}):
        if h.get("date"):
            holidays.add(h["date"])

    days = []
    for i in range(DAYS_BACK + 1):
        d = today - timedelta(days=i)
        if d.weekday() < 6 and d.isoformat() not in holidays:
            days.append(d.isoformat())

    att_inserted = 0
    for date_str in days:
        r = random.random()
        status = "present" if r < 0.92 else ("absent" if r < 0.96 else "leave")
        result = await db.attendance.update_one(
            {"entity_type": "student", "entity_id": sid, "date": date_str},
            {"$setOnInsert": {
                "attendance_id": str(uuid.uuid4()),
                "entity_type":   "student",
                "entity_id":     sid,
                "date":          date_str,
                "status":        status,
                "class_name":    cls,
                "section":       sec,
                "marked_by":     "system",
                "remarks":       None,
                "is_locked":     True,
                "created_at":    datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
        if result.upserted_id is not None:
            att_inserted += 1

    # ── 3. Marks — one row per (exam, subject) for every published exam ─────
    exams = await db.exams.find(
        {"class_name": cls, "is_published": True},
        {"_id": 0, "exam_id": 1, "subjects": 1, "academic_year": 1},
    ).to_list(50)

    marks_inserted = 0
    for ex in exams:
        for subj in ex.get("subjects", []) or []:
            max_marks = float(subj.get("max_marks", 100))
            score = round(random.uniform(0.55, 0.95) * max_marks)
            r = await db.mark_records.update_one(
                {"student_id": sid, "exam_id": ex["exam_id"], "subject": subj["subject"]},
                {"$setOnInsert": {
                    "mark_id":        str(uuid.uuid4()),
                    "student_id":     sid,
                    "exam_id":        ex["exam_id"],
                    "subject":        subj["subject"],
                    "marks_obtained": score,
                    "max_marks":      max_marks,
                    "section":        sec,
                    "academic_year":  ex.get("academic_year") or student.get("academic_year") or ay,
                    "created_at":     datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )
            if r.upserted_id is not None:
                marks_inserted += 1

    # ── 4. Fee ledger for current AY — only if none exists ──────────────────
    existing_count = await db.student_ledger.count_documents({
        "student_id": sid, "academic_year": ay,
    })

    fee_inserted = 0
    if existing_count == 0:
        cfg = await db.fee_component_configs.find_one(
            {"class_name": cls, "academic_year": ay}, {"_id": 0},
        )
        # If no current-AY config, fall back to any config for this class
        if not cfg:
            cfg = await db.fee_component_configs.find_one(
                {"class_name": cls}, {"_id": 0},
            )
        if cfg:
            today_str = today.isoformat()
            year_prefix = ay.split("-")[0]
            entries = []

            # Yearly + one-time components — mark first 2 as paid, rest pending
            comps = [
                ("registration_fee", "registration",    "Registration Fee",            "one_time", "paid"),
                ("admission_fee",    "admission",       "Admission Fee",               "one_time", "paid"),
                ("caution_deposit",  "caution_deposit", "Caution Deposit (Refundable)","one_time", "pending"),
                ("annual_charge",    "annual_charge",   "Annual Charge",               "yearly",   "paid"),
                ("activity_fee",     "activity_fee",    "Activity Fee",                "yearly",   "pending"),
                ("exam_fee",         "exam_fee",        "Exam Fee",                    "yearly",   "pending"),
            ]
            for field, comp, label, ftype, status in comps:
                gross = cfg.get(field, 0) or 0
                if gross <= 0:
                    continue
                pay_id = f"pay_demo_{uuid.uuid4().hex[:10]}" if status == "paid" else None
                receipt = f"REC/{ay.replace('-','')[2:]}/DEMO-{uuid.uuid4().hex[:6].upper()}" if status == "paid" else None
                entries.append({
                    "ledger_id":        f"ldg_{uuid.uuid4().hex[:12]}",
                    "student_id":       sid,
                    "admission_number": student.get("admission_number"),
                    "class_name":       cls,
                    "stream":           student.get("stream"),
                    "academic_year":    ay,
                    "fee_component":    comp,
                    "fee_type":         ftype,
                    "description":      label,
                    "month":            None,
                    "gross_amount":     gross,
                    "concession_amount": 0,
                    "concession_reason": None,
                    "late_fee_applied": 0,
                    "net_amount":       gross,
                    "remaining_balance": 0 if status == "paid" else gross,
                    "due_date":          f"{year_prefix}-04-10",
                    "status":            status,
                    "payment_id":        pay_id,
                    "receipt_number":    receipt,
                    "paid_date":         today_str if status == "paid" else None,
                    "created_at":        datetime.now(timezone.utc).isoformat(),
                })

            # Monthly tuition — first 3 paid, rest pending/overdue
            tuition = cfg.get("monthly_tuition", 0) or 0
            if tuition > 0:
                ay_months = [f"{year_prefix}-{m:02d}" for m in (4,5,6,7,8,9,10,11,12)] + \
                            [f"{int(year_prefix)+1}-{m:02d}" for m in (1,2,3)]
                today_m = today.strftime("%Y-%m")
                for idx, month in enumerate(ay_months):
                    due = f"{month}-10"
                    if month > today_m:
                        status = "pending"
                    elif idx < 3:
                        status = "paid"
                    else:
                        status = "overdue" if month < today_m else "pending"
                    pay_id  = f"pay_demo_{uuid.uuid4().hex[:10]}" if status == "paid" else None
                    receipt = f"REC/{ay.replace('-','')[2:]}/DEMO-{uuid.uuid4().hex[:6].upper()}" if status == "paid" else None
                    entries.append({
                        "ledger_id":        f"ldg_{uuid.uuid4().hex[:12]}",
                        "student_id":       sid,
                        "admission_number": student.get("admission_number"),
                        "class_name":       cls,
                        "stream":           student.get("stream"),
                        "academic_year":    ay,
                        "fee_component":    "monthly_tuition",
                        "fee_type":         "monthly",
                        "description":      f"Tuition Fee — {datetime.strptime(month, '%Y-%m').strftime('%B %Y')}",
                        "month":            month,
                        "gross_amount":     tuition,
                        "concession_amount": 0,
                        "concession_reason": None,
                        "late_fee_applied": 0,
                        "net_amount":       tuition,
                        "remaining_balance": 0 if status == "paid" else tuition,
                        "due_date":          due,
                        "status":            status,
                        "payment_id":        pay_id,
                        "receipt_number":    receipt,
                        "paid_date":         today_str if status == "paid" else None,
                        "created_at":        datetime.now(timezone.utc).isoformat(),
                    })

            if entries:
                await db.student_ledger.insert_many(entries)
                fee_inserted = len(entries)

    print(f"✓ Attendance inserted: {att_inserted}/{len(days)} working days "
          f"({days[-1] if days else '—'} → {days[0] if days else '—'})")
    print(f"✓ Marks inserted     : {marks_inserted} (across {len(exams)} published exam(s))")
    print(f"✓ Fee ledger inserted: {fee_inserted} for AY {ay}"
          f"{' (skipped — already had ' + str(existing_count) + ' entries)' if existing_count else ''}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
