import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import api from '../lib/api';
import { useMobile } from '../hooks/useMobile';
import MobileLayout from '../mobile/MobileLayout';
import '../mobile/mobile.css';
import {
  LayoutDashboard, Users, GraduationCap, UserCog, Calendar,
  CreditCard, FileText, Bell, BookOpen, TicketCheck, MessageSquare,
  BarChart3, LogOut, Menu, X, School, AlertTriangle, ArrowUpCircle, Settings, Wallet,
  History, Search, Loader2, ChevronDown, Check, Pencil, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { displaySection } from '../lib/utils';
import { useSession } from '../contexts/SessionContext';

const LOGO_URL = "/logo.webp";

const ALL_MENU_ITEMS = [
  { name: 'Dashboard',              icon: LayoutDashboard, path: '/dashboard',           roles: ['admin', 'teacher', 'student', 'parent', 'accountant'] },
  { name: 'Students',               icon: GraduationCap,   path: '/students',            roles: ['admin', 'teacher', 'accountant'] },
  { name: 'Classes',                icon: School,           path: '/class-structure',     roles: ['admin', 'teacher'] },
  { name: 'Attendance',             icon: Calendar,         path: '/attendance',          roles: ['admin', 'teacher'] },
  { name: 'My Attendance',          icon: Calendar,         path: '/my-attendance',       roles: ['student'] },
  { name: "Children's Attendance",  icon: Calendar,         path: '/children-attendance', roles: ['parent'] },
  { name: 'Marks',                  icon: FileText,         path: '/marks',               roles: ['admin', 'teacher'] },
  { name: 'My Marks',               icon: FileText,         path: '/my-marks',            roles: ['student'] },
  { name: "Children's Results",     icon: FileText,         path: '/children-marks',      roles: ['parent'] },
  { name: 'Syllabus',               icon: BookOpen,         path: '/syllabus',            roles: ['teacher', 'student', 'parent'] },
  { name: 'Fees',                   icon: CreditCard,       path: '/fees',                roles: ['admin', 'accountant'] },
  { name: 'My Fees',                icon: CreditCard,       path: '/my-fees',             roles: ['student', 'parent'] },
  { name: 'Payroll',                icon: Wallet,           path: '/payroll',             roles: ['admin', 'accountant', 'teacher'] },
  { name: 'Employees',              icon: UserCog,          path: '/employees',           roles: ['admin'] },
  { name: 'Users',                  icon: Users,            path: '/users',               roles: ['admin'] },
  { name: 'Announcements',          icon: Bell,             path: '/announcements',       roles: ['admin', 'teacher', 'student', 'parent'] },
  { name: 'Reports',                icon: BarChart3,        path: '/reports',             roles: ['admin', 'accountant'] },
  { name: 'Upgradation',            icon: ArrowUpCircle,    path: '/upgradation',         roles: ['admin'] },
  { name: 'Audit Trails',           icon: History,          path: '/audit-trail',         roles: ['admin'] },
  { name: 'Issues',                 icon: TicketCheck,      path: '/issues',              roles: ['admin', 'teacher', 'student', 'parent'] },
  { name: 'Messages',               icon: MessageSquare,    path: '/messages',            roles: ['admin', 'teacher', 'student', 'parent'] },
  { name: 'Deletion Requests',      icon: Trash2,           path: '/account-deletions',   roles: ['admin'] },
  { name: 'Settings',               icon: Settings,         path: '/settings',            roles: ['admin', 'teacher', 'student', 'parent', 'accountant'] },
];

const SIDEBAR_SECTIONS = [
  { label: null,             names: ['Dashboard'] },
  { label: 'Academic',      names: ['Students', 'Classes', 'Attendance', 'My Attendance', "Children's Attendance", 'Marks', 'My Marks', "Children's Results", 'Syllabus'] },
  { label: 'Finance',       names: ['Fees', 'My Fees', 'Payroll'] },
  { label: 'Administration',names: ['Employees', 'Users', 'Announcements', 'Reports', 'Upgradation', 'Audit Trails'] },
  { label: 'Community',     names: ['Issues', 'Messages', 'Deletion Requests'] },
  { label: null,             names: ['Settings'] },
];

const getMenuItems = (role) => ALL_MENU_ITEMS.filter(item => item.roles.includes(role));

// Renders children into a detached div appended to <body>, so overlays escape
// the sidebar's CSS transform (which would otherwise anchor `position:fixed`).
// The container is a real element from first render, avoiding the
// "Target container is not a DOM element" error.
const ModalPortal = ({ children }) => {
  const [el] = useState(() => (typeof document !== 'undefined' ? document.createElement('div') : null));
  useEffect(() => {
    if (!el) return;
    document.body.appendChild(el);
    return () => { try { document.body.removeChild(el); } catch (_) {} };
  }, [el]);
  if (!el) return null;
  return createPortal(children, el);
};

// ─── Sidebar session selector (admin-only) ───────────────────────────────────
// Sits at the very top of the sidebar, above Dashboard. Shows the active
// academic session, lets the admin switch which session they're viewing (all
// modules scope their data to it) and edit the active session. DB-backed via
// the session context (/settings/session). Defaults to the current year.
const SidebarSessionSelector = () => {
  const { activeSession, viewSession, availableSessions, setViewSession } = useSession();
  const [pending, setPending] = useState(null);   // session awaiting switch confirmation
  const [showManage, setShowManage] = useState(false);

  if (!viewSession) return null;

  // Switching changes which session the admin is *viewing* (and writing to) — it
  // does NOT change the active/operational session. Any session is fully editable
  // and behaves exactly like the active one; writes are scoped to the viewed year.
  // To change the active session, use Manage Sessions → Activate.
  const doSwitch = (name) => {
    setViewSession(name);
    setPending(null);
  };

  // Only the current (writable) year is flagged; previous years show plain.
  const label = (name) => (name === activeSession ? `${name} (current)` : name);

  return (
    <>
      <p className="sidebar-section-label">Session</p>
      <div className="relative mx-2">
        <Calendar className="sidebar-icon h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" strokeWidth={1.5} />
        <select
          value={viewSession}
          onChange={e => { if (e.target.value !== viewSession) setPending(e.target.value); }}
          data-testid="session-view-select"
          className="w-full appearance-none cursor-pointer truncate pl-9 pr-9 py-2.5 text-sm leading-5 text-slate-400 hover:text-white hover:bg-white/10 transition-all duration-200 rounded-xl bg-transparent focus:outline-none"
        >
          {availableSessions.map(s => (
            <option key={s} value={s} className="bg-slate-900 text-white">{label(s)}</option>
          ))}
        </select>
        <ChevronDown className="h-4 w-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
      <button
        type="button"
        onClick={() => setShowManage(true)}
        className="mx-2 mt-1 mb-1 flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-500 hover:text-white transition-colors"
        data-testid="manage-sessions-btn"
      >
        <Settings className="h-3 w-3" /> Manage Sessions
      </button>

      {/* Confirm switching the viewed session — portaled to body so it
          centres on the viewport (the sidebar's transform would otherwise
          anchor a fixed element to the sidebar). */}
      {pending && (
        <ModalPortal>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setPending(null)}>
            <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-slate-900 mb-1">View {pending}?</h3>
              <p className="text-sm text-slate-500 mb-4">
                The platform will show <strong>{pending}</strong> data across all modules.
                {pending !== activeSession && ' This is a previous year, shown for review — new entries are made in the current year. '}
                The current session ({activeSession}) is unchanged.
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPending(null)} className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
                <button onClick={() => doSwitch(pending)} className="px-3 py-2 text-sm rounded-lg bg-[#E88A1A] text-white font-semibold">View</button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {showManage && <ManageSessionsModal onClose={() => setShowManage(false)} />}
    </>
  );
};

// ─── Manage Sessions modal (admin CRUD) ───────────────────────────────────────
const ManageSessionsModal = ({ onClose }) => {
  const { sessions, createSession, activateSession, setArchived, reloadSessions } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const create = async () => {
    setBusy(true); setErr('');
    try { await createSession({ session_name: name.trim() }); setName(''); }
    catch (e) { setErr(e.response?.data?.detail || 'Failed to create session'); }
    finally { setBusy(false); }
  };
  const act = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e.response?.data?.detail || 'Action failed'); } finally { setBusy(false); } };

  const badge = (st) => {
    const map = {
      active: { cls: 'bg-emerald-100 text-emerald-700', text: 'Current' },
      archived: { cls: 'bg-slate-200 text-slate-600', text: 'Previous Year' },
      upcoming: { cls: 'bg-blue-100 text-blue-700', text: 'Upcoming' },
    };
    const b = map[st] || { cls: 'bg-slate-100 text-slate-500', text: st };
    return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${b.cls}`}>{b.text}</span>;
  };

  return (
    <ModalPortal>
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-base font-semibold text-slate-900">Manage Academic Sessions</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 border-b bg-slate-50">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">New session</label>
          <div className="flex items-center gap-2 mt-1">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="YYYY-YYYY (e.g. 2026-2027)"
              className="flex-1 h-9 px-3 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-100" />
            <Button size="sm" className="h-9 bg-slate-900 text-white text-xs" disabled={busy || !name.trim()} onClick={create}>Create</Button>
          </div>
          {err && <p className="text-xs text-red-500 mt-1.5">{err}</p>}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sessions.length === 0 && <p className="text-sm text-slate-400 text-center py-6">No sessions yet.</p>}
          {sessions.map(s => (
            <div key={s.session_id} className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-50 border-b border-slate-100 last:border-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{s.session_name}</span>
                  {badge(s.status)}
                </div>
                <p className="text-[11px] text-slate-400">{s.start_date} → {s.end_date}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {s.is_active && (
                  <button onClick={() => act(() => setArchived(s.session_id, true))} disabled={busy}
                    className="text-xs px-2 py-1 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50">
                    End session
                  </button>
                )}
                {!s.is_active && (
                  <button onClick={() => act(() => activateSession(s.session_id))} disabled={busy}
                    className="text-xs px-2 py-1 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                    Activate
                  </button>
                )}
                {s.status !== 'archived' && !s.is_active && (
                  <button onClick={() => act(() => setArchived(s.session_id, true))} disabled={busy}
                    className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
                    Close
                  </button>
                )}
                {s.status === 'archived' && (
                  <button onClick={() => act(() => setArchived(s.session_id, false))} disabled={busy}
                    className="text-xs px-2 py-1 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50">
                    Reopen
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t flex justify-end">
          <Button size="sm" variant="outline" onClick={() => { reloadSessions(); onClose(); }}>Done</Button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
};

const Sidebar = ({ isOpen, onClose }) => {
  const location = useLocation();
  const navigate  = useNavigate();
  const { user, logout } = useAuth();
  const menuItems = getMenuItems(user?.role || 'student');

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-64 bg-[#0F172A] transform transition-transform duration-300 ease-in-out lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        data-testid="sidebar"
      >
        <div className="flex flex-col h-full">

          {/* ── Logo ── */}
          <div className="flex items-center justify-between px-5 h-16 border-b border-white/[0.06] shrink-0">
            <Link
              to="/dashboard"
              className="opacity-90 hover:opacity-100 transition-opacity duration-200"
            >
              <img src={LOGO_URL} alt="Shemford" className="h-[42px] w-auto" />
            </Link>
            <button
              className="lg:hidden h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 transition-all"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── Navigation ── */}
          <ScrollArea className="flex-1 py-2">
            <nav className="px-1">
              {user?.role === 'admin' && <SidebarSessionSelector onNavigate={onClose} />}
              {SIDEBAR_SECTIONS.map((section, sectionIdx) => {
                const sectionItems = menuItems.filter(item => section.names.includes(item.name));
                if (!sectionItems.length) return null;
                return (
                  <div key={section.label || `section-${sectionIdx}`}>
                    {section.label && (
                      <p className="sidebar-section-label">{section.label}</p>
                    )}
                    <div className="space-y-0.5">
                      {sectionItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path;
                        return (
                          <Link
                            key={item.path}
                            to={item.path}
                            onClick={onClose}
                            className={cn("sidebar-item", isActive && "active")}
                            data-testid={`sidebar-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                          >
                            <Icon className="sidebar-icon h-4 w-4 shrink-0" strokeWidth={1.5} />
                            <span className="truncate">{item.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>
          </ScrollArea>

          {/* ── User footer ── */}
          <div className="shrink-0 p-3 border-t border-white/[0.06]">
            <div className="flex items-center gap-3 px-2 py-2.5 rounded-xl mb-1">
              <div className="h-9 w-9 rounded-full ring-2 ring-[#E88A1A]/30 bg-gradient-to-br from-[#E88A1A] to-[#C97516] flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-lg shadow-orange-900/30">
                {user?.name?.charAt(0) || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate leading-tight">
                  {user?.name}
                </p>
                <p className="text-[11px] text-slate-500 capitalize mt-0.5">{user?.role}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2.5 w-full px-2 py-2 text-xs text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 rounded-xl uppercase tracking-wider font-medium"
              data-testid="logout-btn"
            >
              <LogOut className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              Sign Out
            </button>
          </div>

        </div>
      </aside>
    </>
  );
};

const Layout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [appLocked, setAppLocked]     = useState(false);
  const { user }   = useAuth();
  const location   = useLocation();
  const isMobile   = useMobile();
  const { reloadSessions } = useSession();

  // The session context loads once at app mount — which may be before login
  // (401). Re-fetch when the authenticated layout mounts so the selector
  // populates right after sign-in.
  useEffect(() => { if (user) reloadSessions(); }, [user, reloadSessions]);

  useEffect(() => {
    const checkAppLock = async () => {
      if (user?.role === 'student' || user?.role === 'parent') {
        try {
          const response = await api.get('/reports/dashboard');
          setAppLocked(!!response.data.app_locked);
        } catch (error) { console.error('App lock check failed', error); }
      }
    };
    checkAppLock();
  }, [user]);

  const allowedLockedPaths = ['/dashboard', '/fees', '/my-fees'];
  const isLockedOut = appLocked && !allowedLockedPaths.some(p => location.pathname.startsWith(p));

  const currentPage = ALL_MENU_ITEMS.find(item => item.path === location.pathname);
  const PageIcon    = currentPage?.icon;
  const isStaff = ['admin', 'accountant', 'teacher'].includes(user?.role);

  // On mobile viewports, hide the desktop sidebar and use the mobile bottom-
  // tab navigation instead. This keeps the same page content (Payroll, Users,
  // Settings, etc.) but lets the user navigate back via the bottom tabs.
  if (isMobile) {
    return (
      <MobileLayout>
        {isLockedOut ? (
          <div className="flex flex-col items-center justify-center h-64 text-center" data-testid="locked-content">
            <div className="h-20 w-20 rounded-3xl bg-orange-50 flex items-center justify-center mb-5">
              <AlertTriangle className="h-10 w-10 text-[#E88A1A]" strokeWidth={1.5} />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Access Restricted</h2>
            <p className="text-sm text-slate-500 mb-6 max-w-xs">
              Clear overdue fees to restore full access to the portal.
            </p>
            <Link to="/my-fees">
              <Button className="bg-[#E88A1A] hover:bg-[#C97516] text-white rounded-xl px-6 shadow-lg shadow-orange-200/50">
                View Fees
              </Button>
            </Link>
          </div>
        ) : children}
      </MobileLayout>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-64">

        {/* ── Header ── */}
        <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-6 bg-white/90 backdrop-blur-md border-b border-slate-200">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden -ml-2 rounded-xl"
              onClick={() => setSidebarOpen(true)}
              data-testid="mobile-menu-btn"
            >
              <Menu className="h-5 w-5" strokeWidth={1.5} />
            </Button>
            {PageIcon && (
              <div className="h-8 w-8 rounded-xl bg-orange-50 flex items-center justify-center">
                <PageIcon className="h-4 w-4 text-[#E88A1A]" strokeWidth={1.5} />
              </div>
            )}
            <span className="text-sm font-bold text-slate-800">
              {currentPage?.name || 'Dashboard'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {isStaff && <HeaderStudentSearch />}
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xs font-semibold text-slate-700">{user?.name}</span>
              <span className="text-[10px] text-slate-400 capitalize">{user?.role}</span>
            </div>
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#E88A1A] to-[#C97516] flex items-center justify-center text-white text-xs font-bold shadow-md shadow-orange-200/60">
              {user?.name?.charAt(0) || 'U'}
            </div>
          </div>
        </header>

        {/* ── App lock banner ── */}
        {appLocked && (
          <div
            className="flex items-center gap-3 px-6 py-3 bg-orange-50 border-b-2 border-[#E88A1A]"
            data-testid="app-lock-banner"
          >
            <div className="h-7 w-7 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-3.5 w-3.5 text-[#E88A1A]" strokeWidth={1.5} />
            </div>
            <p className="text-xs text-slate-700 font-medium">
              Account restricted due to overdue fees. Access limited to Dashboard and Fees.
            </p>
          </div>
        )}

        {/* ── Main ── */}
        <main className="p-4 sm:p-6 lg:p-8 min-w-0 overflow-x-hidden">
          {isLockedOut ? (
            <div className="flex flex-col items-center justify-center h-64 text-center" data-testid="locked-content">
              <div className="h-20 w-20 rounded-3xl bg-orange-50 flex items-center justify-center mb-5">
                <AlertTriangle className="h-10 w-10 text-[#E88A1A]" strokeWidth={1.5} />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Access Restricted</h2>
              <p className="text-sm text-slate-500 mb-6 max-w-xs">
                Clear overdue fees to restore full access to the portal.
              </p>
              <Link to="/my-fees">
                <Button className="bg-[#E88A1A] hover:bg-[#C97516] text-white rounded-xl px-6 shadow-lg shadow-orange-200/50">
                  View Fees
                </Button>
              </Link>
            </div>
          ) : children}
        </main>

      </div>
    </div>
  );
};

// ─── Header quick-search ─────────────────────────────────────────────────────
// Admin/teacher/accountant-only search box in the topbar. Hits /students
// with the debounced term, which is matched against name, admission no,
// email, parent name/phone/email. Click a result → navigates to
// /students?focus=<student_id> so the listing page can scroll/open it.
const HeaderStudentSearch = () => {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const boxRef = React.useRef(null);

  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await api.get('/students', { params: { search: t, limit: 8, is_active: true } });
        const arr = Array.isArray(res.data) ? res.data : (res.data?.students ?? []);
        setResults(arr.slice(0, 8));
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(handle);
  }, [term]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const pick = (s) => {
    setOpen(false);
    setTerm('');
    setResults([]);
    navigate(`/students?focus=${encodeURIComponent(s.student_id)}`);
  };

  return (
    <div ref={boxRef} className="relative hidden md:block w-72">
      <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" strokeWidth={1.8} />
      <input
        type="text"
        placeholder="Search students by name, email, parent…"
        value={term}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="w-full h-9 pl-9 pr-9 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-100 transition"
        data-testid="header-student-search"
      />
      {loading && <Loader2 className="absolute right-3 top-2.5 h-3.5 w-3.5 text-slate-400 animate-spin" />}
      {!loading && term && (
        <button type="button" onClick={() => { setTerm(''); setResults([]); }} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && term.trim().length >= 2 && (
        <div className="absolute mt-1.5 w-full max-h-80 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg z-50">
          {results.length === 0 && !loading && (
            <p className="px-3 py-2.5 text-xs text-slate-400">No students match "{term}"</p>
          )}
          {results.map((s) => (
            <button
              key={s.student_id}
              type="button"
              onClick={() => pick(s)}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
            >
              <p className="text-xs font-semibold text-slate-900 truncate">
                {s.first_name} {s.last_name}
                <span className="text-[10px] font-normal text-slate-400 ml-2 font-mono">{s.admission_number}</span>
              </p>
              <p className="text-[11px] text-slate-500 truncate">
                Class {s.class_name}{s.section ? ` · ${displaySection(s)}` : ''}
                {s.parent_name && <> · Parent: {s.parent_name}</>}
                {s.email && <> · {s.email}</>}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default Layout;
