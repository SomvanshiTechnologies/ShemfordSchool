"""
Reset every existing student login to the standard student password:
date of birth as DDMMYYYY (e.g. DOB 12.04.2008 -> 12042008).

Students log in with their admission number + this password. Accounts whose
student record has no usable date of birth are left unchanged and listed.

Dry run by default — nothing is written until you pass --apply.

Usage:
    python fix_student_dob_passwords.py            # preview
    python fix_student_dob_passwords.py --apply    # write
"""

import asyncio
import sys
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

from auth_utils import hash_password, student_default_password  # noqa: E402

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "shemford_school")


async def main(apply: bool):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # A student has one record per academic session, all sharing one user_id —
    # collapse them so each login account is reset exactly once.
    by_user = {}
    async for s in db.students.find(
        {"user_id": {"$nin": [None, ""]}},
        {"_id": 0, "user_id": 1, "admission_number": 1, "date_of_birth": 1,
         "first_name": 1, "last_name": 1},
    ):
        cur = by_user.get(s["user_id"])
        if not cur or (not student_default_password(cur.get("date_of_birth"))
                       and student_default_password(s.get("date_of_birth"))):
            by_user[s["user_id"]] = s

    reset, skipped_no_dob, skipped_not_student = 0, [], 0
    for user_id, s in by_user.items():
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "role": 1})
        if not user or user.get("role") != "student":
            skipped_not_student += 1
            continue
        pw = student_default_password(s.get("date_of_birth"))
        name = f"{s.get('first_name', '')} {s.get('last_name', '')}".strip()
        if not pw:
            skipped_no_dob.append(f"{s.get('admission_number')} ({name}) dob={s.get('date_of_birth')!r}")
            continue
        if apply:
            await db.users.update_one({"user_id": user_id},
                                      {"$set": {"password_hash": hash_password(pw)}})
        reset += 1

    mode = "RESET" if apply else "WOULD RESET (dry run)"
    print(f"{mode}: {reset} student accounts")
    print(f"Skipped, no usable DOB: {len(skipped_no_dob)}")
    for line in skipped_no_dob:
        print(f"  - {line}")
    if skipped_not_student:
        print(f"Skipped, linked user missing or not a student: {skipped_not_student}")
    if not apply:
        print("\nRe-run with --apply to write these changes.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
