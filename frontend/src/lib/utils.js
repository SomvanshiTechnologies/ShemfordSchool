import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount) {
  return `Rs.${Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function getInitials(name) {
  if (!name) return '';
  return name
    .split(' ')
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function truncate(str, length = 50) {
  if (!str) return '';
  return str.length > length ? str.slice(0, length) + '...' : str;
}

// For Class 11th / 12th the section displayed to users should be the
// stream (Science / Humanities) rather than the colour-named section
// that older student records still carry (Indigo / Red / Violet …).
// Pass a student-like object with { class_name, section, stream }.
const STREAM_CLASSES = new Set(['11', '11th', '12', '12th', 'Class 11', 'Class 12']);
export function displaySection(student) {
  if (!student) return '';
  const cls = student.class_name || student.class || '';
  const isStreamClass = STREAM_CLASSES.has(String(cls));
  if (isStreamClass && student.stream) {
    const s = String(student.stream);
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  return student.section || '';
}
