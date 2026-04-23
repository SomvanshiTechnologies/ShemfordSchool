"""
Seed a linked student record for the existing test account
    student@shemford.edu  (password: Student1234)

After this script runs:
  - /students  returns this student for that user
  - admin / teacher / parent all see the same record (same student_id)
  - the linked parent@shemford.edu user is set as parent
  - fees, attendance, and marks are populated so every screen has data

Idempotent — safe to re-run (re-creates payments/attendance only if missing).
"""
import os, uuid, random
from datetime import datetime, timezone, timedelta
from pathlib import Path
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

AY       = "2025-2026"
AY_SHORT = "2025-26"
CLASS    = "5th"
SECTION  = "Green"
FIRST    = "Arjun"
LAST     = "Kumar"
PARENT_F = "Rohan"
PARENT_L = "Kumar"

# Indian school holidays 2025-26 (same as the main seed)
HOLIDAYS = {
    "2025-04-14","2025-04-18","2025-05-01","2025-06-07",
    "2025-08-15","2025-09-02","2025-10-02","2025-10-20",
    "2025-10-21","2025-10-22","2025-11-05","2025-12-25",
    "2026-01-14","2026-01-26","2026-02-26","2026-03-30",
}

def iso():
    return datetime.now(timezone.utc).isoformat()


# ── 1. Look up the existing test users ─────────────────────────────────────────
student_user = db.users.find_one({"email": "student@shemford.edu"})
parent_user  = db.users.find_one({"email": "parent@shemford.edu"})
teacher_user = db.users.find_one({"email": "teacher@shemford.edu"})
if not (student_user and parent_user):
    raise SystemExit("Test accounts not found. Run seed_data.py first.")

print(f"Test student user_id : {student_user['user_id']}")
print(f"Test parent  user_id : {parent_user['user_id']}")


# ── 2. Upsert the students record linked to this user ────────────────────────
existing = db.students.find_one({"user_id": student_user["user_id"]}, {"_id": 0})

if existing:
    print(f"-> students doc already exists: {existing['student_id']} (re-using)")
    stu = existing
else:
    # Pick an available roll in class 5th / Green
    used_rolls = [
        int(s["roll_number"]) for s in db.students.find(
            {"class_name": CLASS, "section": SECTION}, {"roll_number": 1}
        ) if s.get("roll_number") and str(s["roll_number"]).isdigit()
    ]
    next_roll = (max(used_rolls) if used_rolls else 0) + 1

    stu = {
        "student_id":       f"STU2025{uuid.uuid4().hex[:6].upper()}",
        "admission_number": f"SHM/2025/{random.randint(9000, 9999)}",
        "user_id":          student_user["user_id"],
        "first_name": FIRST, "last_name": LAST,
        "email": "student@shemford.edu",
        "phone": "9876543210",
        "date_of_birth": "2014-06-15",
        "gender": "Male",
        "address": "45, Model Town, Lucknow, Uttar Pradesh",
        "class_name": CLASS,
        "section":    SECTION,
        "stream":     None,
        "roll_number": str(next_roll),
        "parent_id":    parent_user["user_id"],
        "parent_name":  f"{PARENT_F} {PARENT_L}",
        "parent_phone": "9876501234",
        "parent_email": "parent@shemford.edu",
        "admission_date": "2025-04-01",
        "is_active": True,
        "academic_year": AY,
        "app_locked": False,
        "is_sibling": False,
        "fee_status": "pending",
        "created_at": iso(),
    }
    db.students.insert_one(stu)
    print(f"-> created students doc {stu['student_id']} (roll {next_roll} in {CLASS}-{SECTION})")

# ── 3. Update user records so names are consistent across the UI ─────────────
db.users.update_one(
    {"user_id": student_user["user_id"]},
    {"$set": {"name": f"{FIRST} {LAST}", "phone": "9876543210"}},
)
db.users.update_one(
    {"user_id": parent_user["user_id"]},
    {"$set": {"name": f"{PARENT_F} {PARENT_L}", "phone": "9876501234"}},
)
print("-> user records updated with matching names")


