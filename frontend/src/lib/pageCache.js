// SWR-style page cache:
// - Persists to sessionStorage so cache survives page reloads (F5) within the same tab.
// - In-memory Map layered on top for O(1) hot-path reads without JSON parsing.
// - TTL prevents stale data from sticking around forever; expired entries are
//   transparently treated as missing so a fresh fetch can run.

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_PREFIX = 'pc:';

const mem = new Map();

const safeSession = () => {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; }
  catch { return null; }
};

export const getCached = (key) => {
  // 1. Hot path — in-memory
  const inMem = mem.get(key);
  if (inMem && inMem._t + TTL_MS > Date.now()) return inMem._d;

  // 2. Fall back to sessionStorage
  const ss = safeSession();
  if (!ss) return null;
  try {
    const raw = ss.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?._t || parsed._t + TTL_MS < Date.now()) {
      ss.removeItem(STORAGE_PREFIX + key);
      return null;
    }
    // Warm up in-memory layer
    mem.set(key, parsed);
    return parsed._d;
  } catch {
    return null;
  }
};

export const setCached = (key, data) => {
  const entry = { _t: Date.now(), _d: data };
  mem.set(key, entry);
  const ss = safeSession();
  if (!ss) return;
  try {
    ss.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota exceeded or non-serializable — drop silently, in-memory copy still works
  }
};

export const invalidatePrefix = (prefix) => {
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
  const ss = safeSession();
  if (!ss) return;
  try {
    for (let i = ss.length - 1; i >= 0; i--) {
      const k = ss.key(i);
      if (k?.startsWith(STORAGE_PREFIX + prefix)) ss.removeItem(k);
    }
  } catch {}
};

export const clearAllCache = () => {
  mem.clear();
  const ss = safeSession();
  if (!ss) return;
  try {
    for (let i = ss.length - 1; i >= 0; i--) {
      const k = ss.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) ss.removeItem(k);
    }
  } catch {}
};
