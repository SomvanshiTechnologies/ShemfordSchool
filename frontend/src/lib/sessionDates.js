// Session-aware date helpers.
//
// The Fees reports (and other modules) offer relative "Duration" filters
// (Today, This Week, This Month, This Year, ...). These must be anchored to the
// *session* being viewed, not the live system clock — otherwise selecting a
// closed 2024-2025 session and "This Year" would compute 2026 dates.
//
// `resolveDuration` mirrors the backend `_duration_range`, but uses a supplied
// reference date (the session-aware "today" from SessionContext) and clamps the
// result to the session bounds.

const toDate = (s) => {
  // Parse YYYY-MM-DD as a *local* date (avoid UTC shifting the day).
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const fmt = (dt) => {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const addDays = (dt, n) => { const x = new Date(dt); x.setDate(x.getDate() + n); return x; };

// Resolve a duration keyword into an inclusive { start, end } YYYY-MM-DD range,
// or null for "all_time" (no date constraint).
//
//   duration   — one of the DURATIONS keywords
//   refToday   — session-aware "today" (YYYY-MM-DD)
//   bounds     — { start, end } of the session (YYYY-MM-DD); used to clamp
//   custom     — { start, end } for duration === 'custom'
export function resolveDuration(duration, refToday, bounds = {}, custom = {}) {
  if (!duration || duration === 'all_time') return null;
  if (duration === 'custom') {
    if (!custom.start || !custom.end) return null;
    return { start: custom.start, end: custom.end };
  }
  const ref = toDate(refToday);
  let start, end;
  switch (duration) {
    case 'today':
      start = end = ref; break;
    case 'yesterday':
      start = end = addDays(ref, -1); break;
    case 'this_week': {
      const dow = (ref.getDay() + 6) % 7; // Monday = 0
      start = addDays(ref, -dow); end = ref; break;
    }
    case 'last_week': {
      const dow = (ref.getDay() + 6) % 7;
      const mondayThis = addDays(ref, -dow);
      end = addDays(mondayThis, -1); start = addDays(end, -6); break;
    }
    case 'this_month':
      start = new Date(ref.getFullYear(), ref.getMonth(), 1); end = ref; break;
    case 'last_month': {
      const firstThis = new Date(ref.getFullYear(), ref.getMonth(), 1);
      end = addDays(firstThis, -1);
      start = new Date(end.getFullYear(), end.getMonth(), 1); break;
    }
    case 'this_year': {
      // Academic year: April 1 → the reference date.
      const y = ref.getMonth() >= 3 ? ref.getFullYear() : ref.getFullYear() - 1;
      start = new Date(y, 3, 1); end = ref; break;
    }
    default:
      start = end = ref;
  }
  let s = fmt(start), e = fmt(end);
  // Clamp to session bounds so a range never reaches outside the session.
  if (bounds.start && s < bounds.start) s = bounds.start;
  if (bounds.end && e > bounds.end) e = bounds.end;
  return { start: s, end: e };
}
