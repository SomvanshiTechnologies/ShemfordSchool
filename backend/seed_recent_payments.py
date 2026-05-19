"""
seed_recent_payments.py

Adds fee_payments dated within this-week and last-week for EVERY active class+section
combo, so the Fees Collection report has data no matter which class/section/fee_type
filter the admin picks.

Idempotent: each run wipes prior payments tagged with `_seed_recent: True` and re-creates them.
Does NOT mutate student_ledger entries — payments reference real ledger IDs so the
Fees Type column populates correctly via the report's join.

Usage:
    .venv/Scripts/python.exe seed_recent_payments.py
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


async def seed():
    today = date.today()
    monday_this = today - timedelta(days=today.weekday())          # this Monday
    sunday_last = monday_this - timedelta(days=1)
    monday_last = sunday_last - timedelta(days=6)

    # Last calendar month range (entire month, not "last 30 days")
    first_of_this_month = today.replace(day=1)
    last_of_prev_month = first_of_this_month - timedelta(days=1)
    first_of_prev_month = last_of_prev_month.replace(day=1)

    # Build date pool covering every duration dropdown bucket:
    #   today/yesterday (handled by today/today-1)
    #   this_week  → Mon..today
    #   last_week  → Mon..Sun of prior week
    #   this_month → already covered by this_week + last_week (if both fall in same month)
    #   last_month → spread of dates across the entire previous calendar month
    date_pool = []
    d = monday_this
    while d <= today:
        date_pool.append(d)
        d += timedelta(days=1)
    d = monday_last
    while d <= sunday_last:
        date_pool.append(d)
        d += timedelta(days=1)
    d = first_of_prev_month
    while d <= last_of_prev_month:
        date_pool.append(d)
        d += timedelta(days=2)  # every other day in last_month — enough hits without flooding

    # Every payment_method from the report's frontend dropdown
    methods = ["cash", "online", "upi", "bank_transfer", "cheque", "split"]

    # Per-student fee_type profile: pick ONE type for most students, occasional 2-mix.
    # Realistic distribution: not every student pays all three categories.
    fee_type_profiles = [
        ["monthly"],
        ["monthly"],
        ["one_time"],
        ["one_time"],
        ["yearly"],
        ["yearly"],
        ["monthly", "one_time"],   # occasional mix
        ["monthly", "yearly"],
    ]

    # Distinct active class+section combos
    combos = await db.students.aggregate([
        {"$match": {"is_active": True}},
        {"$group": {"_id": {"c": "$class_name", "s": "$section"}}},
        {"$sort": {"_id.c": 1, "_id.s": 1}},
    ]).to_list(1000)

    # Idempotency
    deleted = await db.fee_payments.delete_many({"_seed_recent": True})
    print(f"Cleared {deleted.deleted_count} prior seed-recent payments")

    new_payments = []
    skipped_combos = []
    for combo in combos:
        cn = combo["_id"].get("c")
        sec = combo["_id"].get("s")
        if not cn or not sec:
            continue

        # Up to 2 students from this combo
        students = await db.students.find(
            {"class_name": cn, "section": sec, "is_active": True},
            {"_id": 0, "student_id": 1},
        ).limit(2).to_list(2)
        if not students:
            skipped_combos.append((cn, sec, "no students"))
            continue

        combo_payment_count = 0
        for s in students:
            # Each student gets ONE fee_type profile (mostly single-type, occasional 2-mix)
            profile = random.choice(fee_type_profiles)
            for ft in profile:
                entry = await db.student_ledger.find_one(
                    {"student_id": s["student_id"], "fee_type": ft},
                    {"_id": 0, "ledger_id": 1, "net_amount": 1, "fee_type": 1},
                )
                if not entry:
                    continue
                d = random.choice(date_pool)
                pay = {
                    "payment_id":     f"pay_recent_{uuid.uuid4().hex[:12]}",
                    "student_id":     s["student_id"],
                    "installment_ids": [entry["ledger_id"]],
                    "amount":         float(entry.get("net_amount") or 1500),
                    "payment_date":   d.isoformat(),
                    "payment_method": random.choice(methods),
                    "transaction_id": f"TXN{uuid.uuid4().hex[:10].upper()}",
                    "receipt_number": f"RCP{datetime.now().year}{uuid.uuid4().hex[:8].upper()}",
                    "remarks":        "Seeded payment for recent-duration reports",
                    "academic_year":  "2025-2026",
                    "created_at":     datetime.now(timezone.utc).isoformat(),
                    "_seed_recent":   True,
                }
                new_payments.append(pay)
                combo_payment_count += 1

        if combo_payment_count == 0:
            skipped_combos.append((cn, sec, "no ledger entries"))

    if new_payments:
        await db.fee_payments.insert_many(new_payments)

    print(f"Inserted {len(new_payments)} payments across {len(combos)} class+section combos")
    if skipped_combos:
        print(f"Skipped {len(skipped_combos)} combos (no students/ledger): {skipped_combos[:5]}{'...' if len(skipped_combos) > 5 else ''}")

    # Coverage report
    print("\nDuration coverage after seed:")
    durs = {
        "today":      (today, today),
        "yesterday":  (today - timedelta(days=1), today - timedelta(days=1)),
        "this_week":  (monday_this, today),
        "last_week":  (monday_last, sunday_last),
        "this_month": (today.replace(day=1), today),
    }
    for name, (s, e) in durs.items():
        end_excl = (e + timedelta(days=1)).isoformat()
        cnt = await db.fee_payments.count_documents({"payment_date": {"$gte": s.isoformat(), "$lt": end_excl}})
        print(f"  {name:12s}: {cnt} payments")


if __name__ == "__main__":
    asyncio.run(seed())
