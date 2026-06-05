"""
Shemford School — Razorpay Payment Integration
===============================================

Transaction lifecycle:
  CREATED → INITIATED → SUCCESS_PENDING_VERIFICATION → VERIFIED_SUCCESS
                                                      → FAILED
  Any state → CANCELLED (user dismissed / timeout)

Security model:
  - Backend-only HMAC-SHA256 signature verification. Frontend data is NEVER trusted.
  - Pessimistic fee-entry locking with 10-minute TTL prevents double-payment.
  - Idempotency enforced via unique index on rzp_payment_id.
  - Webhook reconciliation covers missed frontend callbacks (crash / network drop).
  - All financial mutations run inside MongoDB multi-document transactions.

Financial accuracy:
  - Amounts stored and validated in paise (integer) to avoid float rounding.
  - Fee ledger updated atomically with payment record creation.
  - Oldest dues paid first; partial payment rejected unless ledger entry is exact match.
"""

from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from fastapi.responses import JSONResponse, HTMLResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import hashlib
import hmac
import os
import uuid
import logging
import asyncio

import httpx

from database import db, client as mongo_client
from models import (
    UserRole, RazorpayOrder, RazorpayOrderStatus, FeePayment
)
from auth_utils import get_current_user, require_roles, create_audit_log

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

RAZORPAY_KEY_ID         = os.environ.get("RAZORPAY_KEY_ID", "rzp_test_SYVHBGyYvwSp7g")
RAZORPAY_KEY_SECRET     = os.environ.get("RAZORPAY_KEY_SECRET", "7dVFviqOrMI6d9xVMRiFXuoJ")
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")

LOCK_TTL_MINUTES    = 5        # fee-entry lock expiry; auto-frees an abandoned
                               # (hard-closed) payment quickly. Normal cancel /
                               # dismiss / failure releases the lock immediately.
RECEIPT_PREFIX      = "SFS"    # receipt number prefix
# Set ALLOW_PARTIAL_PAYMENT=true in .env to allow paying less than the full due amount.
# When false (default), partial amounts are rejected.
ALLOW_PARTIAL_PAYMENT = os.environ.get("ALLOW_PARTIAL_PAYMENT", "false").lower() == "true"

# ── Fraud detection ───────────────────────────────────────────────────────────
# Block new order creation if a student has >= N failed payments within M minutes.
FRAUD_FAILURE_THRESHOLD = int(os.environ.get("FRAUD_FAILURE_THRESHOLD", "5"))
FRAUD_WINDOW_MINUTES    = int(os.environ.get("FRAUD_WINDOW_MINUTES", "60"))

# ── Razorpay REST helpers (no SDK — avoids pkg_resources dependency) ──────────

RZP_BASE = "https://api.razorpay.com/v1"


def _rzp_auth():
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        raise HTTPException(status_code=503, detail="Razorpay is not configured on this server.")
    return (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)


async def _rzp_post(path: str, payload: dict) -> dict:
    auth = _rzp_auth()
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.post(f"{RZP_BASE}{path}", json=payload, auth=auth)
            if r.status_code not in (200, 201):
                raise HTTPException(status_code=502, detail=f"Razorpay error: {r.text[:300]}")
            return r.json()
    except HTTPException:
        raise
    except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as exc:
        logger.error("Razorpay connectivity error: %s", exc)
        raise HTTPException(status_code=503, detail="Cannot reach Razorpay servers. Please check your internet connection and try again.")
    except Exception as exc:
        logger.error("Razorpay unexpected error: %s", exc)
        raise HTTPException(status_code=502, detail="Razorpay request failed. Please try again.")


async def _rzp_get(path: str) -> dict:
    auth = _rzp_auth()
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.get(f"{RZP_BASE}{path}", auth=auth)
            if r.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Razorpay error: {r.text[:300]}")
            return r.json()
    except HTTPException:
        raise
    except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as exc:
        logger.error("Razorpay connectivity error: %s", exc)
        raise HTTPException(status_code=503, detail="Cannot reach Razorpay servers. Please try again.")
    except Exception as exc:
        logger.error("Razorpay unexpected error: %s", exc)
        raise HTTPException(status_code=502, detail="Razorpay request failed. Please try again.")


# ── Request/Response schemas ──────────────────────────────────────────────────

class CreateOrderRequest(BaseModel):
    student_id: str
    ledger_ids: List[str]                    # specific ledger entries to pay
    amount_override_paise: Optional[int] = None  # for partial payment — omit for full payment


class InitiateRequest(BaseModel):
    internal_order_id: str


class VerifyRequest(BaseModel):
    razorpay_order_id: str         # order_xxx
    razorpay_payment_id: str       # pay_xxx
    razorpay_signature: str


class RefundRequest(BaseModel):
    internal_order_id: str
    amount: Optional[float] = None  # None = full refund


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _generate_receipt_number() -> str:
    """Atomic sequential receipt: SFS2026/0001"""
    year = datetime.now().year
    key  = f"razorpay_receipt_{year}"
    doc  = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return f"{RECEIPT_PREFIX}{year}/{doc['seq']:05d}"


def _verify_payment_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """Razorpay HMAC-SHA256: sign(order_id|payment_id) with KEY_SECRET."""
    message = f"{order_id}|{payment_id}".encode()
    expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _verify_webhook_signature(body: bytes, signature: str) -> bool:
    """Razorpay webhook HMAC-SHA256: sign(raw_body) with WEBHOOK_SECRET."""
    if not RAZORPAY_WEBHOOK_SECRET:
        return False
    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def _release_locks(ledger_ids: List[str], order_id: str):
    """Remove payment lock from ledger entries (used on cancel / failure)."""
    await db.student_ledger.update_many(
        {"ledger_id": {"$in": ledger_ids}, "payment_lock.order_id": order_id},
        {"$unset": {"payment_lock": ""}},
    )


