/**
 * POSCheckout — Admin/Accountant card-machine (Ezetap POS) collection.
 *
 * Flow:
 *   1. Operator picks a registered terminal + payment mode.
 *   2. POST /payments/pos/initiate pushes the amount to the physical device.
 *   3. We poll POST /payments/pos/status until SUCCESS / FAILED / CANCELLED.
 *   4. On SUCCESS the backend has already created the FeePayment + receipt;
 *      we surface it and call onSuccess so the ledger refreshes.
 *
 * The backend settles each selected ledger entry by its own net amount and
 * generates the receipt — the frontend never marks anything paid directly.
 *
 * Usage:
 *   <POSCheckout
 *     studentId="STU2026abc"
 *     ledgerIds={["ldg_1","ldg_2"]}
 *     amountPaise={140000}
 *     onSuccess={(res) => refetchData()}
 *   />
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Smartphone, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from './ui/select';
import api from '../lib/api';

const POLL_INTERVAL_MS = 3000;
const MODES = [
  { value: 'ALL', label: 'Let customer choose (Card / UPI / QR)' },
  { value: 'CARD', label: 'Card only' },
  { value: 'UPI', label: 'UPI only' },
  { value: 'BHARATQR', label: 'Bharat QR' },
];

const fmtINR = (rupees) =>
  `₹${Number(rupees || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function POSCheckout({
  studentId, ledgerIds = [], amountPaise, onSuccess, onCancel, disabled = false, className, children,
}) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState(null);   // null = not loaded yet
  const [deviceId, setDeviceId] = useState('');
  const [mode, setMode] = useState('ALL');
  const [phase, setPhase] = useState('idle');      // idle | sending | waiting | success | failed
  const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState(null);

  const orderRef = useRef(null);
  const pollRef = useRef(null);

  const amountRupees = (amountPaise || 0) / 100;

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const cancelOrder = useCallback(async () => {
    stopPolling();
    const oid = orderRef.current;
    orderRef.current = null;
    if (oid) {
      try { await api.post('/payments/pos/cancel', { pos_order_id: oid, reason: 'Cancelled by operator' }); } catch (_) {}
    }
  }, [stopPolling]);

  // Cleanup if the component unmounts mid-flow.
  useEffect(() => () => {
    stopPolling();
    if (orderRef.current) {
      api.post('/payments/pos/cancel', { pos_order_id: orderRef.current, reason: 'Dialog closed' }).catch(() => {});
      orderRef.current = null;
    }
  }, [stopPolling]);

  // Load registered terminals when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      try {
        const { data } = await api.get('/payments/pos/devices');
        if (!active) return;
        const list = (data || []).filter(d => d.is_active);
        setDevices(list);
        if (list.length === 1) setDeviceId(list[0].device_id);
      } catch (e) {
        if (active) setDevices([]);
      }
    })();
    return () => { active = false; };
  }, [open]);

  const startPolling = useCallback((posOrderId) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.post('/payments/pos/status', { pos_order_id: posOrderId });
        if (data.status === 'SUCCESS') {
          stopPolling(); orderRef.current = null;
          setReceipt(data.receipt_number);
          setMessage(`Payment successful. Receipt ${data.receipt_number}.`);
          setPhase('success');
          toast.success(`POS payment successful! Receipt: ${data.receipt_number}`);
          onSuccess?.(data);
        } else if (data.status === 'FAILED' || data.status === 'CANCELLED') {
          stopPolling(); orderRef.current = null;
          setMessage(data.message || 'Payment failed on the terminal.');
          setPhase('failed');
        } else {
          setMessage(data.message || 'Waiting for the customer on the terminal…');
        }
      } catch (e) {
        // Transient network/poll error — keep polling.
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling, onSuccess]);

  const initiate = useCallback(async () => {
    if (!deviceId) { toast.error('Select a card machine.'); return; }
    if (!ledgerIds.length) { toast.error('No fee items selected.'); return; }
    if (!amountPaise || amountPaise < 100) { toast.error('Amount must be at least ₹1.'); return; }

    setPhase('sending');
    setMessage('Sending the amount to the card machine…');
    try {
      const { data } = await api.post('/payments/pos/initiate', {
        student_id: studentId,
        ledger_ids: ledgerIds,
        amount_paise: amountPaise,
        device_id: deviceId,
        mode,
      });
      orderRef.current = data.pos_order_id;
      setPhase('waiting');
      setMessage(data.message || 'Waiting for the customer on the terminal…');
      startPolling(data.pos_order_id);
    } catch (e) {
      setPhase('idle');
      if (!e._handled) toast.error(e.response?.data?.detail || 'Could not start the POS payment.');
    }
  }, [deviceId, ledgerIds, amountPaise, studentId, mode, startPolling]);

  const resetState = useCallback(() => {
    setPhase('idle'); setMessage(''); setReceipt(null);
  }, []);

  const handleOpenChange = useCallback((next) => {
    if (!next) {
      if (phase === 'sending' || phase === 'waiting') cancelOrder();
      resetState();
      onCancel?.();
    }
    setOpen(next);
  }, [phase, cancelOrder, resetState, onCancel]);

  const busy = phase === 'sending' || phase === 'waiting';

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || !ledgerIds.length}
        className={`bg-slate-800 hover:bg-slate-900 text-white gap-2 ${className || ''}`}
      >
        {children || <><Smartphone className="h-4 w-4" /> Card Machine</>}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-slate-700" /> Collect on Card Machine
            </DialogTitle>
            <DialogDescription>
              Push <span className="font-semibold text-slate-800">{fmtINR(amountRupees)}</span> to a terminal
              and have the customer tap / insert their card.
            </DialogDescription>
          </DialogHeader>

          {/* ── Idle: pick terminal + mode ── */}
          {phase === 'idle' && (
            <div className="space-y-4 py-2">
              {devices === null ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading terminals…
                </div>
              ) : devices.length === 0 ? (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  No card machine is registered yet. An admin must register the terminal's device ID
                  (format <code>SERIAL|ezetap_android</code>) before collecting.
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Card machine</label>
                    <Select value={deviceId} onValueChange={setDeviceId}>
                      <SelectTrigger><SelectValue placeholder="Select a terminal" /></SelectTrigger>
                      <SelectContent>
                        {devices.map(d => (
                          <SelectItem key={d.device_id} value={d.device_id}>
                            {d.label || d.device_id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Payment mode</label>
                    <Select value={mode} onValueChange={setMode}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Sending / Waiting ── */}
          {busy && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-slate-700" />
              <p className="text-sm font-medium text-slate-800">{message}</p>
              <p className="text-xs text-slate-400">Do not close this window until the customer completes payment.</p>
            </div>
          )}

          {/* ── Success ── */}
          {phase === 'success' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-600" />
              <p className="text-sm font-semibold text-emerald-700">{message}</p>
            </div>
          )}

          {/* ── Failed ── */}
          {phase === 'failed' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <XCircle className="h-12 w-12 text-red-500" />
              <p className="text-sm font-semibold text-red-600">{message}</p>
            </div>
          )}

          <DialogFooter>
            {phase === 'idle' && (
              <Button
                onClick={initiate}
                disabled={!deviceId || !devices?.length}
                className="bg-slate-900 hover:bg-slate-800 text-white"
              >
                Send {fmtINR(amountRupees)} to machine
              </Button>
            )}
            {busy && (
              <Button variant="outline" onClick={cancelOrder} className="border-red-300 text-red-600 hover:bg-red-50">
                Cancel payment
              </Button>
            )}
            {(phase === 'success' || phase === 'failed') && (
              <div className="flex gap-2">
                {phase === 'failed' && (
                  <Button variant="outline" onClick={resetState}>Try again</Button>
                )}
                <Button onClick={() => handleOpenChange(false)} className="bg-slate-900 hover:bg-slate-800 text-white">
                  Done
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default POSCheckout;
