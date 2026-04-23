"""
Shemford Futuristic School — Bank Field Encryption Migration

Idempotent migration: encrypts plaintext bank fields in:
  - employees  (bank_account_number, bank_ifsc, bank_name, bank_account_holder)
  - payroll    (bank_snapshot.account_number, bank_snapshot.ifsc, bank_snapshot.bank_name)

Safety guarantees:
  - Skips documents already flagged with _bank_fields_encrypted=True
  - Skips fields that already have the "enc:" prefix (double-run safe)
  - Dry-run mode: prints what would be changed without writing anything
  - Batch size 100 to avoid holding large cursors or memory
  - All writes are individual update_one calls — partial runs are safe to re-run

Usage:
  # Dry run (no writes):
  python migrations/migrate_encrypt_bank.py --dry-run

  # Live run:
  python migrations/migrate_encrypt_bank.py

Environment:
  MONGO_URL            — MongoDB connection string
  DB_NAME              — database name
  FIELD_ENCRYPTION_KEY — Fernet key (required; generate with Fernet.generate_key())
"""
import asyncio
import argparse
import logging
import os
import sys
from pathlib import Path

# ── Bootstrap path so we can import project modules ──────────────────────────
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient
from security import encrypt_field, is_encrypted, _BANK_FIELDS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("migrate_encrypt_bank")

BATCH_SIZE = 100


async def migrate_employees(db, dry_run: bool) -> dict:
    """Encrypt bank fields in the employees collection."""
    processed = 0
    skipped = 0
    updated = 0
    errors = 0

    cursor = db.employees.find(
        {"_bank_fields_encrypted": {"$ne": True}},
        {"_id": 1, "employee_id": 1} | {f: 1 for f in _BANK_FIELDS}
    ).batch_size(BATCH_SIZE)

    async for doc in cursor:
        processed += 1
        employee_id = doc.get("employee_id", str(doc["_id"]))

        has_plaintext = any(
            doc.get(f) and not is_encrypted(doc.get(f))
            for f in _BANK_FIELDS
        )

        if not has_plaintext:
            # All fields either absent, None, or already encrypted
            if not dry_run:
                await db.employees.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"_bank_fields_encrypted": True}}
                )
            skipped += 1
            continue

        update_fields: dict = {"_bank_fields_encrypted": True}
        for field in _BANK_FIELDS:
            value = doc.get(field)
            if value and not is_encrypted(value):
                encrypted = encrypt_field(str(value))
                update_fields[field] = encrypted
                logger.info(
                    "[employees] %s employee_id=%s field=%s %s",
                    "DRY-RUN would encrypt" if dry_run else "encrypting",
                    employee_id, field, "(plaintext → ciphertext)"
                )

        if not dry_run:
            try:
                await db.employees.update_one(
                    {"_id": doc["_id"]},
                    {"$set": update_fields}
                )
                updated += 1
            except Exception as e:
                logger.error("Failed to update employee %s: %s", employee_id, e)
                errors += 1
        else:
            updated += 1

    return {"processed": processed, "updated": updated, "skipped": skipped, "errors": errors}


async def migrate_payroll(db, dry_run: bool) -> dict:
    """Encrypt bank fields in payroll.bank_snapshot sub-documents."""
    _PAYROLL_SNAP_FIELDS = ("account_number", "ifsc", "bank_name")

    processed = 0
    skipped = 0
    updated = 0
    errors = 0

    cursor = db.payroll.find(
        {"_bank_fields_encrypted": {"$ne": True}},
        {"_id": 1, "payroll_id": 1, "bank_snapshot": 1}
    ).batch_size(BATCH_SIZE)

    async for doc in cursor:
        processed += 1
        payroll_id = doc.get("payroll_id", str(doc["_id"]))
        snap = doc.get("bank_snapshot") or {}

        has_plaintext = any(
            snap.get(f) and not is_encrypted(snap.get(f))
            for f in _PAYROLL_SNAP_FIELDS
        )

        if not has_plaintext:
            if not dry_run:
                await db.payroll.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"_bank_fields_encrypted": True}}
                )
            skipped += 1
            continue

        update_fields: dict = {"_bank_fields_encrypted": True}
        for field in _PAYROLL_SNAP_FIELDS:
            value = snap.get(field)
            if value and not is_encrypted(value):
                encrypted = encrypt_field(str(value))
                update_fields[f"bank_snapshot.{field}"] = encrypted
                logger.info(
                    "[payroll] %s payroll_id=%s field=bank_snapshot.%s %s",
                    "DRY-RUN would encrypt" if dry_run else "encrypting",
                    payroll_id, field, "(plaintext → ciphertext)"
                )

        if not dry_run:
            try:
                await db.payroll.update_one(
                    {"_id": doc["_id"]},
                    {"$set": update_fields}
                )
                updated += 1
            except Exception as e:
                logger.error("Failed to update payroll %s: %s", payroll_id, e)
                errors += 1
        else:
            updated += 1

    return {"processed": processed, "updated": updated, "skipped": skipped, "errors": errors}


async def run_migration(dry_run: bool):
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017/?replicaSet=rs0")
    db_name = os.environ.get("DB_NAME")
    if not db_name:
        logger.error("DB_NAME environment variable is required")
        sys.exit(1)

    enc_key = os.environ.get("FIELD_ENCRYPTION_KEY")
    if not enc_key:
        logger.error("FIELD_ENCRYPTION_KEY is required for encryption migration")
        sys.exit(1)

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    mode = "DRY-RUN" if dry_run else "LIVE"
    logger.info("=== Bank Field Encryption Migration [%s] ===", mode)

    # ── Employees ────────────────────────────────────────────────────────────
    logger.info("--- employees collection ---")
    emp_result = await migrate_employees(db, dry_run)
    logger.info(
        "employees: processed=%d updated=%d skipped=%d errors=%d",
        emp_result["processed"], emp_result["updated"],
        emp_result["skipped"], emp_result["errors"]
    )

    # ── Payroll ───────────────────────────────────────────────────────────────
    logger.info("--- payroll collection ---")
    pay_result = await migrate_payroll(db, dry_run)
    logger.info(
        "payroll: processed=%d updated=%d skipped=%d errors=%d",
        pay_result["processed"], pay_result["updated"],
        pay_result["skipped"], pay_result["errors"]
    )

    total_errors = emp_result["errors"] + pay_result["errors"]
    if total_errors:
        logger.warning("Migration completed with %d errors — review logs above", total_errors)
    else:
        logger.info("Migration completed successfully%s", " (dry-run — no writes made)" if dry_run else "")

    client.close()
    return total_errors


def main():
    parser = argparse.ArgumentParser(description="Encrypt bank fields in employees and payroll collections")
    parser.add_argument("--dry-run", action="store_true", help="Print changes without writing to DB")
    args = parser.parse_args()

    errors = asyncio.run(run_migration(dry_run=args.dry_run))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
