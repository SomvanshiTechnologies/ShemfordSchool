"""
Migration: seed dummy bank details for existing employees that have no bank info.
Run once: python migrate_bank_fields.py
"""
import asyncio
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")

# Must load env before importing security so Fernet key is available
from security import encrypt_bank_fields  # noqa: E402

DUMMY_IFSC = "SBIN0001234"
DUMMY_BANK = "State Bank of India"
DUMMY_ACCOUNT_PREFIX = "10000000"  # 8-digit prefix; padded with employee index


async def migrate():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "shemford_school")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    employees = await db.employees.find(
        {"bank_account_number": {"$in": [None, ""]}}
    ).to_list(1000)

    if not employees:
        print("No employees with missing bank details found.")
        client.close()
        return

    print(f"Found {len(employees)} employees with missing bank details. Updating...")

    for i, emp in enumerate(employees):
        full_name = f"{emp.get('first_name', '')} {emp.get('last_name', '')}".strip()
        account_number = f"{DUMMY_ACCOUNT_PREFIX}{str(i + 1).zfill(6)}"

        update = {
            "bank_account_number": account_number,
            "bank_ifsc": DUMMY_IFSC,
            "bank_name": DUMMY_BANK,
            "bank_account_holder": full_name or "Employee",
        }
        encrypt_bank_fields(update)

        await db.employees.update_one(
            {"employee_id": emp["employee_id"]},
            {"$set": update}
        )
        print(f"  Updated {emp['employee_id']} ({full_name}) — account: {account_number}")

    print("Migration complete.")
    client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