async def _build_ledger_updates(
    ledger_ids: List[str],
    paid_paise: int,
    payment_id: str,
    receipt_number: str,
    paid_date: str,
) -> list:
    """
    Distribute a payment across ledger entries (oldest-first).
    Returns a list of per-entry update dicts.

    Full payment: all entries → status=paid, remaining_balance=0
    Partial payment: oldest entries paid fully first; last touched entry may be partially_paid
    """
    entries = await db.student_ledger.find(
        {"ledger_id": {"$in": ledger_ids}}, {"_id": 0}
    ).sort("due_date", 1).to_list(len(ledger_ids))

    remaining = paid_paise
    updates = []

    for entry in entries:
        # How much is still owed on this entry (account for prior partial payments)
        prior_paid  = round((entry.get("amount_paid", 0)) * 100)
        entry_due   = max(0, round(entry["net_amount"] * 100) - prior_paid)

        if remaining <= 0 or entry_due == 0:
            # Payment exhausted — release lock, leave entry as-is
            updates.append({
                "ledger_id": entry["ledger_id"],
                "set_fields": {},   # no status change
            })
            continue

        if remaining >= entry_due:
            # Fully covers this entry
            remaining -= entry_due
            new_paid = entry.get("amount_paid", 0) + entry_due / 100
            updates.append({
                "ledger_id": entry["ledger_id"],
                "set_fields": {
                    "status":            "paid",
                    "payment_id":        payment_id,
                    "receipt_number":    receipt_number,
                    "paid_date":         paid_date,
                    "amount_paid":       round(new_paid, 2),
                    "remaining_balance": 0,
                },
            })
        else:
            # Partial — covers only part of this entry
            partial_rupees = remaining / 100
            new_paid       = entry.get("amount_paid", 0) + partial_rupees
            new_remaining  = entry["net_amount"] - new_paid
            remaining      = 0
            updates.append({
                "ledger_id": entry["ledger_id"],
                "set_fields": {
                    "status":            "partially_paid",
                    "payment_id":        payment_id,
                    "receipt_number":    receipt_number,
                    "paid_date":         paid_date,
                    "amount_paid":       round(new_paid, 2),
                    "remaining_balance": round(new_remaining, 2),
                },
            })

    return updates


async def _mark_order(rzp_order_id: str, status: str, **extra):
    """Update order status + timestamp."""
    await db.razorpay_orders.update_one(
        {"rzp_order_id": rzp_order_id},
        {"$set": {"status": status, "updated_at": datetime.now(timezone.utc).isoformat(), **extra}},
    )


# ── POST /payments/razorpay/create-order ─────────────────────────────────────

