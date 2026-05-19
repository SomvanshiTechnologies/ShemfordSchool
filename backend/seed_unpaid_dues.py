"""
seed_unpaid_dues.py

Ensures the Due Fees report has data for every class × section × fee_type
filter combination by inserting a real pending/overdue ledger entry per combo.

Idempotent: each run wipes prior entries tagged `_seed_unpaid: True` and
re-creates them. Does NOT mutate existing ledger entries — only adds new
synthetic ones so historical fee totals stay intact.

Usage:
    .venv/Scripts/python.exe seed_unpaid_dues.py
"""

import os
import asyncio
import uuid
import random
from datetime import date, timedelta, datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient


load_dotenv()
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]


FEE_TYPE_AMOUNTS = {
    "monthly":  1900,
    "one_time": 500,
    "yearly":   3600,
}

FEE_TYPE_COMPONENTS = {
    "monthly":  "monthly_tuition",
    "one_time": "registration_fee",
    "yearly":   "annual_charge",
}


async def seed():
    today = date.today()

    # Set of (status, due-offset-days)
    profiles = [
        ("pending",  +20),   # due in future
        ("pending",  +5),
        ("overdue",  -8),    # already past due
        ("overdue", -25),
    ]

    # Distinct active class+section combos
    combos = await db.students.aggregate([
        {"$match": {"is_active": True}},
        {"$group": {"_id": {"c": "$class_name", "s": "$section"}}},
        {"$sort": {"_id.c": 1, "_id.s": 1}},
    ]).to_list(1000)

    deleted = await db.student_ledger.delete_many({"_seed_unpaid": True})
    print(f"Cleared {deleted.deleted_count} prior seed-unpaid entries")

    ENTRIES_PER_FEE_TYPE = 10  # at least N unpaid entries per (class, section, fee_type)

    new_entries = []
    skipped = []
    short_combos = []  # combos that couldn't reach the target due to too few students
    for combo in combos:
        cn = combo["_id"].get("c")
        sec = combo["_id"].get("s")
        if not cn or not sec:
            continue

        # Pull enough students to back ENTRIES_PER_FEE_TYPE per fee_type without
        # too much repetition. If a section has < N students, we reuse (different
        # entries on the same student are valid — students often have multiple
        # outstanding installments).
        students = await db.students.find(
            {"class_name": cn, "section": sec, "is_active": True},
            {"_id": 0, "student_id": 1, "admission_number": 1, "stream": 1},
        ).limit(ENTRIES_PER_FEE_TYPE).to_list(ENTRIES_PER_FEE_TYPE)
        if not students:
            skipped.append((cn, sec))
            continue
        if len(students) < ENTRIES_PER_FEE_TYPE:
            short_combos.append((cn, sec, len(students)))

        for ft, amt in FEE_TYPE_AMOUNTS.items():
            for i in range(ENTRIES_PER_FEE_TYPE):
                s = students[i % len(students)]
                status, off = random.choice(profiles)
                due = (today + timedelta(days=off + random.randint(-30, 30))).isoformat()
                entry = {
                    "ledger_id":          f"ldg_unpaid_{uuid.uuid4().hex[:12]}",
                    "student_id":         s["student_id"],
                    "admission_number":   s.get("admission_number", ""),
                    "class_name":         cn,
                    "stream":             s.get("stream"),
                    "academic_year":      "2025-2026",
                    "fee_component":      FEE_TYPE_COMPONENTS[ft],
                    "fee_type":           ft,
                    "description":        f"{FEE_TYPE_COMPONENTS[ft].replace('_', ' ').title()} (seeded due)",
                    "month":              ((today.month + i) % 12) + 1 if ft == "monthly" else None,
                    "gross_amount":       float(amt),
                    "concession_amount":  0.0,
                    "concession_reason":  None,
                    "late_fee_applied":   0.0,
                    "net_amount":         float(amt),
                    "due_date":           due,
                    "status":             status,
                    "amount_paid":        0.0,
                    "remaining_balance":  float(amt),
                    "created_at":         datetime.now(timezone.utc).isoformat(),
                    "_seed_unpaid":       True,
                }
                new_entries.append(entry)

    if new_entries:
        await db.student_ledger.insert_many(new_entries)

    print(f"Inserted {len(new_entries)} unpaid entries across {len(combos)} class+section combos")
    if skipped:
        print(f"Skipped {len(skipped)} combos (no active students): {skipped[:5]}{'...' if len(skipped) > 5 else ''}")
    if short_combos:
        print(f"{len(short_combos)} combos had < {ENTRIES_PER_FEE_TYPE} students — duplicated students to hit the target.")

    # Coverage report — how many class+section+fee_type triples now have ≥ 1 unpaid?
    print("\nCoverage check (status in pending/overdue/partially_paid):")
    pipe = [
        {"$match": {"status": {"$in": ["pending", "overdue", "partially_paid"]}}},
        {"$lookup": {"from": "students", "localField": "student_id", "foreignField": "student_id", "as": "s"}},
        {"$unwind": "$s"},
        {"$group": {"_id": {"c": "$s.class_name", "sec": "$s.section", "ft": "$fee_type"}}},
    ]
    triples = await db.student_ledger.aggregate(pipe).to_list(5000)
    print(f"  → {len(triples)} unique (class, section, fee_type) triples have unpaid entries")


if __name__ == "__main__":
    asyncio.run(seed())
