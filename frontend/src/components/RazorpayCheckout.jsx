/**
 * RazorpayCheckout — Reusable Razorpay payment component
 *
 * Usage:
 *   <RazorpayCheckout
 *     studentId="STU2026abc"
 *     ledgerIds={["ldg_1", "ldg_2"]}
 *     onSuccess={(receipt) => refetchData()}
 *     onCancel={() => {}}
 *   />
 *
 * Security model:
 *   - Order created on backend; key_id returned (never the secret).
 *   - Payment verified on backend via HMAC-SHA256 signature.
 *   - Frontend never directly marks anything as paid.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Loader2, CreditCard } from 'lucide-react';
import { Button } from './ui/button';
import api from '../lib/api';

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

function useRazorpayScript() {
  const [loaded, setLoaded] = useState(!!window.Razorpay);

  useEffect(() => {
    if (window.Razorpay) { setLoaded(true); return; }
    const script = document.createElement('script');
    script.src   = SCRIPT_URL;
    script.async = true;
    script.onload = () => setLoaded(true);
    script.onerror = () => toast.error('Failed to load payment module. Check your internet connection.');
    document.body.appendChild(script);
    return () => { /* keep script in DOM for reuse */ };
  }, []);

  return loaded;
}

export function RazorpayCheckout({ studentId, ledgerIds = [], onSuccess, onCancel, disabled = false, children }) {
  const scriptLoaded   = useRazorpayScript();
  const [busy, setBusy] = useState(false);
  const orderRef       = useRef(null);   // store current order to cancel on unmount

  // Cancel order if component unmounts mid-payment (e.g. navigation away)
  useEffect(() => {
    return () => {
      if (orderRef.current) {
        api.post('/payments/razorpay/cancel', { internal_order_id: orderRef.current })
          .catch(() => {});
        orderRef.current = null;
      }
    };
  }, []);

  const handlePayment = useCallback(async () => {
    if (!scriptLoaded) { toast.error('Payment module is still loading. Please wait.'); return; }
    if (!ledgerIds.length) { toast.error('No fee items selected.'); return; }
    if (busy) return;

    setBusy(true);
    let internalOrderId = null;

    try {
      // ── Step 1: Create order on backend ──────────────────────────────────
      const { data: order } = await api.post('/payments/razorpay/create-order', {
        student_id: studentId,
        ledger_ids: ledgerIds,
      });

      internalOrderId = order.internal_order_id;
      orderRef.current = internalOrderId;

      // ── Step 2: Mark INITIATED (pre-modal) ───────────────────────────────
      await api.post('/payments/razorpay/initiate', { internal_order_id: internalOrderId });

      // ── Step 3: Open Razorpay checkout ───────────────────────────────────
      await new Promise((resolve, reject) => {
        const options = {
          key:         order.key_id,
          amount:      order.amount_paise,
          currency:    order.currency,
          name:        'Shemford Futuristic School',
          description: order.description,
          image:       '/logo.webp',
          order_id:    order.rzp_order_id,

          prefill: {
            name:    order.student_name,
            email:   order.student_email,
            contact: order.student_phone,
          },

          theme: { color: '#E88A1A' },

          // ── Step 4: Verify on backend after success ─────────────────────
          handler: async (response) => {
            try {
              const { data: result } = await api.post('/payments/razorpay/verify', {
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
              });
              orderRef.current = null;
              toast.success(`Payment successful! Receipt: ${result.receipt_number}`);
              onSuccess?.(result);
              resolve(result);
            } catch (err) {
              const msg = err.response?.data?.detail || 'Payment verification failed.';
              toast.error(msg);
              reject(new Error(msg));
            }
          },

          modal: {
            ondismiss: async () => {
              // User closed the modal — cancel the order and release locks
              try {
                await api.post('/payments/razorpay/cancel', { internal_order_id: internalOrderId });
              } catch (_) {}
              orderRef.current = null;
              onCancel?.();
              resolve(null);   // resolve (not reject) — user intentionally cancelled
            },
            escape:        false,
            backdropclose: false,
          },
        };

        const rzp = new window.Razorpay(options);

        rzp.on('payment.failed', async (response) => {
          // Payment failed inside the modal (e.g. wrong OTP, card declined)
          // Razorpay shows its own error UI; we just cancel the order on backend
          try {
            await api.post('/payments/razorpay/cancel', { internal_order_id: internalOrderId });
          } catch (_) {}
          orderRef.current = null;
          const reason = response.error?.description || 'Payment failed.';
          toast.error(`Payment failed: ${reason}`);
          reject(new Error(reason));
        });

        rzp.open();
      });

    } catch (err) {
      // Order creation error or verification error
      if (internalOrderId) {
        api.post('/payments/razorpay/cancel', { internal_order_id: internalOrderId }).catch(() => {});
        orderRef.current = null;
      }
      // Only show toast if interceptor hasn't already shown one (_handled) and not a payment failure
      if (!err._handled && !err.message?.includes('Payment failed')) {
        const detail = err.response?.data?.detail || err.message || 'Payment could not be started.';
        toast.error(detail, { duration: 6000 });
      }
    } finally {
      setBusy(false);
    }
  }, [scriptLoaded, studentId, ledgerIds, busy, onSuccess, onCancel]);

  // Guard: don't render at all if Razorpay not configured
  const razorpayEnabled = !!process.env.REACT_APP_RAZORPAY_KEY_ID;
  if (!razorpayEnabled) return null;

  return (
    <Button
      onClick={handlePayment}
      disabled={disabled || busy || !ledgerIds.length}
      className="bg-[#E88A1A] hover:bg-[#d07a0e] text-white gap-2"
    >
      {busy ? (
        <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
      ) : (
        children || <><CreditCard className="h-4 w-4" /> Pay Online</>
      )}
    </Button>
  );
}

export default RazorpayCheckout;
