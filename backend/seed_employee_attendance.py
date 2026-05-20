"""
Seed employee attendance for the past 3 months so the Employee Attendance
Report has something to display. Runs ADDITIVELY — does NOT drop the
attendance collection. Existing records (by entity_type/entity_id/date)
are upserted, so re-running is safe.

Run: venv/bin/python3 seed_employee_attendance.py
"""
import asyncio
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]


def working_days_in_range(start: datetime, end: datetime):
    """Mon–Sat working days as YYYY-MM-DD strings."""
    days = []
    cur = start
    while cur <= end:
        if cur.weekday() < 6:  # exclude Sunday
            days.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)
    return days


def pick_status():
    """Realistic distribution: ~92% present, 4% absent, 3% leave, 1% half_day."""
    r = random.random()
    if r < 0.92:
        return "present"
    if r < 0.96:
        return "absent"
    if r < 0.99:
        return "leave"
    return "half_day"


async def seed_employee_attendance(months_back: int = 3):
    employees = await db.employees.find(
        {"is_active": True}, {"_id": 0, "employee_id": 1, "first_name": 1, "last_name": 1}
    ).to_list(2000)

    if not employees:
        print("✗ No active employees found — seed employees first.")
        return

    today = datetime.now()
    start = (today - timedelta(days=months_back * 31)).replace(hour=0, minute=0, second=0, microsecond=0)
    end = today - timedelta(days=1)

    # Skip days already marked as holidays
    holiday_dates = set()
    async for h in db.holidays.find({"is_active": True}, {"_id": 0, "date": 1}):
        if h.get("date"):
            holiday_dates.add(h["date"])

    school_days = [d for d in working_days_in_range(start, end) if d not in holiday_dates]
    if not school_days:
        print("✗ No working days in range.")
        return

    # Pick the most senior admin as the marker (fall back to "system")
    admin = await db.users.find_one({"role": "admin"}, {"_id": 0, "user_id": 1})
    marker = admin["user_id"] if admin else "system"

    inserted = 0
    skipped = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for date_str in school_days:
        ops = []
        for emp in employees:
            status = pick_status()
            doc = {
                "attendance_id": str(uuid.uuid4()),
                "entity_type": "employee",
                "entity_id": emp["employee_id"],
                "date": date_str,
                "status": status,
                "marked_by": marker,
                "remarks": None,
                "is_locked": True,
                "created_at": now_iso,
            }
            res = await db.attendance.update_one(
                {"entity_type": "employee", "entity_id": emp["employee_id"], "date": date_str},
                {"$setOnInsert": doc},
                upsert=True,
            )
            if res.upserted_id is not None:
                inserted += 1
            else:
                skipped += 1
        # Quick progress dot
        if school_days.index(date_str) % 10 == 0:
            print(f"  …processed {date_str}")

    print(f"✓ Employee attendance seeded.")
    print(f"  Employees:      {len(employees)}")
    print(f"  Working days:   {len(school_days)} ({school_days[0]} → {school_days[-1]})")
    print(f"  Inserted:       {inserted}")
    print(f"  Already exists: {skipped}")


async def main():
    months_back = int(os.environ.get("MONTHS_BACK", "3"))
    print(f"Seeding employee attendance — last {months_back} month(s)…")
    await seed_employee_attendance(months_back=months_back)
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
