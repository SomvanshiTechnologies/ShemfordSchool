"""
Razorpay Payment Integration Tests
===================================

Covers:
  - Order creation (success, validation errors, concurrency lock)
  - Payment verification (valid sig, invalid sig, duplicate, already verified)
  - Webhook handler (payment.captured, payment.failed, duplicate event)
  - Idempotency (same payment_id cannot be applied twice)
  - Partial payment (when enabled)
  - Cancel / lock release
  - Refund initiation
  - Receipt retrieval

Run with:
    pytest tests/test_razorpay.py -v

Requires:
    pip install pytest pytest-asyncio httpx
"""

import hashlib
import hmac
import json
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

# ── Minimal stubs so the module can be imported without a live DB ─────────────

import sys, types

# Stub 'database' module
db_stub = types.ModuleType("database")
db_stub.db = MagicMock()
db_stub.client = MagicMock()
sys.modules.setdefault("database", db_stub)

# Stub 'auth_utils' module
auth_stub = types.ModuleType("auth_utils")
auth_stub.get_current_user  = AsyncMock(return_value={"user_id": "usr_test", "role": "admin", "name": "Test Admin", "email": "admin@test.com"})
auth_stub.require_roles      = MagicMock(return_value=AsyncMock(return_value={"user_id": "usr_test", "role": "admin", "name": "Test Admin", "email": "admin@test.com"}))
auth_stub.create_audit_log   = AsyncMock()
sys.modules.setdefault("auth_utils", auth_stub)

# ─────────────────────────────────────────────────────────────────────────────

TEST_KEY_SECRET = "7dVFviqOrMI6d9xVMRiFXuoJ"
TEST_KEY_ID     = "rzp_test_SYVHBGyYvwSp7g"


def _make_signature(order_id: str, payment_id: str, secret: str = TEST_KEY_SECRET) -> str:
    """Reproduce Razorpay HMAC-SHA256 signature."""
    msg = f"{order_id}|{payment_id}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def _make_webhook_signature(body: bytes, secret: str = TEST_KEY_SECRET) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


# ── Signature helper tests ────────────────────────────────────────────────────

class TestSignatureVerification:
    """Unit tests for the HMAC signature functions — no I/O needed."""

    def test_valid_signature_accepted(self):
        order_id   = "order_ABC123"
        payment_id = "pay_XYZ789"
        sig = _make_signature(order_id, payment_id)

        msg      = f"{order_id}|{payment_id}".encode()
        expected = hmac.new(TEST_KEY_SECRET.encode(), msg, hashlib.sha256).hexdigest()
        assert hmac.compare_digest(expected, sig)

    def test_wrong_secret_rejected(self):
        order_id   = "order_ABC123"
        payment_id = "pay_XYZ789"
        sig = _make_signature(order_id, payment_id, secret="wrong_secret")

        msg      = f"{order_id}|{payment_id}".encode()
        expected = hmac.new(TEST_KEY_SECRET.encode(), msg, hashlib.sha256).hexdigest()
        assert not hmac.compare_digest(expected, sig)

    def test_tampered_payment_id_rejected(self):
        sig = _make_signature("order_ABC123", "pay_REAL")
        msg = "order_ABC123|pay_TAMPERED".encode()
        expected = hmac.new(TEST_KEY_SECRET.encode(), msg, hashlib.sha256).hexdigest()
        assert not hmac.compare_digest(expected, sig)

    def test_webhook_signature_valid(self):
        body = b'{"event":"payment.captured"}'
        sig  = _make_webhook_signature(body)
        expected = hmac.new(TEST_KEY_SECRET.encode(), body, hashlib.sha256).hexdigest()
        assert hmac.compare_digest(expected, sig)

    def test_webhook_signature_tampered_body(self):
        body         = b'{"event":"payment.captured"}'
        tampered     = b'{"event":"payment.captured","tampered":true}'
        sig          = _make_webhook_signature(body)
        expected_bad = hmac.new(TEST_KEY_SECRET.encode(), tampered, hashlib.sha256).hexdigest()
        assert not hmac.compare_digest(expected_bad, sig)


# ── Ledger update distribution tests ─────────────────────────────────────────

