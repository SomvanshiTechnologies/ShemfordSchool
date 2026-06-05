// Single source of truth for fee payment-method options so every collect-fee
// dialog (Fees Management, Admission, Upgradation, Upgradation-pending) shows
// the exact same list. Values must match what the backend / reports expect.
//
// 'split' is handled specially by each dialog (shows cash + online inputs).
// 'pos_terminal' is ONLY offered where the Ezetap POS flow is wired (the main
// Fees Management collect dialog), so it lives in PAYMENT_METHODS_WITH_POS.
export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'online', label: 'Online / UPI' },
  { value: 'split', label: 'Split' },
];

// Map stored value → display label for payment history rendering.
const _DEFAULT_LABELS = Object.fromEntries(
  [...PAYMENT_METHODS, { value: 'pos_terminal', label: 'POS Terminal' }].map(m => [m.value, m.label])
);

export function fmtPaymentMethod(value) {
  if (!value) return '—';
  return _DEFAULT_LABELS[value] || value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export const PAYMENT_METHODS_WITH_POS = [
  ...PAYMENT_METHODS,
  { value: 'pos_terminal', label: 'POS Terminal (Ezetap)' },
];

import api from './api';

// Payment methods are admin-configurable in the DB (Settings → Payment Methods).
// This fetches the live list; the static arrays above are the seeded defaults
// and the fallback if the request fails. Only active methods are returned.
// `value` strings 'split' and 'pos_terminal' keep their special UI behaviour.
export async function fetchPaymentMethods({ withPos = true } = {}) {
  const fallback = withPos ? PAYMENT_METHODS_WITH_POS : PAYMENT_METHODS;
  try {
    const res = await api.get('/settings/payment-methods');
    const list = Array.isArray(res.data?.methods) ? res.data.methods : null;
    if (list && list.length) {
      let methods = list
        .filter(m => m && m.value && m.active !== false)
        .map(m => ({ value: m.value, label: m.label || m.value, requires_reference: m.requires_reference }));
      if (!withPos) methods = methods.filter(m => m.value !== 'pos_terminal');
      if (methods.length) return methods;
    }
  } catch {
    /* fall back to the static defaults below */
  }
  return fallback;
}
