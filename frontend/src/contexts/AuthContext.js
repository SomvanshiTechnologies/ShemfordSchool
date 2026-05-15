import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { clearAllCache } from '../lib/pageCache';

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
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
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
        setToken(storedToken);
      } catch (error) {
        console.error('Auth check failed:', error);
        localStorage.removeItem('auth_token');
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
      } catch (error) {
        // Not authenticated
        setUser(null);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    const response = await axios.post(`${API}/auth/login`, { email, password });
    const { token: newToken, refresh_token, user: userData } = response.data;
    localStorage.setItem('auth_token', newToken);
    if (refresh_token) localStorage.setItem('refresh_token', refresh_token);
    setToken(newToken);
    setUser(userData);
    return userData;
  };

  const register = async (userData) => {
    const response = await axios.post(`${API}/auth/register`, userData);
    const { token: newToken, refresh_token, user: newUser } = response.data;
    localStorage.setItem('auth_token', newToken);
    if (refresh_token) localStorage.setItem('refresh_token', refresh_token);
    setToken(newToken);
    setUser(newUser);
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
    clearAllCache();
    setToken(null);
    setUser(null);
  };

  const setAuthUser = (userData) => {
    setUser(userData);
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
