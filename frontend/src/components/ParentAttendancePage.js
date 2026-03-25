import React, { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { currentAcademicYear } from '../lib/academicYear';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from './ui/select';
import { toast } from 'sonner';
import {
  Calendar, GraduationCap, CheckCircle2, XCircle, Clock,
  TrendingUp, AlertTriangle, ChevronLeft, ChevronRight, User
} from 'lucide-react';

// ─── helpers ─────────────────────────────────────────────────────────────────

const MONTHS = [
  { value: '2025-04', label: 'Apr 2025' },
  { value: '2025-05', label: 'May 2025' },
  { value: '2025-06', label: 'Jun 2025' },
  { value: '2025-07', label: 'Jul 2025' },
  { value: '2025-08', label: 'Aug 2025' },
  { value: '2025-09', label: 'Sep 2025' },
  { value: '2025-10', label: 'Oct 2025' },
  { value: '2025-11', label: 'Nov 2025' },
  { value: '2025-12', label: 'Dec 2025' },
  { value: '2026-01', label: 'Jan 2026' },
  { value: '2026-02', label: 'Feb 2026' },
  { value: '2026-03', label: 'Mar 2026' },
];

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function weekdayOf(yearMonth, day) {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m - 1, day).getDay(); // 0=Sun
}

function dateStr(yearMonth, day) {
  return `${yearMonth}-${String(day).padStart(2, '0')}`;
}

