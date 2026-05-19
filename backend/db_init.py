"""
Shemford Futuristic School — Database Initialization
Creates all MongoDB indexes required for production performance and data integrity.
Run once at startup via server.py, or manually via: python3 db_init.py
"""
import asyncio
import logging
from pymongo import ASCENDING, DESCENDING, TEXT

logger = logging.getLogger(__name__)


async def create_indexes(db):
    """
    Create all compound indexes for the Shemford School ERP.
    All operations are idempotent — safe to run on every startup.
    """
    idx_tasks = [
        # ── students ──────────────────────────────────────────────────────────
        db.students.create_index([("student_id", ASCENDING)], unique=True, background=True),
        db.students.create_index([("admission_number", ASCENDING)], unique=True, sparse=True, background=True),
        db.students.create_index([("class_name", ASCENDING), ("section", ASCENDING), ("is_active", ASCENDING)], background=True),
        db.students.create_index([("class_name", ASCENDING), ("stream", ASCENDING), ("section", ASCENDING), ("is_active", ASCENDING)], background=True),
        # Roll number uniqueness: scoped to class + section + stream (stream=None for non-senior classes)
        db.students.create_index([
            ("class_name", ASCENDING), ("section", ASCENDING), ("stream", ASCENDING), ("roll_number", ASCENDING)
        ], unique=True, sparse=True, background=True),
        db.students.create_index([("parent_id", ASCENDING), ("is_active", ASCENDING)], background=True),
        db.students.create_index([("parent_email", ASCENDING), ("is_active", ASCENDING)], background=True),
        db.students.create_index([("user_id", ASCENDING)], sparse=True, background=True),
        db.students.create_index([("fee_status", ASCENDING), ("is_active", ASCENDING)], background=True),
        db.students.create_index([("academic_year", ASCENDING), ("is_active", ASCENDING)], background=True),
        db.students.create_index([
            ("first_name", ASCENDING), ("last_name", ASCENDING), ("date_of_birth", ASCENDING)
        ], background=True),

        # ── users ─────────────────────────────────────────────────────────────
        db.users.create_index([("user_id", ASCENDING)], unique=True, background=True),
        db.users.create_index([("email", ASCENDING)], unique=True, background=True),
        db.users.create_index([("role", ASCENDING), ("is_active", ASCENDING)], background=True),

        # ── student_ledger (primary fee table) ────────────────────────────────
        db.student_ledger.create_index([("ledger_id", ASCENDING)], unique=True, background=True),
        db.student_ledger.create_index([("student_id", ASCENDING), ("status", ASCENDING)], background=True),
        db.student_ledger.create_index([
            ("student_id", ASCENDING), ("fee_component", ASCENDING),
            ("month", ASCENDING), ("academic_year", ASCENDING)
        ], background=True),
        db.student_ledger.create_index([("student_id", ASCENDING), ("fee_type", ASCENDING), ("due_date", ASCENDING)], background=True),
        db.student_ledger.create_index([("status", ASCENDING), ("due_date", ASCENDING)], background=True),
        # Supports the /fees/due-chart aggregation: $match on status, then $group by student_id.
        db.student_ledger.create_index([("status", ASCENDING), ("student_id", ASCENDING)], background=True),
        db.student_ledger.create_index([("payment_id", ASCENDING)], sparse=True, background=True),
        db.student_ledger.create_index([("academic_year", ASCENDING), ("status", ASCENDING)], background=True),

        # ── fee_component_configs ─────────────────────────────────────────────
        db.fee_component_configs.create_index([
            ("class_name", ASCENDING), ("stream", ASCENDING), ("academic_year", ASCENDING), ("is_active", ASCENDING)
        ], background=True),
        db.fee_component_configs.create_index([("config_id", ASCENDING)], unique=True, background=True),

        # ── fee_payments ──────────────────────────────────────────────────────
        db.fee_payments.create_index([("payment_id", ASCENDING)], unique=True, background=True),
        db.fee_payments.create_index([("student_id", ASCENDING), ("payment_date", DESCENDING)], background=True),
        db.fee_payments.create_index([("receipt_number", ASCENDING)], unique=True, sparse=True, background=True),
        # Idempotency: one Razorpay/Stripe payment_id can only ever produce one fee_payment record.
        # partialFilterExpression excludes both missing AND explicit-null transaction_ids so that
        # cash payments (no txn id) never cause duplicate-key errors.
        db.fee_payments.create_index(
            [("transaction_id", ASCENDING)],
            unique=True,
            partialFilterExpression={"transaction_id": {"$type": "string"}},
            background=True,
        ),
        db.fee_payments.create_index([("payment_date", DESCENDING)], background=True),
        db.fee_payments.create_index([("academic_year", ASCENDING), ("payment_date", DESCENDING)], background=True),

        # ── fee_installments (legacy — keep indexed for backward compat) ───────
        db.fee_installments.create_index([("student_id", ASCENDING), ("month", ASCENDING)], background=True),
        db.fee_installments.create_index([("status", ASCENDING), ("due_date", ASCENDING)], background=True),

        # ── attendance ────────────────────────────────────────────────────────
        db.attendance.create_index([
            ("entity_id", ASCENDING), ("date", DESCENDING), ("entity_type", ASCENDING)
        ], background=True),
        db.attendance.create_index([
            ("class_name", ASCENDING), ("section", ASCENDING), ("date", DESCENDING)
        ], background=True),
        db.attendance.create_index([("marked_by", ASCENDING), ("date", DESCENDING)], background=True),
        db.attendance.create_index([("date", DESCENDING), ("status", ASCENDING)], background=True),

        # ── attendance_sessions ───────────────────────────────────────────────
        # stream is null for classes 1-10; (class_name, stream, section, date) is the true unique key
        db.attendance_sessions.create_index([
            ("class_name", ASCENDING), ("stream", ASCENDING), ("section", ASCENDING), ("date", ASCENDING)
        ], unique=True, sparse=True, background=True),

        # ── marks / exams ─────────────────────────────────────────────────────
        db.exam_definitions.create_index([("exam_id", ASCENDING)], unique=True, background=True),
        db.exam_definitions.create_index([
            ("class_name", ASCENDING), ("academic_year", ASCENDING), ("is_published", ASCENDING)
        ], background=True),
        db.mark_records.create_index([
            ("student_id", ASCENDING), ("exam_id", ASCENDING), ("subject", ASCENDING)
        ], unique=True, background=True),
        db.mark_records.create_index([
            ("class_name", ASCENDING), ("exam_id", ASCENDING)
        ], background=True),

        # ── onboarding / admissions ───────────────────────────────────────────
        db.onboarding.create_index([("onboarding_id", ASCENDING)], unique=True, background=True),
        db.onboarding.create_index([("status", ASCENDING), ("created_at", DESCENDING)], background=True),
        db.onboarding.create_index([
            ("first_name", ASCENDING), ("last_name", ASCENDING), ("date_of_birth", ASCENDING)
        ], background=True),

        # ── student_documents ─────────────────────────────────────────────────
        db.student_documents.create_index([("document_id", ASCENDING)], unique=True, background=True),
        db.student_documents.create_index([("onboarding_id", ASCENDING), ("document_type", ASCENDING)], background=True),
        db.student_documents.create_index([("student_id", ASCENDING)], sparse=True, background=True),

        # ── upgradation_records ───────────────────────────────────────────────
        db.upgradation_records.create_index([("upgradation_id", ASCENDING)], unique=True, background=True),
        db.upgradation_records.create_index([("student_id", ASCENDING), ("created_at", DESCENDING)], background=True),
        # One upgrade per student per academic year — DB-level enforcement
        db.upgradation_records.create_index([("student_id", ASCENDING), ("academic_year", ASCENDING)], unique=True, background=True),

        # ── class_structures ──────────────────────────────────────────────────
        db.class_structures.create_index([("name", ASCENDING), ("is_active", ASCENDING)], background=True),
        db.class_structures.create_index([("class_id", ASCENDING)], unique=True, background=True),

        # ── employees ────────────────────────────────────────────────────────
        db.employees.create_index([("employee_id", ASCENDING)], unique=True, background=True),
        db.employees.create_index([("email", ASCENDING)], unique=True, background=True),
        db.employees.create_index([("user_id", ASCENDING)], unique=True, sparse=True, background=True),
        db.employees.create_index([("is_active", ASCENDING), ("department", ASCENDING)], background=True),

        # ── audit_logs ────────────────────────────────────────────────────────
        db.audit_logs.create_index([("entity_type", ASCENDING), ("entity_id", ASCENDING), ("created_at", DESCENDING)], background=True),
        db.audit_logs.create_index([("performed_by", ASCENDING), ("created_at", DESCENDING)], background=True),
        db.audit_logs.create_index([("created_at", DESCENDING)], background=True),
        # TTL index: auto-delete audit logs older than 3 years
        db.audit_logs.create_index([("created_at", ASCENDING)], expireAfterSeconds=94608000, background=True),

        # ── payroll ───────────────────────────────────────────────────────────
        # Prevent duplicate payroll generation for the same employee+month
        db.payroll.create_index([("employee_id", ASCENDING), ("month_year", ASCENDING)], unique=True, background=True),
        db.payroll.create_index([("payroll_id", ASCENDING)], unique=True, background=True),
        db.payroll.create_index([("month_year", ASCENDING), ("status", ASCENDING)], background=True),
        db.payroll.create_index([("employee_id", ASCENDING), ("year", ASCENDING), ("month", ASCENDING)], background=True),
        db.payroll.create_index([("status", ASCENDING), ("created_at", DESCENDING)], background=True),

        # ── razorpay_orders ───────────────────────────────────────────────────
        db.razorpay_orders.create_index([("internal_order_id", ASCENDING)], unique=True, background=True),
        db.razorpay_orders.create_index([("rzp_order_id", ASCENDING)], unique=True, background=True),
        # Idempotency: one payment_id can only ever appear once
        db.razorpay_orders.create_index([("rzp_payment_id", ASCENDING)], unique=True, sparse=True, background=True),
        db.razorpay_orders.create_index([("student_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)], background=True),
        db.razorpay_orders.create_index([("webhook_event_id", ASCENDING)], sparse=True, background=True),
        db.razorpay_orders.create_index([("receipt_number", ASCENDING)], sparse=True, background=True),
        # TTL: auto-delete CANCELLED/FAILED orders older than 90 days to keep collection clean
        db.razorpay_orders.create_index([("created_at", ASCENDING)], expireAfterSeconds=7776000,
                                        partialFilterExpression={"status": {"$in": ["CANCELLED", "FAILED"]}},
                                        background=True),

        # ── job_queue (durable background jobs) ──────────────────────────────
        db.jobs.create_index([("job_id", ASCENDING)], unique=True, background=True),
        # Worker claims via status + next_run_at + $expr(attempts < max_attempts)
        db.jobs.create_index([("status", ASCENDING), ("next_run_at", ASCENDING)], background=True),
        # Idempotency key dedup (PENDING/RUNNING state check)
        db.jobs.create_index([("idempotency_key", ASCENDING)], sparse=True, background=True),
        # TTL: auto-purge completed/failed jobs after 30 days to prevent unbounded growth
        db.jobs.create_index([("completed_at", ASCENDING)], expireAfterSeconds=2592000,
                             sparse=True, background=True),

        # counters: _id is the natural key, MongoDB indexes it automatically — no create_index needed

        # ── announcements ─────────────────────────────────────────────────────
        db.announcements.create_index([("target_type", ASCENDING), ("is_active", ASCENDING), ("created_at", DESCENDING)], background=True),

        # ── messages ──────────────────────────────────────────────────────────
        db.messages.create_index([("recipient_id", ASCENDING), ("is_read", ASCENDING), ("created_at", DESCENDING)], sparse=True, background=True),
        db.messages.create_index([("sender_id", ASCENDING), ("created_at", DESCENDING)], background=True),

        # ── user_sessions ─────────────────────────────────────────────────────
        db.user_sessions.create_index([("session_token", ASCENDING)], unique=True, background=True),
        db.user_sessions.create_index([("user_id", ASCENDING)], background=True),
        # Auto-expire sessions
        db.user_sessions.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0, background=True),

        # ── issues ────────────────────────────────────────────────────────────
        db.issues.create_index([("status", ASCENDING), ("created_at", DESCENDING)], background=True),

        # ── holidays ──────────────────────────────────────────────────────────
        db.holidays.create_index([("date", ASCENDING), ("is_active", ASCENDING)], unique=True, background=True),

        # ── password_resets ───────────────────────────────────────────────────
        db.password_resets.create_index([("token", ASCENDING)], unique=True, sparse=True, background=True),
        db.password_resets.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0, background=True),

        # ── jti_blocklist (revoked access tokens) ─────────────────────────────
        # Unique on jti to prevent duplicate inserts; TTL removes entries after natural token expiry
        db.jti_blocklist.create_index([("jti", ASCENDING)], unique=True, background=True),
        db.jti_blocklist.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0, background=True),

        # ── refresh_tokens ────────────────────────────────────────────────────
        db.refresh_tokens.create_index([("token", ASCENDING)], unique=True, background=True),
        db.refresh_tokens.create_index([("user_id", ASCENDING), ("is_revoked", ASCENDING)], background=True),
        # TTL: auto-delete expired refresh tokens
        db.refresh_tokens.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0, background=True),

        # ── pos_orders (Ezetap POS payments) ─────────────────────────────────
        db.pos_orders.create_index([("pos_order_id", ASCENDING)], unique=True, background=True),
        db.pos_orders.create_index([("p2p_request_id", ASCENDING)], sparse=True, background=True),
        db.pos_orders.create_index([("student_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)], background=True),

        # ── pos_devices (registered Ezetap terminal whitelist) ────────────────
        db.pos_devices.create_index([("device_id", ASCENDING)], unique=True, background=True),
        db.pos_devices.create_index([("is_active", ASCENDING)], background=True),

        # ── voice_notes ───────────────────────────────────────────────────────
        db.voice_notes.create_index([("voice_note_id", ASCENDING)], unique=True, background=True),
        db.voice_notes.create_index([("entity_type", ASCENDING), ("entity_id", ASCENDING)], background=True),
        db.voice_notes.create_index([("uploaded_by", ASCENDING), ("created_at", DESCENDING)], background=True),
    ]

    results = await asyncio.gather(*idx_tasks, return_exceptions=True)
    created = 0
    errors = 0
    for r in results:
        if isinstance(r, Exception):
            # Index may already exist — log but don't crash
            logger.warning(f"Index creation warning: {r}")
            errors += 1
        else:
            created += 1

    logger.info(f"Database indexes: {created} created/verified, {errors} warnings")
    return {"created": created, "warnings": errors}


if __name__ == "__main__":
    import os
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    from pathlib import Path

    load_dotenv(Path(__file__).parent / ".env")
    _client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    _db = _client[os.environ["DB_NAME"]]

    async def main():
        result = await create_indexes(_db)
        logging.basicConfig(level=logging.INFO)
        logger.info("Done: %s", result)
        _client.close()

    asyncio.run(main())
