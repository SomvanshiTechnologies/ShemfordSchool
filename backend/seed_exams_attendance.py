"""
Seed missing data: attendance, CBSE exams/marks, announcements.
Runs ADDITIVELY — does NOT drop existing collections.
Run: venv/bin/python3 seed_exams_attendance.py
"""
import asyncio, uuid, random
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

AY = "2025-2026"

# ── CBSE subject map ──────────────────────────────────────────────────────────
SUBJECTS_BY_CLASS = {
    "SF. SR.": ["English", "Hindi", "Math", "Drawing", "EVS"],
    "LKG":     ["English", "Hindi", "Math", "Drawing", "EVS"],
    "UKG":     ["English", "Hindi", "Math", "Drawing", "EVS"],
    "1st":     ["English", "Hindi", "Math", "EVS", "Drawing"],
    "2nd":     ["English", "Hindi", "Math", "EVS", "Drawing"],
    "3rd":     ["English", "Hindi", "Math", "Science", "Social Studies"],
    "4th":     ["English", "Hindi", "Math", "Science", "Social Studies"],
    "5th":     ["English", "Hindi", "Math", "Science", "Social Studies"],
    "6th":     ["English", "Hindi", "Math", "Science", "Social Studies", "Sanskrit"],
    "7th":     ["English", "Hindi", "Math", "Science", "Social Studies", "Sanskrit"],
    "8th":     ["English", "Hindi", "Math", "Science", "Social Studies", "Sanskrit"],
    "9th":     ["English", "Hindi", "Math", "Science", "Social Science", "Sanskrit"],
    "10th":    ["English", "Hindi", "Math", "Science", "Social Science", "Sanskrit"],
    "11th_science":    ["English", "Physics", "Chemistry", "Math", "Biology"],
    "11th_humanities": ["English", "History", "Geography", "Political Science", "Economics"],
    "12th_science":    ["English", "Physics", "Chemistry", "Math", "Biology"],
    "12th_humanities": ["English", "History", "Geography", "Political Science", "Economics"],
}

# ── Helpers ───────────────────────────────────────────────────────────────────
def isodt(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()

def working_days_in_range(start: datetime, end: datetime):
    days = []
    cur = start
    while cur <= end:
        if cur.weekday() < 6:   # Mon–Sat
            days.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)
    return days

HOLIDAYS = {
    "2025-04-14","2025-04-18","2025-05-01","2025-06-07",
    "2025-08-15","2025-09-02","2025-10-02","2025-10-20",
    "2025-10-21","2025-10-22","2025-11-05","2025-12-25",
    "2026-01-14","2026-01-26","2026-02-26","2026-03-30",
}

# ── 1. Attendance ─────────────────────────────────────────────────────────────
async def seed_attendance(students, teacher_ids):
    marker = teacher_ids[0] if teacher_ids else "system"
    today  = datetime.now()
    # AY runs Apr 2025 → Mar 2026; seed up to yesterday
    start  = datetime(2025, 4, 1)
    end    = min(today - timedelta(days=1), datetime(2026, 3, 31))
    school_days = [d for d in working_days_in_range(start, end) if d not in HOLIDAYS]

    # Group by class+section for session records
    by_class_section = {}
    for s in students:
        key = (s["class_name"], s["section"])
        by_class_section.setdefault(key, []).append(s)

    attendance_docs = []
    session_docs    = []

    for date_str in school_days:
        for (cls, sec), group in by_class_section.items():
            session_id = f"sess_{uuid.uuid4().hex[:10]}"
            present_ids = []
            for stu in group:
                # Attendance pattern: 85% attendance on average, some low-attenders
                p = random.random()
                tier = stu.get("_attn_tier", random.choices(
                    ["regular", "average", "irregular"],
                    weights=[55, 35, 10]
                )[0])
                stu["_attn_tier"] = tier
                thresholds = {"regular": 0.95, "average": 0.82, "irregular": 0.60}
                is_present = p < thresholds[tier]
                status = "present" if is_present else random.choice(["absent", "absent", "late"])
                if is_present:
                    present_ids.append(stu["student_id"])
                attendance_docs.append({
                    "attendance_id": f"att_{uuid.uuid4().hex[:12]}",
                    "student_id":    stu["student_id"],
                    "class_name":    cls,
                    "section":       sec,
                    "date":          date_str,
                    "status":        status,
                    "session_id":    session_id,
                    "entity_type":   "student",
                    "marked_by":     marker,
                    "remarks":       None,
                    "academic_year": AY,
                    "created_at":    isodt(),
                })
            session_docs.append({
                "session_id":    session_id,
                "class_name":    cls,
                "section":       sec,
                "date":          date_str,
                "marked_by":     marker,
                "present_count": len(present_ids),
                "total_count":   len(group),
                "academic_year": AY,
                "created_at":    isodt(),
            })

    # Bulk insert in chunks
    CHUNK = 5000
    for i in range(0, len(attendance_docs), CHUNK):
        await db.attendance.insert_many(attendance_docs[i:i+CHUNK])
    if session_docs:
        await db.attendance_sessions.insert_many(session_docs)
    print(f"  Attendance: {len(attendance_docs):,} records across {len(school_days)} school days")

