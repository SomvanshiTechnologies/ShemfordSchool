import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import client, { saveTokens, clearTokens, setSessionExpiredHandler } from '../api/client';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef(null);
  userRef.current = user;

  // The API client calls this when the refresh token is rejected, i.e. the
  // session really is over (not on every 15-minute access-token expiry).
  useEffect(() => {
    setSessionExpiredHandler(() => {
      const wasSignedIn = !!userRef.current;
      setUser(null);
      if (wasSignedIn) Alert.alert('Session expired', 'Please sign in again.');
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      if (token) {
        const res = await client.get('/auth/me');
        setUser(res.data);
      }
    } catch (e) {
      // Only a rejected login ends the session; a network error keeps the
      // stored tokens so the user isn't signed out just for being offline.
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        await clearTokens();
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    // Explicit platform so a student's web-only login restriction can never
    // apply here — the backend only gates platform === "web".
    const res = await client.post('/auth/login', { email, password, platform: 'app' });
    const { token, refresh_token: refreshToken, user: userData } = res.data;
    await saveTokens(token, refreshToken);
    setUser(userData);
    return userData;
  };

  // Revokes the access and refresh tokens on the server, then clears them
  // locally. Signing out still works offline; the server call is best effort.
  const logout = async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync('refresh_token');
      await client.post('/auth/logout', refreshToken ? { refresh_token: refreshToken } : {}, { timeout: 5000 });
    } catch {
      // ignore: local sign-out below still happens
    }
    await clearTokens();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};
