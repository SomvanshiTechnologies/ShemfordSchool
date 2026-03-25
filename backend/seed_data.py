"""
Seed realistic Indian school data for Shemford School Management System.
Run: venv/bin/python3 seed_data.py
"""
import asyncio, bcrypt, uuid, random
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

AY = "2025-2026"
AY_SHORT = "2025-26"

# ─── Name pools ────────────────────────────────────────────────────────────────

BOY_NAMES = [
    "Aarav","Arjun","Vivaan","Aditya","Sai","Krishna","Rohan","Dhruv","Ishaan","Kabir",
    "Arnav","Reyansh","Ayaan","Vihaan","Shaurya","Advait","Atharv","Pranav","Rudra","Dev",
    "Yash","Karan","Nikhil","Rahul","Vikram","Suresh","Manish","Deepak","Rohit","Amit",
    "Tarun","Gaurav","Siddharth","Ankit","Ravi","Sachin","Varun","Harshit","Piyush","Mohit"
]
GIRL_NAMES = [
    "Aanya","Aadhya","Ananya","Pari","Diya","Saanvi","Priya","Riya","Siya","Kavya",
    "Isha","Nisha","Meera","Pooja","Swati","Divya","Shruti","Sneha","Neha","Anjali",
    "Tanvi","Aditi","Avni","Simran","Kriti","Sonal","Komal","Rani","Preeti","Jyoti",
    "Heena","Bhavna","Sunita","Rekha","Geeta","Lata","Seema","Usha","Radha","Manju"
]
LAST_NAMES = [
    "Sharma","Verma","Gupta","Patel","Singh","Kumar","Joshi","Mehta","Shah","Agarwal",
    "Mishra","Tiwari","Pandey","Yadav","Srivastava","Chaudhary","Dubey","Malhotra","Kapoor","Bose",
    "Nair","Pillai","Menon","Iyer","Krishnan","Reddy","Rao","Naidu","Murthy","Hegde"
]
CITIES = ["Lucknow","Kanpur","Agra","Varanasi","Allahabad","Meerut","Ghaziabad","Noida","Bareilly","Aligarh"]
STREETS = [
    "Ashok Nagar","Vijay Nagar","Rajendra Nagar","Gandhi Nagar","Nehru Colony",
    "Shastri Nagar","Civil Lines","Hazratganj","Gomti Nagar","Aliganj",
    "Indira Nagar","Model Town","DLF Colony","Sector 12","Sector 18"
]
SUBJECTS_BY_CLASS = {
    "SF. SR.": ["English","Hindi","Math","Drawing","EVS"],
    "LKG":     ["English","Hindi","Math","Drawing","EVS"],
    "UKG":     ["English","Hindi","Math","Drawing","EVS"],
    "1st":  ["English","Hindi","Math","EVS","Drawing"],
    "2nd":  ["English","Hindi","Math","EVS","Drawing"],
    "3rd":  ["English","Hindi","Math","Science","Social Studies"],
    "4th":  ["English","Hindi","Math","Science","Social Studies"],
    "5th":  ["English","Hindi","Math","Science","Social Studies"],
    "6th":  ["English","Hindi","Math","Science","Social Studies","Sanskrit"],
    "7th":  ["English","Hindi","Math","Science","Social Studies","Sanskrit"],
    "8th":  ["English","Hindi","Math","Science","Social Studies","Sanskrit"],
    "9th":  ["English","Hindi","Math","Science","Social Science","Sanskrit"],
    "10th": ["English","Hindi","Math","Science","Social Science","Sanskrit"],
    "11th_science":    ["English","Physics","Chemistry","Math","Biology"],
    "11th_humanities": ["English","History","Geography","Political Science","Economics"],
    "12th_science":    ["English","Physics","Chemistry","Math","Biology"],
    "12th_humanities": ["English","History","Geography","Political Science","Economics"],
}

SHEMFORD_SECTIONS_SEED = ["Violet", "Indigo", "Blue", "Green", "Yellow", "Orange", "Red"]
DEPARTMENTS = ["Science","Mathematics","Languages","Social Studies","Physical Education","Arts","Commerce"]
DESIGNATIONS = {
    "Science": ["PGT Science","TGT Science","Lab Assistant"],
    "Mathematics": ["PGT Math","TGT Math"],
    "Languages": ["PGT English","TGT English","PGT Hindi","TGT Hindi","Sanskrit Teacher"],
    "Social Studies": ["PGT Social Studies","TGT Social Studies"],
    "Physical Education": ["PTI","Sports Coach"],
    "Arts": ["Art Teacher","Music Teacher","Dance Teacher"],
    "Commerce": ["PGT Commerce","TGT Commerce"],
}
ADMIN_ROLES = [
    ("Principal","Administration"),
    ("Vice Principal","Administration"),
    ("Head Clerk","Administration"),
    ("Accountant","Finance"),
    ("Librarian","Library"),
    ("Lab Technician","Science"),
    ("Peon","Support Staff"),
    ("Security Guard","Support Staff"),
]

# ─── Helpers ───────────────────────────────────────────────────────────────────

def uid(prefix="user"):
    return f"{prefix}_{uuid.uuid4().hex[:12]}"

def hash_pw(pw):
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def rand_phone():
    return f"9{random.randint(100000000,999999999)}"

