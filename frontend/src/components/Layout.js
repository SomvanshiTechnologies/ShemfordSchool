import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import api from '../lib/api';
import {
  LayoutDashboard, Users, GraduationCap, UserCog, Calendar,
  CreditCard, FileText, Bell, BookOpen, TicketCheck, MessageSquare,
  BarChart3, LogOut, Menu, X, School, AlertTriangle, ArrowUpCircle, Settings, Wallet,
  History
} from 'lucide-react';

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
  { name: 'Syllabus',               icon: BookOpen,         path: '/syllabus',            roles: ['teacher', 'student', 'parent'] },
  { name: 'Fees',                   icon: CreditCard,       path: '/fees',                roles: ['admin', 'accountant'] },
  { name: 'My Fees',                icon: CreditCard,       path: '/my-fees',             roles: ['student', 'parent'] },
  { name: 'Payroll',                icon: Wallet,           path: '/payroll',             roles: ['admin', 'accountant', 'teacher'] },
  { name: 'Employees',              icon: UserCog,          path: '/employees',           roles: ['admin'] },
  { name: 'Users',                  icon: Users,            path: '/users',               roles: ['admin'] },
  { name: 'Announcements',          icon: Bell,             path: '/announcements',       roles: ['admin', 'teacher'] },
  { name: 'Reports',                icon: BarChart3,        path: '/reports',             roles: ['admin', 'accountant'] },
  { name: 'Upgradation',            icon: ArrowUpCircle,    path: '/upgradation',         roles: ['admin'] },
  { name: 'Audit Trails',           icon: History,          path: '/audit-trail',         roles: ['admin'] },
  { name: 'Issues',                 icon: TicketCheck,      path: '/issues',              roles: ['admin', 'teacher', 'student', 'parent'] },
  { name: 'Messages',               icon: MessageSquare,    path: '/messages',            roles: ['admin', 'teacher', 'student', 'parent'] },
  { name: 'Settings',               icon: Settings,         path: '/settings',            roles: ['admin', 'teacher', 'student', 'parent', 'accountant'] },
];

const SIDEBAR_SECTIONS = [
  { label: null,             names: ['Dashboard'] },
  { label: 'Academic',      names: ['Students', 'Classes', 'Attendance', 'My Attendance', "Children's Attendance", 'Marks', 'My Marks', 'Syllabus'] },
  { label: 'Finance',       names: ['Fees', 'My Fees', 'Payroll'] },
  { label: 'Administration',names: ['Employees', 'Users', 'Announcements', 'Reports', 'Upgradation', 'Audit Trails'] },
  { label: 'Community',     names: ['Issues', 'Messages'] },
  { label: null,             names: ['Settings'] },
];

const getMenuItems = (role) => ALL_MENU_ITEMS.filter(item => item.roles.includes(role));

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
        <main className="p-8">
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

export default Layout;
