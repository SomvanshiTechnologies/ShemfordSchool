// Hard bounds for native <input type="date"> fields.
//
// The browser's native date input treats the `min`/`max` attributes as form
// *validation* hints only: a user can still type an out-of-range year (e.g.
// "20200") into the year box and the control keeps displaying it. To actually
// enforce a range we clamp the value in the change handler and feed the clamped
// value back into the controlled input, so the display self-corrects.
//
// Note: plain string comparison of ISO dates breaks for 5-digit years
// ("20200-10-12" sorts *before* "2026-03-31" lexicographically), so we compare
// a numeric key (year*10000 + month*100 + day) instead.

const isoKey = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return null;
  return y * 10000 + m * 100 + d;
};

// Clamp an ISO (YYYY-MM-DD) value to the inclusive [min, max] window.
// Empty/invalid input passes through unchanged; missing bounds are ignored.
export function clampISODate(value, { min, max } = {}) {
  if (!value) return value;
  const key = isoKey(value);
  if (key == null) return value;
  if (min) { const k = isoKey(min); if (k != null && key < k) return min; }
  if (max) { const k = isoKey(max); if (k != null && key > k) return max; }
  return value;
}

// Local "today" as YYYY-MM-DD (used as the max for past-only fields like DOB).
export const todayISO = () => new Date().toLocaleDateString('en-CA');