# ── 4. Seed fee ledger + payments for this student ───────────────────────────
cfg = db.fee_component_configs.find_one(
    {"class_name": CLASS, "academic_year": AY}, {"_id": 0}
)
if cfg:
    # Remove any existing ledger/payments for this student so we can re-run cleanly
    db.student_ledger.delete_many({"student_id": stu["student_id"]})
    db.fee_payments.delete_many({"student_id": stu["student_id"]})
    db.fee_installments.delete_many({"student_id": stu["student_id"]})

    # Months in the AY
    months = [f"2025-{m}" for m in ("04","05","06","07","08","09","10","11","12")] \
           + [f"2026-{m}" for m in ("01","02","03")]
    today_m = datetime.now().strftime("%Y-%m")
    past    = [m for m in months if m <  today_m]
    future  = [m for m in months if m >= today_m]
    # This student pays on time for past 2 months short, so they have some overdue
    paid_months = set(past[:-2]) if len(past) > 2 else set()

    # Use a UUID-suffixed receipt so we can never collide with the
    # numeric "REC/2025-26/<seq>" receipts produced by the main seed.
    def next_receipt():
        return f"REC/{AY_SHORT}/TS-{uuid.uuid4().hex[:10].upper()}"

    ledger, payments = [], []
    admission_due = "2025-04-10"

    # One-time + yearly components — paid at admission
    comps = [
        ("registration_fee", "registration",    "Registration Fee",            "one_time"),
        ("admission_fee",    "admission",       "Admission Fee",               "one_time"),
        ("caution_deposit",  "caution_deposit", "Caution Deposit (Refundable)","one_time"),
        ("annual_charge",    "annual_charge",   "Annual Charge",               "yearly"),
        ("activity_fee",     "activity_fee",    "Activity Fee",                "yearly"),
        ("exam_fee",         "exam_fee",        "Exam Fee",                    "yearly"),
        ("lab_fee",          "lab_fee",         "Lab Fee",                     "yearly"),
        ("ai_robotics_fee",  "ai_robotics_fee", "AI & Robotics Fee",           "yearly"),
    ]
    for field, comp, label, ftype in comps:
        gross = cfg.get(field, 0) or 0
        if gross <= 0:
            continue
        pay_id  = f"pay_{uuid.uuid4().hex[:12]}"
        receipt = next_receipt()
        ledger.append({
            "ledger_id":  f"ldg_{uuid.uuid4().hex[:12]}",
            "student_id": stu["student_id"],
            "admission_number": stu["admission_number"],
            "class_name": CLASS, "stream": None, "academic_year": AY,
            "fee_component": comp, "fee_type": ftype, "description": label,
            "month": None,
            "gross_amount": gross, "concession_amount": 0, "concession_reason": None,
            "late_fee_applied": 0, "net_amount": gross, "due_date": admission_due,
            "status": "paid", "payment_id": pay_id, "receipt_number": receipt,
            "paid_date": "2025-04-01", "created_at": iso(),
        })
        payments.append({
            "payment_id": pay_id, "student_id": stu["student_id"], "installment_ids": [],
            "amount": gross, "payment_date": "2025-04-01", "payment_method": random.choice(["cash","upi","bank_transfer"]),
            "transaction_id": f"TXN{uuid.uuid4().hex[:10].upper()}",
            "receipt_number": receipt, "collected_by": None,
            "remarks": "Admission fees", "academic_year": AY, "created_at": iso(),
        })

    # Monthly tuition — paid for past months except last 2 (overdue)
    tuition = cfg.get("monthly_tuition", 0) or 0
    for month in months:
        due_date = f"{month}-10"
        is_paid    = month in paid_months
        is_overdue = (month in past) and not is_paid
        status     = "paid" if is_paid else ("overdue" if is_overdue else "pending")
        late_fee   = 200.0 if is_overdue else 0.0
        pay_id = receipt = paid_date = None
        if is_paid:
            pay_id  = f"pay_{uuid.uuid4().hex[:12]}"
            receipt = next_receipt()
            paid_date = f"{month}-05"
            payments.append({
                "payment_id": pay_id, "student_id": stu["student_id"], "installment_ids": [],
                "amount": tuition, "payment_date": paid_date, "payment_method": random.choice(["cash","upi","bank_transfer"]),
                "transaction_id": f"TXN{uuid.uuid4().hex[:10].upper()}",
                "receipt_number": receipt, "collected_by": None,
                "remarks": f"Tuition {month}", "academic_year": AY, "created_at": iso(),
            })
        ledger.append({
            "ledger_id":  f"ldg_{uuid.uuid4().hex[:12]}",
            "student_id": stu["student_id"], "admission_number": stu["admission_number"],
            "class_name": CLASS, "stream": None, "academic_year": AY,
            "fee_component": "tuition", "fee_type": "monthly",
            "description": f"{datetime.strptime(month, '%Y-%m').strftime('%B %Y')} Tuition",
            "month": month,
            "gross_amount": tuition, "concession_amount": 0, "concession_reason": None,
            "late_fee_applied": late_fee, "net_amount": tuition + late_fee,
            "due_date": due_date, "status": status,
            "payment_id": pay_id, "receipt_number": receipt, "paid_date": paid_date,
            "created_at": iso(),
        })

    if ledger:
        db.student_ledger.insert_many(ledger)
    if payments:
        db.fee_payments.insert_many(payments)

    # Update fee_status on the student
    overdue_count = sum(1 for m in past if m not in paid_months)
    new_status = "overdue" if overdue_count > 2 else "pending"
    db.students.update_one({"student_id": stu["student_id"]}, {"$set": {"fee_status": new_status}})

    print(f"-> fees seeded  : {len(ledger)} ledger entries, {len(payments)} payments, status={new_status}")
