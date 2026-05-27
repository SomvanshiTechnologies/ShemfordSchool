import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../lib/api';

// Academic-session context.
//
// - activeSession: the school's official current academic year (admin-set,
//   stored server-side). Shown to everyone.
// - viewSession: the session the current user is *browsing*. Admins can switch
//   it (to inspect previous years) without changing the global active session;
//   the choice persists in localStorage. Non-admins are always pinned to
//   activeSession.
//
// Pages read `viewSession` and pass it as the `academic_year` param so data is
// scoped to the session being viewed.
const SessionContext = createContext(null);

export const useSession = () => {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
};

const VIEW_KEY = 'view_session';

export const SessionProvider = ({ children }) => {
  const [activeSession, setActiveSession] = useState('');
  const [available, setAvailable] = useState([]);
  const [sessions, setSessions] = useState([]); // full session objects (status, dates)
  const [viewSession, setViewSessionState] = useState(localStorage.getItem(VIEW_KEY) || '');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/settings/session');
      const active = res.data?.active_session || '';
      const avail = Array.isArray(res.data?.available_sessions) ? res.data.available_sessions : [];
      setActiveSession(active);
      setAvailable(avail);
      setSessions(Array.isArray(res.data?.sessions) ? res.data.sessions : []);
      // Always open into the CURRENT (active) session — the live operational
      // workspace. Reviewing a previous year is an explicit switch each session,
      // not a sticky default, so the admin never lands in a stale past year.
      if (active) {
        setViewSessionState(active);
        localStorage.setItem(VIEW_KEY, active);
      }
    } catch {
      /* not logged in yet / endpoint unavailable — stay empty */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Switch which session the user is viewing (persisted).
  const setViewSession = useCallback((s) => {
    setViewSessionState(s);
    if (s) localStorage.setItem(VIEW_KEY, s);
    else localStorage.removeItem(VIEW_KEY);
  }, []);

  // Admin: change the global active session, then refresh.
  const updateActiveSession = useCallback(async (s) => {
    const res = await api.put('/settings/session', { active_session: s });
    const active = res.data?.active_session || s;
    setActiveSession(active);
    setViewSession(active);
    await load();
    return active;
  }, [load, setViewSession]);

  // ── Manage Sessions (admin CRUD) ──────────────────────────────────────────
  const createSession = useCallback(async (payload) => {
    const res = await api.post('/sessions', payload);
    await load();
    return res.data;
  }, [load]);

  const editSession = useCallback(async (sessionId, payload) => {
    const res = await api.put(`/sessions/${sessionId}`, payload);
    await load();
    return res.data;
  }, [load]);

  const activateSession = useCallback(async (sessionId) => {
    const res = await api.post(`/sessions/${sessionId}/activate`);
    const active = res.data?.active_session;
    if (active) setViewSession(active);
    await load();
    return res.data;
  }, [load, setViewSession]);

  const setArchived = useCallback(async (sessionId, archived) => {
    const res = await api.post(`/sessions/${sessionId}/archive`, { archived });
    await load();
    return res.data;
  }, [load]);

  const effectiveView = viewSession || activeSession;

  // Persist the effective view (even the default) so the API layer can attach
  // it as the X-Academic-Year header on every request — making the whole
  // platform operate in the selected session from the first call.
  useEffect(() => {
    if (effectiveView) localStorage.setItem(VIEW_KEY, effectiveView);
  }, [effectiveView]);

  // Calendar bounds (YYYY-MM-DD) of the session being viewed. Indian academic
  // year runs Apr 1 → Mar 31. Prefer the session's stored dates; fall back to
  // deriving them from the "YYYY-YYYY" name.
  //
  // The ACTIVE (current) session runs up to today even though its academic year
  // nominally ends Mar 31 — so the present month is selectable (we're in May
  // 2026 but the active 2025-2026 session ends Mar 2026). PREVIOUS years are
  // strict to their Apr 1 → Mar 31 window, so they can't reach into a later
  // year's dates (no roster/attendance bleed). Because switching to a past year
  // is view-only (doesn't activate it), only the genuine current session is
  // ever extended.
  const sessionBounds = useMemo(() => {
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
    let start = '';
    let end = '';
    const obj = sessions.find((s) => s.session_name === effectiveView);
    if (obj?.start_date && obj?.end_date) {
      start = obj.start_date; end = obj.end_date;
    } else {
      const m = /^(\d{4})-(\d{4})$/.exec(effectiveView || '');
      if (m) { start = `${m[1]}-04-01`; end = `${m[2]}-03-31`; }
    }
    if (effectiveView && effectiveView === activeSession && end && today > end) end = today;
    return { start, end };
  }, [effectiveView, activeSession, sessions]);

  // A session-aware "today": the real date when it falls inside the session
  // window, otherwise clamped to the session's end (past session) or start
  // (future session). Date filters/durations anchor to this so a closed
  // 2024-2025 session never references 2026 dates.
  const sessionToday = useMemo(() => {
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
    if (!sessionBounds.start) return today;
    if (today < sessionBounds.start) return sessionBounds.start;
    if (today > sessionBounds.end) return sessionBounds.end;
    return today;
  }, [sessionBounds]);

  return (
    <SessionContext.Provider value={{
      activeSession,
      viewSession: effectiveView,
      availableSessions: available,
      sessions,
      sessionBounds,
      sessionToday,
      loading,
      setViewSession,
      updateActiveSession,
      reloadSessions: load,
      createSession,
      editSession,
      activateSession,
      setArchived,
    }}>
      {children}
    </SessionContext.Provider>
  );
};
