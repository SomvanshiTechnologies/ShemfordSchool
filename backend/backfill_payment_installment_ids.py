"""
Backfill missing FeePayment.installment_ids by re-linking to student_ledger
via the shared payment_id field.

Why: bulk-seeded payments (see seed_data.py) were inserted with
installment_ids=[]. The Fees Collection Report joins payments → ledger via
installment_ids to display fee_type + due_date; with empty arrays those
columns render as "—" even though the ledger data exists. This script
populates installment_ids in place from the existing payment_id link.

Idempotent: only touches payments that currently have an empty or missing
installment_ids array. Safe to re-run any time.

Run (inside the backend container):
    docker exec shemford_backend python backfill_payment_installment_ids.py

Run (local dev with venv):
    python backfill_payment_installment_ids.py
"""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")


async def backfill():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # Payments where installment_ids is empty or missing — these are the ones
    # that can't reach their ledger entries in the Collection Report join.
    query = {"$or": [{"installment_ids": []}, {"installment_ids": {"$exists": False}}]}
    total = await db.fee_payments.count_documents(query)
    print(f"Found {total} payments with empty/missing installment_ids.")

    if total == 0:
        print("Nothing to backfill — already linked.")
        client.close()
        return

    fixed = 0
    no_ledger = 0
    scanned = 0

    cursor = db.fee_payments.find(query, {"_id": 0, "payment_id": 1})
    async for p in cursor:
        scanned += 1
        pay_id = p.get("payment_id")
        if not pay_id:
            continue

        # student_ledger rows store payment_id on each paid row (see seed_data.py).
        # Collect every ledger_id that points back at this payment.
        ledgers = await db.student_ledger.find(
            {"payment_id": pay_id}, {"_id": 0, "ledger_id": 1},
        ).to_list(200)
        ids = [l["ledger_id"] for l in ledgers if l.get("ledger_id")]

        if not ids:
            no_ledger += 1
            continue

        await db.fee_payments.update_one(
            {"payment_id": pay_id},
            {"$set": {"installment_ids": ids}},
        )
        fixed += 1

        if scanned % 200 == 0:
            print(f"  …scanned {scanned}/{total}, backfilled {fixed} so far")

    print(f"✓ Done.")
    print(f"  Scanned:           {scanned}")
    print(f"  Backfilled:        {fixed}")
    print(f"  No ledger match:   {no_ledger}  (payment_id had no rows in student_ledger)")

    client.close()


if __name__ == "__main__":
    asyncio.run(backfill())