const STATUS_STYLE = {
  present: { bg: 'bg-green-100 text-green-700', dot: 'bg-green-500', label: 'Present' },
  absent:  { bg: 'bg-red-100 text-red-700',   dot: 'bg-red-500',   label: 'Absent'  },
  leave:   { bg: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500', label: 'Leave' },
};

function StatusDot({ status }) {
  const s = STATUS_STYLE[status];
  if (!s) return null;
  return <span className={`inline-block w-2 h-2 rounded-full ${s.dot}`} />;
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className={`rounded-lg border p-4 flex items-start gap-3 ${color}`}>
      <div className="mt-0.5"><Icon className="h-5 w-5" /></div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs font-medium mt-0.5">{label}</p>
        {sub && <p className="text-xs opacity-70 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function AttendanceCalendar({ yearMonth, records }) {
  const days = daysInMonth(yearMonth);
  const firstDay = weekdayOf(yearMonth, 1); // 0=Sun

  // Map date string → status
  const byDate = {};
  records.forEach(r => { byDate[r.date] = r.status; });

  const cells = [];
  // leading blanks
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {dayLabels.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-slate-500 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (!day) return <div key={`blank-${idx}`} />;
          const ds = dateStr(yearMonth, day);
          const status = byDate[ds];
          const isToday = ds === new Date().toISOString().slice(0, 10);
          const isFuture = ds > new Date().toISOString().slice(0, 10);

          let bg = 'bg-slate-100 text-slate-400'; // no data / future
          if (status === 'present') bg = 'bg-green-100 text-green-700 font-semibold';
          else if (status === 'absent') bg = 'bg-red-100 text-red-700 font-semibold';
          else if (status === 'leave') bg = 'bg-yellow-100 text-yellow-700 font-semibold';

          return (
            <div
              key={ds}
              title={status ? `${ds}: ${STATUS_STYLE[status]?.label}` : ds}
              className={`
                relative aspect-square flex items-center justify-center rounded-md text-xs
                ${bg}
                ${isToday ? 'ring-2 ring-slate-900 ring-offset-1' : ''}
                ${isFuture && !status ? 'opacity-40' : ''}
              `}
            >
              {day}
              {status === 'absent' && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
              )}
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 justify-end">
        {Object.entries(STATUS_STYLE).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1 text-xs text-slate-500">
            <span className={`w-2.5 h-2.5 rounded-sm ${v.dot.replace('bg-', 'bg-').replace('500', '200')} border border-current`} style={{background: k === 'present' ? '#bbf7d0' : k === 'absent' ? '#fecaca' : '#fef08a'}} />
            {v.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ChildAttendanceCard({ child, month }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/attendance/summary/${child.student_id}`, { params: { month } });
        setSummary(res.data);
      } catch {
        toast.error(`Failed to load attendance for ${child.first_name}`);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [child.student_id, month]);

  const pct = summary?.percentage ?? 0;
  const pctColor = pct >= 75 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-red-600';
  const pctBarColor = pct >= 75 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <Card className="overflow-hidden">
      {/* Child header */}
      <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-slate-900 flex items-center justify-center shrink-0">
          <User className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900">{child.first_name} {child.last_name}</h3>
          <p className="text-xs text-slate-500">
            Class {child.class_name}-{child.section} · Roll No. {child.roll_number}
          </p>
        </div>
        {summary && (
          <div className={`text-2xl font-bold tabular-nums ${pctColor}`}>
            {pct}%
          </div>
        )}
      </div>

      <CardContent className="p-5">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-[#1A1A1A]" />
          </div>
        ) : !summary ? null : (
          <div className="space-y-5">
            {/* Stats row */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard
                icon={CheckCircle2} label="Present" value={summary.present}
                sub={`of ${summary.total} days`}
                color="bg-green-50 text-green-700 border-green-200"
              />
              <StatCard
                icon={XCircle} label="Absent" value={summary.absent}
                color="bg-red-50 text-red-700 border-red-200"
              />
              <StatCard
                icon={Clock} label="Leave" value={summary.leave}
                color="bg-yellow-50 text-yellow-700 border-yellow-200"
              />
              <StatCard
                icon={TrendingUp} label="Attendance" value={`${pct}%`}
                sub={pct < 75 ? '⚠ Below 75%' : '✓ Good'}
                color={pct >= 75 ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-orange-50 text-orange-700 border-orange-200'}
              />
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Attendance rate</span>
                <span className={pctColor}>{pct}% {pct < 75 && '— Below minimum (75%)'}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pctBarColor}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-300 mt-0.5">
                <span>0%</span><span>75%</span><span>100%</span>
              </div>
            </div>

            {/* Low attendance warning */}
            {pct < 75 && summary.total > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-orange-50 border border-orange-200 text-sm text-orange-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Attendance is below the 75% minimum requirement.{' '}
                  {summary.total > 0 && (
                    <>
                      Your child needs to attend at least{' '}
                      <strong>{Math.max(0, Math.ceil(0.75 * summary.total) - summary.present)}</strong> more
                      {' '}days to reach 75%.
                    </>
                  )}
                </span>
              </div>
            )}

            {/* Calendar */}
            {summary.records && summary.records.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Calendar — {MONTHS.find(m => m.value === month)?.label ?? month}
                </p>
                <AttendanceCalendar yearMonth={month} records={summary.records} />
              </div>
            )}

            {/* Recent absences */}
            {summary.records && summary.records.filter(r => r.status === 'absent').length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Absent Days</p>
                <div className="flex flex-wrap gap-2">
                  {summary.records
                    .filter(r => r.status === 'absent')
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map(r => (
                      <Badge key={r.date} variant="outline" className="text-red-600 border-red-200 bg-red-50 text-xs">
                        {new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </Badge>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

const ParentAttendancePage = () => {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(currentMonth());

  useEffect(() => {
    const fetchChildren = async () => {
      try {
        const res = await api.get('/students');
        setChildren(res.data);
      } catch {
        toast.error('Failed to load children');
      } finally {
        setLoading(false);
      }
    };
    fetchChildren();
  }, []);

  const monthIndex = MONTHS.findIndex(m => m.value === month);

  const prevMonth = () => {
    if (monthIndex > 0) setMonth(MONTHS[monthIndex - 1].value);
  };
  const nextMonth = () => {
    if (monthIndex < MONTHS.length - 1) setMonth(MONTHS[monthIndex + 1].value);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">My Children's Attendance</h1>
          <p className="text-sm text-slate-500 mt-1">
            {children.length} child{children.length !== 1 ? 'ren' : ''} · Academic Year {currentAcademicYear()}
          </p>
        </div>

        {/* Month selector */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            disabled={monthIndex <= 0}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map(m => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={nextMonth}
            disabled={monthIndex >= MONTHS.length - 1}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1A1A1A]" />
        </div>
      ) : children.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-slate-500">
            <GraduationCap className="h-14 w-14 mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-semibold text-slate-900 mb-1">No children linked</h3>
            <p className="text-sm">Your account has no children linked yet. Contact the school admin.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {children.map(child => (
            <ChildAttendanceCard key={child.student_id} child={child} month={month} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ParentAttendancePage;
