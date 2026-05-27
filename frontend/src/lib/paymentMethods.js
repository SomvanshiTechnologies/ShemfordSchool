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
  { value: 'split', label: 'Split (Cash + Online)' },
];

export const PAYMENT_METHODS_WITH_POS = [
  ...PAYMENT_METHODS,
  { value: 'pos_terminal', label: 'POS Terminal (Ezetap)' },
];
