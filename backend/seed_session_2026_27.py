"""
seed_session_2026_27.py — give the ACTIVE 2026-2027 session demo data across
*every* module, so switching to it is no longer blank. One file, all modules.

Modules covered (all tagged academic_year="2026-2027", dated inside the session
window Apr-2026 .. Mar-2027, time-based data capped at "today" since the session
is live):

  • Sessions            — ensure 2026-2027 row exists & is active
  • Fee structure       — fee_component_configs (cloned from the latest prior
                          year, so amounts come from the DB, never hardcoded)
  • Students            — ~25 students
  • Fees / ledger       — yearly + one-time components + 12 monthly tuition rows,
                          amounts pulled from the fee config
  • Payments            — fee_payments for the paid ledger rows (Collection report)
  • Attendance          — student attendance for elapsed school months
  • Exams + Marks       — one published "Unit Test 1" per class + mark records
  • Payroll             — monthly payroll for elapsed months (active employees)
  • Employee attendance — present rows for elapsed school months
  • Announcements / Issues / Messages
  • Syllabus            — a few chapters per subject per class
  • Audit trail         — a couple of deactivate events

Idempotent: every write upserts on a deterministic key, safe to re-run.

Usage (from backend/):
  MONGO_URL="mongodb://localhost:27017/?directConnection=true" DB_NAME="shemford_school" \
      .venv/Scripts/python.exe seed_session_2026_27.py
"""
import os
import asyncio
import random
import uuid
from datetime import datetime, timezone, date

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne

load_dotenv()
db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

AY = "2026-2027"
SY = 2026                       # start calendar year
ADMIN_ID = "user_374af3d88f49"
ADMIN_NAME = "Admin User"
NOW = datetime.now(timezone.utc).isoformat()
TODAY = date.today()

# Last-resort fallbacks only (used when the DB has nothing to derive from).
FIRST = ["Aarav", "Vivaan", "Aditya", "Ananya", "Diya", "Saanvi", "Ishaan", "Kabir",
         "Anaya", "Riya", "Vihaan", "Reyansh", "Myra", "Aadhya", "Kiaan", "Sara"]
LAST = ["Sharma", "Verma", "Gupta", "Patel", "Singh", "Kumar", "Joshi", "Mehta",
        "Nair", "Reddy", "Rao", "Iyer", "Bose", "Kapoor", "Malhotra"]
SECTIONS = ["Blue", "Green", "Red", "Yellow"]
SUBJECTS = ["English", "Hindi", "Math", "Science", "Social Studies"]
N_STUDENTS = 25

# Academic-year months Apr..Mar, with the calendar year each falls in.
AY_MONTHS = [(m, SY) for m in range(4, 13)] + [(m, SY + 1) for m in range(1, 4)]


def elapsed(m, y):
    """True if the 1st of this AY-month is on/before today (live-session cap)."""
    return date(y, m, 1) <= TODAY


# ───────────────────────── 1. Session row ──────────────────────────────────
async def ensure_session():
    await db.sessions.update_one(
        {"session_name": AY},
        {"$setOnInsert": {"session_id": f"sess_{uuid.uuid4().hex[:12]}", "created_at": NOW},
         "$set": {"session_name": AY, "start_date": f"{SY}-04-01", "end_date": f"{SY + 1}-03-31",
                  "status": "active", "is_active": True, "updated_at": NOW}},
        upsert=True)
    await db.sessions.update_many({"session_name": {"$ne": AY}}, {"$set": {"is_active": False}})
    await db.school_settings.update_one({"_id": "session"}, {"$set": {"active_session": AY}}, upsert=True)
    print(f"Session {AY} ensured active.")


