"""Unit tests for the daily collection report (no live Mongo needed)."""
import os
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")

from fastapi import HTTPException  # noqa: E402
from pymongo.errors import DuplicateKeyError  # noqa: E402

from routes import reports  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _n):
        return self.rows


class _Coll:
    def __init__(self, rows=None):
        self.rows = rows or []

    def find(self, *_a, **_k):
        return _Cursor(self.rows)


class _LogColl:
    def __init__(self):
        self.docs = {}

    async def insert_one(self, doc):
        if doc["_id"] in self.docs:
            raise DuplicateKeyError("dup")
        self.docs[doc["_id"]] = dict(doc)

    async def find_one_and_update(self, flt, upd, return_document=None):
        d = self.docs.get(flt["_id"])
        if d and d["status"] == "failed":
            d.update(upd["$set"])
            d["attempts"] += 1
            return d
        return None

    async def update_one(self, flt, upd):
        self.docs[flt["_id"]].update(upd["$set"])


class _FakeDb:
    def __init__(self, payments, orders):
        self.fee_payments = _Coll(payments)
        self.razorpay_orders = _Coll(orders)
        self.daily_collection_reports = _LogColl()


@pytest.mark.parametrize("raw,expected", [
    ("Cash", "cash"), ("pos_card", "card"), ("pos_upi", "upi"), ("Demand Draft", "dd"),
    ("online", "online"), ("bank_transfer", "bank_transfer"), (None, "unknown"),
])
def test_normalize_mode(raw, expected):
    assert reports._normalize_mode(raw) == expected


def test_parse_date_rejects_bad_and_future():
    with pytest.raises(HTTPException):
        reports._parse_report_date("09-11-2026")
    with pytest.raises(HTTPException):
        reports._parse_report_date("2026-3-9")  # must be zero-padded
    with pytest.raises(HTTPException):
        reports._parse_report_date("2999-01-01")


@pytest.mark.anyio
async def test_build_report_groups_modes_splits_and_refunds(monkeypatch):
    payments = [
        {"amount": 500, "payment_method": "cash"},
        {"amount": 300, "payment_method": "pos_card"},
        {"amount": 200, "payment_method": "pos_upi"},
        {"amount": 1000, "payment_method": "split", "split_payments": {"cash": 400, "online": 600}},
        {"amount": 50, "payment_method": "cheque"},
    ]
    orders = [
        {"refund_amount": 100, "refund_status": "processed"},
        {"refund_amount": 999, "refund_status": "failed"},
    ]
    monkeypatch.setattr(reports, "db", _FakeDb(payments, orders))
    r = await reports.build_daily_collection_report("2026-11-09")
    assert r["collections"] == {"cash": 900.0, "cheque": 50.0, "dd": 0.0, "card": 300.0,
                                "upi": 200.0, "online": 600.0}
    assert r["total_collection"] == 2050.0
    assert r["refunds"] == {"total": 100.0, "count": 1}
    assert r["net_collection"] == 1950.0
    assert r["transaction_count"] == 5


@pytest.mark.anyio
async def test_send_is_idempotent(monkeypatch):
    fake = _FakeDb([{"amount": 10, "payment_method": "cash"}], [])
    monkeypatch.setattr(reports, "db", fake)
    monkeypatch.setenv("DAILY_REPORT_EMAILS", "a@example.com")
    monkeypatch.delenv("DAILY_REPORT_WEBHOOK_URL", raising=False)

    sent = []

    async def fake_send(to, subject, html_):
        sent.append(to)
        return True

    import routes.payments as payments_mod
    monkeypatch.setattr(payments_mod, "send_email", fake_send)

    await reports.send_daily_collection_report("2026-11-09")
    await reports.send_daily_collection_report("2026-11-09")  # duplicate trigger
    assert sent == ["a@example.com"]
    assert fake.daily_collection_reports.docs["2026-11-09"]["status"] == "sent"


def test_seconds_until_next_run_rolls_to_tomorrow():
    now = datetime(2026, 11, 9, 23, 59, 30, tzinfo=timezone.utc)
    assert 0 < reports._seconds_until_next_run(now, "23:59") <= 86400
    now = datetime(2026, 11, 9, 23, 0, 0, tzinfo=timezone.utc)
    assert reports._seconds_until_next_run(now, "23:59") == 59 * 60
