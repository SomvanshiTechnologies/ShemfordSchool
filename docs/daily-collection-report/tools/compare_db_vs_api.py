"""Independent check: totals computed straight from MongoDB vs. what the API returns.

Uses its own aggregation (no app code). Local test DB only.
    python compare_db_vs_api.py [YYYY-MM-DD]      (default 2026-11-10)
"""
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from pymongo import MongoClient

DAY = sys.argv[1] if len(sys.argv) > 1 else "2026-11-10"
DB_NAME = os.environ.get("DB_NAME", "postman_test_dc")
if not DB_NAME.startswith("postman_test"):
    sys.exit("local test DB only")
BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8100/api")
ALIAS = {"pos_card": "card", "debit_card": "card", "credit_card": "card", "pos_upi": "upi", "pos_cash": "cash", "demand_draft": "dd"}

db = MongoClient("mongodb://localhost:27017")[DB_NAME]
nxt = (datetime.strptime(DAY, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")

# ---- 1. straight from the database -------------------------------------------------
by_mode = defaultdict(float)
rows = list(db.fee_payments.find({"payment_date": {"$gte": DAY, "$lt": nxt}}))
for p in rows:
    parts = p["split_payments"].items() if p.get("split_payments") else [(p["payment_method"], p["amount"])]
    for mode, amt in parts:
        by_mode[ALIAS.get(mode, mode)] += amt
start = datetime.strptime(DAY, "%Y-%m-%d").replace(tzinfo=ZoneInfo("Asia/Kolkata")).astimezone(timezone.utc)
end = start + timedelta(days=1)
refunds = [r for r in db.razorpay_orders.find({"refund_id": {"$nin": [None, ""]},
                                               "refund_initiated_at": {"$gte": start.isoformat(), "$lt": end.isoformat()}})
           if r.get("refund_status") != "failed"]
db_total = sum(by_mode.values())
db_refund = sum(r["refund_amount"] for r in refunds)

# ---- 2. from the API ----------------------------------------------------------------
login = httpx.post(f"{BASE}/auth/login", json={"email": "admin@test.local", "password": "Test@12345", "platform": "web"}).json()
tok = login.get("access_token") or login["token"]
api = httpx.get(f"{BASE}/reports/daily-collection", params={"date": DAY}, headers={"Authorization": f"Bearer {tok}"}).json()

# ---- 3. compare ---------------------------------------------------------------------
print(f"Report date: {DAY}   (raw rows in fee_payments for that day: {len(rows)})\n")
print(f"{'Payment mode':<16}{'MongoDB':>12}{'API':>12}   match")
ok = True
for mode in sorted(set(by_mode) | set(api["collections"])):
    a, b = round(by_mode.get(mode, 0), 2), api["collections"].get(mode, 0)
    ok &= a == b
    print(f"{mode:<16}{a:>12,.2f}{b:>12,.2f}   {'OK' if a == b else 'MISMATCH'}")
for label, a, b in (("TOTAL", db_total, api["total_collection"]), ("Refunds", db_refund, api["refunds"]["total"]),
                    ("Net", db_total - db_refund, api["net_collection"]),
                    ("Transactions", len(rows), api["transaction_count"]),
                    ("Refund count", len(refunds), api["refunds"]["count"])):
    ok &= round(a, 2) == round(b, 2)
    print(f"{label:<16}{a:>12,.2f}{b:>12,.2f}   {'OK' if round(a, 2) == round(b, 2) else 'MISMATCH'}")
print("\nRESULT:", "ALL TOTALS MATCH" if ok else "MISMATCH FOUND")
sys.exit(0 if ok else 1)
