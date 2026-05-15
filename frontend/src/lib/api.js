import axios from 'axios';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const api = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  withCredentials: true,
});

// Request interceptor — attach JWT token when present
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — handle auth errors and surface server errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    if (status === 401) {
      localStorage.removeItem('auth_token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    if (status === 403) {
      toast.error('You do not have permission to perform this action.');
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