# ───────────────────── 2. Fee structure (cloned) ───────────────────────────
async def seed_fee_configs():
    """Clone the latest prior year's fee configs into 2026-2027 (amounts from DB)."""
    if await db.fee_component_configs.count_documents({"academic_year": AY, "is_active": True}):
        print(f"[fee config] already present for {AY}.")
        return
    prior_years = await db.fee_component_configs.distinct("academic_year")
    prior_years = sorted([y for y in prior_years if y and y < AY], reverse=True)
    if not prior_years:
        print("[fee config] no prior fee configs to clone — skipping (ledger will fall back).")
        return
    src = prior_years[0]
    configs = await db.fee_component_configs.find(
        {"academic_year": src, "is_active": True}, {"_id": 0}).to_list(500)
    ops = []
    for c in configs:
        c = {**c, "config_id": f"fcc_{uuid.uuid4().hex[:10]}", "academic_year": AY,
             "is_active": True, "notes": f"Cloned from {src} for {AY}",
             "created_by": "seed_script", "created_at": NOW, "updated_at": None}
        ops.append(UpdateOne(
            {"academic_year": AY, "class_name": c.get("class_name"), "stream": c.get("stream")},
            {"$setOnInsert": c}, upsert=True))
    if ops:
        await db.fee_component_configs.bulk_write(ops, ordered=False)
    print(f"[fee config] cloned {len(ops)} configs from {src} → {AY}.")


# ───────────────────────────── 3. Students ─────────────────────────────────
async def _class_list():
    """Derive real classes from fee configs / prior students / structures; fallback."""
    cls = await db.fee_component_configs.distinct("class_name", {"academic_year": AY})
    if not cls:
        cls = await db.students.distinct("class_name", {"academic_year": {"$lt": AY}})
    if not cls:
        cls = await db.class_structures.distinct("class_name")
    cls = [c for c in cls if c]
    return cls or ["3rd", "4th", "5th", "6th", "7th", "8th"]


async def seed_students(classes):
    random.seed(SY)
    existing = await db.students.count_documents({"academic_year": AY})
    ops = []
    for i in range(existing, N_STUDENTS):
        sid = f"STU{SY}{uuid.uuid4().hex[:6].upper()}"
        adm = f"SHM/{SY}/{9000 + i}"
        ops.append(UpdateOne(
            {"admission_number": adm},
            {"$setOnInsert": {"student_id": sid, "created_at": NOW},
             "$set": {"admission_number": adm, "first_name": random.choice(FIRST),
                      "last_name": random.choice(LAST), "gender": random.choice(["male", "female"]),
                      "class_name": random.choice(classes), "section": random.choice(SECTIONS),
                      "academic_year": AY, "roll_number": f"{str(SY)[-2:]}{i + 1:03d}",
                      "is_active": True, "fee_status": random.choice(["paid", "paid", "pending", "overdue"]),
                      "phone": f"98{random.randint(10000000, 99999999)}"}},
            upsert=True))
    if ops:
        await db.students.bulk_write(ops, ordered=False)
    total = await db.students.count_documents({"academic_year": AY})
    print(f"[students] {total} students for {AY} ({len(ops)} new).")