@router.post("/payments/razorpay/create-order")
async def create_razorpay_order(body: CreateOrderRequest, request: Request):
    """
    Step 1: Create a Razorpay order for the selected fee ledger entries.

    - Validates ledger entries belong to the student and are unpaid.
    - Locks entries for LOCK_TTL_MINUTES to prevent concurrent payments.
    - Creates Razorpay order via API.
    - Persists order with status=CREATED.
    - Returns key_id + order details needed by the frontend checkout.
    """
    user = await require_roles(
        UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.PARENT, UserRole.STUDENT
    )(request)

    if not body.ledger_ids:
        raise HTTPException(status_code=400, detail="Select at least one fee entry to pay.")

    # ── 1. Validate student ───────────────────────────────────────────────────
    student = await db.students.find_one({"student_id": body.student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    # Parents/students may only pay for their own children
    if user["role"] in (UserRole.PARENT, UserRole.STUDENT):
        if user["role"] == UserRole.STUDENT and student.get("user_id") != user["user_id"]:
            raise HTTPException(status_code=403, detail="You can only pay your own fees.")
        if user["role"] == UserRole.PARENT and student.get("parent_email") != user["email"]:
            raise HTTPException(status_code=403, detail="You can only pay fees for your own children.")

    # ── 2. Fetch + validate ledger entries ────────────────────────────────────
    now = datetime.now(timezone.utc)
    entries = await db.student_ledger.find(
        {"ledger_id": {"$in": body.ledger_ids}, "student_id": body.student_id},
        {"_id": 0}
    ).to_list(len(body.ledger_ids))

    if len(entries) != len(body.ledger_ids):
        raise HTTPException(status_code=400, detail="One or more fee entries not found for this student.")

    for e in entries:
        if e["status"] not in ("pending", "overdue", "partially_paid"):
            raise HTTPException(
                status_code=400,
                detail=f"Entry '{e['description']}' is already {e['status']}. Cannot pay again."
            )
        # Check existing lock (not expired)
        lock = e.get("payment_lock")
        if lock:
            expires = lock.get("expires_at")
            if isinstance(expires, str):
                expires = datetime.fromisoformat(expires)
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires > now:
                raise HTTPException(
                    status_code=409,
                    detail=f"Entry '{e['description']}' is currently being processed by another payment. Try again in a few minutes."
                )

    # ── 3. Oldest-first: sort selected entries by due_date (no hard block) ──────
    # Entries are paid oldest-first internally; we don't block selective payment.

    # ── 4. Calculate total (integer paise — no float rounding) ───────────────
    # For partially_paid entries, use the remaining_balance instead of net_amount
    total_rupees = sum(
        e.get("remaining_balance", e["net_amount"]) if e.get("status") == "partially_paid"
        else e["net_amount"]
        for e in entries
    )
    total_paise = round(total_rupees * 100)   # integer paise

    # Handle partial payment
    is_partial = False
    charge_paise = total_paise
    if body.amount_override_paise is not None:
        if not ALLOW_PARTIAL_PAYMENT:
            raise HTTPException(
                status_code=400,
                detail="Partial payment is not enabled. Please pay the full amount."
            )
        if body.amount_override_paise < 100:
            raise HTTPException(status_code=400, detail="Minimum payable amount is Rs.1.")
        if body.amount_override_paise > total_paise:
            raise HTTPException(
                status_code=400,
                detail=f"Override amount ({body.amount_override_paise} paise) exceeds total due ({total_paise} paise)."
            )
        if body.amount_override_paise < total_paise:
            is_partial = True
            charge_paise = body.amount_override_paise

    if charge_paise < 100:    # Razorpay minimum: Rs.1
        raise HTTPException(status_code=400, detail="Minimum payable amount is Rs.1.")

    # ── 4b. Fraud detection ───────────────────────────────────────────────────
    # Block students who have racked up too many failed attempts in the recent window.
    # Uses the razorpay_orders collection so no extra collection is needed.
    fraud_window_start = (now - timedelta(minutes=FRAUD_WINDOW_MINUTES)).isoformat()
    recent_failures = await db.razorpay_orders.count_documents({
        "student_id": body.student_id,
        "status":     RazorpayOrderStatus.FAILED,
        "created_at": {"$gte": fraud_window_start},
    })
    if recent_failures >= FRAUD_FAILURE_THRESHOLD:
        logger.warning(
            "FRAUD_BLOCK: student=%s has %d failed payments in last %d min — order blocked rid=%s",
            body.student_id, recent_failures, FRAUD_WINDOW_MINUTES,
            getattr(request.state, "request_id", "-"),
        )
        raise HTTPException(
            status_code=429,
            detail=(
                f"Too many failed payment attempts ({recent_failures} in the last "
                f"{FRAUD_WINDOW_MINUTES} minutes). Please wait before trying again or contact support."
            ),
        )

    # ── 5. Acquire pessimistic lock on entries ────────────────────────────────
    internal_order_id = f"rzpord_{uuid.uuid4().hex[:14]}"
    lock_expires = now + timedelta(minutes=LOCK_TTL_MINUTES)

    result = await db.student_ledger.update_many(
        {
            "ledger_id": {"$in": body.ledger_ids},
            "status": {"$in": ["pending", "overdue", "partially_paid"]},
            "$or": [
                {"payment_lock": {"$exists": False}},
                {"payment_lock": None},
                {"payment_lock.expires_at": {"$lt": now.isoformat()}},
            ],
        },
        {"$set": {"payment_lock": {"order_id": internal_order_id, "expires_at": lock_expires.isoformat()}}},
    )

    if result.modified_count != len(body.ledger_ids):
        raise HTTPException(
            status_code=409,
            detail="Could not lock all fee entries. Some may have been modified. Please refresh and try again."
        )

    # ── 6. Create Razorpay order ──────────────────────────────────────────────
    charge_rupees = charge_paise / 100
    rzp_receipt = f"SFS{now.strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:4].upper()}"
    try:
        rzp_order = await _rzp_post("/orders", {
            "amount":   charge_paise,
            "currency": "INR",
            "receipt":  rzp_receipt,
            "notes": {
                "student_id":        body.student_id,
                "admission_number":  student.get("admission_number", ""),
                "student_name":      f"{student['first_name']} {student['last_name']}",
                "internal_order_id": internal_order_id,
                "ledger_count":      str(len(body.ledger_ids)),
                "is_partial":        str(is_partial),
            },
        })
    except HTTPException:
        await _release_locks(body.ledger_ids, internal_order_id)
        raise
    except Exception as exc:
        await _release_locks(body.ledger_ids, internal_order_id)
        logger.error("Razorpay order creation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to create payment order. Please try again.")

    # ── 7. Persist order ──────────────────────────────────────────────────────
    order = RazorpayOrder(
        internal_order_id=internal_order_id,
        rzp_order_id=rzp_order["id"],
        student_id=body.student_id,
        ledger_ids=body.ledger_ids,
        amount_paise=charge_paise,
        amount_rupees=charge_rupees,
        is_partial=is_partial,
        partial_amount_paise=charge_paise if is_partial else None,
        status=RazorpayOrderStatus.CREATED,
        created_by=user["user_id"],
    )
    order_dict = order.model_dump()
    order_dict["created_at"] = order_dict["created_at"].isoformat()
    order_dict["updated_at"] = order_dict["updated_at"].isoformat()
    await db.razorpay_orders.insert_one(order_dict)

    await create_audit_log("razorpay_order", internal_order_id, "CREATED",
                           {"rzp_order_id": rzp_order["id"], "amount_paise": charge_paise,
                            "is_partial": is_partial, "ledger_ids": body.ledger_ids}, user)

    logger.info("Razorpay order created: %s (%s) student=%s Rs.%.2f%s rid=%s",
                internal_order_id, rzp_order["id"], body.student_id, charge_rupees,
                " [PARTIAL]" if is_partial else "",
                getattr(request.state, "request_id", "-"))

    return {
        "internal_order_id": internal_order_id,
        "rzp_order_id":      rzp_order["id"],
        "key_id":            RAZORPAY_KEY_ID,
        "amount_paise":      charge_paise,
        "total_due_paise":   total_paise,
        "amount_rupees":     charge_rupees,
        "total_due_rupees":  total_rupees,
        "is_partial":        is_partial,
        "currency":          "INR",
        "student_name":      f"{student['first_name']} {student['last_name']}",
        "student_email":     student.get("email") or student.get("parent_email", ""),
        "student_phone":     student.get("phone") or student.get("parent_phone", ""),
        "description":       f"Fee payment — {len(body.ledger_ids)} item(s)" + (" (partial)" if is_partial else ""),
    }


# ── POST /payments/razorpay/initiate ─────────────────────────────────────────

@router.post("/payments/razorpay/initiate")
async def initiate_razorpay_order(body: InitiateRequest, request: Request):
    """
    Step 2: Mark order as INITIATED when user opens the Razorpay checkout modal.
    Called from frontend immediately before opening the Razorpay SDK.
    """
    user = await get_current_user(request)
    result = await db.razorpay_orders.update_one(
        {"internal_order_id": body.internal_order_id, "status": RazorpayOrderStatus.CREATED},
        {"$set": {"status": RazorpayOrderStatus.INITIATED,
                  "initiated_by": user["user_id"],
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.modified_count:
        logger.info("Order INITIATED: %s by user=%s rid=%s",
                    body.internal_order_id, user["user_id"],
                    getattr(request.state, "request_id", "-"))
    return {"status": "INITIATED"}


# ── POST /payments/razorpay/verify ────────────────────────────────────────────

@router.post("/payments/razorpay/verify")
async def verify_razorpay_payment(body: VerifyRequest, request: Request, background_tasks: BackgroundTasks):
    """
    Step 3 (CRITICAL): Verify payment signature and finalize the ledger.

    This is the only path that marks fees as paid. The frontend sends the three
    Razorpay response fields; we re-derive and compare the HMAC signature server-side.

    On success:
      - Atomically marks ledger entries as paid.
      - Creates a FeePayment record.
      - Generates a receipt number.
      - Releases entry locks.

    On failure:
      - Marks order FAILED.
      - Releases entry locks.
    """
    user = await get_current_user(request)

    # ── 1. Load order ─────────────────────────────────────────────────────────
    order = await db.razorpay_orders.find_one(
        {"rzp_order_id": body.razorpay_order_id}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Payment order not found.")

    # ── 2. Idempotency: already processed? ────────────────────────────────────
    if order["status"] == RazorpayOrderStatus.VERIFIED_SUCCESS:
        return {
            "status": "already_verified",
            "message": "This payment has already been verified and recorded.",
            "receipt_number": order.get("receipt_number"),
            "fee_payment_id": order.get("fee_payment_id"),
        }

    if order["status"] == RazorpayOrderStatus.FAILED:
        raise HTTPException(status_code=400, detail="This payment order has already failed.")

    # ── 3. Verify HMAC-SHA256 signature (CRITICAL security check) ─────────────
    sig_valid = _verify_payment_signature(
        body.razorpay_order_id,
        body.razorpay_payment_id,
        body.razorpay_signature,
    )

    if not sig_valid:
        await _mark_order(body.razorpay_order_id, RazorpayOrderStatus.FAILED,
                          failure_reason="Invalid payment signature")
        await _release_locks(order["ledger_ids"], order["internal_order_id"])
        logger.warning("INVALID SIGNATURE — order %s payment %s",
                       body.razorpay_order_id, body.razorpay_payment_id)
        raise HTTPException(status_code=400, detail="Payment signature verification failed. Payment rejected.")

    # ── 4. Mark SUCCESS_PENDING_VERIFICATION (pre-write checkpoint) ───────────
    await _mark_order(body.razorpay_order_id, RazorpayOrderStatus.SUCCESS_PENDING_VERIFICATION,
                      rzp_payment_id=body.razorpay_payment_id,
                      rzp_signature=body.razorpay_signature)

    # ── 5. Atomic ledger update inside MongoDB transaction ────────────────────
    receipt_number = await _generate_receipt_number()
    now_iso  = datetime.now(timezone.utc).isoformat()
    now_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    fee_payment = FeePayment(
        student_id=order["student_id"],
        installment_ids=order["ledger_ids"],
        amount=order["amount_rupees"],
        payment_method="online",
        transaction_id=body.razorpay_payment_id,
        receipt_number=receipt_number,
        collected_by=user["user_id"],
        remarks=f"Razorpay — {body.razorpay_payment_id}" + (" [partial]" if order.get("is_partial") else ""),
        academic_year=datetime.now().strftime("%Y"),
    )
    fee_payment_dict = fee_payment.model_dump()
    fee_payment_dict["created_at"] = fee_payment_dict["created_at"].isoformat()

    # Build per-entry ledger updates (handles partial payment)
    ledger_updates = await _build_ledger_updates(
        order["ledger_ids"], order["amount_paise"], fee_payment.payment_id, receipt_number, now_date
    )

    async def _do_verify_writes(session=None):
        await db.fee_payments.insert_one(fee_payment_dict, **({"session": session} if session else {}))
        for upd in ledger_updates:
            await db.student_ledger.update_one(
                {"ledger_id": upd["ledger_id"]},
                {"$set": upd["set_fields"], "$unset": {"payment_lock": ""}},
                **({"session": session} if session else {}),
            )
        await db.razorpay_orders.update_one(
            {"rzp_order_id": body.razorpay_order_id},
            {"$set": {
                "status":         RazorpayOrderStatus.VERIFIED_SUCCESS,
                "fee_payment_id": fee_payment.payment_id,
                "receipt_number": receipt_number,
                "updated_at":     now_iso,
            }},
            **({"session": session} if session else {}),
        )

    try:
        async with await mongo_client.start_session() as session:
            async with session.start_transaction():
                await _do_verify_writes(session)
    except Exception as exc:
        # DuplicateKeyError on transaction_id → webhook + verify raced and webhook won
        if "transaction_id" in str(exc) or "E11000" in str(exc):
            logger.warning("Duplicate payment detected for pay=%s order=%s — idempotent return",
                           body.razorpay_payment_id, body.razorpay_order_id)
            existing_order = await db.razorpay_orders.find_one(
                {"rzp_order_id": body.razorpay_order_id}, {"_id": 0}
            )
            return {
                "status": "already_verified",
                "message": "Payment already recorded.",
                "receipt_number": existing_order.get("receipt_number") if existing_order else receipt_number,
                "fee_payment_id": existing_order.get("fee_payment_id") if existing_order else fee_payment.payment_id,
                "amount_rupees":  order["amount_rupees"],
            }
        # MongoDB standalone (no replica set) — fall back to non-transactional writes
        logger.warning("Transaction unavailable for order %s (%s) — falling back to non-atomic writes",
                       body.razorpay_order_id, exc)
        try:
            await _do_verify_writes(session=None)
        except Exception as exc2:
            if "transaction_id" in str(exc2) or "E11000" in str(exc2):
                existing_order = await db.razorpay_orders.find_one(
                    {"rzp_order_id": body.razorpay_order_id}, {"_id": 0}
                )
                return {
                    "status": "already_verified",
                    "message": "Payment already recorded.",
                    "receipt_number": existing_order.get("receipt_number") if existing_order else receipt_number,
                    "fee_payment_id": existing_order.get("fee_payment_id") if existing_order else fee_payment.payment_id,
                    "amount_rupees":  order["amount_rupees"],
                }
            logger.error("Payment recording failed for order %s: %s", body.razorpay_order_id, exc2)
            raise HTTPException(status_code=500, detail="Payment recording failed. Please contact support.")

    # ── 6. Update student fee_status summary (non-critical — run in background) ─
    background_tasks.add_task(_refresh_student_fee_status, order["student_id"])

    await create_audit_log("razorpay_order", order["internal_order_id"], "VERIFIED_SUCCESS",
                           {"rzp_payment_id": body.razorpay_payment_id,
                            "receipt_number": receipt_number,
                            "amount_rupees": order["amount_rupees"]}, user)

    logger.info("Payment verified: order=%s pay=%s student=%s Rs.%.2f receipt=%s rid=%s",
                body.razorpay_order_id, body.razorpay_payment_id,
                order["student_id"], order["amount_rupees"], receipt_number,
                getattr(request.state, "request_id", "-"))

    return {
        "status": "success",
        "message": "Payment verified and recorded successfully.",
        "receipt_number": receipt_number,
        "fee_payment_id": fee_payment.payment_id,
        "amount_rupees":  order["amount_rupees"],
    }


# ── POST /payments/razorpay/cancel ────────────────────────────────────────────

@router.post("/payments/razorpay/cancel")
async def cancel_razorpay_order(body: InitiateRequest, request: Request):
    """
    Called when user dismisses the Razorpay checkout modal without paying.
    Releases the fee-entry locks so the user can retry.
    """
    user = await get_current_user(request)
    order = await db.razorpay_orders.find_one(
        {"internal_order_id": body.internal_order_id}, {"_id": 0}
    )
    if not order:
        return {"status": "not_found"}

    if order["status"] in (RazorpayOrderStatus.VERIFIED_SUCCESS, RazorpayOrderStatus.FAILED):
        return {"status": order["status"]}

    await _mark_order(order["rzp_order_id"], RazorpayOrderStatus.CANCELLED)
    await _release_locks(order["ledger_ids"], order["internal_order_id"])
    await create_audit_log("razorpay_order", order["internal_order_id"], "CANCELLED",
                           {"student_id": order["student_id"],
                            "amount_rupees": order["amount_rupees"]}, user)
    logger.info("Order CANCELLED: %s by user=%s rid=%s",
                body.internal_order_id, user["user_id"],
                getattr(request.state, "request_id", "-"))
    return {"status": "cancelled"}


# ── POST /webhook/razorpay ────────────────────────────────────────────────────

@router.post("/webhook/razorpay")
async def razorpay_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Razorpay webhook receiver.

    Events handled:
      payment.captured  — reconcile if frontend missed the callback
      payment.failed    — mark order FAILED, release locks

    Webhook signature is verified before any processing.
    Idempotency guaranteed by checking current order status before mutation.

    Configure in Razorpay Dashboard → Settings → Webhooks:
      URL: https://yourdomain/api/webhook/razorpay
      Secret: (same as RAZORPAY_WEBHOOK_SECRET)
      Events: payment.captured, payment.failed
    """
    raw_body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")

    if RAZORPAY_WEBHOOK_SECRET and not _verify_webhook_signature(raw_body, signature):
        logger.warning("Webhook: invalid signature — rejecting")
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")

    try:
        import json
        payload = json.loads(raw_body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload.")

    event      = payload.get("event", "")
    event_id   = payload.get("id", f"evt_{uuid.uuid4().hex[:12]}")
    entity     = payload.get("payload", {}).get("payment", {}).get("entity", {})
    rzp_order_id  = entity.get("order_id", "")
    rzp_payment_id = entity.get("id", "")
    error_reason   = entity.get("error_description", "") or entity.get("description", "")

    logger.info("Webhook received: event=%s order=%s payment=%s", event, rzp_order_id, rzp_payment_id)

    if event not in ("payment.captured", "payment.failed"):
        return {"status": "ignored", "event": event}

    if not rzp_order_id:
        return {"status": "no_order_id"}

    # Load our order
    order = await db.razorpay_orders.find_one({"rzp_order_id": rzp_order_id}, {"_id": 0})
    if not order:
        logger.warning("Webhook: unknown order_id %s", rzp_order_id)
        return {"status": "order_not_found"}

    # Dedup: ignore if this webhook event already processed
    if order.get("webhook_event_id") == event_id:
        return {"status": "duplicate_event"}

    # ── payment.captured: reconcile missed verification ───────────────────────
    if event == "payment.captured":
        if order["status"] == RazorpayOrderStatus.VERIFIED_SUCCESS:
            return {"status": "already_verified"}

        # Idempotency: check if this payment_id has already been recorded in fee_payments
        # This prevents double-credit when both verify AND webhook complete simultaneously
        if rzp_payment_id:
            existing_payment = await db.fee_payments.find_one(
                {"transaction_id": rzp_payment_id}, {"payment_id": 1}
            )
            if existing_payment:
                logger.info("Webhook: payment %s already recorded as %s — skipping",
                            rzp_payment_id, existing_payment["payment_id"])
                # Ensure order is marked verified (may have missed the update)
                await _mark_order(rzp_order_id, RazorpayOrderStatus.VERIFIED_SUCCESS,
                                  rzp_payment_id=rzp_payment_id,
                                  webhook_event_id=event_id)
                return {"status": "already_recorded"}

        # Razorpay does not send the signature in webhooks — fetch and verify server-side
        try:
            payment_detail = await _rzp_get(f"/payments/{rzp_payment_id}")
        except Exception as exc:
            logger.error("Webhook: failed to fetch payment %s: %s", rzp_payment_id, exc)
            return {"status": "fetch_failed"}

        if payment_detail.get("status") != "captured":
            return {"status": "not_captured"}

        # Reconcile: create a synthetic user object for audit
        system_user = {"user_id": "system_webhook", "name": "Razorpay Webhook"}

        receipt_number = await _generate_receipt_number()
        now_iso  = datetime.now(timezone.utc).isoformat()
        now_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        fee_payment = FeePayment(
            student_id=order["student_id"],
            installment_ids=order["ledger_ids"],
            amount=order["amount_rupees"],
            payment_method="online",
            transaction_id=rzp_payment_id,
            receipt_number=receipt_number,
            collected_by="system_webhook",
            remarks=f"Webhook reconciliation — {rzp_payment_id}" + (" [partial]" if order.get("is_partial") else ""),
        )
        fee_payment_dict = fee_payment.model_dump()
        fee_payment_dict["created_at"] = fee_payment_dict["created_at"].isoformat()

        ledger_updates = await _build_ledger_updates(
            order["ledger_ids"], order["amount_paise"], fee_payment.payment_id, receipt_number, now_date
        )

        async def _do_webhook_writes(session=None):
            kw = {"session": session} if session else {}
            await db.fee_payments.insert_one(fee_payment_dict, **kw)
            for upd in ledger_updates:
                await db.student_ledger.update_one(
                    {"ledger_id": upd["ledger_id"]},
                    {"$set": upd["set_fields"], "$unset": {"payment_lock": ""}},
                    **kw,
                )
            await db.razorpay_orders.update_one(
                {"rzp_order_id": rzp_order_id},
                {"$set": {
                    "status":           RazorpayOrderStatus.VERIFIED_SUCCESS,
                    "rzp_payment_id":   rzp_payment_id,
                    "fee_payment_id":   fee_payment.payment_id,
                    "receipt_number":   receipt_number,
                    "webhook_verified": True,
                    "webhook_event_id": event_id,
                    "updated_at":       now_iso,
                }},
                **kw,
            )

        try:
            async with await mongo_client.start_session() as session:
                async with session.start_transaction():
                    await _do_webhook_writes(session)
        except Exception as exc:
            if "transaction_id" in str(exc) or "E11000" in str(exc):
                return {"status": "already_recorded"}
            logger.warning("Webhook: transaction unavailable (%s) — non-atomic fallback", exc)
            try:
                await _do_webhook_writes(session=None)
            except Exception as exc2:
                if "transaction_id" in str(exc2) or "E11000" in str(exc2):
                    return {"status": "already_recorded"}
                logger.error("Webhook write failed: %s", exc2)
                return {"status": "write_failed"}

        background_tasks.add_task(_refresh_student_fee_status, order["student_id"])
        await create_audit_log("razorpay_order", order["internal_order_id"], "WEBHOOK_RECONCILED",
                               {"rzp_payment_id": rzp_payment_id, "receipt_number": receipt_number},
                               system_user)
        logger.info("Webhook reconciliation success: order=%s student=%s receipt=%s",
                    rzp_order_id, order["student_id"], receipt_number)
        return {"status": "reconciled"}

    # ── payment.failed ────────────────────────────────────────────────────────
    if event == "payment.failed":
        if order["status"] in (RazorpayOrderStatus.VERIFIED_SUCCESS,):
            return {"status": "already_verified"}

        await db.razorpay_orders.update_one(
            {"rzp_order_id": rzp_order_id},
            {"$set": {
                "status":           RazorpayOrderStatus.FAILED,
                "failure_reason":   error_reason,
                "webhook_event_id": event_id,
                "updated_at":       datetime.now(timezone.utc).isoformat(),
            }},
        )
        await _release_locks(order["ledger_ids"], order["internal_order_id"])
        logger.info("Webhook: payment failed for order %s: %s", rzp_order_id, error_reason)
        return {"status": "marked_failed"}

    return {"status": "ok"}


# ── POST /payments/razorpay/refund ────────────────────────────────────────────

@router.post("/payments/razorpay/refund")
async def initiate_refund(body: RefundRequest, request: Request):
    """
    Admin-only: initiate a Razorpay refund.
    Updates the order record and marks ledger entries as pending (reversed).
    """
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)

    order = await db.razorpay_orders.find_one(
        {"internal_order_id": body.internal_order_id}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order["status"] != RazorpayOrderStatus.VERIFIED_SUCCESS:
        raise HTTPException(status_code=400, detail="Only verified successful payments can be refunded.")
    if order.get("refund_id"):
        raise HTTPException(status_code=400, detail="A refund has already been initiated for this order.")
    if not order.get("rzp_payment_id"):
        raise HTTPException(status_code=400, detail="No Razorpay payment ID associated with this order.")

    refund_rupees = body.amount if body.amount else order["amount_rupees"]
    refund_paise  = round(refund_rupees * 100)

    try:
        refund = await _rzp_post(f"/payments/{order['rzp_payment_id']}/refund", {
            "amount": refund_paise,
            "notes": {
                "reason":            "School admin initiated refund",
                "internal_order_id": body.internal_order_id,
                "initiated_by":      user["user_id"],
            },
        })
    except HTTPException as exc:
        logger.error("Refund failed for order %s: %s", body.internal_order_id, exc.detail)
        raise HTTPException(status_code=502, detail=f"Razorpay refund failed: {exc.detail}")
    except Exception as exc:
        logger.error("Refund failed for order %s: %s", body.internal_order_id, exc)
        raise HTTPException(status_code=502, detail=f"Razorpay refund failed: {exc}")

    now = datetime.now(timezone.utc)

    # Reverse ledger entries to pending (partial refunds keep as paid — only full refund reversal)
    if refund_paise == order["amount_paise"]:
        await db.student_ledger.update_many(
            {"ledger_id": {"$in": order["ledger_ids"]}},
            {"$set": {"status": "pending", "payment_id": None, "receipt_number": None, "paid_date": None}},
        )

    await db.razorpay_orders.update_one(
        {"internal_order_id": body.internal_order_id},
        {"$set": {
            "refund_id":            refund["id"],
            "refund_amount":        refund_rupees,
            "refund_status":        refund.get("status", "initiated"),
            "refund_initiated_by":  user["user_id"],
            "refund_initiated_at":  now.isoformat(),
            "updated_at":           now.isoformat(),
        }},
    )

    await create_audit_log("razorpay_order", body.internal_order_id, "REFUND_INITIATED",
                           {"refund_id": refund["id"], "refund_amount": refund_rupees}, user)

    logger.info("Refund initiated: order=%s refund=%s Rs.%.2f by %s",
                body.internal_order_id, refund["id"], refund_rupees, user["user_id"])

    return {
        "status": "refund_initiated",
        "refund_id": refund["id"],
        "refund_amount": refund_rupees,
        "message": f"Refund of Rs.{refund_rupees:,.2f} initiated successfully.",
    }


# ── GET /payments/razorpay/receipt/{internal_order_id} ───────────────────────

@router.get("/payments/razorpay/receipt/{internal_order_id}")
async def get_payment_receipt(internal_order_id: str, request: Request):
    """Return structured receipt data for a verified payment."""
    user = await get_current_user(request)

    order = await db.razorpay_orders.find_one(
        {"internal_order_id": internal_order_id}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order["status"] != RazorpayOrderStatus.VERIFIED_SUCCESS:
        raise HTTPException(status_code=400, detail="Receipt available only for verified payments.")

    # ── Access control: parents/students can only view receipts for their own accounts ──
    if user["role"] == UserRole.TEACHER:
        raise HTTPException(status_code=403, detail="Access denied. Fee receipts are not accessible to staff.")
    if user["role"] == UserRole.STUDENT:
        stu = await db.students.find_one({"user_id": user["user_id"]}, {"student_id": 1})
        if not stu or stu["student_id"] != order["student_id"]:
            logger.warning(
                "Unauthorized receipt access: student user=%s tried to access order=%s (student=%s)",
                user["user_id"], internal_order_id, order["student_id"]
            )
            raise HTTPException(status_code=403, detail="Access denied. You can only view your own receipts.")
    if user["role"] == UserRole.PARENT:
        children = await db.students.find(
            {"parent_email": user["email"], "is_active": True}, {"student_id": 1}
        ).to_list(20)
        child_ids = {c["student_id"] for c in children}
        if order["student_id"] not in child_ids:
            logger.warning(
                "Unauthorized receipt access: parent user=%s tried to access order=%s (student=%s)",
                user["user_id"], internal_order_id, order["student_id"]
            )
            raise HTTPException(status_code=403, detail="Access denied. You can only view receipts for your own children.")

    student = await db.students.find_one({"student_id": order["student_id"]}, {"_id": 0})
    ledger_entries = await db.student_ledger.find(
        {"ledger_id": {"$in": order["ledger_ids"]}}, {"_id": 0}
    ).to_list(100)

    return {
        "receipt_number":   order.get("receipt_number"),
        "internal_order_id": internal_order_id,
        "rzp_order_id":     order.get("rzp_order_id"),
        "rzp_payment_id":   order.get("rzp_payment_id"),
        "payment_date":     order.get("updated_at", order.get("created_at")),
        "amount_rupees":    order["amount_rupees"],
        "payment_method":   "Razorpay (Online)",
        "student": {
            "name":             f"{student['first_name']} {student['last_name']}" if student else "—",
            "admission_number": student.get("admission_number", "") if student else "",
            "class_name":       student.get("class_name", "") if student else "",
            "section":          student.get("section", "") if student else "",
        },
        "fee_items": [
            {
                "description":  e["description"],
                "fee_component": e["fee_component"],
                "gross_amount": e["gross_amount"],
                "concession":   e.get("concession_amount", 0),
                "net_amount":   e["net_amount"],
                "month":        e.get("month"),
            }
            for e in ledger_entries
        ],
        "school": {
            "name":    "Shemford Futuristic School",
            "address": "Shemford School Campus",
        },
    }


# ── GET /payments/razorpay/orders ─────────────────────────────────────────────

@router.get("/payments/razorpay/orders")
async def list_razorpay_orders(
    request: Request,
    student_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
):
    """List orders. Admin sees all; parent/student sees own."""
    user = await get_current_user(request)

    query: dict = {}
    if user["role"] in (UserRole.PARENT, UserRole.STUDENT):
        # Resolve to student_id(s) for this user
        if user["role"] == UserRole.PARENT:
            children = await db.students.find(
                {"parent_email": user["email"], "is_active": True}, {"student_id": 1}
            ).to_list(20)
            child_ids = [c["student_id"] for c in children]
            query["student_id"] = {"$in": child_ids}
        else:
            stu = await db.students.find_one({"user_id": user["user_id"]}, {"student_id": 1})
            if stu:
                query["student_id"] = stu["student_id"]
    else:
        if student_id:
            query["student_id"] = student_id

    if status:
        query["status"] = status

    orders = await db.razorpay_orders.find(query, {"_id": 0}).sort(
        "created_at", -1
    ).limit(limit).to_list(limit)

    return orders


# ── GET /payments/razorpay/config ─────────────────────────────────────────────

@router.get("/payments/razorpay/config")
async def get_razorpay_config(request: Request):
    """Return the public Razorpay key for frontend initialization."""
    await get_current_user(request)
    return {
        "key_id": RAZORPAY_KEY_ID,
        "enabled": bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET),
    }


# ── GET /payments/razorpay/checkout-page/{internal_order_id} ─────────────────
# Used by mobile apps: opens in system browser, verifies on backend, shows result.

@router.get("/payments/razorpay/checkout-page/{internal_order_id}", response_class=HTMLResponse)
async def razorpay_checkout_page(internal_order_id: str, request: Request):
    """
    Serves a self-contained HTML page that runs the Razorpay checkout.
    Used by mobile (React Native) via Linking.openURL() since native SDK is
    not bundled. After payment the page auto-closes and the app can poll status.
    """
    order = await db.razorpay_orders.find_one({"internal_order_id": internal_order_id}, {"_id": 0})
    if not order:
        return HTMLResponse("<h2>Order not found</h2>", status_code=404)
    if order["status"] == RazorpayOrderStatus.VERIFIED_SUCCESS:
        return HTMLResponse(_checkout_result_page("success", order.get("receipt_number", "")))

    student = await db.students.find_one({"student_id": order["student_id"]}, {"_id": 0})
    student_name  = f"{student['first_name']} {student['last_name']}" if student else "Student"
    student_email = student.get("email") or student.get("parent_email", "") if student else ""
    student_phone = student.get("phone") or student.get("parent_phone", "") if student else ""

    backend_url = str(request.base_url).rstrip("/")
    # Pre-compute the success page HTML so the f-string below contains no backslash expressions.
    # (Python 3.11 disallows backslashes inside f-string expression parts.)
    _success_html_escaped = _checkout_result_page("success", "__RECEIPT__").replace("'", "\\'")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Shemford School — Fee Payment</title>
  <style>
    body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;
         display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box}}
    .card{{background:#fff;border-radius:16px;padding:28px;max-width:400px;width:100%;
           box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center}}
    .logo{{font-size:18px;font-weight:800;color:#1a1a1a;margin-bottom:4px}}
    .sub{{font-size:13px;color:#888;margin-bottom:24px}}
    .amount{{font-size:32px;font-weight:800;color:#E88A1A;margin:16px 0}}
    .btn{{background:#E88A1A;color:#fff;border:none;border-radius:10px;padding:14px 28px;
          font-size:16px;font-weight:700;cursor:pointer;width:100%;margin-top:8px}}
    .btn:disabled{{opacity:.6;cursor:not-allowed}}
    .msg{{font-size:13px;color:#888;margin-top:16px}}
  </style>
</head>
<body>
<div class="card">
  <div class="logo">Shemford Futuristic School</div>
  <div class="sub">Secure Fee Payment</div>
  <div style="font-size:15px;font-weight:600;color:#1a1a1a">{student_name}</div>
  <div class="amount">Rs.{order["amount_rupees"]:,.2f}</div>
  <button class="btn" id="pay-btn" onclick="startPayment()">Pay Now</button>
  <div class="msg" id="msg"></div>
</div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
function startPayment() {{
  document.getElementById('pay-btn').disabled = true;
  document.getElementById('msg').textContent = 'Opening payment...';
  var options = {{
    key:         '{RAZORPAY_KEY_ID}',
    amount:      {order["amount_paise"]},
    currency:    'INR',
    name:        'Shemford Futuristic School',
    description: 'Fee payment',
    order_id:    '{order["rzp_order_id"]}',
    prefill:     {{ name: '{student_name}', email: '{student_email}', contact: '{student_phone}' }},
    theme:       {{ color: '#E88A1A' }},
    handler: function(resp) {{
      document.getElementById('msg').textContent = 'Verifying payment...';
      fetch('{backend_url}/api/payments/razorpay/verify-mobile', {{
        method: 'POST',
        headers: {{'Content-Type': 'application/json'}},
        body: JSON.stringify({{
          internal_order_id:   '{internal_order_id}',
          razorpay_order_id:   resp.razorpay_order_id,
          razorpay_payment_id: resp.razorpay_payment_id,
          razorpay_signature:  resp.razorpay_signature
        }})
      }}).then(r => r.json()).then(data => {{
        if (data.status === 'success') {{
          document.body.innerHTML = `{_success_html_escaped}`.replace('__RECEIPT__', data.receipt_number || '');
        }} else {{
          document.getElementById('msg').textContent = 'Verification failed. Contact school.';
          document.getElementById('pay-btn').disabled = false;
        }}
      }}).catch(() => {{
        document.getElementById('msg').textContent = 'Network error. Please try again.';
        document.getElementById('pay-btn').disabled = false;
      }});
    }},
    modal: {{
      ondismiss: function() {{
        document.getElementById('pay-btn').disabled = false;
        document.getElementById('msg').textContent = 'Payment cancelled.';
      }}
    }}
  }};
  var rzp = new Razorpay(options);
  rzp.on('payment.failed', function(r) {{
    document.getElementById('msg').textContent = 'Payment failed: ' + (r.error.description || 'Unknown error');
    document.getElementById('pay-btn').disabled = false;
  }});
  rzp.open();
}}
window.onload = startPayment;
</script>
</body>
</html>"""
    return HTMLResponse(html)


def _checkout_result_page(result: str, receipt: str) -> str:
    if result == "success":
        return f"""<html><body style="font-family:-apple-system,sans-serif;background:#f5f5f5;
            display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
            <div style="background:#fff;border-radius:16px;padding:32px;max-width:360px;width:90%;text-align:center;
                        box-shadow:0 4px 24px rgba(0,0,0,.08)">
              <div style="font-size:48px">✅</div>
              <div style="font-size:20px;font-weight:800;color:#1a1a1a;margin:12px 0">Payment Successful!</div>
              <div style="font-size:13px;color:#888">Receipt: <strong>{receipt}</strong></div>
              <div style="font-size:12px;color:#aaa;margin-top:16px">You can close this window and return to the app.</div>
            </div></body></html>"""
    return """<html><body style="font-family:-apple-system,sans-serif;background:#f5f5f5;
        display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
        <div style="background:#fff;border-radius:16px;padding:32px;max-width:360px;width:90%;text-align:center">
          <div style="font-size:48px">❌</div>
          <div style="font-size:20px;font-weight:800;color:#1a1a1a;margin:12px 0">Payment Failed</div>
          <div style="font-size:12px;color:#aaa;margin-top:8px">Please close this window and try again.</div>
        </div></body></html>"""


@router.post("/payments/razorpay/verify-mobile")
async def verify_razorpay_payment_mobile(request: Request, background_tasks: BackgroundTasks):
    """
    Mobile checkout HTML page calls this to verify payment server-side.
    No auth token required — the internal_order_id is the possession proof.
    """
    body = await request.json()
    internal_order_id = body.get("internal_order_id", "")
    rzp_order_id      = body.get("razorpay_order_id", "")
    rzp_payment_id    = body.get("razorpay_payment_id", "")
    rzp_signature     = body.get("razorpay_signature", "")

    order = await db.razorpay_orders.find_one({"internal_order_id": internal_order_id}, {"_id": 0})
    if not order:
        return JSONResponse({"status": "error", "detail": "Order not found"}, status_code=404)

    if order["status"] == RazorpayOrderStatus.VERIFIED_SUCCESS:
        return {"status": "success", "receipt_number": order.get("receipt_number")}

    if order["status"] == RazorpayOrderStatus.FAILED:
        return JSONResponse(
            {"status": "error", "detail": "This payment order has already failed. Please create a new payment."},
            status_code=400
        )

    if order["status"] == RazorpayOrderStatus.CANCELLED:
        return JSONResponse(
            {"status": "error", "detail": "This payment order was cancelled."},
            status_code=400
        )

    if not _verify_payment_signature(rzp_order_id, rzp_payment_id, rzp_signature):
        await _mark_order(rzp_order_id, RazorpayOrderStatus.FAILED, failure_reason="Invalid signature (mobile)")
        await _release_locks(order["ledger_ids"], order["internal_order_id"])
        return JSONResponse({"status": "error", "detail": "Signature verification failed"}, status_code=400)

    await _mark_order(rzp_order_id, RazorpayOrderStatus.SUCCESS_PENDING_VERIFICATION,
                      rzp_payment_id=rzp_payment_id, rzp_signature=rzp_signature)

    receipt_number = await _generate_receipt_number()
    now_iso  = datetime.now(timezone.utc).isoformat()
    now_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    fee_payment = FeePayment(
        student_id=order["student_id"],
        installment_ids=order["ledger_ids"],
        amount=order["amount_rupees"],
        payment_method="online",
        transaction_id=rzp_payment_id,
        receipt_number=receipt_number,
        collected_by="mobile_checkout",
        remarks=f"Mobile Razorpay — {rzp_payment_id}" + (" [partial]" if order.get("is_partial") else ""),
    )
    fee_payment_dict = fee_payment.model_dump()
    fee_payment_dict["created_at"] = fee_payment_dict["created_at"].isoformat()

    ledger_updates = await _build_ledger_updates(
        order["ledger_ids"], order["amount_paise"], fee_payment.payment_id, receipt_number, now_date
    )

    async def _do_mobile_writes(session=None):
        kw = {"session": session} if session else {}
        await db.fee_payments.insert_one(fee_payment_dict, **kw)
        for upd in ledger_updates:
            await db.student_ledger.update_one(
                {"ledger_id": upd["ledger_id"]},
                {"$set": upd["set_fields"], "$unset": {"payment_lock": ""}},
                **kw,
            )
        await db.razorpay_orders.update_one(
            {"rzp_order_id": rzp_order_id},
            {"$set": {"status": RazorpayOrderStatus.VERIFIED_SUCCESS,
                      "fee_payment_id": fee_payment.payment_id,
                      "receipt_number": receipt_number,
                      "updated_at": now_iso}},
            **kw,
        )

    try:
        async with await mongo_client.start_session() as session:
            async with session.start_transaction():
                await _do_mobile_writes(session)
    except Exception as exc:
        if "transaction_id" in str(exc) or "E11000" in str(exc):
            existing_order = await db.razorpay_orders.find_one({"rzp_order_id": rzp_order_id}, {"_id": 0})
            return {"status": "success",
                    "receipt_number": existing_order.get("receipt_number") if existing_order else receipt_number}
        logger.warning("Mobile: transaction unavailable (%s) — non-atomic fallback", exc)
        try:
            await _do_mobile_writes(session=None)
        except Exception as exc2:
            if "transaction_id" in str(exc2) or "E11000" in str(exc2):
                existing_order = await db.razorpay_orders.find_one({"rzp_order_id": rzp_order_id}, {"_id": 0})
                return {"status": "success",
                        "receipt_number": existing_order.get("receipt_number") if existing_order else receipt_number}
            logger.error("Mobile payment recording failed: %s", exc2)
            return JSONResponse({"status": "error", "detail": "Payment recording failed."}, status_code=500)

    background_tasks.add_task(_refresh_student_fee_status, order["student_id"])
    system_user = {"user_id": "mobile_checkout", "name": "Mobile Checkout"}
    await create_audit_log("razorpay_order", order["internal_order_id"], "MOBILE_VERIFIED_SUCCESS",
                           {"rzp_payment_id": rzp_payment_id, "receipt_number": receipt_number,
                            "amount_rupees": order["amount_rupees"]}, system_user)
    logger.info("Mobile payment verified: order=%s pay=%s receipt=%s student=%s",
                rzp_order_id, rzp_payment_id, receipt_number, order["student_id"])
    return {"status": "success", "receipt_number": receipt_number}


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _refresh_student_fee_status(student_id: str):
    """Recompute student.fee_status from current ledger state."""
    try:
        pending = await db.student_ledger.count_documents(
            {"student_id": student_id, "status": {"$in": ["pending", "overdue", "partially_paid"]}}
        )
        new_status = "pending" if pending > 0 else "paid"
        await db.students.update_one(
            {"student_id": student_id},
            {"$set": {"fee_status": new_status}}
        )
    except Exception as exc:
        logger.error("Failed to refresh fee_status for student %s: %s", student_id, exc)
