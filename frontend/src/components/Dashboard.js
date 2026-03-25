import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { Progress } from './ui/progress';
import {
  Users, GraduationCap, CreditCard, AlertTriangle, Calendar, Bell,
  ArrowRight, UserCog, BarChart3, FileText, BookOpen, CheckCircle,
  TrendingUp, UserX, Activity, Banknote, Smartphone, Building2, Landmark,
  School, TicketCheck, MessageSquare,
} from 'lucide-react';
import { Link } from 'react-router-dom';

/* ─────────────────────────────────────────────
   Design tokens — icon bg / color per stat
───────────────────────────────────────────── */
const STAT_META = {
  'Total Students':     { icon: GraduationCap, iconBg: 'bg-blue-50',    iconColor: 'text-blue-600' },
  'Total Employees':    { icon: UserCog,        iconBg: 'bg-violet-50',  iconColor: 'text-violet-600' },
  'Employees':          { icon: UserCog,        iconBg: 'bg-violet-50',  iconColor: 'text-violet-600' },
  'Fee Collection':     { icon: TrendingUp,     iconBg: 'bg-orange-50',  iconColor: 'text-[#E88A1A]' },
  'Month Collection':   { icon: TrendingUp,     iconBg: 'bg-orange-50',  iconColor: 'text-[#E88A1A]' },
  'Fee Overdue':        { icon: AlertTriangle,  iconBg: 'bg-red-50',     iconColor: 'text-red-500' },
  "Today's Attendance": { icon: Calendar,       iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  'My Classes':         { icon: School,         iconBg: 'bg-blue-50',    iconColor: 'text-blue-600' },
  'Pending Attendance': { icon: Calendar,       iconBg: 'bg-amber-50',   iconColor: 'text-amber-600' },
  'Pending Marks':      { icon: FileText,       iconBg: 'bg-purple-50',  iconColor: 'text-purple-600' },
  'Fee Status':         { icon: CreditCard,     iconBg: 'bg-orange-50',  iconColor: 'text-[#E88A1A]' },
  'Attendance':         { icon: Calendar,       iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  'Children':           { icon: Users,          iconBg: 'bg-blue-50',    iconColor: 'text-blue-600' },
  'Messages':           { icon: MessageSquare,  iconBg: 'bg-purple-50',  iconColor: 'text-purple-600' },
};

const ACTION_META = {
  'Add Student':       { iconBg: 'bg-blue-50',    iconColor: 'text-blue-600' },
  'Mark Attendance':   { iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  'Collect Fees':      { iconBg: 'bg-orange-50',  iconColor: 'text-[#E88A1A]' },
  'Announcements':     { iconBg: 'bg-purple-50',  iconColor: 'text-purple-600' },
  'Reports':           { iconBg: 'bg-indigo-50',  iconColor: 'text-indigo-600' },
  'Manage Users':      { iconBg: 'bg-slate-100',  iconColor: 'text-slate-600' },
  'Enter Marks':       { iconBg: 'bg-teal-50',    iconColor: 'text-teal-600' },
  'Upload Syllabus':   { iconBg: 'bg-cyan-50',    iconColor: 'text-cyan-600' },
  'View Marksheet':    { iconBg: 'bg-blue-50',    iconColor: 'text-blue-600' },
  'Attendance':        { iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  'Syllabus':          { iconBg: 'bg-cyan-50',    iconColor: 'text-cyan-600' },
  'View Fees':         { iconBg: 'bg-orange-50',  iconColor: 'text-[#E88A1A]' },
  'Messages':          { iconBg: 'bg-purple-50',  iconColor: 'text-purple-600' },
  'Raise Issue':       { iconBg: 'bg-red-50',     iconColor: 'text-red-500' },
  'Due Chart':         { iconBg: 'bg-red-50',     iconColor: 'text-red-500' },
};

/* ─────────────────────────────────────────────
   Stat card
───────────────────────────────────────────── */
const Stat = ({ label, value }) => {
  const meta = STAT_META[label] || { icon: BarChart3, iconBg: 'bg-orange-50', iconColor: 'text-[#E88A1A]' };
  const Icon = meta.icon;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all duration-200">
      <div className="h-11 w-11 rounded-xl flex items-center justify-center mb-4 shrink-0" style={{}} >
        <div className={`h-11 w-11 rounded-xl ${meta.iconBg} flex items-center justify-center`}>
          <Icon className={`h-5 w-5 ${meta.iconColor}`} strokeWidth={1.5} />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-900 tracking-tight leading-none">{value}</p>
      <p className="text-sm text-slate-500 mt-1.5">{label}</p>
    </div>
  );
};

/* ─────────────────────────────────────────────
   Quick-action card
───────────────────────────────────────────── */
const Action = ({ title, desc, icon: Icon, to }) => {
  const meta = ACTION_META[title] || { iconBg: 'bg-orange-50', iconColor: 'text-[#E88A1A]' };
  return (
    <Link to={to}>
      <div
        className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-4 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group"
        data-testid={`quick-action-${title.toLowerCase().replace(/\s+/g, '-')}`}
      >
        <div className={`h-11 w-11 ${meta.iconBg} rounded-xl flex items-center justify-center shrink-0`}>
          <Icon className={`h-5 w-5 ${meta.iconColor}`} strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="text-xs text-slate-500 truncate mt-0.5">{desc}</p>
        </div>
        <ArrowRight
          className="h-4 w-4 text-slate-300 group-hover:text-[#E88A1A] group-hover:translate-x-0.5 transition-all duration-200 shrink-0"
          strokeWidth={1.5}
        />
      </div>
    </Link>
  );
};

/* ─────────────────────────────────────────────
   Section header
───────────────────────────────────────────── */
const SectionHeader = ({ title }) => (
  <h3 className="text-sm font-bold text-slate-800 mb-4">{title}</h3>
);

/* ─────────────────────────────────────────────
   Payment method icons
───────────────────────────────────────────── */
const PAYMENT_METHOD_ICONS = {
  cash: Banknote,
  online: Smartphone,
  cheque: FileText,
  bank_transfer: Landmark,
};

/* ─────────────────────────────────────────────
   Fee health widget
───────────────────────────────────────────── */
const FeeHealthWidget = ({ financial }) => {
  if (!financial) return null;
  const collected = financial.total_collection || 0;
  const pending   = financial.total_pending   || 0;
  const total     = collected + pending;
  const pct       = total > 0 ? Math.round((collected / total) * 100) : 0;
  const methods   = financial.by_payment_method || {};

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Collection health */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Fee Collection</p>
            <p className="text-3xl font-bold text-slate-900 mt-1 tracking-tight">
              ₹{collected.toLocaleString()}
            </p>
          </div>
          <div className="h-12 w-12 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0">
            <TrendingUp className="h-6 w-6 text-emerald-600" strokeWidth={1.5} />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span className="font-semibold text-emerald-600">{pct}% collected</span>
            <span>₹{pending.toLocaleString()} outstanding</span>
          </div>
          <Progress value={pct} className="h-2 rounded-full" />
        </div>
      </div>

      {/* Payment methods */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-5">
          Payment Methods
        </p>
        <div className="space-y-3.5">
          {Object.entries(methods).filter(([, v]) => v > 0).map(([method, amount]) => {
            const Icon = PAYMENT_METHOD_ICONS[method] || Banknote;
            const methodPct = collected > 0 ? Math.round((amount / collected) * 100) : 0;
            return (
              <div key={method} className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center shrink-0">
                  <Icon className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-600 capitalize">{method.replace('_', ' ')}</span>
                    <span className="font-semibold text-slate-900">₹{amount.toLocaleString()}</span>
                  </div>
                  <Progress value={methodPct} className="h-1.5 rounded-full" />
                </div>
              </div>
            );
          })}
          {Object.values(methods).every(v => v === 0) && (
            <p className="text-sm text-slate-400">No payments recorded yet</p>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   Attendance alerts widget
───────────────────────────────────────────── */
const AttendanceAlertsWidget = ({ alerts }) => {
  const flagged = alerts?.total_flagged ?? null;
  const list    = alerts?.alerts?.slice(0, 3) || [];
  const hasFlag = flagged > 0;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Low Attendance</p>
          <p className="text-3xl font-bold text-slate-900 mt-1 tracking-tight">
            {flagged === null ? '—' : flagged}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">students below 75%</p>
        </div>
        <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${hasFlag ? 'bg-amber-50' : 'bg-emerald-50'}`}>
          <UserX className={`h-5 w-5 ${hasFlag ? 'text-amber-500' : 'text-emerald-600'}`} strokeWidth={1.5} />
        </div>
      </div>

      <div className="space-y-0.5">
        {list.map(s => (
          <div key={s.student_id} className="flex items-center justify-between py-2 border-t border-slate-100 first:border-0">
            <span className="text-sm text-slate-700 truncate flex-1 mr-3">{s.student_name}</span>
            <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-lg ${
              s.attendance_percentage < 60
                ? 'bg-red-50 text-red-600'
                : 'bg-amber-50 text-amber-600'
            }`}>
              {s.attendance_percentage.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      {flagged > 3 && (
        <Link to="/attendance" className="text-xs text-[#E88A1A] mt-3 inline-block hover:underline font-semibold">
          View {flagged - 3} more →
        </Link>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────
   Recent activity widget
───────────────────────────────────────────── */
const ACTION_LABELS = { create: 'created', update: 'updated', delete: 'deleted', insert: 'added' };

const RecentActivityWidget = ({ logs }) => {
  if (!logs?.length) return null;
  return (
    <div>
      <SectionHeader title="Recent Activity" />
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        {logs.map((log, i) => {
          const verb   = ACTION_LABELS[log.action?.toLowerCase()] || log.action || 'modified';
          const entity = log.entity_type ? log.entity_type.replace(/_/g, ' ') : 'record';
          const actor  = log.performed_by_name || (log.performed_by ? String(log.performed_by).slice(0, 8) + '…' : 'System');
          const time   = log.created_at
            ? new Date(log.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
            : '';
          return (
            <div key={i} className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
              <div className="h-9 w-9 rounded-xl bg-orange-50 flex items-center justify-center shrink-0 mt-0.5">
                <Activity className="h-4 w-4 text-[#E88A1A]" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800">
                  <span className="font-semibold">{actor}</span>
                  {' '}<span className="text-slate-500">{verb}</span>
                  {' '}<span className="capitalize text-slate-700">{entity}</span>
                </p>
                <p className="text-xs text-slate-400 mt-0.5">{time}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   Role dashboards
───────────────────────────────────────────── */
const AdminDashboard = ({ stats, financial, attendanceAlerts, recentActivity }) => (
  <div className="space-y-8 animate-fade-in">
    {/* Top stats */}
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Stat label="Total Students"  value={stats.total_students  || 0} />
      <Stat label="Total Employees" value={stats.total_employees || 0} />
      <Stat label="Fee Collection"  value={`₹${(stats.month_collection || 0).toLocaleString()}`} />
      <Stat label="Fee Overdue"     value={stats.fee_overdue_count || 0} />
    </div>

    {/* Middle row */}
    <div className="grid gap-4 md:grid-cols-3">
      <Stat label="Today's Attendance" value={stats.today_present || 0} />

      {/* Open issues inline */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all duration-200">
        <div className="h-11 w-11 rounded-xl bg-red-50 flex items-center justify-center mb-4">
          <TicketCheck className="h-5 w-5 text-red-500" strokeWidth={1.5} />
        </div>
        <p className="text-2xl font-bold text-slate-900 tracking-tight">{stats.open_issues || 0}</p>
        <p className="text-sm text-slate-500 mt-1.5">Open Issues</p>
        <p className="text-xs text-slate-400 mt-0.5">Tickets to resolve</p>
      </div>

      <AttendanceAlertsWidget alerts={attendanceAlerts} />
    </div>

    <FeeHealthWidget financial={financial} />
    <RecentActivityWidget logs={recentActivity} />

    <div>
      <SectionHeader title="Quick Actions" />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Action title="Add Student"    desc="Register new admission"    icon={GraduationCap} to="/students?action=add" />
        <Action title="Mark Attendance" desc="Today's attendance"       icon={Calendar}      to="/attendance" />
        <Action title="Collect Fees"   desc="Record payment"            icon={CreditCard}    to="/fees" />
        <Action title="Announcements"  desc="Notify students & parents" icon={Bell}          to="/announcements" />
        <Action title="Reports"        desc="Analytics & insights"      icon={BarChart3}     to="/reports" />
        <Action title="Manage Users"   desc="Add or update users"       icon={Users}         to="/users" />
      </div>
    </div>
  </div>
);

const TeacherDashboard = ({ stats }) => (
  <div className="space-y-8 animate-fade-in">
    <div className="grid gap-4 md:grid-cols-3">
      <Stat label="My Classes"         value={stats.assigned_classes     || 0} />
      <Stat label="Pending Attendance" value={stats.pending_attendance   || 0} />
      <Stat label="Pending Marks"      value={stats.pending_marks_entry  || 0} />
    </div>
    <div>
      <SectionHeader title="Quick Actions" />
      <div className="grid gap-3 md:grid-cols-3">
        <Action title="Mark Attendance" desc="Mark today's attendance"  icon={Calendar}   to="/attendance" />
        <Action title="Enter Marks"     desc="Update student marks"     icon={CheckCircle} to="/marks" />
        <Action title="Upload Syllabus" desc="Add study materials"      icon={BookOpen}   to="/syllabus" />
      </div>
    </div>
  </div>
);

const StudentDashboard = ({ stats }) => (
  <div className="space-y-8 animate-fade-in">
    {stats.app_locked && (
      <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 flex items-center gap-4">
        <div className="h-10 w-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
          <AlertTriangle className="h-5 w-5 text-[#E88A1A]" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900">Account Restricted</p>
          <p className="text-xs text-slate-600 mt-0.5">Access limited due to pending fees. Contact the accounts office.</p>
        </div>
      </div>
    )}

    <div className="grid gap-4 md:grid-cols-3">
      <Stat label="Fee Status"  value={stats.fee_status || 'N/A'} />
      <Stat label="Attendance"  value={`${stats.attendance_percentage || 0}%`} />

      {/* Attendance progress card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="h-11 w-11 rounded-xl bg-emerald-50 flex items-center justify-center mb-4">
          <TrendingUp className="h-5 w-5 text-emerald-600" strokeWidth={1.5} />
        </div>
        <div className="flex items-end justify-between mb-3">
          <p className="text-2xl font-bold text-slate-900 tracking-tight">
            {stats.attendance_percentage || 0}<span className="text-base text-slate-400 font-semibold">%</span>
          </p>
          <span className={`text-[11px] font-bold px-2 py-1 rounded-lg ${
            stats.attendance_percentage >= 75
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-600'
          }`}>
            {stats.attendance_percentage >= 75 ? 'On Track' : 'Below 75%'}
          </span>
        </div>
        <Progress value={stats.attendance_percentage || 0} className="h-2 rounded-full" />
        <p className="text-xs text-slate-500 mt-2">Attendance Progress</p>
      </div>
    </div>

    <div>
      <SectionHeader title="Quick Actions" />
      <div className="grid gap-3 md:grid-cols-3">
        <Action title="View Marksheet" desc="Check your results"        icon={FileText}  to="/my-marks" />
        <Action title="Attendance"     desc="Check attendance record"   icon={Calendar}  to="/my-attendance" />
        <Action title="Syllabus"       desc="Access study materials"    icon={BookOpen}  to="/syllabus" />
      </div>
    </div>
  </div>
);

const ParentDashboard = ({ stats }) => (
  <div className="space-y-8 animate-fade-in">
    <div className="grid gap-4 md:grid-cols-2">
      <Stat label="Children" value={stats.children_count || 0} />
      <Stat label="Messages" value={0} />
    </div>

    {stats.children?.length > 0 && (
      <div>
        <SectionHeader title="Your Children" />
        <div className="grid gap-3 md:grid-cols-2">
          {stats.children.map((child) => (
            <div key={child.student_id} className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-4 shadow-sm hover:shadow-md transition-all duration-200">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#E88A1A] to-[#C97516] flex items-center justify-center text-white text-lg font-bold shrink-0 shadow-md shadow-orange-200/40">
                {child.first_name?.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">{child.first_name} {child.last_name}</p>
                <p className="text-xs text-slate-500 mt-0.5">Class {child.class_name} · {child.section}</p>
                <span className={`inline-flex items-center mt-2 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${
                  child.fee_status === 'paid'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-orange-50 text-orange-600'
                }`}>
                  {child.fee_status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}

    <div>
      <SectionHeader title="Quick Actions" />
      <div className="grid gap-3 md:grid-cols-3">
        <Action title="View Fees"   desc="Check fee status"    icon={CreditCard}    to="/my-fees" />
        <Action title="Messages"    desc="View communications" icon={Bell}          to="/messages" />
        <Action title="Raise Issue" desc="Report a concern"    icon={AlertTriangle} to="/issues" />
      </div>
    </div>
  </div>
);

const AccountantDashboard = ({ stats }) => (
  <div className="space-y-8 animate-fade-in">
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Stat label="Total Students"  value={stats.total_students      || 0} />
      <Stat label="Month Collection" value={`₹${(stats.month_collection || 0).toLocaleString()}`} />
      <Stat label="Fee Overdue"     value={stats.fee_overdue_count   || 0} />
      <Stat label="Employees"       value={stats.total_employees     || 0} />
    </div>
    <div>
      <SectionHeader title="Quick Actions" />
      <div className="grid gap-3 md:grid-cols-3">
        <Action title="Collect Fees" desc="Record payment"     icon={CreditCard}    to="/fees" />
        <Action title="Due Chart"    desc="View pending fees"  icon={AlertTriangle} to="/fees?tab=due" />
        <Action title="Reports"      desc="View reports"       icon={BarChart3}     to="/reports" />
      </div>
    </div>
  </div>
);

/* ─────────────────────────────────────────────
   Main Dashboard component
───────────────────────────────────────────── */
const Dashboard = () => {
  const { user } = useAuth();
  const [stats,            setStats]            = useState({});
  const [financial,        setFinancial]        = useState(null);
  const [attendanceAlerts, setAttendanceAlerts] = useState(null);
  const [recentActivity,   setRecentActivity]   = useState(null);
  const [loading,          setLoading]          = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await api.get('/reports/dashboard');
        setStats(response.data);
      } catch (error) {
        console.error('Failed to fetch dashboard stats:', error);
      } finally { setLoading(false); }
    };

    const fetchAdminExtras = async () => {
      const [fin, alerts, logs] = await Promise.allSettled([
        api.get('/reports/financial'),
        api.get('/attendance/alerts', { params: { threshold: 75 } }),
        api.get('/audit-logs', { params: { limit: 5 } }),
      ]);
      if (fin.status    === 'fulfilled') setFinancial(fin.value.data);
      if (alerts.status === 'fulfilled') setAttendanceAlerts(alerts.value.data);
      if (logs.status   === 'fulfilled') setRecentActivity(logs.value.data);
    };

    fetchStats();
    if (user?.role === 'admin') fetchAdminExtras();

    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchStats();
        if (user?.role === 'admin') fetchAdminExtras();
      }
    }, 60000);
    return () => clearInterval(intervalId);
  }, [user?.role]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="relative">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-200 border-t-[#E88A1A]" />
        </div>
      </div>
    );
  }

  const dashboards = {
    admin:      AdminDashboard,
    teacher:    TeacherDashboard,
    student:    StudentDashboard,
    parent:     ParentDashboard,
    accountant: AccountantDashboard,
  };

  const DashComponent = dashboards[user?.role] || (() => (
    <div className="text-center py-16 text-slate-400 text-sm">
      No dashboard available for your role. Please contact the school administrator.
    </div>
  ));

  return (
    <div data-testid="dashboard">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Welcome back, <span className="font-semibold text-slate-700">{user?.name}</span>
        </p>
      </div>

      <DashComponent
        stats={stats}
        financial={financial}
        attendanceAlerts={attendanceAlerts}
        recentActivity={recentActivity}
      />
    </div>
  );
};

export default Dashboard;
