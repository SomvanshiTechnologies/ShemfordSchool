import React from 'react';
import { useSession } from '../contexts/SessionContext';

// A native date input bounded to the selected academic session.
//
// Renders the browser's native <input type="date"> (same look/size as before)
// with min/max set to the session window, so:
//   - the current/active session allows dates up to today,
//   - previous sessions can't select dates outside their academic year.
// Using the native control keeps the original field size and the familiar
// year/month dropdown (years shown up to the session's max).
export default function SessionDatePicker({ value, onChange, className = '', disabled = false, 'data-testid': testid }) {
  const { sessionBounds } = useSession();
  return (
    <input
      type="date"
      disabled={disabled}
      data-testid={testid}
      min={sessionBounds.start || undefined}
      max={sessionBounds.end || undefined}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    />
  );
}
