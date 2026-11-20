import * as DocumentPicker from 'expo-document-picker';

// Must match the backend's CLASSES_WITH_STREAMS and the web dashboard's
// STREAMS_FOR_CLASS. For these classes the section IS the stream.
export const STREAM_CLASSES = ['11th', '12th'];
export const STREAM_SECTIONS = ['Science', 'Humanities'];

export const isStreamClass = (className) => STREAM_CLASSES.includes(className);

// Section options for a class, the same way the web dashboard builds them.
export const sectionsFor = (classes, className) => {
  if (!className) return [];
  if (isStreamClass(className)) return STREAM_SECTIONS;
  const cls = (classes || []).find(c => c.name === className);
  return (cls?.sections || []).map(s => s.section_name);
};

// For stream classes the stream is the lowercased section name.
export const streamFor = (className, section) =>
  isStreamClass(className) ? (section || '').toLowerCase() : undefined;

export const isTenDigits = (v) => /^\d{10}$/.test((v || '').trim());
export const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());
export const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test((v || '').trim());

// Turns any FastAPI error shape into one readable message.
export const errorText = (e, fallback = 'Something went wrong.') => {
  const detail = e?.response?.data?.detail;
  if (!detail) return e?.response ? fallback : 'Cannot reach the server. Check your connection.';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(d => d?.msg || String(d)).join('\n');
  if (detail.validation_errors) return Object.values(detail.validation_errors).join('\n');
  return fallback;
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const mimeFromName = (name = '') => {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.csv')) return 'text/csv';
  return 'application/octet-stream';
};

// Opens the system file picker. Returns { uri, name, type, size } or null if cancelled.
export const pickFile = async (types) => {
  const res = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const name = a.name || a.uri.split('/').pop() || 'file';
  return { uri: a.uri, name, type: a.mimeType || mimeFromName(name), size: a.size };
};

// A picked file as a React Native FormData part.
export const formFile = (file) => ({ uri: file.uri, name: file.name, type: file.type || mimeFromName(file.name) });

export const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };

export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
