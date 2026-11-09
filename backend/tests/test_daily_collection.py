"""Unit tests for the daily collection report (no live Mongo needed)."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

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

    async def find_one(self, flt):
        d = self.docs.get(flt["_id"])
        return dict(d) if d else None

    async def find_one_and_update(self, flt, upd, return_document=None):
        d = self.docs.get(flt["_id"])
        if not d:
            return None
        failed = d["status"] == "failed"
        stale = d["status"] == "sending" and d["claimed_at"] < flt["$or"][1]["claimed_at"]["$lt"]
        if failed or stale:
            d.update(upd["$set"])
            d["attempts"] += upd["$inc"]["attempts"]
            return dict(d)
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


def _utc(**kw):
    return datetime(2026, 11, 10, 0, 0, tzinfo=timezone.utc) + timedelta(**kw)


def test_latest_due_date_before_and_after_trigger():
    ist = reports.REPORT_TZ
    assert reports._latest_due_date(datetime(2026, 11, 9, 23, 58, tzinfo=ist), "23:59") == "2026-11-08"
    assert reports._latest_due_date(datetime(2026, 11, 9, 23, 59, tzinfo=ist), "23:59") == "2026-11-09"
    # app restarted next morning: the missed 23:59 report is still the one due
    assert reports._latest_due_date(datetime(2026, 11, 10, 8, 0, tzinfo=ist), "23:59") == "2026-11-09"


def test_needs_run_recovery_rules():
    now = _utc()
    iso = lambda **kw: (now - timedelta(**kw)).isoformat()  # noqa: E731
    assert reports._needs_run(None, now)                                         # missed entirely
    assert not reports._needs_run({"status": "sent"}, now)
    assert not reports._needs_run({"status": "skipped"}, now)
    assert not reports._needs_run({"status": "sending", "claimed_at": iso(minutes=2)}, now)   # live run
    assert reports._needs_run({"status": "sending", "claimed_at": iso(minutes=20)}, now)      # crashed run
    assert not reports._needs_run({"status": "failed", "attempts": 3, "finished_at": iso(minutes=5)}, now)
    assert reports._needs_run({"status": "failed", "attempts": 3, "finished_at": iso(minutes=45)}, now)
    assert not reports._needs_run({"status": "failed", "attempts": 12, "finished_at": iso(hours=5)}, now)


@pytest.mark.anyio
async def test_concurrent_triggers_deliver_once(monkeypatch):
    fake = _FakeDb([{"amount": 10, "payment_method": "cash"}], [])
    monkeypatch.setattr(reports, "db", fake)
    monkeypatch.setenv("DAILY_REPORT_EMAILS", "a@example.com")
    monkeypatch.delenv("DAILY_REPORT_WEBHOOK_URL", raising=False)
    sent = []

    async def fake_send(to, subject, html_):
        await asyncio.sleep(0.05)  # keep the first run in flight while the others start
        sent.append(to)
        return True

    import routes.payments as payments_mod
    monkeypatch.setattr(payments_mod, "send_email", fake_send)
    await asyncio.gather(*(reports.send_daily_collection_report("2026-11-09") for _ in range(4)))
    assert sent == ["a@example.com"]


@pytest.mark.anyio
async def test_stale_claim_is_recovered_and_delivered(monkeypatch):
    fake = _FakeDb([{"amount": 10, "payment_method": "cash"}], [])
    old = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    fake.daily_collection_reports.docs["2026-11-09"] = {
        "_id": "2026-11-09", "status": "sending", "claimed_at": old, "channels": {}, "attempts": 1}
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
    assert sent == ["a@example.com"]
    assert fake.daily_collection_reports.docs["2026-11-09"]["status"] == "sent"


@pytest.mark.anyio
async def test_retry_only_resends_the_failed_channel(monkeypatch):
    fake = _FakeDb([{"amount": 10, "payment_method": "cash"}], [])
    monkeypatch.setattr(reports, "db", fake)
    monkeypatch.setenv("DAILY_REPORT_EMAILS", "a@example.com")
    monkeypatch.setenv("DAILY_REPORT_WEBHOOK_URL", "http://127.0.0.1:9/hook")
    emails, hooks, hook_ok = [], [], {"v": False}

    async def fake_send(to, subject, html_):
        emails.append(to)
        return True

    async def fake_hook(report):
        hooks.append(report["report_date"])
        if not hook_ok["v"]:
            raise RuntimeError("receiver down")

    import routes.payments as payments_mod
    monkeypatch.setattr(payments_mod, "send_email", fake_send)
    monkeypatch.setattr(reports, "_push_webhook", fake_hook)

    with pytest.raises(RuntimeError):
        await reports.send_daily_collection_report("2026-11-09")   # email ok, webhook fails
    hook_ok["v"] = True
    await reports.send_daily_collection_report("2026-11-09")       # the queue's retry
    assert emails == ["a@example.com"]        # not re-sent
    assert hooks == ["2026-11-09", "2026-11-09"]
    assert fake.daily_collection_reports.docs["2026-11-09"]["status"] == "sent"
