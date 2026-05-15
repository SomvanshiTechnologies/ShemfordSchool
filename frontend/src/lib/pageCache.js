const cache = new Map();

export const getCached = (key) => cache.get(key) ?? null;
export const setCached = (key, data) => cache.set(key, data);
export const invalidatePrefix = (prefix) => { for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k); };