# ──────────────────── 4 + 5. Ledger and payments ───────────────────────────
async def seed_ledger_and_payments():
    random.seed(SY + 1)
    students = await db.students.find(
        {"academic_year": AY}, {"_id": 0, "student_id": 1, "admission_number": 1, "class_name": 1}
    ).to_list(5000)
    # Per-class fee config (amounts from the DB). Fallback amounts only if none.
    cfgs = {c["class_name"]: c for c in await db.fee_component_configs.find(
        {"academic_year": AY, "is_active": True}, {"_id": 0}).to_list(500)}
    FALLBACK = {"monthly_tuition": 1300, "annual_charge": 3600, "admission_fee": 2500,
                "registration_fee": 500, "caution_deposit": 1000, "activity_fee": 2400,
                "exam_fee": 300, "lab_fee": 1500, "ai_robotics_fee": 0}

    ledger_ops, pay_ops = [], []
    methods = ["cash", "online", "cheque", "bank_transfer", "upi"]
    pidx = 0
    for stu in students:
        sid, adm, cls = stu["student_id"], stu.get("admission_number", ""), stu.get("class_name", "")
        cfg = cfgs.get(cls) or (next(iter(cfgs.values())) if cfgs else FALLBACK)

        def amt(field):
            v = cfg.get(field)
            return float(v if v is not None else FALLBACK.get(field, 0))

        rows = [
            ("registration", amt("registration_fee"), "one_time", f"{SY}-04-10"),
            ("admission",    amt("admission_fee"),    "one_time", f"{SY}-04-10"),
            ("annual_charge", amt("annual_charge"),   "yearly",   f"{SY}-04-10"),
            ("activity_fee", amt("activity_fee"),     "yearly",   f"{SY}-04-10"),
            ("exam_fee",     amt("exam_fee"),         "yearly",   f"{SY}-04-10"),
        ]
        # 12 monthly tuition rows (Apr..Mar)
        tuition = amt("monthly_tuition")
        for m, y in AY_MONTHS:
            rows.append(("tuition", tuition, "monthly", f"{y}-{m:02d}-10"))

        for comp, gross, ftype, due in rows:
            if gross <= 0:
                continue
            past_due = date.fromisoformat(due) <= TODAY
            paid = past_due and random.random() < 0.65   # only elapsed dues get paid
            desc = (f"Tuition Fee {due[:7]}" if comp == "tuition"
                    else f"{comp.replace('_', ' ').title()} ({AY})")
            led_key = {"student_id": sid, "academic_year": AY, "fee_component": comp, "due_date": due}
            ledger_id = f"led_{uuid.uuid4().hex[:12]}"
            ledger_ops.append(UpdateOne(
                led_key,
                {"$setOnInsert": {"ledger_id": ledger_id, "created_at": NOW},
                 "$set": {**led_key, "admission_number": adm, "class_name": cls, "fee_type": ftype,
                          "description": desc, "gross_amount": gross, "net_amount": gross,
                          "amount_paid": gross if paid else 0,
                          "remaining_balance": 0 if paid else gross,
                          "status": "paid" if paid else ("overdue" if past_due else "pending")}},
                upsert=True))
            if paid:
                pidx += 1
                pay_id = f"pay_seed_{ledger_id}"
                pay_ops.append(UpdateOne(
                    {"payment_id": pay_id},
                    {"$setOnInsert": {"created_at": NOW},
                     "$set": {"payment_id": pay_id, "student_id": sid, "installment_ids": [ledger_id],
                              "amount": gross, "payment_date": due,
                              "payment_method": methods[pidx % len(methods)],
                              "receipt_number": f"RCP-{AY}-{pidx:05d}", "academic_year": AY,
                              "_seeded": True}},
                    upsert=True))
    if ledger_ops:
        await db.student_ledger.bulk_write(ledger_ops, ordered=False)
    if pay_ops:
        await db.fee_payments.bulk_write(pay_ops, ordered=False)
    print(f"[fees] {len(ledger_ops)} ledger rows, {len(pay_ops)} payments for {AY}.")


# ───────────────────────────── 6. Attendance ───────────────────────────────
async def seed_attendance():
    random.seed(SY + 2)
    students = await db.students.find(
        {"academic_year": AY}, {"_id": 0, "student_id": 1, "class_name": 1, "section": 1}
    ).to_list(5000)
    dates = [f"{y}-{m:02d}-15" for m, y in AY_MONTHS if elapsed(m, y)]
    ops = []
    for stu in students:
        for d in dates:
            ops.append(UpdateOne(
                {"entity_type": "student", "entity_id": stu["student_id"], "date": d},
                {"$set": {"attendance_id": f"att_{uuid.uuid4().hex[:12]}", "entity_type": "student",
                          "entity_id": stu["student_id"], "date": d,
                          "status": random.choice(["present"] * 9 + ["absent", "leave"]),
                          "class_name": stu.get("class_name"), "section": stu.get("section"),
                          "marked_by": "seed-script", "is_locked": True, "created_at": NOW,
                          "_seeded": True}},
                upsert=True))
    if ops:
        await db.attendance.bulk_write(ops, ordered=False)
    print(f"[attendance] {len(ops)} student rows across {len(dates)} days.")