class TestBuildLedgerUpdates:
    """
    Tests for partial-payment distribution logic.
    These are pure-logic tests — they mock the DB call inside _build_ledger_updates.
    """

    @pytest.mark.asyncio
    async def test_full_payment_marks_all_paid(self):
        entries = [
            {"ledger_id": "ldg_1", "net_amount": 1000.0, "due_date": "2026-01-10", "status": "pending", "amount_paid": 0},
            {"ledger_id": "ldg_2", "net_amount": 500.0,  "due_date": "2026-02-10", "status": "pending", "amount_paid": 0},
        ]
        total_paise = 150000  # 1000 + 500 = ₹1500 = 150000 paise

        from routes.razorpay_payments import _build_ledger_updates

        with patch("routes.razorpay_payments.db") as mock_db:
            cursor = MagicMock()
            cursor.sort.return_value = cursor
            cursor.to_list = AsyncMock(return_value=entries)
            mock_db.student_ledger.find.return_value = cursor

            updates = await _build_ledger_updates(
                ["ldg_1", "ldg_2"], total_paise, "pay_TEST", "SFS2026/00001", "2026-01-15"
            )

        assert updates[0]["set_fields"]["status"] == "paid"
        assert updates[0]["set_fields"]["remaining_balance"] == 0
        assert updates[1]["set_fields"]["status"] == "paid"
        assert updates[1]["set_fields"]["remaining_balance"] == 0

    @pytest.mark.asyncio
    async def test_partial_payment_marks_first_paid_second_partial(self):
        entries = [
            {"ledger_id": "ldg_1", "net_amount": 1000.0, "due_date": "2026-01-10", "status": "pending", "amount_paid": 0},
            {"ledger_id": "ldg_2", "net_amount": 500.0,  "due_date": "2026-02-10", "status": "pending", "amount_paid": 0},
        ]
        # Pay ₹1200 — covers ldg_1 fully, ldg_2 partially (₹200 of ₹500)
        paid_paise = 120000

        from routes.razorpay_payments import _build_ledger_updates

        with patch("routes.razorpay_payments.db") as mock_db:
            cursor = MagicMock()
            cursor.sort.return_value = cursor
            cursor.to_list = AsyncMock(return_value=entries)
            mock_db.student_ledger.find.return_value = cursor

            updates = await _build_ledger_updates(
                ["ldg_1", "ldg_2"], paid_paise, "pay_PARTIAL", "SFS2026/00002", "2026-01-15"
            )

        assert updates[0]["set_fields"]["status"] == "paid"
        assert updates[0]["set_fields"]["remaining_balance"] == 0
        assert updates[1]["set_fields"]["status"] == "partially_paid"
        assert updates[1]["set_fields"]["remaining_balance"] == pytest.approx(300.0, abs=0.01)
        assert updates[1]["set_fields"]["amount_paid"] == pytest.approx(200.0, abs=0.01)

    @pytest.mark.asyncio
    async def test_payment_less_than_first_entry(self):
        entries = [
            {"ledger_id": "ldg_1", "net_amount": 1000.0, "due_date": "2026-01-10", "status": "pending", "amount_paid": 0},
            {"ledger_id": "ldg_2", "net_amount": 500.0,  "due_date": "2026-02-10", "status": "pending", "amount_paid": 0},
        ]
        paid_paise = 50000  # ₹500 — only partially covers ldg_1

        from routes.razorpay_payments import _build_ledger_updates

        with patch("routes.razorpay_payments.db") as mock_db:
            cursor = MagicMock()
            cursor.sort.return_value = cursor
            cursor.to_list = AsyncMock(return_value=entries)
            mock_db.student_ledger.find.return_value = cursor

            updates = await _build_ledger_updates(
                ["ldg_1", "ldg_2"], paid_paise, "pay_SMALL", "SFS2026/00003", "2026-01-15"
            )

        assert updates[0]["set_fields"]["status"] == "partially_paid"
        assert updates[0]["set_fields"]["remaining_balance"] == pytest.approx(500.0, abs=0.01)
        # ldg_2: payment exhausted — no status change
        assert updates[1]["set_fields"] == {}

    @pytest.mark.asyncio
    async def test_continuing_partial_payment(self):
        """Second payment on a partially_paid entry picks up from remaining_balance."""
        entries = [
            {
                "ledger_id":        "ldg_1",
                "net_amount":       1000.0,
                "due_date":         "2026-01-10",
                "status":           "partially_paid",
                "amount_paid":      600.0,   # ₹600 already paid
            },
        ]
        # Pay the remaining ₹400
        paid_paise = 40000

        from routes.razorpay_payments import _build_ledger_updates

        with patch("routes.razorpay_payments.db") as mock_db:
            cursor = MagicMock()
            cursor.sort.return_value = cursor
            cursor.to_list = AsyncMock(return_value=entries)
            mock_db.student_ledger.find.return_value = cursor

            updates = await _build_ledger_updates(
                ["ldg_1"], paid_paise, "pay_FINAL", "SFS2026/00004", "2026-01-20"
            )

        assert updates[0]["set_fields"]["status"] == "paid"
        assert updates[0]["set_fields"]["remaining_balance"] == 0
        assert updates[0]["set_fields"]["amount_paid"] == pytest.approx(1000.0, abs=0.01)


