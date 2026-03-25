"""
Fix duplicate admission_number values in the students collection.

For each set of duplicates, the oldest document (by _id) is kept unchanged.
All newer duplicates get a suffix appended: -DUP-2, -DUP-3, etc.
Run once before deploying, then rebuild the unique index.

Usage:
    python fix_duplicate_admission.py
"""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv

load_dotenv()

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "shemford_school")


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    print("Scanning for duplicate admission_number values...")

    pipeline = [
        {"$group": {"_id": "$admission_number", "count": {"$sum": 1}, "ids": {"$push": "$_id"}}},
        {"$match": {"count": {"$gt": 1}}},
    ]
    duplicates = await db.students.aggregate(pipeline).to_list(None)

    if not duplicates:
        print("No duplicates found. Collection is clean.")
        client.close()
        return

    total_fixed = 0
    for dup in duplicates:
        admission_no = dup["_id"]
        ids = sorted(dup["ids"])  # sort by ObjectId (insertion order)
        print(f"  Duplicate: {admission_no} ({len(ids)} records) — keeping {ids[0]}")

        for i, doc_id in enumerate(ids[1:], start=2):
            new_no = f"{admission_no}-DUP-{i}"
            await db.students.update_one(
                {"_id": doc_id},
                {"$set": {"admission_number": new_no}}
            )
            print(f"    Renamed duplicate _id={doc_id} → {new_no}")
            total_fixed += 1

    print(f"\nDone. {total_fixed} duplicate(s) renamed.")

    # Drop and recreate the unique index
    print("Rebuilding unique index on admission_number...")
    try:
        await db.students.drop_index("admission_number_1")
    except Exception:
        pass
    await db.students.create_index("admission_number", unique=True, background=True)
    print("Index rebuilt successfully.")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