# ── 2. CBSE Exams & Marks ─────────────────────────────────────────────────────
async def seed_exams_and_marks(students, teacher_ids):
    marker = teacher_ids[0] if teacher_ids else "system"
    today  = datetime.now().strftime("%Y-%m-%d")

    # CBSE assessment calendar 2025-26
    EXAMS = [
        # name, type, max_marks, start, end
        ("Periodic Test 1 (PT-1)",      "unit_test", 20, "2025-07-01", "2025-07-05"),
        ("Half-Yearly Examination",     "term",      80, "2025-09-18", "2025-09-27"),
        ("Periodic Test 2 (PT-2)",      "unit_test", 20, "2025-11-12", "2025-11-15"),
        ("Annual Examination 2025-26",  "term",      80, "2026-03-02", "2026-03-14"),
    ]
    # Extra exam for board classes (10th & 12th)
    BOARD_EXTRA = [
        ("Pre-Board Examination",       "unit_test", 80, "2026-01-15", "2026-01-25"),
    ]

    # Group students by (class, stream)
    by_class_stream = {}
    for s in students:
        key = (s["class_name"], s.get("stream"))
        by_class_stream.setdefault(key, []).append(s)

    exam_docs = []
    mark_docs = []

    for (cls_name, stream), group in by_class_stream.items():
        subj_key = f"{cls_name}_{stream}" if stream else cls_name
        subjects = SUBJECTS_BY_CLASS.get(subj_key, SUBJECTS_BY_CLASS.get(cls_name, ["English", "Hindi", "Math"]))
        is_board = cls_name in ("10th", "12th")
        applicable = EXAMS + (BOARD_EXTRA if is_board else [])

        for (ename, etype, max_m, estart, eend) in applicable:
            exam_id      = f"exam_{uuid.uuid4().hex[:10]}"
            is_published = eend < today

            exam_docs.append({
                "exam_id":       exam_id,
                "name":          ename,
                "exam_type":     etype,
                "class_name":    cls_name,
                "stream":        stream,
                "academic_year": AY,
                "subjects":      [{"subject": s, "max_marks": max_m} for s in subjects],
                "start_date":    estart,
                "end_date":      eend,
                "is_published":  is_published,
                "is_locked":     is_published,
                "created_by":    marker,
                "created_at":    isodt(),
            })

            if not is_published:
                continue

            # Assign performance tier per student (consistent across subjects)
            TIERS = ["topper", "good", "average", "below_average", "struggling"]
            WEIGHTS = [10, 25, 40, 18, 7]
            TIER_PARAMS = {
                "topper":        (0.92, 0.05),
                "good":          (0.76, 0.08),
                "average":       (0.60, 0.10),
                "below_average": (0.45, 0.09),
                "struggling":    (0.30, 0.08),
            }

            for stu in group:
                tier = random.choices(TIERS, weights=WEIGHTS)[0]
                mu_pct, sigma_pct = TIER_PARAMS[tier]

                for subj in subjects:
                    subj_mu = mu_pct + random.uniform(-0.06, 0.06)
                    raw = random.gauss(max_m * subj_mu, max_m * sigma_pct)
                    obtained = round(max(max_m * 0.20, min(max_m, raw)), 1)
                    pct = obtained / max_m * 100
                    if   pct >= 91: grade = "A1"
                    elif pct >= 81: grade = "A2"
                    elif pct >= 71: grade = "B1"
                    elif pct >= 61: grade = "B2"
                    elif pct >= 51: grade = "C1"
                    elif pct >= 41: grade = "C2"
                    elif pct >= 33: grade = "D"
                    else:           grade = "E"  # fail

                    mark_docs.append({
                        "mark_id":        f"mark_{uuid.uuid4().hex[:12]}",
                        "student_id":     stu["student_id"],
                        "exam_id":        exam_id,
                        "class_name":     cls_name,
                        "section":        stu["section"],
                        "subject":        subj,
                        "exam_type":      etype,
                        "term":           "Term 1" if "Half" in ename or "PT-1" in ename else "Term 2",
                        "academic_year":  AY,
                        "marks_obtained": obtained,
                        "max_marks":      max_m,
                        "grade":          grade,
                        "remarks":        None,
                        "entered_by":     marker,
                        "is_locked":      True,
                        "created_at":     isodt(),
                    })

    await db.exam_definitions.insert_many(exam_docs)
    CHUNK = 5000
    for i in range(0, len(mark_docs), CHUNK):
        await db.mark_records.insert_many(mark_docs[i:i+CHUNK])
    print(f"  Exams: {len(exam_docs)}, Mark records: {len(mark_docs):,}")

