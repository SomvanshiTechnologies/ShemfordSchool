import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../config';

const TOKEN_KEY = 'auth_token';
const REFRESH_KEY = 'refresh_token';

const client = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Endpoints that must never trigger a token refresh (they are either public
// or part of the refresh flow itself).
const NO_REFRESH = [
  '/auth/login', '/auth/refresh', '/auth/logout', '/auth/register',
  '/auth/forgot-password', '/auth/reset-password', '/auth/student-reset-password',
];
const skipsRefresh = (url = '') => NO_REFRESH.some(p => url.includes(p));

// AuthContext registers this so a dead session signs the user out of the UI.
let onSessionExpired = null;
export const setSessionExpiredHandler = (fn) => { onSessionExpired = fn; };

export const saveTokens = async (token, refreshToken) => {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  if (refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
};

export const clearTokens = async () => {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
};

// Reads the "exp" claim (seconds) from a JWT without verifying it.
const tokenExpiry = (token) => {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = part + '==='.slice((part.length + 3) % 4);
    return JSON.parse(global.atob(padded)).exp || null;
  } catch {
    return null;
  }
};

// One refresh at a time: parallel requests that hit an expired token all wait
// for the same refresh instead of each rotating the refresh token.
let refreshPromise = null;
export const refreshAccessToken = () => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!refreshToken) {
        const err = new Error('No refresh token stored');
        err.noRefreshToken = true;
        throw err;
      }
      // Plain axios, not `client`, so this call never re-enters the interceptors.
      const res = await axios.post(`${API_URL}/auth/refresh`, { refresh_token: refreshToken }, { timeout: 15000 });
      await saveTokens(res.data.token, res.data.refresh_token);
      return res.data.token;
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
};

// The server rejected the refresh token, or there never was one: the session
// is over. A network failure is not treated as expiry.
const isDeadSession = (err) => !!(err?.noRefreshToken || err?.response);

const endSession = async () => {
  await clearTokens();
  onSessionExpired?.();
};

// An access token valid for at least 30 more seconds, refreshed if needed.
// Used by the request interceptor and by raw file downloads that bypass axios.
export const getValidToken = async () => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return null;
  const exp = tokenExpiry(token);
  if (exp && exp * 1000 - Date.now() < 30000) {
    try {
      return await refreshAccessToken();
    } catch (err) {
      if (isDeadSession(err)) { await endSession(); return null; }
      return token; // offline: let the request fail normally
    }
  }
  return token;
};

client.interceptors.request.use(async (config) => {
  const token = skipsRefresh(config.url)
    ? await SecureStore.getItemAsync(TOKEN_KEY)
    : await getValidToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Mirrors frontend/src/lib/api.js — an admin viewing a past academic year
  // (SessionContext) drives every request via this header.
  const viewSession = await SecureStore.getItemAsync('view_session');
  if (viewSession) {
    config.headers['X-Academic-Year'] = viewSession;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (error.response?.status !== 401 || !config || config._retried || skipsRefresh(config.url)) {
      return Promise.reject(error);
    }
    // Access token rejected (expired or revoked): refresh once and retry.
    config._retried = true;
    try {
      await refreshAccessToken();
      return client(config); // the request interceptor attaches the new token
    } catch (err) {
      if (isDeadSession(err)) await endSession();
      return Promise.reject(error);
    }
  }
);

export default client;
