import axios from 'axios';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const api = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  withCredentials: true,
});

// Token refresh state — prevents multiple concurrent refresh attempts
let isRefreshing = false;
let refreshSubscribers = [];

const subscribeTokenRefresh = (cb) => refreshSubscribers.push(cb);
const onRefreshed = (newToken) => {
  refreshSubscribers.forEach(cb => cb(newToken));
  refreshSubscribers = [];
};

async function refreshAccessToken() {
  const refresh_token = localStorage.getItem('refresh_token');
  if (!refresh_token) throw new Error('No refresh token');
  const res = await axios.post(`${BACKEND_URL}/api/auth/refresh`, { refresh_token }, { withCredentials: true });
  const { token, refresh_token: newRefresh } = res.data;
  localStorage.setItem('auth_token', token);
  if (newRefresh) localStorage.setItem('refresh_token', newRefresh);
  return token;
}

// Request interceptor — attach JWT token + the selected academic session.
// The session header makes the whole platform session-aware centrally: the
// backend reads X-Academic-Year to scope reads, and tags writes, to the
// session the admin is currently viewing — without every call site passing it.
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const session = localStorage.getItem('view_session');
    if (session) {
      config.headers['X-Academic-Year'] = session;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — handle auth errors and surface server errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const originalRequest = error.config;

    if (status === 401 && !originalRequest._retry) {
      // Don't try to refresh on the public/unauthenticated auth endpoints — a
      // 401 there is a real failure (bad credentials / not logged in), not an
      // expired session. Attempting a token refresh + retry (or logout
      // redirect) just adds a slow, pointless round-trip to flows like the
      // student self-service password reset.
      const url = originalRequest.url || '';
      const isAuthEndpoint = /\/auth\/(login|register|refresh|logout|session|forgot-password|reset-password|student-reset-password)/.test(url);
      const hasRefreshToken = !!localStorage.getItem('refresh_token');

      if (!isAuthEndpoint && hasRefreshToken) {
        if (isRefreshing) {
          // Queue this request until refresh completes
          return new Promise((resolve, reject) => {
            subscribeTokenRefresh((newToken) => {
              if (newToken) {
                originalRequest.headers.Authorization = `Bearer ${newToken}`;
                originalRequest._retry = true;
                resolve(api(originalRequest));
              } else {
                reject(error);
              }
            });
          });
        }

        isRefreshing = true;
        originalRequest._retry = true;
        try {
          const newToken = await refreshAccessToken();
          isRefreshing = false;
          onRefreshed(newToken);
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        } catch (refreshError) {
          isRefreshing = false;
          onRefreshed(null);
          // Refresh failed — log out
          localStorage.removeItem('auth_token');
          localStorage.removeItem('refresh_token');
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
          return Promise.reject(refreshError);
        }
      }

      // No refresh token or refresh endpoint itself failed — log out
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    if (status === 403) {
      // Surface the backend's real reason when present (e.g. "This academic
      // session is closed and available in read-only mode") instead of a
      // generic message that misleads admins.
      const detail = error.response?.data?.detail;
      toast.error(typeof detail === 'string' && detail ? detail : 'You do not have permission to perform this action.');
      error._handled = true;
      return Promise.reject(error);
    }

    if (status === 429) {
      toast.error('Too many requests. Please wait a moment and try again.');
      error._handled = true;
      return Promise.reject(error);
    }

    if (status >= 500) {
      toast.error('A server error occurred. Please try again or contact support.');
      error._handled = true;
      return Promise.reject(error);
    }

    // Network / timeout errors (no response at all)
    // Use a fixed toast id so multiple concurrent failing calls only show one toast
    if (!error.response) {
      toast.error('Cannot reach the server. Please check your connection.', { id: 'network-error' });
      error._handled = true;
    }

    return Promise.reject(error);
  }
);

export default api;