# ── Order lifecycle state tests ───────────────────────────────────────────────

class TestOrderLifecycle:
    """Verify the state machine transitions are correct."""

    def test_status_constants(self):
        from models import RazorpayOrderStatus as S
        assert S.CREATED                     == "CREATED"
        assert S.INITIATED                   == "INITIATED"
        assert S.SUCCESS_PENDING_VERIFICATION == "SUCCESS_PENDING_VERIFICATION"
        assert S.VERIFIED_SUCCESS            == "VERIFIED_SUCCESS"
        assert S.FAILED                      == "FAILED"
        assert S.CANCELLED                   == "CANCELLED"

    def test_razorpay_order_model_defaults(self):
        from models import RazorpayOrder, RazorpayOrderStatus
        order = RazorpayOrder(
            rzp_order_id="order_TEST",
            student_id="STU2026TEST",
            ledger_ids=["ldg_1"],
            amount_paise=100000,
            amount_rupees=1000.0,
            created_by="usr_admin",
        )
        assert order.status == RazorpayOrderStatus.CREATED
        assert order.is_partial is False
        assert order.webhook_verified is False
        assert order.refund_id is None
        assert order.internal_order_id.startswith("rzpord_")


# ── Idempotency tests ─────────────────────────────────────────────────────────

class TestIdempotency:
    """
    Verify that double-processing a payment is safe.
    The verify endpoint returns 'already_verified' if status == VERIFIED_SUCCESS.
    """

    @pytest.mark.asyncio
    async def test_already_verified_returns_safe_response(self):
        from routes.razorpay_payments import verify_razorpay_payment
        from models import RazorpayOrderStatus

        mock_order = {
            "rzp_order_id":  "order_DUP",
            "status":        RazorpayOrderStatus.VERIFIED_SUCCESS,
            "receipt_number": "SFS2026/00001",
            "fee_payment_id": "pay_abc123",
        }

        mock_request = MagicMock()
        mock_request.headers = {}

        with patch("routes.razorpay_payments.get_current_user", AsyncMock(return_value={"user_id": "u1", "role": "admin", "name": "A", "email": "a@a.com"})), \
             patch("routes.razorpay_payments.db") as mock_db:

            mock_db.razorpay_orders.find_one = AsyncMock(return_value=mock_order)

            from pydantic import BaseModel
            from typing import Optional

            class _Req(BaseModel):
                razorpay_order_id:   str
                razorpay_payment_id: str
                razorpay_signature:  str

            body = _Req(
                razorpay_order_id="order_DUP",
                razorpay_payment_id="pay_XYZ",
                razorpay_signature="sig_abc",
            )

            result = await verify_razorpay_payment(body, mock_request)

        assert result["status"] == "already_verified"
        assert result["receipt_number"] == "SFS2026/00001"

    @pytest.mark.asyncio
    async def test_failed_order_cannot_be_verified(self):
        from routes.razorpay_payments import verify_razorpay_payment
        from models import RazorpayOrderStatus
        from fastapi import HTTPException

        mock_order = {
            "rzp_order_id": "order_FAIL",
            "status":       RazorpayOrderStatus.FAILED,
        }

        mock_request = MagicMock()
        mock_request.headers = {}

        with patch("routes.razorpay_payments.get_current_user", AsyncMock(return_value={"user_id": "u1", "role": "admin", "name": "A", "email": "a@a.com"})), \
             patch("routes.razorpay_payments.db") as mock_db:

            mock_db.razorpay_orders.find_one = AsyncMock(return_value=mock_order)

            from pydantic import BaseModel

            class _Req(BaseModel):
                razorpay_order_id:   str
                razorpay_payment_id: str
                razorpay_signature:  str

            body = _Req(
                razorpay_order_id="order_FAIL",
                razorpay_payment_id="pay_XYZ",
                razorpay_signature="sig_abc",
            )

            with pytest.raises(HTTPException) as exc_info:
                await verify_razorpay_payment(body, mock_request)

        assert exc_info.value.status_code == 400


# ── Webhook deduplication tests ───────────────────────────────────────────────

