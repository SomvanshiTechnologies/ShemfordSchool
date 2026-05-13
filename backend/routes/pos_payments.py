"""
Shemford School — Ezetap POS Bridge Payment Integration
=========================================================

Payment lifecycle:
  INITIATED → SUCCESS
            → FAILED
            → CANCELLED

Security model:
  - Credentials loaded exclusively from environment variables.
  - Pessimistic fee-entry locking (same 10-minute TTL pattern as razorpay_payments.py).
  - All financial mutations run inside MongoDB transactions (with standalone fallback).
  - Idempotent status finalization — safe to call multiple times.
  - All POS actions written to audit_logs.

Financial accuracy:
  - Amounts stored and operated on in integer paise.
  - get_next_receipt_number() shared with fees.py (same atomic counter).
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import os
import uuid
import logging

import httpx
from pymongo import UpdateOne

from database import db, client as mongo_client
from models import UserRole, POSOrder, POSOrderStatus, FeePayment
from auth_utils import get_current_user, require_roles, create_audit_log
from routes.fees import get_next_receipt_number, refresh_overdue_for_student

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Ezetap config (never hardcode — always from env) ─────────────────────────

EZETAP_BASE_URL  = os.environ.get("EZETAP_BASE_URL", "https://demo.ezetap.com")
EZETAP_USERNAME  = os.environ.get("EZETAP_USERNAME", "")       # API username (1411001141)
EZETAP_APP_KEY   = os.environ.get("EZETAP_APP_KEY", "")        # App key
EZETAP_ORG_CODE  = os.environ.get("EZETAP_ORG_CODE", "SHEMFORD_FUTURISTIC_SCHOO")

LOCK_TTL_MINUTES = 10  # same as razorpay_payments.py

# When set to "false" the device whitelist check is skipped (useful for initial onboarding).
DEVICE_WHITELIST_ENABLED = os.environ.get("POS_DEVICE_WHITELIST_ENABLED", "true").lower() != "false"


def _ezetap_headers() -> dict:
    return {"Content-Type": "application/json", "Accept": "application/json"}


def _check_ezetap_config():
    if not EZETAP_USERNAME or not EZETAP_APP_KEY:
        raise HTTPException(
            status_code=503,
            detail="POS terminal is not configured on this server. Contact admin."
        )


async def _check_device_whitelist(device_id: str):
    """
    Raise 403 if the device_id is not in the registered pos_devices collection.
    Skipped when DEVICE_WHITELIST_ENABLED=false (e.g., during initial onboarding).
    """
    if not DEVICE_WHITELIST_ENABLED:
        return
    device = await db.pos_devices.find_one(
        {"device_id": device_id, "is_active": True}, {"_id": 0}
    )
    if not device:
        raise HTTPException(
            status_code=403,
            detail=f"Device '{device_id}' is not registered. Ask an admin to register it at POST /payments/pos/devices.",
        )


# ── Request / Response schemas ────────────────────────────────────────────────

class POSInitiateRequest(BaseModel):
    student_id: str
    ledger_ids: List[str]
    amount_paise: int          # must be integer paise, ≥ 100
    device_id: str
    mode: str = "ALL"          # ALL / UPI / CARD / CASH / BHARATQR / CHEQUE
    external_ref_number: Optional[str] = None

    @classmethod
    def validate_mode(cls, mode: str) -> str:
        valid = {"ALL", "UPI", "CARD", "CASH", "BHARATQR", "CHEQUE"}
        if mode.upper() not in valid:
            raise ValueError(f"mode must be one of {valid}")
        return mode.upper()


class POSStatusRequest(BaseModel):
    pos_order_id: str


class POSCancelRequest(BaseModel):
    pos_order_id: str
    reason: Optional[str] = "Cancelled by operator"


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _release_pos_locks(ledger_ids: List[str], pos_order_id: str):
    """Release pessimistic locks acquired during POS initiation."""
    await db.student_ledger.update_many(
        {"ledger_id": {"$in": ledger_ids}, "payment_lock.order_id": pos_order_id},
        {"$unset": {"payment_lock": ""}},
    )


async def _finalize_pos_payment(pos_order: dict, ezetap_resp: dict, user: dict):
    """
    Mark ledger entries as paid, create FeePayment, generate receipt.
    Idempotent — returns existing receipt_number if already processed.
    """
    pos_order_id = pos_order["pos_order_id"]

    # Idempotency guard
    if pos_order.get("status") == POSOrderStatus.SUCCESS and pos_order.get("fee_payment_id"):
        return pos_order.get("receipt_number")

    receipt_number = await get_next_receipt_number()
    today = datetime.now().strftime("%Y-%m-%d")
    ledger_ids = pos_order["ledger_ids"]
    amount_rupees = pos_order["amount_paise"] / 100

    # Fetch ledger entries so we can record the correct amount_paid per entry
    # and derive the academic_year for the FeePayment record.
    entries = await db.student_ledger.find(
        {"ledger_id": {"$in": ledger_ids}}, {"_id": 0}
    ).to_list(len(ledger_ids))
    entry_map = {e["ledger_id"]: e for e in entries}
    academic_year = entries[0].get("academic_year", "") if entries else ""

    # Determine txn_id from Ezetap response
    txn_id = (
        ezetap_resp.get("txnId")
        or ezetap_resp.get("appTransactionId")
        or ezetap_resp.get("externalRefNumber")
        or pos_order_id
    )

    payment = FeePayment(
        student_id=pos_order["student_id"],
        installment_ids=ledger_ids,
        amount=amount_rupees,
        payment_method=f"pos_{pos_order.get('mode', 'card').lower()}",
        transaction_id=txn_id,
        collected_by=pos_order.get("collected_by", user["user_id"]),
        remarks=f"POS payment via Ezetap. Device: {pos_order.get('device_id', '')}. Order: {pos_order_id}",
        academic_year=academic_year,
    )
    pay_dict = payment.model_dump()
    pay_dict["receipt_number"] = receipt_number
    pay_dict["pos_order_id"] = pos_order_id
    pay_dict["created_at"] = pay_dict["created_at"].isoformat()

    # Build per-entry updates: set amount_paid to each entry's net_amount
    ledger_updates = [
        UpdateOne(
            {"ledger_id": lid},
            {"$set": {
                "status": "paid",
                "paid_date": today,
                "payment_id": payment.payment_id,
                "receipt_number": receipt_number,
                "amount_paid": entry_map.get(lid, {}).get("net_amount", 0),
                "remaining_balance": 0,
            }}
        )
        for lid in ledger_ids
    ]

    try:
        async with await mongo_client.start_session() as session:
            async with session.start_transaction():
                await db.fee_payments.insert_one(pay_dict, session=session)
                await db.student_ledger.bulk_write(ledger_updates, session=session)
                await db.pos_orders.update_one(
                    {"pos_order_id": pos_order_id},
                    {"$set": {
                        "status": POSOrderStatus.SUCCESS,
                        "receipt_number": receipt_number,
                        "fee_payment_id": payment.payment_id,
                        "ezetap_response": ezetap_resp,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }},
                    session=session,
                )
    except Exception:
        # Standalone MongoDB fallback (no replica set)
        await db.fee_payments.insert_one(pay_dict)
        await db.student_ledger.bulk_write(ledger_updates)
        await db.pos_orders.update_one(
            {"pos_order_id": pos_order_id},
            {"$set": {
                "status": POSOrderStatus.SUCCESS,
                "receipt_number": receipt_number,
                "fee_payment_id": payment.payment_id,
                "ezetap_response": ezetap_resp,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )

    # Release locks and refresh the student's overdue/fee_status
    await _release_pos_locks(ledger_ids, pos_order_id)
    await refresh_overdue_for_student(pos_order["student_id"])

    return receipt_number


# ── POST /payments/pos/initiate ───────────────────────────────────────────────

@router.post("/payments/pos/initiate")
async def initiate_pos_payment(body: POSInitiateRequest, request: Request):
    """
    Initiate a POS payment on an Ezetap device.

    1. Validates student and ledger entries.
    2. Acquires pessimistic locks (same TTL as Razorpay flow).
    3. Calls Ezetap POST /api/3.0/p2padapter/pay.
    4. Persists a POSOrder document.
    5. Returns pos_order_id + p2p_request_id.
    """
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    _check_ezetap_config()

    if not body.ledger_ids:
        raise HTTPException(status_code=400, detail="Select at least one fee entry.")

    mode = body.mode.upper()
    valid_modes = {"ALL", "UPI", "CARD", "CASH", "BHARATQR", "CHEQUE"}
    if mode not in valid_modes:
        raise HTTPException(status_code=400, detail=f"mode must be one of {valid_modes}")

    if body.amount_paise < 100:
        raise HTTPException(status_code=400, detail="Minimum payable amount is ₹1.")

    # ── Verify the device is registered ──────────────────────────────────────
    await _check_device_whitelist(body.device_id)

    # ── Validate student ──────────────────────────────────────────────────────
    student = await db.students.find_one({"student_id": body.student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    # ── Fetch + validate ledger entries ───────────────────────────────────────
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
                detail=f"Entry '{e['description']}' is already {e['status']}."
            )
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
                    detail=f"Entry '{e['description']}' is locked by another payment."
                )

    # ── Acquire pessimistic locks ─────────────────────────────────────────────
    pos_order_id = f"posord_{uuid.uuid4().hex[:14]}"
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
        {"$set": {"payment_lock": {"order_id": pos_order_id, "expires_at": lock_expires.isoformat()}}},
    )

    if result.modified_count != len(body.ledger_ids):
        raise HTTPException(
            status_code=409,
            detail="Could not lock all fee entries. Refresh and try again."
        )

    # ── Call Ezetap P2P adapter ───────────────────────────────────────────────
    external_ref = body.external_ref_number or f"SFS-{pos_order_id[-8:].upper()}"
    ezetap_payload = {
        "appKey": EZETAP_APP_KEY,
        "username": EZETAP_USERNAME,
        "merchantOrderId": external_ref,
        "amount": str(body.amount_paise / 100),  # Ezetap expects rupees as string
        "paymentBy": mode,
        "deviceId": body.device_id,
        "externalRefNumber": external_ref,
        "orderDetails": {
            "studentId": body.student_id,
            "studentName": f"{student.get('first_name', '')} {student.get('last_name', '')}",
            "admissionNumber": student.get("admission_number", ""),
            "posOrderId": pos_order_id,
        },
    }

    p2p_request_id = None
    ezetap_raw = {}
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(
                f"{EZETAP_BASE_URL}/api/3.0/p2padapter/pay",
                json=ezetap_payload,
                headers=_ezetap_headers(),
            )
            ezetap_raw = r.json() if r.content else {}
            if r.status_code not in (200, 201):
                await _release_pos_locks(body.ledger_ids, pos_order_id)
                raise HTTPException(
                    status_code=502,
                    detail=f"Ezetap error: {ezetap_raw.get('message', r.text[:200])}"
                )
            p2p_request_id = (
                ezetap_raw.get("p2pRequestId")
                or ezetap_raw.get("requestId")
                or ezetap_raw.get("data", {}).get("p2pRequestId")
            )
    except HTTPException:
        raise
    except Exception as exc:
        await _release_pos_locks(body.ledger_ids, pos_order_id)
        logger.error("Ezetap initiate failed: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to send payment to POS device. Try again.")

    # ── Persist POSOrder ──────────────────────────────────────────────────────
    order = POSOrder(
        pos_order_id=pos_order_id,
        p2p_request_id=p2p_request_id,
        student_id=body.student_id,
        ledger_ids=body.ledger_ids,
        amount_paise=body.amount_paise,
        amount_rupees=body.amount_paise / 100,
        device_id=body.device_id,
        mode=mode,
        external_ref_number=external_ref,
        status=POSOrderStatus.INITIATED,
        ezetap_response=ezetap_raw,
        collected_by=user["user_id"],
    )
    order_dict = order.model_dump()
    order_dict["created_at"] = order_dict["created_at"].isoformat()
    order_dict["updated_at"] = order_dict["updated_at"].isoformat()
    await db.pos_orders.insert_one(order_dict)

    await create_audit_log(
        "pos_payment", pos_order_id, "INITIATED",
        {
            "student_id": body.student_id,
            "amount_paise": body.amount_paise,
            "device_id": body.device_id,
            "mode": mode,
            "ledger_ids": body.ledger_ids,
        },
        user,
    )

    logger.info(
        "POS initiated: %s student=%s ₹%.2f device=%s mode=%s rid=%s",
        pos_order_id, body.student_id, body.amount_paise / 100,
        body.device_id, mode, getattr(request.state, "request_id", "-"),
    )

    return {
        "pos_order_id": pos_order_id,
        "p2p_request_id": p2p_request_id,
        "status": POSOrderStatus.INITIATED,
        "amount_paise": body.amount_paise,
        "amount_rupees": body.amount_paise / 100,
        "message": "Payment request sent to POS device. Poll /payments/pos/status for updates.",
    }


# ── POST /payments/pos/status ─────────────────────────────────────────────────

@router.post("/payments/pos/status")
async def check_pos_status(body: POSStatusRequest, request: Request):
    """
    Poll Ezetap for payment status.
    On SUCCESS: finalize ledger, create FeePayment, generate receipt.
    Idempotent — safe to call repeatedly.
    """
    user = await get_current_user(request)
    _check_ezetap_config()

    pos_order = await db.pos_orders.find_one({"pos_order_id": body.pos_order_id}, {"_id": 0})
    if not pos_order:
        raise HTTPException(status_code=404, detail="POS order not found.")

    # Already terminal — return current state
    if pos_order["status"] in (POSOrderStatus.SUCCESS, POSOrderStatus.CANCELLED, POSOrderStatus.FAILED):
        return {
            "pos_order_id": pos_order["pos_order_id"],
            "status": pos_order["status"],
            "receipt_number": pos_order.get("receipt_number"),
            "fee_payment_id": pos_order.get("fee_payment_id"),
        }

    if not pos_order.get("p2p_request_id"):
        raise HTTPException(status_code=400, detail="No p2pRequestId on this order. Cannot poll status.")

    # ── Poll Ezetap ───────────────────────────────────────────────────────────
    ezetap_payload = {
        "appKey": EZETAP_APP_KEY,
        "username": EZETAP_USERNAME,
        "origP2pRequestId": pos_order["p2p_request_id"],
    }

    ezetap_resp = {}
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(
                f"{EZETAP_BASE_URL}/api/3.0/p2padapter/status",
                json=ezetap_payload,
                headers=_ezetap_headers(),
            )
            ezetap_resp = r.json() if r.content else {}
    except Exception as exc:
        logger.warning("Ezetap status poll failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not reach Ezetap. Try again.")

    # Determine outcome from Ezetap response
    txn_status = (
        ezetap_resp.get("txnStatus")
        or ezetap_resp.get("status")
        or ezetap_resp.get("paymentStatus")
        or ""
    ).upper()

    if txn_status in ("SUCCESS", "APPROVED", "CAPTURED"):
        receipt_number = await _finalize_pos_payment(pos_order, ezetap_resp, user)
        await create_audit_log(
            "pos_payment", body.pos_order_id, "SUCCESS",
            {"student_id": pos_order["student_id"], "amount_paise": pos_order["amount_paise"]},
            user,
        )
        refreshed = await db.pos_orders.find_one({"pos_order_id": body.pos_order_id}, {"_id": 0})
        return {
            "pos_order_id": body.pos_order_id,
            "status": POSOrderStatus.SUCCESS,
            "receipt_number": receipt_number,
            "fee_payment_id": refreshed.get("fee_payment_id") if refreshed else None,
            "message": f"Payment successful. Receipt: {receipt_number}",
        }

    if txn_status in ("FAILED", "DECLINED", "ERROR", "CANCELLED"):
        await db.pos_orders.update_one(
            {"pos_order_id": body.pos_order_id},
            {"$set": {
                "status": POSOrderStatus.FAILED,
                "ezetap_response": ezetap_resp,
                "failure_reason": ezetap_resp.get("message", txn_status),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        await _release_pos_locks(pos_order["ledger_ids"], body.pos_order_id)
        await create_audit_log(
            "pos_payment", body.pos_order_id, "FAILED",
            {"student_id": pos_order["student_id"], "reason": ezetap_resp.get("message", txn_status)},
            user,
        )
        return {
            "pos_order_id": body.pos_order_id,
            "status": POSOrderStatus.FAILED,
            "message": ezetap_resp.get("message", "Payment failed on POS device."),
        }

    # Still pending on device
    return {
        "pos_order_id": body.pos_order_id,
        "status": POSOrderStatus.INITIATED,
        "ezetap_status": txn_status or "PENDING",
        "message": "Waiting for customer action on POS device.",
    }


# ── POST /payments/pos/cancel ─────────────────────────────────────────────────

@router.post("/payments/pos/cancel")
async def cancel_pos_payment(body: POSCancelRequest, request: Request):
    """
    Cancel an in-progress POS payment.
    Calls Ezetap cancel API, releases locks, marks order CANCELLED.
    """
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    _check_ezetap_config()

    pos_order = await db.pos_orders.find_one({"pos_order_id": body.pos_order_id}, {"_id": 0})
    if not pos_order:
        raise HTTPException(status_code=404, detail="POS order not found.")

    if pos_order["status"] in (POSOrderStatus.SUCCESS, POSOrderStatus.CANCELLED):
        return {
            "pos_order_id": body.pos_order_id,
            "status": pos_order["status"],
            "message": f"Order is already {pos_order['status']}.",
        }

    # ── Call Ezetap cancel ────────────────────────────────────────────────────
    ezetap_payload = {
        "appKey": EZETAP_APP_KEY,
        "username": EZETAP_USERNAME,
        "origP2pRequestId": pos_order.get("p2p_request_id", ""),
    }

    try:
        async with httpx.AsyncClient(timeout=30) as http:
            await http.post(
                f"{EZETAP_BASE_URL}/api/3.0/p2p/cancel",
                json=ezetap_payload,
                headers=_ezetap_headers(),
            )
    except Exception as exc:
        logger.warning("Ezetap cancel call failed (proceeding anyway): %s", exc)

    await _release_pos_locks(pos_order["ledger_ids"], body.pos_order_id)
    await db.pos_orders.update_one(
        {"pos_order_id": body.pos_order_id},
        {"$set": {
            "status": POSOrderStatus.CANCELLED,
            "failure_reason": body.reason,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )

    await create_audit_log(
        "pos_payment", body.pos_order_id, "CANCELLED",
        {"student_id": pos_order["student_id"], "reason": body.reason},
        user,
    )

    return {
        "pos_order_id": body.pos_order_id,
        "status": POSOrderStatus.CANCELLED,
        "message": "POS payment cancelled and fee entries unlocked.",
    }


# ── GET /payments/pos/order/{pos_order_id} ────────────────────────────────────

@router.get("/payments/pos/order/{pos_order_id}")
async def get_pos_order(pos_order_id: str, request: Request):
    """Return the current state of a POSOrder."""
    await get_current_user(request)
    order = await db.pos_orders.find_one({"pos_order_id": pos_order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="POS order not found.")
    return order


# ── Device registry endpoints ─────────────────────────────────────────────────

class RegisterDeviceRequest(BaseModel):
    device_id: str
    label: Optional[str] = None      # e.g. "Front desk", "Accountant room"
    serial_number: Optional[str] = None


@router.post("/payments/pos/devices")
async def register_pos_device(body: RegisterDeviceRequest, request: Request):
    """
    Register an Ezetap device ID so it can be used for payments.
    Admin only. Idempotent — re-registering an existing device re-activates it.
    """
    user = await require_roles(UserRole.ADMIN)(request)

    if not body.device_id.strip():
        raise HTTPException(status_code=400, detail="device_id cannot be empty.")

    now = datetime.now(timezone.utc).isoformat()
    await db.pos_devices.update_one(
        {"device_id": body.device_id},
        {"$set": {
            "device_id": body.device_id,
            "label": body.label or body.device_id,
            "serial_number": body.serial_number,
            "is_active": True,
            "registered_by": user["user_id"],
            "updated_at": now,
        }, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    await create_audit_log("pos_device", body.device_id, "REGISTER",
                           {"label": body.label, "serial": body.serial_number}, user)
    return {"message": f"Device '{body.device_id}' registered.", "device_id": body.device_id}


@router.get("/payments/pos/devices")
async def list_pos_devices(request: Request):
    """List all registered POS devices. Admin only."""
    await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT)(request)
    devices = await db.pos_devices.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return devices


@router.delete("/payments/pos/devices/{device_id}")
async def deactivate_pos_device(device_id: str, request: Request):
    """Deactivate a POS device so it can no longer initiate payments. Admin only."""
    user = await require_roles(UserRole.ADMIN)(request)
    result = await db.pos_devices.update_one(
        {"device_id": device_id},
        {"$set": {"is_active": False, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Device not found.")
    await create_audit_log("pos_device", device_id, "deactivate", {"device_id": device_id}, user)
    return {"message": f"Device '{device_id}' deactivated."}
