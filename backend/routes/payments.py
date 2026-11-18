from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import uuid
import os
import logging
import asyncio

from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest
import resend

from database import db
from models import UserRole, FeePayment
from auth_utils import get_current_user, require_roles
from routes.fees import refresh_overdue_for_student as refresh_student_fee_status

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY', '')
RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'notifications@shemford.edu')
if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


class PaymentRequest(BaseModel):
    student_id: str
    fee_id: Optional[str] = None
    amount: float
    month: str
    origin_url: str


async def send_email(to_email: str, subject: str, html_content: str):
    if not RESEND_API_KEY:
        logger.warning("Email service not configured")
        return False
    try:
        params = {"from": SENDER_EMAIL, "to": [to_email], "subject": subject, "html": html_content}
        await asyncio.to_thread(resend.Emails.send, params)
        return True
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False


async def send_payment_confirmation_email(student: dict, amount: float, month: str):
    parent_email = student.get("parent_email")
    if not parent_email:
        return
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #E88A1A; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">Shemford Futuristic School</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #333;">Payment Confirmation</h2>
            <p>Dear Parent/Guardian,</p>
            <p>We have received your fee payment for <strong>{student['first_name']} {student['last_name']}</strong>.</p>
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p>Amount Paid: <strong>Rs.{amount:,.2f}</strong></p>
                <p>Month: <strong>{month}</strong></p>
            </div>
        </div>
    </div>
    """
    await send_email(parent_email, f"Payment Confirmation - {month}", html)


@router.post("/payments/create-checkout")
async def create_payment_checkout(payment: PaymentRequest, request: Request):
    user = await require_roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.PARENT)(request)

    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Payment service not configured")

    student = await db.students.find_one({"student_id": payment.student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    pending_payments = await db.fee_payments.find({
        "student_id": payment.student_id, "status": "pending"
    }, {"_id": 0}).sort("month", 1).to_list(100)

    if pending_payments and payment.month != pending_payments[0].get("month"):
        oldest_month = pending_payments[0]["month"]
        raise HTTPException(status_code=400, detail=f"Cannot skip payment. Please pay dues for {oldest_month} first.")

    host_url = str(request.base_url).rstrip('/')
    webhook_url = f"{host_url}/api/webhook/stripe"
    stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)

    success_url = f"{payment.origin_url}/fees?payment=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{payment.origin_url}/fees?payment=cancelled"

    metadata = {
        "student_id": payment.student_id,
        "student_name": f"{student['first_name']} {student['last_name']}",
        "admission_number": student['admission_number'],
        "month": payment.month,
        "collected_by": user["user_id"]
    }

    checkout_request = CheckoutSessionRequest(
        amount=float(payment.amount),
        currency="inr",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata=metadata
    )

    session = await stripe_checkout.create_checkout_session(checkout_request)

    transaction = {
        "transaction_id": f"txn_{uuid.uuid4().hex[:12]}",
        "session_id": session.session_id,
        "student_id": payment.student_id,
        "amount": payment.amount,
        "currency": "inr",
        "month": payment.month,
        "fee_id": payment.fee_id,
        "payment_status": "initiated",
        "metadata": metadata,
        "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.payment_transactions.insert_one(transaction)

    return {"checkout_url": session.url, "session_id": session.session_id}


@router.get("/payments/status/{session_id}")
async def get_payment_status(session_id: str, request: Request):
    await get_current_user(request)

    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Payment service not configured")

    transaction = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if transaction["payment_status"] in ["completed", "paid"]:
        return {"status": "completed", "payment_status": "paid", "transaction": transaction}

    host_url = str(request.base_url).rstrip('/')
    webhook_url = f"{host_url}/api/webhook/stripe"
    stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)

    try:
        status = await stripe_checkout.get_checkout_status(session_id)

        if status.payment_status == "paid" and transaction["payment_status"] != "completed":
            payment = FeePayment(
                student_id=transaction["student_id"],
                fee_id=transaction.get("fee_id", ""),
                amount=transaction["amount"],
                payment_method="online",
                month=transaction["month"],
                status="completed",
                transaction_id=session_id,
                collected_by=transaction.get("created_by")
            )
            payment_dict = payment.model_dump()
            payment_dict["created_at"] = payment_dict["created_at"].isoformat()
            await db.fee_payments.insert_one(payment_dict)

            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {"payment_status": "completed", "updated_at": datetime.now(timezone.utc).isoformat()}}
            )

            await refresh_student_fee_status(transaction["student_id"])

            student = await db.students.find_one({"student_id": transaction["student_id"]}, {"_id": 0})
            if student and student.get("parent_email"):
                await send_payment_confirmation_email(student, transaction["amount"], transaction["month"])

        return {
            "status": status.status,
            "payment_status": status.payment_status,
            "amount": status.amount_total,
            "currency": status.currency
        }
    except Exception as e:
        logger.error(f"Error checking payment status: {e}")
        return {"status": "error", "payment_status": transaction["payment_status"]}


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("Stripe-Signature")

    if not STRIPE_API_KEY:
        return {"status": "error", "message": "Stripe not configured"}

    try:
        host_url = str(request.base_url).rstrip('/')
        webhook_url = f"{host_url}/api/webhook/stripe"
        stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)

        webhook_response = await stripe_checkout.handle_webhook(body, signature)

        if webhook_response.payment_status == "paid":
            session_id = webhook_response.session_id
            transaction = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
            if transaction and transaction["payment_status"] != "completed":
                payment = FeePayment(
                    student_id=transaction["student_id"],
                    fee_id=transaction.get("fee_id", ""),
                    amount=transaction["amount"],
                    payment_method="online",
                    month=transaction["month"],
                    status="completed",
                    transaction_id=session_id,
                    collected_by=transaction.get("created_by")
                )
                payment_dict = payment.model_dump()
                payment_dict["created_at"] = payment_dict["created_at"].isoformat()
                await db.fee_payments.insert_one(payment_dict)

                await db.payment_transactions.update_one(
                    {"session_id": session_id},
                    {"$set": {"payment_status": "completed", "updated_at": datetime.now(timezone.utc).isoformat()}}
                )

                await refresh_student_fee_status(transaction["student_id"])

        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return {"status": "error", "message": str(e)}
