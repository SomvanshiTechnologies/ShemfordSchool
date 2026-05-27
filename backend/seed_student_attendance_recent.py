"""
seed_student_attendance_recent.py

The bulk seed populated student attendance only through ~2026-05-11, so the
Class Attendance Report is empty for more recent dates. This fills the gap
from the day after the last seeded date up to today, for every active student,
skipping Sundays and configured holidays.

Idempotent: upsert on (entity_type, entity_id, date); tagged `_seeded`.

Usage (from backend/):
    MONGO_URL="mongodb://localhost:27017/?directConnection=true" .venv/Scripts/python.exe seed_student_attendance_recent.py
"""
import os
import asyncio
import random
import uuid
from datetime import date, timedelta, datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne

load_dotenv()
db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

# ~93% present, rest absent/leave — realistic class attendance spread.
STATUS_CHOICES = ["present"] * 93 + ["absent"] * 5 + ["leave"] * 2


async def main():
    students = await db.students.find(
        {"is_active": True},
        {"_id": 0, "student_id": 1, "class_name": 1, "section": 1},
    ).to_list(20000)
    if not students:
        print("No active students.")
        return

    # Start the day after the latest existing student attendance date.
    latest = sorted(
        [d for d in await db.attendance.distinct("date", {"entity_type": "student"}) if d],
        reverse=True,
    )
    start = date(2026, 5, 12)
    if latest:
        try:
            start = datetime.strptime(latest[0], "%Y-%m-%d").date() + timedelta(days=1)
        except ValueError:
            pass
    today = datetime.now().date()
    if start > today:
        print(f"Nothing to fill — attendance already current (latest {latest[0] if latest else 'n/a'}).")
        return

    holidays = {
        h["date"] for h in await db.holidays.find(
            {"is_active": True}, {"_id": 0, "date": 1}
        ).to_list(500)
    }

    days = []
    d = start
    while d <= today:
        if d.weekday() != 6 and d.isoformat() not in holidays:  # skip Sundays + holidays
            days.append(d.isoformat())
        d += timedelta(days=1)

    if not days:
        print("No school days in the gap.")
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    ops = []
    for s in students:
        for day in days:
            ops.append(UpdateOne(
                {"entity_type": "student", "entity_id": s["student_id"], "date": day},
                {"$set": {
                    "attendance_id": f"att_{uuid.uuid4().hex[:12]}",
                    "entity_type": "student",
                    "entity_id": s["student_id"],
                    "date": day,
                    "status": random.choice(STATUS_CHOICES),
                    "class_name": s.get("class_name"),
                    "section": s.get("section"),
                    "marked_by": "seed-script",
                    "is_locked": True,
                    "created_at": now_iso,
                    "_seeded": True,
                }},
                upsert=True,
            ))

    print(f"Filling {len(students)} students x {len(days)} days "
          f"({days[0]} -> {days[-1]})...")
    for i in range(0, len(ops), 2000):
        await db.attendance.bulk_write(ops[i:i + 2000], ordered=False)
    print(f"Done. {len(ops)} attendance records upserted.")


if __name__ == "__main__":
    asyncio.run(main())
