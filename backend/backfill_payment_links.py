"""
backfill_payment_links.py

Legacy fee_payments were inserted with empty `installment_ids`, so the Fees Type
column in the report falls back to "—". This script links each such payment to a
real student_ledger entry for the same student so fee_type is resolvable.

Per-student fee_type variety is preserved by picking a profile (mostly single-type,
occasional 2-mix) and linking that student's empty payments only to ledger entries
matching the profile.

Idempotent: only touches payments whose `installment_ids` is empty/missing.
Tagged with `_backfilled_link: True` for audit.

Usage:
    .venv/Scripts/python.exe backfill_payment_links.py
"""

import os
import asyncio
import random
from collections import defaultdict

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne


load_dotenv()
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]


# Same distribution used by seed_recent_payments — most students pay one type,
# minority pay two. Realistic spread for the report.
FEE_TYPE_PROFILES = [
    ["monthly"],
    ["monthly"],
    ["one_time"],
    ["one_time"],
    ["yearly"],
    ["yearly"],
    ["monthly", "one_time"],
    ["monthly", "yearly"],
]


async def backfill():
    # 1. All ledger entries by (student_id, fee_type)
    print("Loading ledger entries...")
    ledgers_by_student = defaultdict(lambda: defaultdict(list))
    cursor = db.student_ledger.find({}, {"_id": 0, "ledger_id": 1, "student_id": 1, "fee_type": 1})
    async for e in cursor:
        ledgers_by_student[e["student_id"]][e.get("fee_type") or "monthly"].append(e["ledger_id"])
    print(f"  → {len(ledgers_by_student)} students have ledger entries")

    # 2. Find all payments lacking installment_ids
    print("Loading legacy payments...")
    legacy = await db.fee_payments.find(
        {"$or": [{"installment_ids": []}, {"installment_ids": {"$exists": False}}, {"installment_ids": None}]},
        {"_id": 0, "payment_id": 1, "student_id": 1},
    ).to_list(50000)
    print(f"  → {len(legacy)} legacy payments to backfill")

    if not legacy:
        print("Nothing to backfill.")
        return

    # 3. Group legacy payments by student
    by_student = defaultdict(list)
    for p in legacy:
        by_student[p["student_id"]].append(p["payment_id"])

    # 4. For each student, pick a profile and link their legacy payments
    bulk_ops = []
    skipped_no_ledger = 0
    profile_counts = defaultdict(int)
    for sid, payment_ids in by_student.items():
        student_ledgers = ledgers_by_student.get(sid)
        if not student_ledgers:
            skipped_no_ledger += len(payment_ids)
            continue

        # Pick a profile, intersected with what the student actually has
        profile = random.choice(FEE_TYPE_PROFILES)
        available = [ft for ft in profile if student_ledgers.get(ft)]
        if not available:
            # Profile doesn't intersect — fall back to whatever the student has
            available = list(student_ledgers.keys())
        profile_counts[tuple(sorted(available))] += 1

        # Pool of ledger_ids matching the chosen profile
        pool = []
        for ft in available:
            pool.extend(student_ledgers[ft])

        for pid in payment_ids:
            bulk_ops.append(UpdateOne(
                {"payment_id": pid},
                {"$set": {
                    "installment_ids": [random.choice(pool)],
                    "_backfilled_link": True,
                }},
            ))

    print(f"Profile distribution across students:")
    for prof, n in sorted(profile_counts.items(), key=lambda x: -x[1]):
        print(f"  {prof}: {n} students")

    if not bulk_ops:
        print("Nothing to write.")
        return

    print(f"Writing {len(bulk_ops)} updates...")
    BATCH = 1000
    written = 0
    for i in range(0, len(bulk_ops), BATCH):
        chunk = bulk_ops[i:i + BATCH]
        result = await db.fee_payments.bulk_write(chunk, ordered=False)
        written += result.modified_count
    print(f"  → modified {written} payments  ({skipped_no_ledger} skipped: student has no ledger)")


if __name__ == "__main__":
    asyncio.run(backfill())