# ───────────────────────── 7. Exams + marks ────────────────────────────────
async def seed_marks():
    random.seed(SY + 3)
    students = await db.students.find(
        {"academic_year": AY}, {"_id": 0, "student_id": 1, "class_name": 1, "section": 1}
    ).to_list(5000)
    classes = sorted({s["class_name"] for s in students if s.get("class_name")})
    exam_by_class = {}
    for cls in classes:
        name = f"Unit Test 1 {AY}"
        await db.exam_definitions.update_one(
            {"name": name, "class_name": cls, "academic_year": AY},
            {"$setOnInsert": {"exam_id": f"exam_{uuid.uuid4().hex[:10]}", "created_at": NOW},
             "$set": {"name": name, "class_name": cls, "academic_year": AY, "exam_type": "term",
                      "is_published": True, "is_locked": False,
                      "subjects": [{"subject": s, "max_marks": 100} for s in SUBJECTS]}},
            upsert=True)
        doc = await db.exam_definitions.find_one(
            {"name": name, "class_name": cls, "academic_year": AY}, {"_id": 0, "exam_id": 1})
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
                {"$setOnInsert": {"mark_id": f"mark_{uuid.uuid4().hex[:12]}", "created_at": NOW},
                 "$set": {"student_id": stu["student_id"], "exam_id": eid, "class_name": stu["class_name"],
                          "section": stu.get("section"), "subject": subj, "exam_type": "term",
                          "term": f"Unit Test 1 {AY}", "academic_year": AY,
                          "marks_obtained": obtained, "max_marks": 100,
                          "grade": ("A1" if obtained >= 91 else "A2" if obtained >= 81 else
                                    "B1" if obtained >= 71 else "B2" if obtained >= 61 else "C1"),
                          "entered_by": "seed-script", "is_locked": False}},
                upsert=True))
    if ops:
        await db.mark_records.bulk_write(ops, ordered=False)
    print(f"[marks] {len(classes)} exams, {len(ops)} mark records.")


# ───────────────────── 8 + 9. Payroll + emp attendance ─────────────────────
async def seed_payroll():
    try:
        from routes.payroll import calculate_payroll
        from models import PayrollRecord, PayrollStatus
    except Exception as e:
        print(f"[payroll] skipped (import failed: {e}).")
        return
    emps = await db.employees.find({"is_active": True}, {"_id": 0}).to_list(1000)
    if not emps:
        print("[payroll] no active employees — skipped.")
        return
    months = [(m, y) for m, y in AY_MONTHS if elapsed(m, y)]
    total = 0
    for month, year in months:
        month_year = f"{year}-{month:02d}"
        month_end = f"{year}-{month:02d}-28"
        ops = []
        for emp in emps:
            jd = emp.get("joining_date") or "2000-01-01"
            left = emp.get("date_left")
            if jd > month_end:
                continue
            if left and left < f"{year}-{month:02d}-01":
                continue
            calc = calculate_payroll(emp, month, year)
            rec = PayrollRecord(
                employee_id=emp["employee_id"], month=month, year=year, month_year=month_year,
                generated_by="seed", status=PayrollStatus.PAID,
                paid_at=NOW, bank_account_number=emp.get("bank_account_number"),
                bank_ifsc=emp.get("bank_ifsc"), bank_name=emp.get("bank_name"), **calc)
            d = rec.model_dump()
            d["created_at"] = d["created_at"].isoformat()
            d["updated_at"] = d["updated_at"].isoformat()
            d.pop("payroll_id", None)
            ops.append(UpdateOne(
                {"employee_id": emp["employee_id"], "month_year": month_year},
                {"$setOnInsert": {"payroll_id": rec.payroll_id}, "$set": d}, upsert=True))
        if ops:
            await db.payroll.bulk_write(ops, ordered=False)
            total += len(ops)
    print(f"[payroll] {total} records across {len(months)} months.")


