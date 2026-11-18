"""Seed a THROWAWAY database with sample data for testing the Daily Collection Report API.

Safety: refuses to run unless MONGO_URL is localhost and DB_NAME starts with "postman_test".
Never point this at a real database.

    set MONGO_URL=mongodb://localhost:27017
    set DB_NAME=postman_test_dc
    python seed_test_data.py            # (re)creates the sample data, wiping this test DB first

Test logins created (local test values only):
    admin@test.local        / Test@12345   (admin)
    accountant@test.local   / Test@12345   (accountant)
    teacher@test.local      / Test@12345   (teacher - must be forbidden)

Scenario dates (REPORT_TIMEZONE = Asia/Kolkata):
    2026-11-10  full day: every payment mode, a split payment, a refund, a failed refund, failed/cancelled orders
    2026-11-11  one UPI payment (proves a neighbouring day does not leak into 2026-11-10)
    2026-11-09  one cash payment (same)
    2026-11-12  every POS terminal mode (card, upi, cash, cheque, BharatQR, "all modes"), manual cash/cheque/online,
                and a cash+online split: used to check the mode mapping
    2026-11-13  no collections at all (empty day)
"""
import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend"))

MONGO_URL = os.environ.get("MONGO_URL", "")
DB_NAME = os.environ.get("DB_NAME", "")
if not ("localhost" in MONGO_URL or "127.0.0.1" in MONGO_URL) or not DB_NAME.startswith("postman_test"):
    sys.exit("Refusing to run: needs a localhost MONGO_URL and a DB_NAME starting with 'postman_test'.")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from auth_utils import hash_password  # noqa: E402

D1 = "2026-11-10"
NOW = datetime.now(timezone.utc).isoformat()
PASSWORD = "Test@12345"


def user(uid, email, role, name):
    return {"user_id": uid, "email": email, "name": name, "role": role, "is_active": True,
            "password_hash": hash_password(PASSWORD), "created_at": NOW}


STUDENTS = [
    ("stu_001", "SFS2026/0001", "Aarav", "Sharma"),
    ("stu_002", "SFS2026/0002", "Diya", "Verma"),
    ("stu_003", "SFS2026/0003", "Kabir", "Singh"),
]


def pay(n, student, amount, method, date=D1, split=None, txn=None):
    d = {"payment_id": f"pay_test_{n:03d}", "student_id": student, "amount": amount, "payment_method": method,
         "payment_date": date, "transaction_id": txn, "receipt_number": f"RCP2026TEST{n:03d}",
         "collected_by": "usr_accountant", "academic_year": "2026-2027", "installment_ids": [],
         "created_at": f"{date}T10:{n:02d}:00+00:00"}
    if split:
        d["split_payments"] = split
    return d


PAYMENTS = [
    pay(1, "stu_001", 1000, "cash"),
    pay(2, "stu_002", 500, "cash"),
    pay(3, "stu_001", 2000, "cheque", txn="CHQ-445566"),
    pay(4, "stu_003", 1500, "dd", txn="DD-778899"),
    pay(5, "stu_002", 3000, "card", txn="POS-TXN-1001"),
    pay(6, "stu_003", 2500, "upi", txn="UPI-REF-2002"),
    pay(7, "stu_001", 1200, "online", txn="pay_RZP0000001"),
    pay(8, "stu_002", 800, "bank_transfer", txn="NEFT-3003"),
    pay(9, "stu_003", 1000, "split", split={"cash": 300, "upi": 700}),
    pay(10, "stu_001", 400, "pos_card", txn="POS-TXN-1002"),          # alias of card
    pay(11, "stu_002", 777, "upi", date="2026-11-11", txn="UPI-NEXT-DAY"),
    pay(12, "stu_003", 999, "cash", date="2026-11-09"),
    # ---- 2026-11-12: payment-mode mapping day (expected: cash 600, cheque 450, card 1000, upi 2000,
    #      bharat_qr 1500, pos_terminal 600, online 1000, total 7150, 10 transactions)
    pay(21, "stu_001", 1000, "pos_card", date="2026-11-12", txn="POS-C-1"),
    pay(22, "stu_002", 2000, "pos_upi", date="2026-11-12", txn="POS-U-1"),
    pay(23, "stu_003", 300, "pos_cash", date="2026-11-12"),
    pay(24, "stu_001", 400, "pos_cheque", date="2026-11-12", txn="POS-CHQ-1"),
    pay(25, "stu_002", 1500, "pos_bharatqr", date="2026-11-12", txn="POS-QR-1"),
    pay(26, "stu_003", 600, "pos_all", date="2026-11-12", txn="POS-ALL-1"),
    pay(27, "stu_001", 100, "cash", date="2026-11-12"),
    pay(28, "stu_002", 50, "cheque", date="2026-11-12", txn="CHQ-1"),
    pay(29, "stu_003", 700, "online", date="2026-11-12", txn="pay_RZP0000002"),
    pay(30, "stu_001", 500, "split", date="2026-11-12", split={"cash": 200, "online": 300}),
]

ORDERS = [
    # refunded successfully on 2026-11-10 (IST)                    -> counted
    {"order_id": "order_refund_ok", "status": "paid", "refund_id": "rfnd_1", "refund_amount": 600,
     "refund_status": "processed", "refund_initiated_at": "2026-11-10T05:00:00+00:00"},
    # refund initiated after IST midnight (= 2026-11-11 IST)       -> NOT counted on 2026-11-10
    {"order_id": "order_refund_next_day", "status": "paid", "refund_id": "rfnd_2", "refund_amount": 250,
     "refund_status": "processed", "refund_initiated_at": "2026-11-10T20:00:00+00:00"},
    # refund that failed                                          -> NOT counted
    {"order_id": "order_refund_failed", "status": "paid", "refund_id": "rfnd_3", "refund_amount": 900,
     "refund_status": "failed", "refund_initiated_at": "2026-11-10T06:00:00+00:00"},
    # failed / cancelled payments never reach fee_payments        -> never counted
    {"order_id": "order_failed", "status": "failed", "amount": 5000},
    {"order_id": "order_cancelled", "status": "cancelled", "amount": 4000},
]


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    await client.drop_database(DB_NAME)
    await db.users.insert_many([
        user("usr_admin", "admin@test.local", "admin", "Test Admin"),
        user("usr_accountant", "accountant@test.local", "accountant", "Test Accountant"),
        user("usr_teacher", "teacher@test.local", "teacher", "Test Teacher"),
    ])
    await db.students.insert_many([
        {"student_id": s, "admission_number": a, "first_name": f, "last_name": l, "class_name": "5th",
         "academic_year": "2026-2027", "is_active": True} for s, a, f, l in STUDENTS])
    await db.fee_payments.insert_many(PAYMENTS)
    await db.razorpay_orders.insert_many(ORDERS)
    print(f"seeded {DB_NAME}: {await db.fee_payments.count_documents({})} payments, "
          f"{await db.razorpay_orders.count_documents({})} orders")
    client.close()


asyncio.run(main())
