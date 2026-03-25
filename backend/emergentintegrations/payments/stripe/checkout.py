"""
Real Stripe checkout integration using the stripe Python SDK.
Requires STRIPE_API_KEY and STRIPE_WEBHOOK_SECRET environment variables.
"""
from pydantic import BaseModel
from typing import Optional
import stripe
import logging

logger = logging.getLogger(__name__)


class CheckoutSessionRequest(BaseModel):
    amount: float
    currency: str = "inr"
    success_url: str
    cancel_url: str
    metadata: Optional[dict] = None


class CheckoutSessionResponse(BaseModel):
    session_id: str
    url: str


class CheckoutStatusResponse(BaseModel):
    status: str
    payment_status: str
    amount_total: Optional[float] = None
    currency: Optional[str] = None


class WebhookResponse(BaseModel):
    session_id: str
    payment_status: str


class StripeCheckout:
    def __init__(self, api_key: str, webhook_url: Optional[str] = None):
        self.api_key = api_key
        self.webhook_url = webhook_url
        stripe.api_key = api_key

    async def create_checkout_session(self, request: CheckoutSessionRequest) -> CheckoutSessionResponse:
        # Stripe amounts are in the smallest currency unit (paise for INR)
        amount_in_paise = int(round(request.amount * 100))

        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": request.currency,
                    "product_data": {
                        "name": request.metadata.get("student_name", "School Fee") if request.metadata else "School Fee",
                        "description": f"Fee for {request.metadata.get('month', '')} - {request.metadata.get('admission_number', '')}" if request.metadata else "School Fee Payment",
                    },
                    "unit_amount": amount_in_paise,
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=request.success_url,
            cancel_url=request.cancel_url,
            metadata=request.metadata or {},
        )
        logger.info("Stripe checkout session created: %s", session.id)
        return CheckoutSessionResponse(session_id=session.id, url=session.url)

    async def get_checkout_status(self, session_id: str) -> CheckoutStatusResponse:
        session = stripe.checkout.Session.retrieve(session_id)
        return CheckoutStatusResponse(
            status=session.status,
            payment_status=session.payment_status,
            amount_total=session.amount_total / 100 if session.amount_total is not None else None,
            currency=session.currency,
        )

    async def handle_webhook(self, body: bytes, signature: str) -> WebhookResponse:
        import os
        webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
        if not webhook_secret:
            raise ValueError("STRIPE_WEBHOOK_SECRET is not configured")

        try:
            event = stripe.Webhook.construct_event(body, signature, webhook_secret)
        except stripe.SignatureVerificationError as e:
            logger.error("Stripe webhook signature verification failed: %s", e)
            raise ValueError(f"Invalid webhook signature: {e}")

        if event["type"] == "checkout.session.completed":
            session = event["data"]["object"]
            return WebhookResponse(
                session_id=session["id"],
                payment_status=session.get("payment_status", "unknown"),
            )

        # Non-payment events — return a neutral response that won't trigger payment recording
        logger.info("Stripe webhook event ignored: %s", event["type"])
        return WebhookResponse(session_id="", payment_status="ignored")