async def seed_employee_attendance():
    random.seed(SY + 4)
    emps = await db.employees.find({"is_active": True}, {"_id": 0, "employee_id": 1}).to_list(1000)
    if not emps:
        print("[emp attendance] no active employees — skipped.")
        return
    dates = [f"{y}-{m:02d}-15" for m, y in AY_MONTHS if elapsed(m, y)]
    ops = []
    for emp in emps:
        for d in dates:
            ops.append(UpdateOne(
                {"entity_type": "employee", "entity_id": emp["employee_id"], "date": d},
                {"$set": {"attendance_id": f"att_{uuid.uuid4().hex[:12]}", "entity_type": "employee",
                          "entity_id": emp["employee_id"], "date": d,
                          "status": random.choice(["present"] * 10 + ["leave"]),
                          "marked_by": "seed-script", "is_locked": True, "created_at": NOW,
                          "_seeded": True}},
                upsert=True))
    if ops:
        await db.attendance.bulk_write(ops, ordered=False)
    print(f"[emp attendance] {len(ops)} rows across {len(dates)} days.")


# ─────────────────── 10. Announcements / Issues / Messages ──────────────────
async def seed_operational():
    d = [f"{SY}-04-15T10:00:00+00:00", f"{SY}-05-20T11:30:00+00:00", f"{SY}-06-10T09:15:00+00:00"]
    ann_ops, iss_ops, msg_ops = [], [], []
    anns = [
        ("general",   f"Session {AY} kick-off",       "Welcome to the new academic session. Classes begin as scheduled."),
        ("homework",  f"Summer holiday homework — {AY}", "Submit holiday assignments by the reopening date."),
        ("classwork", f"Unit Test 1 schedule {AY}",   "Unit Test 1 begins next week. Check the timetable."),
    ]
    for i, (typ, title, content) in enumerate(anns):
        key = f"seed:ann:{AY}:{i}"
        ann_ops.append(UpdateOne({"_seed_key": key},
            {"$setOnInsert": {"announcement_id": f"ann_{uuid.uuid4().hex[:12]}"},
             "$set": {"_seed_key": key, "title": title, "content": content, "target_type": "all",
                      "target_audiences": ["student", "parent"], "priority": "normal",
                      "announcement_type": typ, "created_by": ADMIN_ID, "is_active": True,
                      "academic_year": AY, "created_at": d[i]}}, upsert=True))
    issues = [
        ("academic", "high",   "open",     f"Syllabus clarification ({AY})", "Need clarification on the revised syllabus."),
        ("facility", "normal", "resolved", f"Classroom fan repair ({AY})",   "Ceiling fan in 5-Blue was repaired."),
        ("it",       "low",    "open",     f"Email login issue ({AY})",      "Unable to reset staff email password."),
    ]
    for i, (cat, pri, status, title, desc) in enumerate(issues):
        key = f"seed:iss:{AY}:{i}"
        iss_ops.append(UpdateOne({"_seed_key": key},
            {"$setOnInsert": {"issue_id": f"iss_{uuid.uuid4().hex[:12]}"},
             "$set": {"_seed_key": key, "title": title, "description": desc, "category": cat,
                      "priority": pri, "status": status, "raised_by": ADMIN_ID,
                      "raised_by_role": "admin", "academic_year": AY, "created_at": d[i]}}, upsert=True))
    msgs = [
        ("all",     f"Fee reminder — {AY}",   "Kindly clear pending fees before the due date."),
        ("teacher", f"Staff meeting — {AY}",  "Staff meeting scheduled this Friday at 3 PM."),
        ("student", f"Exam timetable — {AY}", "The Unit Test 1 timetable has been published."),
    ]
    for i, (rtype, subject, content) in enumerate(msgs):
        key = f"seed:msg:{AY}:{i}"
        msg_ops.append(UpdateOne({"_seed_key": key},
            {"$setOnInsert": {"message_id": f"msg_{uuid.uuid4().hex[:12]}"},
             "$set": {"_seed_key": key, "sender_id": ADMIN_ID, "sender_name": ADMIN_NAME,
                      "recipient_type": rtype, "subject": subject, "content": content,
                      "is_read": False, "academic_year": AY, "created_at": d[i]}}, upsert=True))
    if ann_ops: await db.announcements.bulk_write(ann_ops, ordered=False)
    if iss_ops: await db.issues.bulk_write(iss_ops, ordered=False)
    if msg_ops: await db.messages.bulk_write(msg_ops, ordered=False)
    print(f"[operational] +{len(ann_ops)} announcements, +{len(iss_ops)} issues, +{len(msg_ops)} messages.")


