"""
seed_employee_attendance_may2026.py

Seeds employee attendance records for May 2026 so the Employee Attendance
Report has data to show during testing.

- One record per active employee per working day in May 2026.
- Sundays are skipped (treated as weekly off).
- Active holidays in the `holidays` collection for May 2026 are skipped.
- Status distribution is realistic: mostly present, with occasional
  absent / leave / half_day.

Idempotent: uses upsert keyed on (entity_type, entity_id, date), and every
record is tagged `_seeded: True` so it can be identified / cleaned up later.

Usage (from backend/):
    .venv/Scripts/python.exe seed_employee_attendance_may2026.py
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
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

YEAR, MONTH = 2026, 5

# Weighted status distribution — ~88% present, rest spread across the others.
STATUS_CHOICES = (
    ["present"] * 88 + ["absent"] * 4 + ["leave"] * 5 + ["half_day"] * 3
)


def working_days(year: int, month: int):
    """Yield YYYY-MM-DD strings for every non-Sunday day in the month."""
    d = date(year, month, 1)
    while d.month == month:
        if d.weekday() != 6:  # 6 == Sunday
            yield d.isoformat()
        d += timedelta(days=1)


async def main():
    employees = await db.employees.find(
        {"is_active": True}, {"_id": 0, "employee_id": 1, "first_name": 1, "last_name": 1}
    ).to_list(5000)
    if not employees:
        print("No active employees found — nothing to seed.")
        return

    # Skip configured holidays in May 2026
    holiday_rows = await db.holidays.find(
        {"is_active": True, "date": {"$regex": f"^{YEAR}-{MONTH:02d}"}}, {"_id": 0, "date": 1}
    ).to_list(100)
    holidays = {h["date"] for h in holiday_rows}

    days = [d for d in working_days(YEAR, MONTH) if d not in holidays]
    print(f"Seeding {len(employees)} employees × {len(days)} working days "
          f"({YEAR}-{MONTH:02d}, {len(holidays)} holiday(s) skipped)…")

    ops = []
    now_iso = datetime.now(timezone.utc).isoformat()
    for emp in employees:
        emp_id = emp["employee_id"]
        for day in days:
            status = random.choice(STATUS_CHOICES)
            doc = {
                "attendance_id": f"att_{uuid.uuid4().hex[:12]}",
                "entity_type": "employee",
                "entity_id": emp_id,
                "date": day,
                "status": status,
                "marked_by": "seed-script",
                "remarks": None,
                "is_locked": True,
                "created_at": now_iso,
                "_seeded": True,
            }
            ops.append(UpdateOne(
                {"entity_type": "employee", "entity_id": emp_id, "date": day},
                {"$set": doc},
                upsert=True,
            ))

    if ops:
        result = await db.attendance.bulk_write(ops, ordered=False)
        print(f"Done. upserted={result.upserted_count} modified={result.modified_count} "
              f"matched={result.matched_count}")
    else:
        print("Nothing to write.")


if __name__ == "__main__":
    asyncio.run(main())
