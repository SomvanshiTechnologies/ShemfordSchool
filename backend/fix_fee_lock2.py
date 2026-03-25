"""Fix: mark all pending/overdue installments as paid, clear app_locked."""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv

load_dotenv()
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "shemford_school")
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]


async def main():
    # Mark ALL remaining pending/overdue installments as paid
    result = await db.fee_installments.update_many(
        {"status": {"$in": ["pending", "overdue"]}},
        {"$set": {"status": "paid", "paid_date": "2026-03-21"}}
    )
    print(f"Updated {result.modified_count} installments to paid")

    # Clear all app_locked and set fee_status to paid
    result2 = await db.students.update_many(
        {},
        {"$set": {"app_locked": False, "fee_status": "paid"}}
    )
    print(f"Cleared app_locked for {result2.modified_count} students")

    locked = await db.students.count_documents({"app_locked": True})
    print(f"Students still locked: {locked}")
    print("Done!")


asyncio.run(main())