# ───────────────────────────── 11. Syllabus ────────────────────────────────
async def seed_syllabus(classes):
    ops = []
    for cls in classes:
        for subj in SUBJECTS:
            for unit in (1, 2, 3):
                key = f"seed:syl:{AY}:{cls}:{subj}:{unit}"
                ops.append(UpdateOne({"_seed_key": key},
                    {"$setOnInsert": {"syllabus_id": f"syl_{uuid.uuid4().hex[:12]}",
                                      "created_at": NOW},
                     "$set": {"_seed_key": key, "class_name": cls, "subject": subj,
                              "title": f"{subj} — Unit {unit}",
                              "description": f"{subj} Unit {unit} chapters for class {cls} ({AY}).",
                              "academic_year": AY, "uploaded_by": ADMIN_ID, "is_active": True}},
                    upsert=True))
    if ops:
        await db.syllabus.bulk_write(ops, ordered=False)
    print(f"[syllabus] {len(ops)} entries across {len(classes)} classes.")


# ───────────────────────────── 12. Audit trail ─────────────────────────────
async def seed_audit():
    d = [f"{SY}-04-20T10:00:00+00:00", f"{SY}-05-25T11:00:00+00:00", f"{SY}-06-12T09:00:00+00:00"]
    audits = [
        ("student",  f"Duplicate admission removed ({AY})"),
        ("student",  f"Transferred-out student ({AY})"),
        ("employee", f"Resigned staff deactivated ({AY})"),
    ]
    ops = []
    for i, (etype, label) in enumerate(audits):
        key = f"seed:aud:{AY}:{i}"
        ops.append(UpdateOne({"_seed_key": key},
            {"$setOnInsert": {"log_id": f"audit_{uuid.uuid4().hex[:10]}"},
             "$set": {"_seed_key": key, "entity_type": etype, "entity_id": f"seed_{etype}_{AY}_{i}",
                      "action": "deactivate", "changes": {"reason": label}, "performed_by": ADMIN_ID,
                      "performed_by_name": ADMIN_NAME, "performed_by_role": "admin",
                      "restored_at": None, "academic_year": AY, "created_at": d[i]}}, upsert=True))
    if ops:
        await db.audit_logs.bulk_write(ops, ordered=False)
    print(f"[audit] +{len(ops)} audit events.")


async def main():
    print(f"Seeding session {AY} (today={TODAY}) …\n")
    await ensure_session()
    await seed_fee_configs()
    classes = await _class_list()
    await seed_students(classes)
    await seed_ledger_and_payments()
    await seed_attendance()
    await seed_marks()
    await seed_payroll()
    await seed_employee_attendance()
    await seed_operational()
    await seed_syllabus(classes)
    await seed_audit()
    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