else:
    print("-> SKIPPED fees: no fee_component_configs for class 5th")


# ── 5. Attendance — daily Apr 2025 → yesterday (mirror group stats so teacher's session view shows this student) ─
def working_days_in_range(start, end):
    days = []
    cur = start
    while cur <= end:
        if cur.weekday() < 6:
            days.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)
    return days

start = datetime(2025, 4, 1)
end   = datetime.now() - timedelta(days=1)
school_days = [d for d in working_days_in_range(start, end) if d not in HOLIDAYS]

# Remove any existing attendance for this student first
db.attendance.delete_many({"entity_id": stu["student_id"]})

att_docs = []
marker = teacher_user["user_id"] if teacher_user else "system"
for date_str in school_days:
    r = random.random()
    if   r < 0.90: status = "present"
    elif r < 0.97: status = "absent"
    else:          status = "leave"
    att_docs.append({
        "attendance_id": f"att_{uuid.uuid4().hex[:12]}",
        "entity_type": "student", "entity_id": stu["student_id"],
        "date": date_str, "status": status,
        "class_name": CLASS, "section": SECTION,
        "marked_by": marker, "remarks": None, "is_locked": True,
        "created_at": iso(),
    })

# Batch insert
for i in range(0, len(att_docs), 5000):
    db.attendance.insert_many(att_docs[i:i+5000])
print(f"-> attendance    : {len(att_docs)} records across {len(school_days)} school days")


# ── 6. Marks for every published exam for class 5th ──────────────────────────
exams = list(db.exam_definitions.find(
    {"class_name": CLASS, "is_published": True}, {"_id": 0}
))
# Wipe & re-insert for this student only
db.mark_records.delete_many({"student_id": stu["student_id"]})

mark_docs = []
for ex in exams:
    for subj in ex.get("subjects", []):
        mx = subj["max_marks"]
        raw = random.gauss(mx * 0.78, mx * 0.08)
        obtained = round(max(mx * 0.25, min(mx, raw)), 1)
        pct = obtained / mx * 100
        grade = (
            "A+" if pct >= 90 else "A"  if pct >= 75 else
            "B"  if pct >= 60 else "C"  if pct >= 45 else
            "D"  if pct >= 33 else "F"
        )
        mark_docs.append({
            "mark_id": f"mark_{uuid.uuid4().hex[:12]}",
            "student_id": stu["student_id"], "exam_id": ex["exam_id"],
            "class_name": CLASS, "section": SECTION, "subject": subj["subject"],
            "exam_type": ex["exam_type"],
            "term": "Term 1" if ex["exam_type"] == "term" else "Unit Test",
            "academic_year": AY,
            "marks_obtained": obtained, "max_marks": mx, "grade": grade,
            "remarks": None, "entered_by": marker, "is_locked": True,
            "created_at": iso(),
        })

if mark_docs:
    db.mark_records.insert_many(mark_docs)
print(f"-> marks         : {len(mark_docs)} records across {len(exams)} published exams")


# ── 7. Print verification summary ────────────────────────────────────────────
print("\n=== Consistency summary ===")
print(f"Student             : {FIRST} {LAST} ({stu['student_id']})  class {CLASS}-{SECTION}, roll {stu['roll_number']}")
print(f"Admission number    : {stu['admission_number']}")
print(f"Linked student-user : {student_user['email']}")
print(f"Linked parent-user  : {parent_user['email']}")
print(f"Fee payments        : {db.fee_payments.count_documents({'student_id': stu['student_id']})}")
print(f"Ledger entries      : {db.student_ledger.count_documents({'student_id': stu['student_id']})}")
print(f"Attendance records  : {db.attendance.count_documents({'entity_id': stu['student_id']})}")
print(f"Mark records        : {db.mark_records.count_documents({'student_id': stu['student_id']})}")
print()
print(f"Login with:")
print(f"  student@shemford.edu / Student1234  -> dashboard shows class {CLASS}-{SECTION}, attendance, marks, fees")
print(f"  parent@shemford.edu  / Parent1234   -> dashboard shows {FIRST} {LAST} as child")
print(f"  teacher@shemford.edu / Teacher1234  -> attendance page for {CLASS}-{SECTION} includes this student")
print(f"  admin@shemford.edu   / Admin1234    -> students list includes {FIRST} {LAST}")
