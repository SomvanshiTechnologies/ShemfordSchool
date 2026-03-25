/**
 * Returns the current Indian academic year string (e.g. "2025-2026").
 * Academic year runs April–March: if current month >= April, year is this year to next.
 * Otherwise, year is previous year to this year.
 */
export function currentAcademicYear() {
  const now = new Date();
  const year = now.getFullYear();
  // JS months are 0-indexed: 3 = April
  return now.getMonth() >= 3
    ? `${year}-${year + 1}`
    : `${year - 1}-${year}`;
}
