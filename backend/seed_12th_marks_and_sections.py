"""
seed_12th_marks_and_sections.py

Two jobs:

1. SECTION MIGRATION (11th & 12th only):
   These classes now use Science / Humanities as their section (the section
   IS the stream). Older student rows still carry colour sections (Blue,
   Green, …) plus a separate `stream` field, so the Marks / View-Marks
   screens - which filter students by `section` - find nobody when you pick
   "Humanities". This sets section = Title(stream) for every active 11th/12th
   student that has a stream, making the data match the new model.

2. MARKS SEED:
   Generates realistic Pre-Board Examination marks for every active 12th
   student, for each subject defined on their stream's Pre-Board exam.
   Idempotent (upsert on student+exam+subject; tagged `_seeded`).

Usage (from backend/):
    .venv/Scripts/python.exe seed_12th_marks_and_sections.py
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
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

STREAM_CLASSES = ["11th", "12th"]


def grade_for(pct: float) -> str:
    if pct >= 91: return "A1"
    if pct >= 81: return "A2"
    if pct >= 71: return "B1"
    if pct >= 61: return "B2"
    if pct >= 51: return "C1"
    if pct >= 41: return "C2"
    if pct >= 33: return "D"
    return "E"


async def migrate_sections():
    """
    Collapse colour sections into Science / Humanities for 11th & 12th.
    Roll numbers were unique per colour-section, so merging them collides on
    the (class_name, section, stream, roll_number) unique index - we therefore
    re-number rolls sequentially within each (class, target_section) group.
    """
    students = await db.students.find(
        {"class_name": {"$in": STREAM_CLASSES}, "is_active": True, "stream": {"$nin": [None, ""]}},
        {"_id": 0, "student_id": 1, "stream": 1, "section": 1, "class_name": 1,
         "roll_number": 1, "first_name": 1, "last_name": 1},
    ).to_list(5000)

    # Group by (class, target section) and assign fresh sequential roll numbers.
    from collections import defaultdict
    groups = defaultdict(list)
    for s in students:
        target = s["stream"].strip().capitalize()  # 'humanities' -> 'Humanities'
        groups[(s["class_name"], target)].append(s)

    # Phase 1: park every target student on a globally-unique temp roll under
    # the target section. Temp rolls can't collide, so this always succeeds and
    # clears the way for clean sequential numbering.
    phase1 = [
        UpdateOne(
            {"student_id": s["student_id"]},
            {"$set": {"section": s["stream"].strip().capitalize(),
                      "roll_number": f"TMP_{s['student_id']}"}},
        )
        for s in students
    ]
    if phase1:
        await db.students.bulk_write(phase1, ordered=False)

    # Phase 2: assign final sequential rolls 1..N within each (class, section).
    phase2 = []
    for (cls, target), members in groups.items():
        members.sort(key=lambda m: (str(m.get("roll_number") or "999"), m.get("first_name", ""), m.get("last_name", "")))
        for i, s in enumerate(members, start=1):
            phase2.append(UpdateOne(
                {"student_id": s["student_id"]},
                {"$set": {"roll_number": str(i)}},
            ))
    if phase2:
        res = await db.students.bulk_write(phase2, ordered=False)
        print(f"[sections] aligned {len(students)} 11th/12th students "
              f"(section->Science/Humanities, rolls renumbered per stream)")
    else:
        print("[sections] nothing to migrate")


async def seed_marks():
    exams = await db.exam_definitions.find(
        {"class_name": "12th", "name": {"$regex": "Pre-Board", "$options": "i"}},
        {"_id": 0},
    ).to_list(20)
    if not exams:
        print("[marks] No 12th Pre-Board exam found - skipping marks seed.")
        return

    total = 0
    for exam in exams:
        subjects = exam.get("subjects", [])
        # Infer the stream this exam targets from its subjects.
        subj_names = {s["subject"] for s in subjects}
        if {"History", "Geography", "Political Science", "Economics"} & subj_names:
            stream = "humanities"
        elif {"Physics", "Chemistry", "Biology"} & subj_names:
            stream = "science"
        else:
            stream = None  # generic - seed for all 12th students

        stu_query = {"class_name": "12th", "is_active": True}
        if stream:
            stu_query["stream"] = stream
        students = await db.students.find(
            stu_query, {"_id": 0, "student_id": 1, "section": 1}
        ).to_list(5000)

        ops = []
        now_iso = datetime.now(timezone.utc).isoformat()
        for stu in students:
            for subj in subjects:
                max_marks = float(subj["max_marks"])
                # Realistic spread: most students 55-95% of max.
                obtained = round(random.uniform(0.45, 0.97) * max_marks)
                pct = (obtained / max_marks) * 100 if max_marks else 0
                doc = {
                    "mark_id": f"mark_{uuid.uuid4().hex[:12]}",
                    "student_id": stu["student_id"],
                    "exam_id": exam["exam_id"],
                    "class_name": "12th",
                    "section": stu.get("section") or (stream.capitalize() if stream else ""),
                    "subject": subj["subject"],
                    "exam_type": exam.get("exam_type", "unit_test"),
                    "term": exam.get("name", ""),
                    "academic_year": exam.get("academic_year", ""),
                    "marks_obtained": obtained,
                    "max_marks": max_marks,
                    "grade": grade_for(pct),
                    "entered_by": "seed-script",
                    "is_locked": False,
                    "created_at": now_iso,
                    "_seeded": True,
                }
                ops.append(UpdateOne(
                    {"student_id": stu["student_id"], "exam_id": exam["exam_id"], "subject": subj["subject"]},
                    {"$set": doc},
                    upsert=True,
                ))
        if ops:
            res = await db.mark_records.bulk_write(ops, ordered=False)
            total += res.upserted_count + res.modified_count
            print(f"[marks] {exam['name']} ({stream or 'all'}): {len(students)} students x {len(subjects)} subjects "
                  f"-> upserted={res.upserted_count} modified={res.modified_count}")
    print(f"[marks] total mark records written/updated: {total}")


async def main():
    await migrate_sections()
    await seed_marks()


if __name__ == "__main__":
    asyncio.run(main())
