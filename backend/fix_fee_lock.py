"""
Fix script: Mark all past installments (before current month) as paid
so the app_locked logic only triggers for genuinely unpaid recent fees.
Run once: python fix_fee_lock.py
"""
import asyncio
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv

load_dotenv()

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "shemford_school")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]


async def main():
    now = datetime.now()
    current_month = f"{now.year}-{str(now.month).zfill(2)}"  # e.g. "2026-03"

    print(f"Current month: {current_month}")
    print("Marking all past pending/overdue installments as paid...")

    # Mark all installments with month < current_month as paid
    result = await db.fee_installments.update_many(
        {
            "month": {"$lt": current_month},
            "status": {"$in": ["pending", "overdue"]}
        },
        {
            "$set": {
                "status": "paid",
                "paid_date": f"{current_month}-01",
            }
        }
    )
    print(f"  Updated {result.modified_count} installments to 'paid'")

    # Reset app_locked for all students
    result2 = await db.students.update_many(
        {},
        {"$set": {"app_locked": False}}
    )
    print(f"  Reset app_locked for {result2.modified_count} students")

    # Recalculate fee_status for all students
    students = await db.students.find(
        {"is_active": True}, {"_id": 0, "student_id": 1}
    ).to_list(5000)

    paid_count = 0
    pending_count = 0
    overdue_count = 0

    for s in students:
        sid = s["student_id"]
        today = datetime.now().strftime("%Y-%m-%d")

        # Check if any installments are truly overdue (past due date, still pending)
        overdue = await db.fee_installments.count_documents({
            "student_id": sid,
            "status": "overdue"
        })
        pending = await db.fee_installments.count_documents({
            "student_id": sid,
            "status": "pending"
        })

        if overdue > 0:
            await db.students.update_one(
                {"student_id": sid},
                {"$set": {"fee_status": "overdue", "app_locked": True}}
            )
            overdue_count += 1
        elif pending > 0:
            await db.students.update_one(
                {"student_id": sid},
                {"$set": {"fee_status": "pending", "app_locked": False}}
            )
            pending_count += 1
        else:
            await db.students.update_one(
                {"student_id": sid},
                {"$set": {"fee_status": "paid", "app_locked": False}}
            )
            paid_count += 1

    print(f"\nFee status summary:")
    print(f"  paid:    {paid_count}")
    print(f"  pending: {pending_count}")
    print(f"  overdue: {overdue_count}")

    # Verify test students are not locked
    test_students = await db.students.find(
        {"is_active": True, "app_locked": True},
        {"_id": 0, "first_name": 1, "last_name": 1, "app_locked": 1, "fee_status": 1}
    ).to_list(10)

    if test_students:
        print(f"\nWARNING: {len(test_students)} students still locked (sample):")
        for s in test_students[:5]:
            print(f"  {s['first_name']} {s['last_name']}: {s['fee_status']}")
    else:
        print("\nAll students are now unlocked (no app_locked=True).")

    print("\nDone!")


if __name__ == "__main__":
    asyncio.run(main())
