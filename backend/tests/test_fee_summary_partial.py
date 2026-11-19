"""Pending / overdue totals must count only what is still owed on a partly paid entry."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")

from routes.fees import ledger_due_totals, ledger_entry_due  # noqa: E402


def e(status, net, paid=0, rb=None):
    d = {"status": status, "net_amount": net, "amount_paid": paid}
    if rb is not None:
        d["remaining_balance"] = rb
    return d


def test_partial_admission_payment_scenario_from_the_local_test():
    """Billed 21,100; Rs.2,500 collected at admission, 650 of it against the Admission Fee."""
    entries = [
        e("paid", 500, 500, 0),                      # Registration
        e("paid", 1350, 1350, 0),                    # Tuition Nov
        e("overdue", 2500, 650, 1850),               # Admission Fee, partly paid, still flagged overdue
        e("overdue", 1000, 0, 1000),                 # Caution
        *[e("overdue", n, 0, n) for n in (4000, 3600, 500, 1500)],   # yearly fees
        e("overdue", 150, 0, 150),                   # E-Learning Nov
        *[e("pending", 1350, 0, 1350) for _ in range(4)],            # Tuition Dec-Mar
        *[e("pending", 150, 0, 150) for _ in range(4)],              # E-Learning Dec-Mar
    ]
    pending, overdue = ledger_due_totals(entries)
    assert pending == 18600.0          # 21,100 billed - 2,500 paid (was reported as 19,250)
    assert overdue == 12600.0          # was reported as 13,250


def test_partially_paid_status_is_unchanged():
    assert ledger_due_totals([e("partially_paid", 1000, 400, 600)]) == (600.0, 0.0)


def test_unpaid_entries_without_a_remaining_balance_use_the_net_amount():
    assert ledger_due_totals([e("pending", 1350), e("overdue", 1000, 0, 0)]) == (2350.0, 1000.0)


def test_paid_and_waived_entries_are_not_counted():
    assert ledger_due_totals([e("paid", 500, 500, 0), e("waived", 700)]) == (0.0, 0.0)


def test_fallback_when_remaining_balance_is_missing_but_something_was_paid():
    assert ledger_entry_due({"status": "overdue", "net_amount": 2500, "amount_paid": 650}) == 1850.0
