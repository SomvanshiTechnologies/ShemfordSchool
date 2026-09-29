import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import client from '../api/client';
import { useAuth } from './AuthContext';

const SessionContext = createContext(null);
const VIEW_KEY = 'view_session';

export const useSession = () => useContext(SessionContext);

export const SessionProvider = ({ children }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [activeSession, setActiveSession] = useState(null);
  const [available, setAvailable] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [viewSession, setViewSessionState] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await client.get('/settings/session');
      const { active_session, available_sessions, sessions: allSessions } = res.data || {};
      setActiveSession(active_session || null);
      setAvailable(Array.isArray(available_sessions) ? available_sessions : []);
      setSessions(Array.isArray(allSessions) ? allSessions : []);

      if (active_session) {
        const stored = await SecureStore.getItemAsync(VIEW_KEY);
        // Only admins keep a stored/previous choice, and only while it still
        // exists — a deleted/archived session falls back to the active one so
        // nobody stays stranded viewing a year that no longer exists.
        const next = isAdmin && stored && (available_sessions || []).includes(stored)
          ? stored
          : active_session;
        setViewSessionState(next);
        await SecureStore.setItemAsync(VIEW_KEY, next);
      }
    } catch (e) {
      console.warn('Session load failed', e?.message);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  // Seed synchronously from whatever was stored before load() corrects it, so
  // the first requests right after login aren't session-less.
  useEffect(() => {
    if (!user) { setViewSessionState(null); setLoading(false); return; }
    (async () => {
      const stored = await SecureStore.getItemAsync(VIEW_KEY);
      if (stored) setViewSessionState(stored);
      await load();
    })();
  }, [user, load]);

  const setViewSession = useCallback(async (name) => {
    if (!isAdmin) return;
    setViewSessionState(name);
    if (name) await SecureStore.setItemAsync(VIEW_KEY, name);
    else await SecureStore.deleteItemAsync(VIEW_KEY);
  }, [isAdmin]);

  const effectiveView = viewSession || activeSession;

  return (
    <SessionContext.Provider value={{
      activeSession,
      viewSession: effectiveView,
      availableSessions: available,
      sessions,
      loading,
      isViewingPastSession: !!activeSession && effectiveView !== activeSession,
      setViewSession,
      reload: load,
    }}>
      {children}
    </SessionContext.Provider>
  );
};
