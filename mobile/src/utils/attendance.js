// Date helpers for attendance screens. All dates are local calendar dates
// (YYYY-MM-DD), never UTC, so early-morning use in India stays on "today".

const pad = (n) => String(n).padStart(2, '0');

export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISO(new Date());
export const thisMonth = () => todayISO().slice(0, 7);

export const parseISO = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

export const isISODate = (v) => !!parseISO((v || '').trim());

export const shiftDay = (iso, by) => {
  const d = parseISO(iso) || new Date();
  d.setDate(d.getDate() + by);
  return toISO(d);
};

export const shiftMonth = (ym, by) => {
  const [y, m] = (ym || thisMonth()).split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const monthLabel = (ym) => {
  if (!ym) return 'All time';
  const [y, m] = ym.split('-');
  return `${MONTHS_LONG[parseInt(m, 10) - 1]} ${y}`;
};

export const dayLabel = (iso) => {
  const d = parseISO(iso);
  return d ? d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : (iso || '');
};

export const STATUS_STYLE = {
  present:  { label: 'Present', short: 'P', bg: '#ECFDF5', fg: '#059669' },
  absent:   { label: 'Absent', short: 'A', bg: '#FEF2F2', fg: '#EF4444' },
  leave:    { label: 'Leave', short: 'L', bg: '#FFFBEB', fg: '#D97706' },
  half_day: { label: 'Half Day', short: 'H', bg: '#EFF6FF', fg: '#2563EB' },
  holiday:  { label: 'Holiday', short: '★', bg: '#F5F3FF', fg: '#7C3AED' },
};
