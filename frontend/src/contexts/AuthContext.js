import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { clearAllCache } from '../lib/pageCache';
import { warmCacheAfterLogin } from '../lib/prefetch';

// Persisted identity (Skillora-style): the last authenticated user object is
// kept in localStorage so a page load renders the app shell instantly instead
// of blocking on the /auth/me round trip. /auth/me still revalidates in the
// background — if the token turns out to be dead, state is cleared and the
// API layer's 401 handling redirects to /login.
const USER_KEY = 'auth_user';

const readStoredUser = () => {
  try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; }
  catch { return null; }
};

const storeUser = (u) => {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch { /* quota/serialization — identity cache is optional */ }
};

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  // Hydrate synchronously from the persisted identity: a returning user's UI
  // mounts immediately (loading=false) and pages paint from pageCache while
  // checkAuth revalidates against the server in the background.
  const [user, setUser] = useState(() => (localStorage.getItem('auth_token') ? readStoredUser() : null));
  const [loading, setLoading] = useState(() => !(localStorage.getItem('auth_token') && readStoredUser()));
  const [token, setToken] = useState(localStorage.getItem('auth_token'));

  const checkAuth = useCallback(async () => {
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    if (window.location.hash?.includes('session_id=')) {
      setLoading(false);
      return;
    }

    const storedToken = localStorage.getItem('auth_token');
    if (storedToken) {
      try {
        const response = await axios.get(`${API}/auth/me`, {
          headers: { Authorization: `Bearer ${storedToken}` },
          withCredentials: true
        });
        setUser(response.data);
        storeUser(response.data);
        setToken(storedToken);
      } catch (error) {
        console.error('Auth check failed:', error);
        localStorage.removeItem('auth_token');
        storeUser(null);
        setToken(null);
        setUser(null);
      }
    } else {
      // Try cookie-based auth
      try {
        const response = await axios.get(`${API}/auth/me`, {
          withCredentials: true
        });
        setUser(response.data);
        storeUser(response.data);
      } catch (error) {
        // Not authenticated
        setUser(null);
        storeUser(null);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    const response = await axios.post(`${API}/auth/login`, { email, password, platform: "web" });
    const { token: newToken, refresh_token, user: userData, active_session } = response.data;
    localStorage.setItem('auth_token', newToken);
    if (refresh_token) localStorage.setItem('refresh_token', refresh_token);
    // Seed the academic session BEFORE setUser: SessionContext reads it the
    // moment `user` lands, letting the first data fetches (X-Academic-Year)
    // fire immediately instead of waiting for /settings/session.
    if (active_session) localStorage.setItem('view_session', active_session);
    setToken(newToken);
    setUser(userData);
    storeUser(userData);
    // Warm the page cache for the heavy list pages (fire-and-forget) so
    // navigating there right after login paints instantly.
    warmCacheAfterLogin(userData, active_session);
    return userData;
  };

  const register = async (userData) => {
    const response = await axios.post(`${API}/auth/register`, userData);
    const { token: newToken, refresh_token, user: newUser } = response.data;
    localStorage.setItem('auth_token', newToken);
    if (refresh_token) localStorage.setItem('refresh_token', refresh_token);
    setToken(newToken);
    setUser(newUser);
    storeUser(newUser);
    return newUser;
  };

  const googleAuthUrl = process.env.REACT_APP_GOOGLE_AUTH_URL;

  const loginWithGoogle = () => {
    if (!googleAuthUrl) {
      console.error('REACT_APP_GOOGLE_AUTH_URL is not configured');
      return;
    }
    const redirectUrl = window.location.origin + '/dashboard';
    window.location.href = `${googleAuthUrl}?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const logout = async () => {
    const storedToken = localStorage.getItem('auth_token');
    const storedRefresh = localStorage.getItem('refresh_token');
    try {
      await axios.post(`${API}/auth/logout`,
        storedRefresh ? { refresh_token: storedRefresh } : {},
        { headers: storedToken ? { Authorization: `Bearer ${storedToken}` } : {}, withCredentials: true }
      );
    } catch (error) {
      // Even if logout fails, clear local token and session
    }
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    storeUser(null);
    clearAllCache();
    setToken(null);
    setUser(null);
  };

  const setAuthUser = (userData) => {
    setUser(userData);
    storeUser(userData);
  };

  const value = {
    user,
    token,
    loading,
    login,
    register,
    loginWithGoogle,
    googleAuthEnabled: !!googleAuthUrl,
    logout,
    setAuthUser,
    checkAuth,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isTeacher: user?.role === 'teacher',
    isStudent: user?.role === 'student',
    isParent: user?.role === 'parent',
    isAccountant: user?.role === 'accountant'
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