def rand_dob(min_age, max_age):
    days = random.randint(min_age*365, max_age*365)
    return (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

def rand_name(gender):
    first = random.choice(BOY_NAMES if gender == "Male" else GIRL_NAMES)
    last  = random.choice(LAST_NAMES)
    return first, last

def rand_address():
    return f"{random.randint(1,200)}, {random.choice(STREETS)}, {random.choice(CITIES)}, Uttar Pradesh"

def isodt(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()

def working_days_in_range(start: datetime, end: datetime):
    days = []
    cur = start
    while cur <= end:
        if cur.weekday() < 6:  # Mon-Sat
            days.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)
    return days

# Indian school holidays 2025-26
HOLIDAYS = {
    "2025-04-14","2025-04-18","2025-05-01","2025-06-07",
    "2025-08-15","2025-09-02","2025-10-02","2025-10-20",
    "2025-10-21","2025-10-22","2025-11-05","2025-12-25",
    "2026-01-14","2026-01-26","2026-02-26","2026-03-30",
}

# ─── Collections ───────────────────────────────────────────────────────────────

async def drop_collections():
    cols = ["class_structures","students","users","employees","fee_structures",
            "fee_installments","fee_payments","fee_component_configs","student_ledger",
            "attendance","attendance_sessions",
            "exam_definitions","mark_records","announcements","syllabus",
            "issues","messages","holidays","counters","onboarding","student_documents",
            "upgradation_records"]
    for c in cols:
        await db[c].drop()
    print("Dropped existing collections.")

async def seed_users_table():
    """Keep the 5 test users."""
    roles = [
        ("admin","admin@shemford.edu","Admin User","Admin1234"),
        ("teacher","teacher@shemford.edu","Teacher User","Teacher1234"),
        ("student","student@shemford.edu","Student User","Student1234"),
        ("parent","parent@shemford.edu","Parent User","Parent1234"),
        ("accountant","accountant@shemford.edu","Accountant User","Account1234"),
    ]
    docs = []
    for role, email, name, pw in roles:
        docs.append({
            "user_id": uid("user"), "email": email, "name": name, "role": role,
            "phone": rand_phone(), "picture": None, "is_active": True,
            "password_hash": hash_pw(pw),
            "created_at": isodt(),
        })
    await db.users.insert_many(docs)
    print(f"  Users: {len(docs)} test accounts")
    return docs

async def seed_classes():
    """Create Shemford Futuristic School class structures with rainbow sections."""
    fee_map = {
        "SF. SR.": 30000, "LKG": 36000, "UKG": 40000,
        "1st": 48000,  "2nd": 50000,  "3rd": 52000,
        "4th": 54000,  "5th": 56000,  "6th": 60000,
        "7th": 62000,  "8th": 64000,  "9th": 72000,
        "10th": 75000, "11th": 85000, "12th": 88000,
    }

    all_class_names = [
        "SF. SR.", "LKG", "UKG",
        "1st", "2nd", "3rd", "4th", "5th",
        "6th", "7th", "8th", "9th", "10th",
        "11th", "12th",
    ]

    def _sections(capacity=45):
        return [
            {"section_name": s, "capacity": capacity,
             "class_teacher_id": None, "class_teacher_name": None}
            for s in SHEMFORD_SECTIONS_SEED
        ]

    docs = []
    for order, cls_name in enumerate(all_class_names):
        is_senior = cls_name in ("11th", "12th")
        display = cls_name if cls_name in ("SF. SR.", "LKG", "UKG") else f"Class {cls_name}"
        annual = fee_map.get(cls_name, 50000)
        docs.append({
            "class_id": uid("cls"),
            "name": cls_name,
            "display_name": display,
            "sort_order": order,
            "academic_year": AY,
            "sections": _sections(45),
            "has_streams": is_senior,
            "streams": ["science", "humanities"] if is_senior else [],
            "annual_fee": annual,
            "monthly_amount": round(annual / 12, 2),
            "late_fee": 200.0,
            "late_fee_enabled": True,
            "fee_due_day": 10,
            "sibling_discount_percent": 10.0,
            "is_active": True,
            "created_at": isodt(),
        })

    await db.class_structures.insert_many(docs)
    print(f"  Classes: {len(docs)} (SF.SR. → 12th, 7 sections each, 11th/12th with Science+Humanities streams)")
    return docs

async def seed_employees(teacher_user_id):
    """Create ~30 employees (teachers + admin staff)."""
    docs = []
    teacher_ids = []

    # Subject teachers
    for dept, desigs in DESIGNATIONS.items():
        count = random.randint(2, 4)
        for _ in range(count):
            gender = random.choice(["Male","Female"])
            first, last = rand_name(gender)
            emp_id = f"EMP2025{uuid.uuid4().hex[:6].upper()}"
            user_id = uid("user")
            email = f"{first.lower()}.{last.lower()}{random.randint(1,99)}@shemford.edu"
            doc = {
                "employee_id": emp_id, "user_id": user_id,
                "first_name": first, "last_name": last,
                "email": email, "phone": rand_phone(),
                "date_of_birth": rand_dob(25, 55), "gender": gender,
                "address": rand_address(),
                "designation": random.choice(desigs), "department": dept,
                "joining_date": (datetime.now() - timedelta(days=random.randint(30, 2000))).strftime("%Y-%m-%d"),
                "salary": random.choice([35000,42000,48000,55000,62000,68000,75000]),
                "is_active": True, "created_at": isodt(),
            }
            docs.append(doc)
            teacher_ids.append(emp_id)
            # create user account
            await db.users.insert_one({
                "user_id": user_id, "email": email,
                "name": f"{first} {last}", "role": "teacher",
                "phone": doc["phone"], "picture": None, "is_active": True,
                "password_hash": hash_pw("Teacher1234"),
                "created_at": isodt(),
            })

    # Admin staff
    for desig, dept in ADMIN_ROLES:
        gender = random.choice(["Male","Female"])
        first, last = rand_name(gender)
        emp_id = f"EMP2025{uuid.uuid4().hex[:6].upper()}"
        role = "accountant" if dept == "Finance" else "admin"
        user_id = uid("user")
        email = f"{first.lower()}.{last.lower()}@shemford.edu"
        docs.append({
            "employee_id": emp_id, "user_id": user_id,
            "first_name": first, "last_name": last,
            "email": email, "phone": rand_phone(),
            "date_of_birth": rand_dob(28, 58), "gender": gender,
            "address": rand_address(),
            "designation": desig, "department": dept,
            "joining_date": (datetime.now() - timedelta(days=random.randint(100, 3000))).strftime("%Y-%m-%d"),
            "salary": random.choice([30000,38000,45000,52000,60000,80000,90000,110000]),
            "is_active": True, "created_at": isodt(),
        })

    # Attach the seeded teacher user to first teacher employee
    if docs:
        docs[0]["user_id"] = teacher_user_id

    await db.employees.insert_many(docs)
    print(f"  Employees: {len(docs)}")
    return teacher_ids

async def seed_students_and_fees(classes, teacher_ids):
    """
    Create students with Indian names, parent user accounts, legacy fee
    installments (backward-compat), and component-based student_ledger entries.
    """
    # ── load fee component configs seeded in the previous step ─────────────────
    fee_cfg_by_class = {}
    for cfg in await db.fee_component_configs.find(
        {"academic_year": AY, "is_active": True}, {"_id": 0}
    ).to_list(200):
        fee_cfg_by_class[cfg["class_name"]] = cfg

    # ── academic year months Apr-2025 → Mar-2026 ────────────────────────────────
    ay_months = [f"2025-{m}" for m in ["04","05","06","07","08","09","10","11","12"]] + \
                [f"2026-{m}" for m in ["01","02","03"]]

    today_month = datetime.now().strftime("%Y-%m")
    past_months        = [m for m in ay_months if m < today_month]
    current_and_future = [m for m in ay_months if m >= today_month]

    # ── one-time / yearly fee components (always collected at admission) ────────
    # (cfg_field, canonical fee_component, label, fee_type)
    # fee_component must match FeeComponentType constants — NOT the config field name
    ONE_TIME_COMPS = [
        ("registration_fee",  "registration",    "Registration Fee",            "one_time"),
        ("admission_fee",     "admission",       "Admission Fee",               "one_time"),
        ("caution_deposit",   "caution_deposit", "Caution Deposit (Refundable)","one_time"),
    ]
    YEARLY_COMPS = [
        ("annual_charge",   "annual_charge",   "Annual Charge",     "yearly"),
        ("activity_fee",    "activity_fee",    "Activity Fee",      "yearly"),
        ("exam_fee",        "exam_fee",        "Exam Fee",          "yearly"),
        ("lab_fee",         "lab_fee",         "Lab Fee",           "yearly"),
        ("ai_robotics_fee", "ai_robotics_fee", "AI & Robotics Fee", "yearly"),
    ]

    # sequential receipt counter
    receipt_seq = [1000]

    def next_receipt():
        r = f"REC/{AY_SHORT}/{receipt_seq[0]}"
        receipt_seq[0] += 1
        return r

    student_docs   = []
    user_docs      = []          # student + parent user accounts
    ledger_entries = []          # new component-based ledger
    installment_docs = []        # legacy fee_installments
    payment_docs   = []

    for cls_doc in classes:
        cls_name   = cls_doc["name"]
        sections   = [s["section_name"] for s in cls_doc["sections"]]
        has_streams = cls_doc.get("has_streams", False)
        streams_list = cls_doc.get("streams", []) if has_streams else [None]

        cfg = fee_cfg_by_class.get(cls_name)
        # fallback monthly for legacy installments
        legacy_monthly = cfg["monthly_tuition"] if cfg else round(cls_doc["annual_fee"] / 12, 2)

        for stream in streams_list:
            for section in sections:
                n_students = random.randint(5, 8) if has_streams else random.randint(10, 18)
                roll = 1

                for _ in range(n_students):
                    # ── student identity ──────────────────────────────────────
                    gender = random.choice(["Male", "Female"])
                    first, last = rand_name(gender)
                    student_id   = f"STU2025{uuid.uuid4().hex[:6].upper()}"
                    admission_no = f"SHM/2025/{random.randint(1000, 9999)}"
                    student_phone = rand_phone()
                    student_email = f"{first.lower()}.{last.lower()}{random.randint(1,99)}@shemford.edu"
                    student_user_id = uid("user")

                    # ── parent identity ───────────────────────────────────────
                    p_gender = random.choice(["Male", "Female"])
                    p_first, p_last = rand_name(p_gender)
                    parent_name  = f"{p_first} {p_last}"
                    parent_phone = rand_phone()
                    parent_email = f"{p_first.lower()}.{p_last.lower()}{random.randint(1,99)}@gmail.com"
                    parent_user_id = uid("user")

                    # ── payment pattern ───────────────────────────────────────
                    pay_pattern = random.choices(
                        ["good", "ok", "defaulter"], weights=[50, 35, 15]
                    )[0]
                    if pay_pattern == "good":
                        paid_months = set(past_months)
                    elif pay_pattern == "ok":
                        skip = random.randint(1, 2)
                        paid_months = set(past_months[:-skip]) if len(past_months) > skip else set()
                    else:
                        keep = random.randint(0, max(0, len(past_months) - 2))
                        paid_months = set(past_months[:keep])
                    overdue_months = set(m for m in past_months if m not in paid_months)

                    # ── student doc ───────────────────────────────────────────
                    student_doc = {
                        "student_id":       student_id,
                        "admission_number": admission_no,
                        "user_id":          student_user_id,
                        "first_name": first, "last_name": last,
                        "email": student_email, "phone": student_phone,
                        "date_of_birth": rand_dob(4, 18),
                        "gender": gender,
                        "address": rand_address(),
                        "class_name": cls_name,
                        "section": section,
                        "stream": stream,
                        "roll_number": str(roll),
                        "parent_id":    parent_user_id,
                        "parent_name":  parent_name,
                        "parent_phone": parent_phone,
                        "parent_email": parent_email,
                        "admission_date": "2025-04-01",
                        "is_active": True,
                        "academic_year": AY,
                        "app_locked": False,
                        "is_sibling": False,
                        "created_at": isodt(),
                        # fee_status set after ledger loop below
                    }

                    # ── student user account ──────────────────────────────────
                    user_docs.append({
                        "user_id": student_user_id, "email": student_email,
                        "name": f"{first} {last}", "role": "student",
                        "phone": student_phone, "picture": None, "is_active": True,
                        "password_hash": hash_pw("Student1234"),
                        "created_at": isodt(),
                    })

                    # ── parent user account ───────────────────────────────────
                    user_docs.append({
                        "user_id": parent_user_id, "email": parent_email,
                        "name": parent_name, "role": "parent",
                        "phone": parent_phone, "picture": None, "is_active": True,
                        "password_hash": hash_pw("Parent1234"),
                        "created_at": isodt(),
                    })

                    # ── component-based student_ledger entries ────────────────
                    if cfg:
                        admission_due = "2025-04-10"

                        # one-time fees — always paid at admission
                        for field, component, label, ftype in ONE_TIME_COMPS:
                            gross = cfg.get(field, 0)
                            if gross <= 0:
                                continue
                            pay_id  = f"pay_{uuid.uuid4().hex[:12]}"
                            receipt = next_receipt()
                            ledger_entries.append({
                                "ledger_id":        f"ldg_{uuid.uuid4().hex[:12]}",
                                "student_id":       student_id,
                                "admission_number": admission_no,
                                "class_name": cls_name, "stream": stream,
                                "academic_year": AY,
                                "fee_component": component,
                                "fee_type": ftype,
                                "description": label,
                                "month": None,
                                "gross_amount": gross,
                                "concession_amount": 0,
                                "concession_reason": None,
                                "late_fee_applied": 0,
                                "net_amount": gross,
                                "due_date": admission_due,
                                "status": "paid",
                                "payment_id": pay_id,
                                "receipt_number": receipt,
                                "paid_date": "2025-04-01",
                                "created_at": isodt(),
                            })
                            payment_docs.append({
                                "payment_id": pay_id,
                                "student_id": student_id,
                                "installment_ids": [],
                                "amount": gross,
                                "payment_date": "2025-04-01",
                                "payment_method": random.choice(["cash","upi","cheque","bank_transfer"]),
                                "transaction_id": f"TXN{uuid.uuid4().hex[:10].upper()}",
                                "receipt_number": receipt,
                                "collected_by": random.choice(teacher_ids) if teacher_ids else None,
                                "remarks": None, "academic_year": AY, "created_at": isodt(),
                            })

                        # yearly fees — always paid at admission
                        for field, component, label, ftype in YEARLY_COMPS:
                            gross = cfg.get(field, 0)
                            if gross <= 0:
                                continue
                            pay_id  = f"pay_{uuid.uuid4().hex[:12]}"
                            receipt = next_receipt()
                            ledger_entries.append({
                                "ledger_id":        f"ldg_{uuid.uuid4().hex[:12]}",
                                "student_id":       student_id,
                                "admission_number": admission_no,
                                "class_name": cls_name, "stream": stream,
                                "academic_year": AY,
                                "fee_component": component,
                                "fee_type": ftype,
                                "description": label,
                                "month": None,
                                "gross_amount": gross,
                                "concession_amount": 0,
                                "concession_reason": None,
                                "late_fee_applied": 0,
                                "net_amount": gross,
                                "due_date": admission_due,
                                "status": "paid",
                                "payment_id": pay_id,
                                "receipt_number": receipt,
                                "paid_date": "2025-04-01",
                                "created_at": isodt(),
                            })
                            payment_docs.append({
                                "payment_id": pay_id,
                                "student_id": student_id,
                                "installment_ids": [],
                                "amount": gross,
                                "payment_date": "2025-04-01",
                                "payment_method": random.choice(["cash","upi","cheque","bank_transfer"]),
                                "transaction_id": f"TXN{uuid.uuid4().hex[:10].upper()}",
                                "receipt_number": receipt,
                                "collected_by": random.choice(teacher_ids) if teacher_ids else None,
                                "remarks": None, "academic_year": AY, "created_at": isodt(),
                            })

                        # monthly tuition — 12 entries with realistic pay patterns
                        tuition = cfg.get("monthly_tuition", 0)
                        for month in ay_months:
                            due_date = f"{month}-10"
                            due_dt   = datetime.strptime(due_date, "%Y-%m-%d")
                            is_paid    = month in paid_months
                            is_overdue = month in overdue_months
                            status = "paid" if is_paid else ("overdue" if is_overdue else "pending")
                            late_fee = 200.0 if is_overdue else 0.0
                            pay_id = receipt = paid_date = None
                            if is_paid:
                                pay_id  = f"pay_{uuid.uuid4().hex[:12]}"
                                receipt = next_receipt()
                                paid_date = (due_dt - timedelta(days=random.randint(0,5))).strftime("%Y-%m-%d")
                                payment_docs.append({
                                    "payment_id": pay_id,
                                    "student_id": student_id,
                                    "installment_ids": [],
                                    "amount": tuition,
                                    "payment_date": paid_date,
                                    "payment_method": random.choice(["cash","upi","cheque","bank_transfer"]),
                                    "transaction_id": f"TXN{uuid.uuid4().hex[:10].upper()}",
                                    "receipt_number": receipt,
                                    "collected_by": random.choice(teacher_ids) if teacher_ids else None,
                                    "remarks": None, "academic_year": AY, "created_at": isodt(),
                                })
                            ledger_entries.append({
                                "ledger_id":        f"ldg_{uuid.uuid4().hex[:12]}",
                                "student_id":       student_id,
                                "admission_number": admission_no,
                                "class_name": cls_name, "stream": stream,
                                "academic_year": AY,
                                "fee_component": "tuition",
                                "fee_type": "monthly",
                                "description": f"{datetime.strptime(month, '%Y-%m').strftime('%B %Y')} Tuition",
                                "month": month,
                                "gross_amount": tuition,
                                "concession_amount": 0,
                                "concession_reason": None,
                                "late_fee_applied": late_fee,
                                "net_amount": tuition + late_fee,
                                "due_date": due_date,
                                "status": status,
                                "payment_id": pay_id,
                                "receipt_number": receipt,
                                "paid_date": paid_date,
                                "created_at": isodt(),
                            })

                    # ── legacy fee_installments (backward-compat) ─────────────
                    for month in ay_months:
                        due_date = f"{month}-10"
                        due_dt   = datetime.strptime(due_date, "%Y-%m-%d")
                        is_paid    = month in paid_months
                        is_overdue = month in overdue_months
                        status = "paid" if is_paid else ("overdue" if is_overdue else "pending")
                        inst_id = f"inst_{uuid.uuid4().hex[:12]}"
                        inst = {
                            "installment_id": inst_id,
                            "fee_id": f"fee_{cls_name}_{AY}",
                            "student_id": student_id,
                            "class_name": cls_name,
                            "month": month,
                            "amount": legacy_monthly,
                            "late_fee_applied": 200.0 if is_overdue else 0.0,
                            "concession_amount": 0.0,
                            "concession_reason": None,
                            "total_due": legacy_monthly + (200.0 if is_overdue else 0.0),
                            "status": status,
                            "due_date": due_date,
                            "paid_date": None,
                            "payment_id": None,
                            "academic_year": AY,
                            "created_at": isodt(),
                        }
                        if is_paid:
                            inst["paid_date"] = (due_dt - timedelta(days=random.randint(0,5))).strftime("%Y-%m-%d")
                        installment_docs.append(inst)

                    # ── aggregate fee_status ──────────────────────────────────
                    if len(overdue_months) > 2:
                        student_doc["fee_status"] = "overdue"
                    elif overdue_months:
                        student_doc["fee_status"] = "pending"
                    else:
                        student_doc["fee_status"] = "pending" if current_and_future else "paid"

                    student_docs.append(student_doc)
                    roll += 1

    # ── bulk insert ─────────────────────────────────────────────────────────────
    # deduplicate parent emails (multiple children may share a parent email)
    seen_emails = set()
    deduped_users = []
    for u in user_docs:
        if u["email"] not in seen_emails:
            seen_emails.add(u["email"])
            deduped_users.append(u)

    await db.users.insert_many(deduped_users)
    await db.students.insert_many(student_docs)
    await db.fee_installments.insert_many(installment_docs)
    await db.student_ledger.insert_many(ledger_entries)
    if payment_docs:
        await db.fee_payments.insert_many(payment_docs)

    # ── initialise roll-number counters from seeded max values ───────────────
    # This ensures new students created via the UI continue from the correct roll number.
    max_roll_by_key: dict[str, int] = {}
    for s in student_docs:
        key = f"roll_{s['class_name']}_{s['section']}"
        if s.get("stream"):
            key += f"_{s['stream']}"
        roll_val = int(s["roll_number"])
        if roll_val > max_roll_by_key.get(key, 0):
            max_roll_by_key[key] = roll_val

    if max_roll_by_key:
        counter_docs = [{"_id": k, "seq": v} for k, v in max_roll_by_key.items()]
        await db.counters.insert_many(counter_docs)
        print(f"  Roll counters:     {len(counter_docs)}  (class-section keys)")

    print(f"  Students:          {len(student_docs)}")
    print(f"  User accounts:     {len(deduped_users)}  (students + parents)")
    print(f"  Ledger entries:    {len(ledger_entries)}  (component-based)")
    print(f"  Fee installments:  {len(installment_docs)}  (legacy)")
    print(f"  Payment records:   {len(payment_docs)}")
    return student_docs

async def seed_attendance(student_docs, teacher_ids):
    """Mark daily attendance for April-2025 to current date."""
    att_docs = []
    session_docs = []

    start = datetime(2025, 4, 1)
    end = datetime.now() - timedelta(days=1)  # up to yesterday
    all_days = working_days_in_range(start, end)
    school_days = [d for d in all_days if d not in HOLIDAYS]

    # Group students by (class_name, stream, section)
    # stream is None for classes below 11th; stream separates Science/Humanities for 11th/12th
    groups = {}
    for s in student_docs:
        key = (s["class_name"], s.get("stream"), s["section"])
        groups.setdefault(key, []).append(s)

    marker = teacher_ids[0] if teacher_ids else "system"

    for date_str in school_days:
        for (cls, stream, sec), students in groups.items():
            present = absent = leave = 0
            for s in students:
                r = random.random()
                if r < 0.88:
                    status = "present"; present += 1
                elif r < 0.95:
                    status = "absent"; absent += 1
                else:
                    status = "leave"; leave += 1
                att_docs.append({
                    "attendance_id": f"att_{uuid.uuid4().hex[:12]}",
                    "entity_type": "student",
                    "entity_id": s["student_id"],
                    "date": date_str,
                    "status": status,
                    "class_name": cls,
                    "section": sec,
                    "marked_by": marker,
                    "remarks": None,
                    "is_locked": True,
                    "created_at": isodt(),
                })
            session_docs.append({
                "session_id": f"attsess_{uuid.uuid4().hex[:10]}",
                "class_name": cls, "stream": stream, "section": sec,
                "date": date_str, "marked_by": marker,
                "is_locked": True,
                "student_count": len(students),
                "present_count": present, "absent_count": absent, "leave_count": leave,
                "created_at": isodt(),
            })

    # Batch insert in chunks
    chunk = 5000
    for i in range(0, len(att_docs), chunk):
        await db.attendance.insert_many(att_docs[i:i+chunk])
    await db.attendance_sessions.insert_many(session_docs)
    print(f"  Attendance records: {len(att_docs)} across {len(school_days)} school days")

async def seed_exams_and_marks(student_docs, teacher_ids):
    """Create CBSE-aligned exams for the full academic year."""
    # CBSE assessment structure:
    # PT1 (20) → Half-Yearly/Term1 (80) → PT2 (20) → Annual/Term2 (80)
    # Board classes (10, 12): Pre-Board added before Annual
    exam_types = [
        {"name": "Periodic Test 1 (PT-1)",       "type": "unit_test", "max": 20, "start": "2025-07-01", "end": "2025-07-05"},
        {"name": "Half-Yearly Examination",       "type": "term",      "max": 80, "start": "2025-09-18", "end": "2025-09-27"},
        {"name": "Periodic Test 2 (PT-2)",        "type": "unit_test", "max": 20, "start": "2025-11-12", "end": "2025-11-15"},
        {"name": "Annual Examination 2025-26",    "type": "term",      "max": 80, "start": "2026-03-02", "end": "2026-03-14"},
    ]
    board_extra = [
        {"name": "Pre-Board Examination",         "type": "unit_test", "max": 80, "start": "2026-01-15", "end": "2026-01-25"},
    ]

    # Group students by (class_name, stream) — stream is None for classes below 11th
    by_class_stream = {}
    for s in student_docs:
        key = (s["class_name"], s.get("stream"))
        by_class_stream.setdefault(key, []).append(s)

    exam_docs = []
    mark_docs = []
    marker = teacher_ids[0] if teacher_ids else "system"

    for (cls_name, stream), students in by_class_stream.items():
        subj_key = f"{cls_name}_{stream}" if stream else cls_name
        subjects = SUBJECTS_BY_CLASS.get(subj_key, SUBJECTS_BY_CLASS.get(cls_name, ["English","Hindi","Math"]))
        is_board_class = cls_name in ("10th", "12th")
        applicable_exams = exam_types + (board_extra if is_board_class else [])
        for et in applicable_exams:
            exam_id = f"exam_{uuid.uuid4().hex[:10]}"
            is_published = et["end"] < datetime.now().strftime("%Y-%m-%d")
            exam_docs.append({
                "exam_id": exam_id,
                "name": et["name"],
                "exam_type": et["type"],
                "class_name": cls_name,
                "stream": stream,  # None for classes below 11th
                "academic_year": AY,
                "subjects": [{"subject": s, "max_marks": et["max"]} for s in subjects],
                "start_date": et["start"],
                "end_date": et["end"],
                "is_published": is_published,
                "is_locked": is_published,
                "created_by": marker,
                "created_at": isodt(),
            })

            if not is_published:
                continue  # No marks for future exams

            for student in students:
                # Assign student a performance tier once per exam (consistent across subjects)
                tier = random.choices(
                    ["topper", "good", "average", "below_average", "struggling"],
                    weights=[10, 25, 40, 18, 7]
                )[0]
                tier_params = {
                    "topper":        (0.92, 0.05),
                    "good":          (0.76, 0.08),
                    "average":       (0.60, 0.10),
                    "below_average": (0.45, 0.09),
                    "struggling":    (0.30, 0.08),
                }
                mu_pct, sigma_pct = tier_params[tier]
                for subj in subjects:
                    max_m = et["max"]
                    # Subject-level variance (+/- a bit around the student's tier)
                    subj_mu = mu_pct + random.uniform(-0.06, 0.06)
                    raw = random.gauss(max_m * subj_mu, max_m * sigma_pct)
                    obtained = max(max_m * 0.20, min(max_m, round(raw, 1)))
                    pct = obtained / max_m * 100
                    if pct >= 90: grade = "A+"
                    elif pct >= 75: grade = "A"
                    elif pct >= 60: grade = "B"
                    elif pct >= 45: grade = "C"
                    elif pct >= 33: grade = "D"
                    else: grade = "F"

                    mark_docs.append({
                        "mark_id": f"mark_{uuid.uuid4().hex[:12]}",
                        "student_id": student["student_id"],
                        "exam_id": exam_id,
                        "class_name": cls_name,
                        "section": student["section"],
                        "subject": subj,
                        "exam_type": et["type"],
                        "term": "Term 1" if et["type"] == "term" else "Unit Test",
                        "academic_year": AY,
                        "marks_obtained": obtained,
                        "max_marks": max_m,
                        "grade": grade,
                        "remarks": None,
                        "entered_by": marker,
                        "is_locked": True,
                        "created_at": isodt(),
                    })

    await db.exam_definitions.insert_many(exam_docs)
    chunk = 5000
    for i in range(0, len(mark_docs), chunk):
        await db.mark_records.insert_many(mark_docs[i:i+chunk])
    print(f"  Exams: {len(exam_docs)}, Mark records: {len(mark_docs)}")

async def seed_announcements(admin_user_id):
    docs = [
        {
            "announcement_id": f"ann_{uuid.uuid4().hex[:12]}",
            "title": "Annual Sports Day – 15 March 2026",
            "content": "We are pleased to announce that Shemford School's Annual Sports Day will be held on 15 March 2026 on the school grounds. All students are requested to participate enthusiastically. Parents are cordially invited.",
            "target_type": "all", "target_value": None, "priority": "high",
            "created_by": admin_user_id, "is_active": True, "created_at": isodt(datetime.now(timezone.utc) - timedelta(days=2)),
        },
        {
            "announcement_id": f"ann_{uuid.uuid4().hex[:12]}",
            "title": "Term 2 Examinations Schedule Released",
            "content": "The schedule for Term 2 examinations (January 2026) has been released. Students of Class 9-12 will have their exams from 10 January to 25 January 2026. Admit cards will be distributed next week.",
            "target_type": "all", "target_value": None, "priority": "high",
            "created_by": admin_user_id, "is_active": True, "created_at": isodt(datetime.now(timezone.utc) - timedelta(days=5)),
        },
        {
            "announcement_id": f"ann_{uuid.uuid4().hex[:12]}",
            "title": "Winter Vacation Notice",
            "content": "The school will remain closed for Winter Vacation from 25 December 2025 to 5 January 2026. School will reopen on 6 January 2026. Students are advised to complete holiday homework.",
            "target_type": "all", "target_value": None, "priority": "normal",
            "created_by": admin_user_id, "is_active": True, "created_at": isodt(datetime.now(timezone.utc) - timedelta(days=10)),
        },
        {
            "announcement_id": f"ann_{uuid.uuid4().hex[:12]}",
            "title": "Fee Payment Reminder – March 2026",
            "content": "This is a gentle reminder that the monthly fee for March 2026 is due by 10 March 2026. A late fee of ₹200 will be charged after the due date. Parents may pay via UPI, cash, or bank transfer.",
            "target_type": "all", "target_value": None, "priority": "normal",
            "created_by": admin_user_id, "is_active": True, "created_at": isodt(datetime.now(timezone.utc) - timedelta(days=1)),
        },
        {
            "announcement_id": f"ann_{uuid.uuid4().hex[:12]}",
            "title": "Parent-Teacher Meeting – Class 10 & 12",
            "content": "A Parent-Teacher Meeting for Class 10 and Class 12 is scheduled for 29 March 2026 from 10:00 AM to 1:00 PM. Attendance is mandatory. Parents are requested to bring their ward's diary.",
            "target_type": "class", "target_value": "10", "priority": "high",
            "created_by": admin_user_id, "is_active": True, "created_at": isodt(datetime.now(timezone.utc) - timedelta(days=3)),
        },
        {
            "announcement_id": f"ann_{uuid.uuid4().hex[:12]}",
            "title": "Science Exhibition 2026",
            "content": "Shemford School is organising its annual Science Exhibition on 20 February 2026. Students of Class 6-10 are encouraged to submit project proposals by 31 January 2026. Best projects will represent the school at district level.",
            "target_type": "all", "target_value": None, "priority": "normal",
            "created_by": admin_user_id, "is_active": True, "created_at": isodt(datetime.now(timezone.utc) - timedelta(days=7)),
        },
        {
            "announcement_id": f"ann_{uuid.uuid4().hex[:12]}",
            "title": "Republic Day Celebration",
            "content": "Republic Day will be celebrated in the school premises on 26 January 2026. Cultural programmes, march past, and prize distribution ceremony will be held. All students and staff must attend in full uniform by 8:00 AM.",
            "target_type": "all", "target_value": None, "priority": "high",
            "created_by": admin_user_id, "is_active": True, "created_at": isodt(datetime.now(timezone.utc) - timedelta(days=60)),
        },
        {
            "announcement_id": f"ann_{uuid.uuid4().hex[:12]}",
            "title": "New Library Books Added",
            "content": "The school library has acquired 200 new books across various categories including NCERT reference books, competitive exam guides, and fiction titles. Students can issue books during library hours (10:00 AM – 12:00 PM).",
            "target_type": "all", "target_value": None, "priority": "low",
            "created_by": admin_user_id, "is_active": True, "created_at": isodt(datetime.now(timezone.utc) - timedelta(days=15)),
        },
    ]
    await db.announcements.insert_many(docs)
    print(f"  Announcements: {len(docs)}")

async def seed_syllabus(admin_user_id):
    docs = []
    # Build a flat list: (class_name, stream_or_None, subjects)
    syllabus_entries = []
    for key, subjects in SUBJECTS_BY_CLASS.items():
        if "_" in key and key.split("_")[0] in ("11th", "12th"):
            parts = key.split("_", 1)
            syllabus_entries.append((parts[0], parts[1], subjects))
        else:
            syllabus_entries.append((key, None, subjects))

    for cls_name, stream, subjects in syllabus_entries:
        label = f"{cls_name} ({stream.capitalize()})" if stream else f"Class {cls_name}"
        for subject in subjects:
            docs.append({
                "syllabus_id": f"syl_{uuid.uuid4().hex[:12]}",
                "class_name": cls_name,
                "stream": stream,
                "subject": subject,
                "title": f"{subject} – {label} Syllabus {AY}",
                "description": f"Detailed syllabus for {subject} as per CBSE curriculum for {label}. Covers all chapters and topics for {AY}.",
                "file_url": None,
                "file_name": f"{subject.replace(' ', '_')}_{cls_name}{('_'+stream) if stream else ''}_Syllabus.pdf",
                "academic_year": AY,
                "uploaded_by": admin_user_id,
                "is_active": True,
                "created_at": isodt(datetime.now(timezone.utc) - timedelta(days=random.randint(10, 120))),
            })
    await db.syllabus.insert_many(docs)
    print(f"  Syllabus entries: {len(docs)}")

async def seed_issues(student_docs, teacher_ids, admin_user_id):
    categories = ["academic","infrastructure","discipline","fee","health","other"]
    priorities  = ["low","normal","high","urgent"]
    statuses    = ["open","in_progress","resolved","closed"]
    sample_issues = [
        ("Classroom projector not working in Class 9-A","The projector in Class 9-A has been malfunctioning since last week. Teachers are unable to display digital content.","infrastructure","high"),
        ("Drinking water cooler broken near Block B","The water cooler near Block B has stopped working. Students are facing difficulty during summer.","infrastructure","urgent"),
        ("Request for additional benches in Class 7-B","Class 7-B is overcrowded. Request for 5 additional benches urgently.","infrastructure","normal"),
        ("Playground equipment maintenance required","Several items on the playground (swings, see-saw) need urgent repair before Sports Day.","infrastructure","high"),
        ("Washroom cleaning schedule not followed","The washrooms in Block A are not being cleaned regularly as per the schedule.","infrastructure","normal"),
        ("Student repeatedly absent without notice","Student Rahul Verma of Class 8-B has been absent for 7 consecutive days without any communication from parents.","academic","high"),
        ("Bullying complaint – Class 6-A","A student in Class 6-A has complained of being bullied by a group of students. Requires immediate counselling.","discipline","urgent"),
        ("Request for extra Math classes before Term 2","Students of Class 10-A have requested additional Math revision classes before the upcoming Term 2 exams.","academic","normal"),
        ("Fee payment receipt not generated","The fee payment receipt for student Priya Sharma (STU2025XXXX) was not generated after online payment.","fee","high"),
        ("Internet connectivity issues in computer lab","The internet connection in the computer lab is very slow, affecting practical sessions.","infrastructure","normal"),
        ("Library book missing – reported by librarian","Three NCERT books (Class 10 Science) have gone missing from the library. Investigation requested.","other","normal"),
        ("Medical emergency protocol update needed","The school's first aid kit needs restocking and the emergency contact list needs to be updated.","health","high"),
    ]

    docs = []
    for title, desc, cat, priority in sample_issues:
        status = random.choice(statuses)
        raised = random.choice(teacher_ids) if teacher_ids else admin_user_id
        docs.append({
            "issue_id": f"iss_{uuid.uuid4().hex[:12]}",
            "title": title, "description": desc,
            "category": cat, "priority": priority,
            "status": status,
            "raised_by": raised, "raised_by_role": "teacher",
            "assigned_to": admin_user_id if status in ["in_progress","resolved"] else None,
            "resolution": "Issue has been resolved and reported to management." if status == "resolved" else None,
            "resolved_at": isodt() if status == "resolved" else None,
            "created_at": isodt(datetime.now(timezone.utc) - timedelta(days=random.randint(1, 60))),
        })
    await db.issues.insert_many(docs)
    print(f"  Issues: {len(docs)}")

async def seed_messages(student_docs, teacher_ids, admin_user_id):
    docs = []
    sample_msgs = [
        ("Attendance Concern","Dear Parent, your ward was absent on {date} without prior intimation. Kindly provide a leave application."),
        ("Fee Reminder","Dear Parent, the monthly fee for {month} is overdue. Kindly clear the dues at the earliest to avoid late charges."),
        ("Exam Performance","Dear Parent, your ward has performed well in Unit Test 1. Encourage them to maintain this performance."),
        ("Parent Meeting Invite","Dear Parent, you are requested to attend the Parent-Teacher Meeting on 29 March 2026 at 10 AM."),
        ("Homework Not Submitted","This is to inform you that your ward has not submitted homework for the past 3 days. Please ensure timely submission."),
        ("Congratulations","Dear Parent, your ward has been selected for the school's Science Exhibition team. Congratulations!"),
    ]
    for i in range(25):
        student = random.choice(student_docs)
        template = random.choice(sample_msgs)
        sender = random.choice(teacher_ids) if teacher_ids else admin_user_id
        content = template[1].replace("{date}", "2026-02-15").replace("{month}", "February 2026")
        docs.append({
            "message_id": f"msg_{uuid.uuid4().hex[:12]}",
            "sender_id": sender, "sender_name": "Class Teacher",
            "recipient_id": student.get("parent_id"),
            "recipient_type": "parent",
            "recipient_value": student["parent_email"],
            "subject": template[0],
            "content": content,
            "message_type": "text",
            "voice_url": None,
            "is_read": random.choice([True, True, False]),
            "created_at": isodt(datetime.now(timezone.utc) - timedelta(days=random.randint(1, 45))),
        })
    await db.messages.insert_many(docs)
    print(f"  Messages: {len(docs)}")

async def seed_holidays():
    holiday_data = [
        ("2025-04-14","Dr Ambedkar Jayanti","public"),
        ("2025-04-18","Good Friday","public"),
        ("2025-05-01","Labour Day","public"),
        ("2025-06-07","Eid ul-Adha","public"),
        ("2025-07-06","Summer Vacation Ends","school"),
        ("2025-08-15","Independence Day","public"),
        ("2025-09-02","Janmashtami","public"),
        ("2025-10-02","Gandhi Jayanti","public"),
        ("2025-10-20","Dussehra","public"),
        ("2025-10-21","Dussehra (Holiday)","public"),
        ("2025-10-22","Post-Dussehra Break","school"),
        ("2025-11-05","Diwali","public"),
        ("2025-11-06","Diwali (Holiday)","public"),
        ("2025-12-25","Christmas Day","public"),
        ("2025-12-26","Winter Vacation Begins","school"),
        ("2026-01-01","New Year","school"),
        ("2026-01-06","Winter Vacation Ends","school"),
        ("2026-01-14","Makar Sankranti","public"),
        ("2026-01-26","Republic Day","public"),
        ("2026-02-26","Maha Shivratri","public"),
        ("2026-03-30","Holi","public"),
        ("2026-03-31","Holi (Holiday)","public"),
    ]
    docs = [
        {
            "holiday_id": f"hol_{uuid.uuid4().hex[:10]}",
            "date": d, "name": n, "type": t,
            "is_active": True, "created_at": isodt(),
        }
        for d, n, t in holiday_data
    ]
    await db.holidays.insert_many(docs)
    print(f"  Holidays: {len(docs)}")

# ─── Fee Component Configs ─────────────────────────────────────────────────────

async def seed_fee_component_configs():
    """
    Seed official fee component configs for 2025-2026.

    Class groups (same rates within each group):
      SF.JR & SR  → "SF. SR."   (SF.JR not yet in system)
      LKG & UKG   → "LKG", "UKG"
      I & II      → "1st", "2nd"
      III & IV    → "3rd", "4th"
      V & VI      → "5th", "6th"
      VII & VIII  → "7th", "8th"
      IX & X      → "9th", "10th"
    """
    COMMON = dict(
        registration_fee=500,
        admission_fee=2500,
        caution_deposit=1000,
        annual_charge=3600,
        upgradation_fee=0,
        due_day=10,
        late_fee=0,
        late_fee_enabled=False,
        sibling_admission_discount_pct=50,
        sibling_tuition_discount_pct=15,
    )

    # class_name → class-specific fee overrides
    CLASS_FEES = {
        "SF. SR.": dict(activity_fee=1500, exam_fee=300,  lab_fee=0,    ai_robotics_fee=0,    monthly_tuition=1000),
        "LKG":     dict(activity_fee=2000, exam_fee=300,  lab_fee=0,    ai_robotics_fee=0,    monthly_tuition=1100),
        "UKG":     dict(activity_fee=2000, exam_fee=300,  lab_fee=0,    ai_robotics_fee=0,    monthly_tuition=1100),
        "1st":     dict(activity_fee=2400, exam_fee=300,  lab_fee=1500, ai_robotics_fee=0,    monthly_tuition=1150),
        "2nd":     dict(activity_fee=2400, exam_fee=300,  lab_fee=1500, ai_robotics_fee=0,    monthly_tuition=1150),
        "3rd":     dict(activity_fee=2900, exam_fee=300,  lab_fee=1500, ai_robotics_fee=0,    monthly_tuition=1250),
        "4th":     dict(activity_fee=2900, exam_fee=300,  lab_fee=1500, ai_robotics_fee=0,    monthly_tuition=1250),
        "5th":     dict(activity_fee=3400, exam_fee=300,  lab_fee=1500, ai_robotics_fee=0,    monthly_tuition=1350),
        "6th":     dict(activity_fee=3400, exam_fee=300,  lab_fee=1500, ai_robotics_fee=0,    monthly_tuition=1350),
        "7th":     dict(activity_fee=3900, exam_fee=300,  lab_fee=1500, ai_robotics_fee=0,    monthly_tuition=1400),
        "8th":     dict(activity_fee=3900, exam_fee=300,  lab_fee=1500, ai_robotics_fee=0,    monthly_tuition=1400),
        "9th":     dict(activity_fee=4500, exam_fee=450,  lab_fee=1500, ai_robotics_fee=2400, monthly_tuition=1900),
        "10th":    dict(activity_fee=4500, exam_fee=450,  lab_fee=1500, ai_robotics_fee=2400, monthly_tuition=1900),
    }

    now = datetime.now(timezone.utc).isoformat()
    docs = []
    for class_name, overrides in CLASS_FEES.items():
        doc = {
            "config_id": f"fcc_{uuid.uuid4().hex[:10]}",
            "class_name": class_name,
            "stream": None,
            "academic_year": AY,
            **COMMON,
            **overrides,
            "is_active": True,
            "notes": "Seeded from official fee schedule 2025-26",
            "created_by": "seed_script",
            "created_at": now,
            "updated_at": None,
        }
        docs.append(doc)

    await db.fee_component_configs.insert_many(docs)
    print(f"  Fee configs: {len(docs)} classes seeded for {AY}")
    return docs


# ─── Main ──────────────────────────────────────────────────────────────────────

async def main():
    print("Seeding Shemford School data...\n")
    await drop_collections()

    print("\n[1/9] Users")
    user_docs = await seed_users_table()
    admin_user_id  = next(u["user_id"] for u in user_docs if u["role"] == "admin")
    teacher_user_id = next(u["user_id"] for u in user_docs if u["role"] == "teacher")

    print("[2/9] Classes")
    classes = await seed_classes()

    print("[2b] Fee Component Configs")
    await seed_fee_component_configs()

    print("[3/9] Employees")
    teacher_ids = await seed_employees(teacher_user_id)

    print("[4/9] Students + Fees")
    student_docs = await seed_students_and_fees(classes, teacher_ids)

    print("[5/9] Attendance")
    await seed_attendance(student_docs, teacher_ids)

    print("[6/9] Exams & Marks")
    await seed_exams_and_marks(student_docs, teacher_ids)

    print("[7/9] Announcements")
    await seed_announcements(admin_user_id)

    print("[8/9] Holidays")
    await seed_holidays()

    print("[9/9] Done!")
    client.close()
    print("\nDone! All data seeded successfully.")

asyncio.run(main())