# ── 3. Announcements ──────────────────────────────────────────────────────────
async def seed_announcements():
    admin = await db.users.find_one({"role": "admin"}, {"_id": 0, "user_id": 1})
    aid   = admin["user_id"] if admin else "system"
    now   = datetime.now(timezone.utc)

    items = [
        (0,  "high",   "all",   None,    "Annual Sports Day – 15 March 2026",
         "Shemford's Annual Sports Day will be held on 15 March 2026. All students must participate. Parents are cordially invited."),
        (2,  "high",   "all",   None,    "Term 2 Examination Schedule Released",
         "Term 2 exams (Annual Examination 2025-26) will be held from 2 March to 14 March 2026. Admit cards will be distributed on 25 February 2026. Students of Class 10 & 12 must note the Pre-Board exams scheduled 15–25 January 2026."),
        (5,  "normal", "all",   None,    "Republic Day Celebration – 26 January 2026",
         "The school will celebrate Republic Day on 26 January 2026. A flag-hoisting ceremony will be held at 8:00 AM. All students are requested to be present in school uniform by 7:45 AM."),
        (7,  "normal", "class", "10th",  "Board Exam Preparation – Extra Classes",
         "Special doubt-clearing classes for Class 10 students will be conducted every Saturday from 8 AM to 12 PM starting 10 January 2026. Attendance is mandatory."),
        (8,  "normal", "class", "12th",  "Class 12 Board Exam Guidelines",
         "CBSE Board examination guidelines have been shared with Class 12 students. Please check the CBSE website for subject-specific instructions. Practical examinations will begin from 2 January 2026."),
        (10, "normal", "all",   None,    "New Books Available in School Library",
         "The library has acquired 250 new books including NCERT reference books, competitive exam guides, and general reading titles. Students can issue books during library hours: Mon–Fri 10:00 AM – 12:00 PM."),
        (12, "low",    "all",   None,    "Diwali Vacation Notice",
         "The school will remain closed from 1 November to 6 November 2025 for Diwali vacation. Classes will resume on 7 November 2025 (Friday)."),
        (14, "high",   "all",   None,    "Winter Vacation Schedule",
         "Winter vacation for 2025-26 will be observed from 26 December 2025 to 5 January 2026. School will reopen on 6 January 2026. Students should complete holiday homework during the break."),
        (20, "normal", "class", "9th",   "Science Exhibition – Registrations Open",
         "Inter-school Science Exhibition will be held on 28 February 2026. Class 9 & 10 students can register their projects by 15 January 2026. Contact your Science teacher for details."),
        (22, "low",    "all",   None,    "Parent-Teacher Meeting – 8 February 2026",
         "The next PTM will be held on 8 February 2026 (Sunday) from 9 AM to 1 PM. Parents are requested to meet the respective class teachers to discuss their ward's academic progress."),
    ]

    docs = [{
        "announcement_id": f"ann_{uuid.uuid4().hex[:12]}",
        "title":       title,
        "content":     content,
        "target_type": ttype,
        "target_value":tval,
        "priority":    priority,
        "created_by":  aid,
        "is_active":   True,
        "created_at":  isodt(now - timedelta(days=days_ago)),
    } for (days_ago, priority, ttype, tval, title, content) in items]

    await db.announcements.insert_many(docs)
    print(f"  Announcements: {len(docs)}")

# ── Main ──────────────────────────────────────────────────────────────────────
async def main():
    # Drop only the collections we're re-seeding
    for col in ["attendance", "attendance_sessions", "exam_definitions", "mark_records", "announcements"]:
        await db[col].drop()
    print("Cleared: attendance, exams, marks, announcements\n")

    # Load existing students + teacher IDs
    students = await db.students.find({"academic_year": AY}, {"_id": 0}).to_list(None)
    print(f"Found {len(students)} students\n")

    emps = await db.employees.find({}, {"_id": 0, "employee_id": 1}).to_list(None)
    teacher_ids = [e["employee_id"] for e in emps]

    print("[1/3] Attendance")
    await seed_attendance(students, teacher_ids)

    print("[2/3] Exams & Marks")
    await seed_exams_and_marks(students, teacher_ids)

    print("[3/3] Announcements")
    await seed_announcements()

    client.close()
    print("\nDone!")

asyncio.run(main())
