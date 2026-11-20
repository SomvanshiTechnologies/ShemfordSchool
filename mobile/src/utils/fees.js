import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getValidToken } from '../api/client';
import { API_URL } from '../config';

// Same components, labels and order as the web dashboard's FEE_COMPONENTS.
export const FEE_FIELDS = [
  { key: 'registration_fee', label: 'Registration Fee', type: 'one_time' },
  { key: 'admission_fee', label: 'Admission Fee', type: 'one_time' },
  { key: 'caution_deposit', label: 'Caution Deposit', type: 'one_time' },
  { key: 'upgradation_fee', label: 'Upgradation Fee', type: 'one_time' },
  { key: 'annual_charge', label: 'Annual Charge', type: 'yearly' },
  { key: 'activity_fee', label: 'Activity Fee', type: 'yearly' },
  { key: 'exam_fee', label: 'Exam Fee', type: 'yearly' },
  { key: 'lab_fee', label: 'Lab Fee', type: 'yearly' },
  { key: 'ai_robotics_fee', label: 'AI & Robotics Fee', type: 'yearly' },
  { key: 'monthly_tuition', label: 'Monthly Tuition', type: 'monthly' },
  { key: 'late_fee', label: 'Late Fee (per month)', type: 'monthly' },
];

export const FEE_TYPE_LABELS = { one_time: 'One-time', yearly: 'Yearly', monthly: 'Monthly' };

// Report filters, matching the web Fees Reports page.
export const DURATIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'last_week', label: 'Last Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all_time', label: 'All Time' },
];

export const REPORT_FEE_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'tuition', label: 'Tuition Fee' },
  { value: 'admission', label: 'Admission Fee' },
  { value: 'registration', label: 'Registration Fee' },
  { value: 'annual_charge', label: 'Annual Charge' },
  { value: 'activity_fee', label: 'Activity Fee' },
  { value: 'exam_fee', label: 'Exam Fee' },
  { value: 'lab_fee', label: 'Lab Fee' },
  { value: 'ai_robotics_fee', label: 'AI & Robotics Fee' },
  { value: 'caution_deposit', label: 'Caution Deposit' },
  { value: 'upgradation', label: 'Upgradation Fee' },
];

export const REPORT_METHODS = [
  { value: '', label: 'All Methods' },
  { value: 'cash', label: 'Cash' },
  { value: 'online', label: 'Online' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'split', label: 'Split' },
];

export const METHOD_LABELS = {
  cash: 'Cash', online: 'Online', cheque: 'Cheque', bank_transfer: 'Bank Transfer',
  split: 'Split', pos_terminal: 'POS', razorpay: 'Razorpay', upi: 'UPI', card: 'Card',
};
export const methodLabel = (m) => METHOD_LABELS[m] || (m ? String(m).replace(/_/g, ' ') : '—');

// Academic years run April to March.
export const currentAcademicYear = () => {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 3 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
};

const shiftYear = (ay, by) => {
  const s = parseInt(String(ay).split('-')[0], 10) + by;
  return `${s}-${s + 1}`;
};

// Previous, current and next academic year, plus any extra sessions known to
// the server, newest first. The web dashboard offers the same three years.
export const academicYearOptions = (extra = []) => {
  const cur = currentAcademicYear();
  const set = new Set([shiftYear(cur, 1), cur, shiftYear(cur, -1), ...extra.filter(Boolean)]);
  return [...set].filter(y => /^\d{4}-\d{4}$/.test(y)).sort().reverse();
};

export const nextAcademicYear = (ay) => shiftYear(ay, 1);

export const fmtDate = (iso) => {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
};

// Downloads an authenticated PDF from the API and opens the share sheet,
// the same way the receipt screen shares receipts.
export const downloadAndSharePdf = async (path, params, filename, viewSession) => {
  const qs = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const url = `${API_URL}${path}${qs ? `?${qs}` : ''}`;
  const token = await getValidToken();
  const headers = { Authorization: `Bearer ${token}` };
  if (viewSession) headers['X-Academic-Year'] = viewSession;
  const target = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  const res = await FileSystem.downloadAsync(url, target, { headers });
  if (res.status !== 200) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw new Error(res.status === 401 ? 'Your session has expired. Please log in again.' : `The server returned an error (${res.status}).`);
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(res.uri, { mimeType: 'application/pdf', dialogTitle: filename, UTI: 'com.adobe.pdf' });
};
