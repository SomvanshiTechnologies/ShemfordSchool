"""Create login accounts for existing students who have none.

Login ID = admission number, password = date of birth as ddmmyyyy.
Run from the backend folder:  python backfill_student_logins.py
"""
import asyncio

from database import db
from student_login import ensure_student_login


async def main():
    created = skipped = 0
    cursor = db.students.find({"user_id": {"$in": [None, ""]}}, {"_id": 0})
    async for student in cursor:
        if await ensure_student_login(student):
            created += 1
        else:
            skipped += 1
            print(f"skipped {student.get('admission_number')}: no valid date of birth")
    print(f"accounts created: {created}, skipped (no DOB): {skipped}")


if __name__ == "__main__":
    asyncio.run(main())