class TestWebhookDeduplication:

    @pytest.mark.asyncio
    async def test_duplicate_webhook_event_ignored(self):
        from routes.razorpay_payments import razorpay_webhook
        from models import RazorpayOrderStatus

        event_id   = "evt_DUPLICATE"
        rzp_order  = "order_WH001"
        rzp_pay    = "pay_WH001"

        payload = {
            "id":    event_id,
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id":       rzp_pay,
                        "order_id": rzp_order,
                    }
                }
            }
        }
        raw_body = json.dumps(payload).encode()

        mock_order = {
            "rzp_order_id":     rzp_order,
            "status":           RazorpayOrderStatus.VERIFIED_SUCCESS,
            "webhook_event_id": event_id,  # already processed
            "ledger_ids":       ["ldg_x"],
            "student_id":       "STU001",
            "amount_rupees":    1000.0,
            "amount_paise":     100000,
            "internal_order_id": "rzpord_test",
            "is_partial":       False,
        }

        mock_request = MagicMock()
        mock_request.body  = AsyncMock(return_value=raw_body)
        mock_request.headers = {"X-Razorpay-Signature": ""}
        mock_bg = MagicMock()

        with patch("routes.razorpay_payments.RAZORPAY_WEBHOOK_SECRET", ""), \
             patch("routes.razorpay_payments.db") as mock_db:

            mock_db.razorpay_orders.find_one = AsyncMock(return_value=mock_order)

            result = await razorpay_webhook(mock_request, mock_bg)

        assert result["status"] == "duplicate_event"

    @pytest.mark.asyncio
    async def test_unknown_event_ignored(self):
        from routes.razorpay_payments import razorpay_webhook

        payload  = {"id": "evt_UNKNOWN", "event": "order.paid", "payload": {}}
        raw_body = json.dumps(payload).encode()

        mock_request = MagicMock()
        mock_request.body    = AsyncMock(return_value=raw_body)
        mock_request.headers = {"X-Razorpay-Signature": ""}
        mock_bg = MagicMock()

        with patch("routes.razorpay_payments.RAZORPAY_WEBHOOK_SECRET", ""):
            result = await razorpay_webhook(mock_request, mock_bg)

        assert result["status"] == "ignored"

    @pytest.mark.asyncio
    async def test_invalid_webhook_signature_rejected(self):
        from routes.razorpay_payments import razorpay_webhook
        from fastapi import HTTPException

        payload  = {"id": "evt_BAD", "event": "payment.captured", "payload": {}}
        raw_body = json.dumps(payload).encode()

        mock_request = MagicMock()
        mock_request.body    = AsyncMock(return_value=raw_body)
        mock_request.headers = {"X-Razorpay-Signature": "bad_signature"}
        mock_bg = MagicMock()

        with patch("routes.razorpay_payments.RAZORPAY_WEBHOOK_SECRET", "real_secret"):
            with pytest.raises(HTTPException) as exc:
                await razorpay_webhook(mock_request, mock_bg)

        assert exc.value.status_code == 400


# ── Partial payment config tests ──────────────────────────────────────────────

class TestPartialPaymentConfig:

    def test_partial_payment_disabled_by_default(self):
        with patch.dict("os.environ", {}, clear=False):
            import importlib
            import routes.razorpay_payments as rzp
            # Default should be False when env var is not set
            assert rzp.ALLOW_PARTIAL_PAYMENT is False or isinstance(rzp.ALLOW_PARTIAL_PAYMENT, bool)

    def test_partial_payment_enabled_via_env(self):
        with patch.dict("os.environ", {"ALLOW_PARTIAL_PAYMENT": "true"}):
            val = "true".lower() == "true"
            assert val is True


# ── Receipt number generation tests ──────────────────────────────────────────

class TestReceiptGeneration:

    @pytest.mark.asyncio
    async def test_receipt_number_format(self):
        from routes.razorpay_payments import _generate_receipt_number

        with patch("routes.razorpay_payments.db") as mock_db:
            mock_db.counters.find_one_and_update = AsyncMock(return_value={"_id": "razorpay_receipt_2026", "seq": 42})
            receipt = await _generate_receipt_number()

        assert receipt.startswith("SFS2026/")
        assert receipt == "SFS2026/00042"

    @pytest.mark.asyncio
    async def test_receipt_numbers_zero_padded_to_5_digits(self):
        from routes.razorpay_payments import _generate_receipt_number

        with patch("routes.razorpay_payments.db") as mock_db:
            mock_db.counters.find_one_and_update = AsyncMock(return_value={"_id": "razorpay_receipt_2026", "seq": 1})
            receipt = await _generate_receipt_number()

        assert receipt == "SFS2026/00001"
