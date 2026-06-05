import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';
import SessionDatePicker from './SessionDatePicker';
import api from '../lib/api';
import { getCached, setCached } from '../lib/pageCache';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from './ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from './ui/table';
import { toast } from 'sonner';
import { Calendar, CheckCircle, XCircle, Clock, Lock, Unlock, Save, Loader2, AlertTriangle, Users, Plus, Trash2, Download, FileText } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

// ====== STUDENT VIEW ======
const StudentAttendanceView = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));

  useEffect(() => {
    setLoading(true);
    api.get('/attendance', { params: { entity_type: 'student', month: selectedMonth } })
      .then(res => setRecords(res.data))
      .catch((e) => { if (!e?._handled) toast.error('Failed to fetch attendance'); })
      .finally(() => setLoading(false));
  }, [selectedMonth]);

  const present = records.filter(r => r.status === 'present').length;
  const absent = records.filter(r => r.status === 'absent').length;
  const total = records.length;
  const pct = total > 0 ? ((present / total) * 100).toFixed(1) : 0;

  return (
    <div data-testid="student-attendance-view">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">My Attendance</h1>
        <p className="text-sm text-slate-500 mt-1">View your attendance records</p>
      </div>
      <div className="mb-6">
        <input type="month" className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} data-testid="month-picker" />
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-900 border-t-transparent" /></div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4 mb-6">
            <div className="bg-slate-900 p-5 rounded-2xl"><p className="stat-label-dark">Total Days</p><p className="text-2xl font-bold text-white">{total}</p></div>
            <div className="bg-white border border-slate-200 p-5 rounded-2xl"><p className="stat-label">Present</p><p className="text-2xl font-bold text-slate-900">{present}</p></div>
            <div className="bg-white border border-slate-200 p-5 rounded-2xl"><p className="stat-label">Absent</p><p className="text-2xl font-bold text-slate-900">{absent}</p></div>
            <div className="bg-white border border-slate-200 p-5 rounded-2xl"><p className="stat-label">Attendance %</p><p className="text-2xl font-bold text-slate-900">{pct}%</p></div>
          </div>
          {records.length > 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <Table>
                <TableHeader><TableRow className="bg-slate-50">
                  <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Date</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {records.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-slate-900">{r.date}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold ${r.status === 'present' ? 'bg-slate-900 text-white' : r.status === 'absent' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500"><Calendar className="h-12 w-12 mx-auto mb-4" strokeWidth={1} /><p>No attendance records for this month</p></div>
          )}
        </>
      )}
    </div>
  );
};

// ====== TEACHER/ADMIN VIEW ======
const MarkAttendanceView = () => {
  const { user } = useAuth();
  const { sessionBounds, sessionToday, viewSession } = useSession();
  const isAdmin = user?.role === 'admin';

  const [activeTab, setActiveTab] = useState('mark');
  const [classes, setClasses] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [students, setStudents] = useState([]);
  const [attendanceData, setAttendanceData] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [sessionStatus, setSessionStatus] = useState(null);

  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  // Report
  const [reportSubTab, setReportSubTab] = useState('class');
  const [reportClass, setReportClass] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  // Alerts
  const [alerts, setAlerts] = useState(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertThreshold, setAlertThreshold] = useState('75');

  // Employee attendance
  const [empAttDate, setEmpAttDate] = useState('');
  const [empAttData, setEmpAttData] = useState({});
  const [savingEmpAtt, setSavingEmpAtt] = useState(false);

  // Employee attendance report
  const [empReportMonth, setEmpReportMonth] = useState(new Date().toISOString().slice(0, 7));
  const [empReportData, setEmpReportData] = useState(null);
  const [empReportLoading, setEmpReportLoading] = useState(false);

  // Holidays
  const [holidays, setHolidays] = useState([]);
  const [showHolidayDialog, setShowHolidayDialog] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ date: '', name: '', type: 'public' });

  // Bulk unlock (#8)
  const [bulkUnlockSessions, setBulkUnlockSessions] = useState([{ class_name: '', section: '', date: '' }]);
  const [bulkUnlocking, setBulkUnlocking] = useState(false);
  // Holiday delete confirmation
  const [deleteHolidayTarget, setDeleteHolidayTarget] = useState(null);

  // Track whether the user has manually picked a date. Until they do, the date
  // always follows sessionToday so both the phase-1 stale value AND the phase-2
  // corrected value are applied automatically. Refs reset when session switches.
  const dateUserSet = useRef(false);
  const empDateUserSet = useRef(false);

  useEffect(() => {
    dateUserSet.current = false;
    empDateUserSet.current = false;
  }, [viewSession]);

  useEffect(() => {
    const outOfRange = (d) => d && sessionBounds.start && (d < sessionBounds.start || d > sessionBounds.end);
    setSelectedDate((d) => (!dateUserSet.current || outOfRange(d)) ? sessionToday : d);
    setEmpAttDate((d) => (!empDateUserSet.current || outOfRange(d)) ? sessionToday : d);
    setReportDate((d) => (outOfRange(d) ? '' : d));
  }, [sessionBounds, sessionToday]);

  useEffect(() => {
    Promise.all([
      api.get('/classes').catch(() => ({ data: [] })),
      isAdmin ? api.get('/employees').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      api.get('/holidays').catch(() => ({ data: [] })),
    ]).then(([c, e, h]) => {
      setClasses(c.data);
      setEmployees(e.data);
      setHolidays(h.data);
    });
    // Refetch on session change so holidays (and class counts) reflect the
    // selected session.
  }, [isAdmin, viewSession]);

  useEffect(() => {
    if (!selectedClass || !selectedSection || !selectedDate) return;
    const controller = new AbortController();
    const { signal } = controller;
    const cacheKey = `attendance:${viewSession}:${selectedClass}:${selectedSection}:${selectedDate}`;
    const cached = getCached(cacheKey);
    if (cached) {
      setStudents(cached.students);
      setSessionStatus(cached.sessionStatus);
      setAttendanceData(cached.attMap);
      setLoading(false);
    } else {
      // Clear stale holiday banner and data immediately so old date's state
      // never persists while the new date's request is in flight.
      setSessionStatus(null);
      setStudents([]);
      setAttendanceData({});
      setLoading(true);
    }
    Promise.all([
      api.get('/students', { params: { class_name: selectedClass, section: selectedSection }, signal }),
      api.get('/attendance', { params: { entity_type: 'student', date: selectedDate, class_name: selectedClass, section: selectedSection }, signal }),
      api.get('/attendance/session-status', { params: { class_name: selectedClass, section: selectedSection, date: selectedDate }, signal }),
    ]).then(([s, a, sess]) => {
      if (signal.aborted) return;
      const studentList = (s.data.students ?? s.data ?? [])
        .filter(stu => !stu.admission_date || String(stu.admission_date).slice(0, 10) <= selectedDate);
      const attMap = {};
      a.data.forEach(r => { attMap[r.entity_id] = r.status; });
      setStudents(studentList);
      setSessionStatus(sess.data);
      setAttendanceData(attMap);
      setCached(cacheKey, { students: studentList, sessionStatus: sess.data, attMap });
    }).catch((e) => {
      if (e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError') return;
      if (!cached) toast.error('Failed to fetch data');
    }).finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedClass, selectedSection, selectedDate, viewSession]);

  const isLocked = sessionStatus?.is_locked && sessionStatus?.submitted;
  const isHoliday = sessionStatus?.is_holiday;
  const canEdit = !isLocked && !isHoliday || isAdmin;

  const handleAttendanceChange = (entityId, status) => {
    if (!canEdit) return;
    setAttendanceData(prev => ({ ...prev, [entityId]: status }));
  };

  const markAllPresent = () => {
    if (!canEdit) return;
    const n = {};
    students.forEach(s => { n[s.student_id] = 'present'; });
    setAttendanceData(n);
  };

  const saveAttendance = async () => {
    setSaving(true);
    try {
      const records = students.map(s => ({
        entity_type: 'student', entity_id: s.student_id, date: selectedDate,
        status: attendanceData[s.student_id] || 'absent', class_name: selectedClass, section: selectedSection,
      }));
      const res = await api.post('/attendance', { class_name: selectedClass, section: selectedSection, date: selectedDate, records });
      toast.success(res.data.message || 'Attendance saved & locked');
      if (res.data.parents_notified > 0) {
        toast.info(`${res.data.parents_notified} absent parent(s) notified`);
      }
      setSessionStatus({ submitted: true, is_locked: true, ...res.data });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save attendance');
    } finally { setSaving(false); }
  };

  const unlockAttendance = async () => {
    setUnlocking(true);
    try {
      await api.post('/attendance/unlock', { class_name: selectedClass, section: selectedSection, date: selectedDate });
      toast.success('Attendance unlocked for editing');
      setSessionStatus({ ...sessionStatus, is_locked: false });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to unlock');
    } finally { setUnlocking(false); }
  };

  const fetchReport = async () => {
    setReportLoading(true);
    try {
      const params = {};
      if (reportClass) params.class_name = reportClass;
      if (reportDate) params.date = reportDate;
      const res = await api.get('/reports/attendance', { params });
      setReportData(res.data);
    } catch (error) { if (!error?._handled) toast.error('Failed to fetch report'); }
    finally { setReportLoading(false); }
  };

  const fetchAlerts = async () => {
    setAlertsLoading(true);
    try {
      const res = await api.get('/attendance/alerts', { params: { threshold: parseFloat(alertThreshold) } });
      setAlerts(res.data);
    } catch (error) { if (!error?._handled) toast.error('Failed to fetch alerts'); }
    finally { setAlertsLoading(false); }
  };

  const downloadCSV = (rows, filename) => {
    const csv = rows.map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  // Open a clean, printable preview of a report in a new window. The browser's
  // print dialog lets the admin review it on screen and Save-as-PDF / print —
  // a preview rather than a forced CSV download.
  const previewReport = ({ title, subtitle, summary = [], columns, rows }) => {
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cards = summary.map(s => `<div class="card"><span class="lbl">${esc(s.label)}</span><span class="val">${esc(s.value)}</span></div>`).join('');
    const head = columns.map(c => `<th>${esc(c)}</th>`).join('');
    const body = rows.length
      ? rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${columns.length}" style="text-align:center;padding:24px;color:#888">No records</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>
        *{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}
        body{margin:24px;color:#1a1a1a}
        h1{font-size:18px;margin:0}
        .sub{color:#666;font-size:12px;margin:2px 0 16px}
        .cards{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
        .card{border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;min-width:110px}
        .card .lbl{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#888}
        .card .val{font-size:20px;font-weight:700}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
        th{background:#f1f5f9;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
        tr:nth-child(even) td{background:#f8fafc}
        .toolbar{margin-bottom:14px}
        .toolbar button{padding:8px 16px;border:none;border-radius:8px;background:#E88A1A;color:#fff;font-weight:700;cursor:pointer}
        @media print{.toolbar{display:none}}
      </style></head>
      <body>
        <div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
        <h1>${esc(title)}</h1>
        <div class="sub">${esc(subtitle || '')} &middot; Generated ${new Date().toLocaleString('en-IN')}</div>
        <div class="cards">${cards}</div>
        <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('Allow pop-ups to preview the report.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  };

  const fetchEmployeeReport = async () => {
    setEmpReportLoading(true);
    try {
      const res = await api.get('/attendance/employees', { params: { month: empReportMonth } });
      const records = Array.isArray(res.data) ? res.data : [];
      // Group by employee
      const byEmp = {};
      records.forEach(r => {
        if (!byEmp[r.entity_id]) byEmp[r.entity_id] = { present: 0, absent: 0, leave: 0, total: 0, name: r.name || r.entity_id };
        byEmp[r.entity_id][r.status] = (byEmp[r.entity_id][r.status] || 0) + 1;
        byEmp[r.entity_id].total += 1;
      });
      setEmpReportData({ records, summary: byEmp });
    } catch { toast.error('Failed to fetch employee report'); }
    finally { setEmpReportLoading(false); }
  };

  const saveEmployeeAttendance = async () => {
    setSavingEmpAtt(true);
    try {
      const records = employees.filter(e => e.is_active).map(e => ({
        employee_id: e.employee_id,
        status: empAttData[e.employee_id] || 'present',
      }));
      const res = await api.post('/attendance/employee', { date: empAttDate, records });
      toast.success(res.data.message);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
    finally { setSavingEmpAtt(false); }
  };

  const addHoliday = async () => {
    if (!holidayForm.date || !holidayForm.name) { toast.error('Date and name required'); return; }
    try {
      await api.post('/holidays', holidayForm);
      toast.success('Holiday added');
      setShowHolidayDialog(false);
      setHolidayForm({ date: '', name: '', type: 'public' });
      const res = await api.get('/holidays');
      setHolidays(res.data);
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed'); }
  };

  const deleteHoliday = async (id) => {
    try {
      await api.delete(`/holidays/${id}`);
      toast.success('Holiday removed');
      setHolidays(prev => prev.filter(h => h.holiday_id !== id));
      setDeleteHolidayTarget(null);
    } catch (error) { toast.error('Failed to remove holiday'); }
  };

  const selectedClassSections = classes.find(c => c.name === selectedClass)?.sections || [];
  const statusButtons = [
    { value: 'present', icon: CheckCircle, label: 'P', tooltip: 'Present', activeColor: 'bg-slate-900 text-white' },
    { value: 'absent', icon: XCircle, label: 'A', tooltip: 'Absent', activeColor: 'bg-red-500 text-white' },
    { value: 'leave', icon: Clock, label: 'L', tooltip: 'Leave', activeColor: 'bg-slate-500 text-white' },
  ];

  return (
    <div data-testid="attendance-page">
      <div className="page-header mb-8">
        <div className="page-header-inner">
          <div className="page-header-accent" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Attendance</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Mark and track daily attendance</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6 rounded-xl h-10 bg-slate-100 flex-wrap">
          <TabsTrigger value="mark" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="mark-tab">Students</TabsTrigger>
          {isAdmin && <TabsTrigger value="employee" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="employee-tab">Employees</TabsTrigger>}
          <TabsTrigger value="report" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="report-tab">Report</TabsTrigger>
          {/* <TabsTrigger value="alerts" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="alerts-tab">Alerts</TabsTrigger> */}
          {isAdmin && <TabsTrigger value="holidays" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="holidays-tab">Holidays</TabsTrigger>}
          {/* {isAdmin && <TabsTrigger value="bulk-unlock" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="bulk-unlock-tab">Bulk Unlock</TabsTrigger>} */}
        </TabsList>

        {/* ====== MARK STUDENT ATTENDANCE ====== */}
        <TabsContent value="mark">
          <Card className="mb-6"><CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-900">Class</label>
                <Select value={selectedClass} onValueChange={(v) => { setSelectedClass(v); setSelectedSection(''); setSessionStatus(null); }}>
                  <SelectTrigger className="w-[120px]" data-testid="att-class"><SelectValue placeholder="Select class" /></SelectTrigger>
                  <SelectContent>{classes.map(c => <SelectItem key={c.name} value={c.name}>{c.display_name || (c.name.startsWith('Class ') ? c.name : `Class ${c.name}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-900">Section</label>
                <Select value={selectedSection} onValueChange={setSelectedSection} disabled={!selectedClass}>
                  <SelectTrigger className="w-[150px]" data-testid="att-section"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{selectedClassSections.map(sec => { const n = typeof sec === 'string' ? sec : sec.section_name; return <SelectItem key={n} value={n}>{n}</SelectItem>; })}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-900">Date</label>
                <SessionDatePicker value={selectedDate} onChange={(d) => { dateUserSet.current = true; setSelectedDate(d); }} data-testid="att-date" />
              </div>
              {canEdit && students.length > 0 && !isHoliday && (
                <>
                  <Button variant="outline" onClick={markAllPresent} className="rounded-xl text-xs" data-testid="mark-all-present"><CheckCircle className="h-4 w-4 mr-2" strokeWidth={1.5} /> Mark All Present</Button>
                  <Button onClick={saveAttendance} disabled={saving} className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs" data-testid="save-attendance">
                    {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : <><Save className="h-4 w-4 mr-2" strokeWidth={1.5} />{isLocked && isAdmin ? 'Override & Save' : 'Submit & Lock'}</>}
                  </Button>
                </>
              )}
              {isLocked && isAdmin && (
                <Button variant="outline" onClick={unlockAttendance} disabled={unlocking} className="rounded-xl text-xs border-slate-900 text-slate-900" data-testid="unlock-attendance">
                  {unlocking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Unlock className="h-4 w-4 mr-2" strokeWidth={1.5} />} Unlock
                </Button>
              )}
            </div>
          </CardContent></Card>

          {/* Holiday banner */}
          {isHoliday && (
            <div className="mb-4 flex items-center gap-3 bg-amber-500 text-white px-5 py-3 rounded-xl" data-testid="holiday-banner">
              <Calendar className="h-4 w-4" strokeWidth={1.5} />
              <span className="text-sm font-medium">{selectedDate} is a holiday: {sessionStatus?.holiday_name}. Attendance cannot be marked.</span>
            </div>
          )}

          {sessionStatus?.submitted && !isHoliday && (
            <div className="mb-4 flex items-center gap-2 flex-wrap" data-testid="session-summary">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold">Total <span className="text-base font-black text-slate-900">{sessionStatus.student_count || sessionStatus.success || 0}</span></span>
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200">Present <span className="text-base font-black text-emerald-800">{sessionStatus.present_count || sessionStatus.present || 0}</span></span>
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 text-red-700 text-xs font-bold border border-red-200">Absent <span className="text-base font-black text-red-800">{sessionStatus.absent_count || sessionStatus.absent || 0}</span></span>
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-50 text-slate-600 text-xs font-bold border border-slate-200">Leave <span className="text-base font-black text-slate-700">{sessionStatus.leave_count || sessionStatus.leave || 0}</span></span>
            </div>
          )}

          {isLocked && !isHoliday && (
            <div className="mb-4 flex items-center gap-3 bg-slate-900 text-white px-5 py-3 rounded-xl" data-testid="locked-banner">
              <Lock className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
              <span className="text-sm font-medium">Attendance submitted & locked for {selectedClass}-{selectedSection} on {selectedDate}. {!isAdmin && 'Contact admin to make changes.'}</span>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-900 border-t-transparent" /></div>
            ) : students.length === 0 ? (
              <div className="text-center py-12 text-slate-500"><Calendar className="h-12 w-12 mx-auto mb-4" strokeWidth={1} /><p className="font-medium">Select class and section to mark attendance</p></div>
            ) : (
              <Table>
                <TableHeader><TableRow className="bg-slate-50">
                  <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Adm No.</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Name</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Roll</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Status</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {students.map(student => {
                    const status = attendanceData[student.student_id] || '';
                    return (
                      <TableRow key={student.student_id} data-testid={`attendance-row-${student.student_id}`}>
                        <TableCell className="font-mono text-xs text-slate-500">{student.admission_number}</TableCell>
                        <TableCell className="font-medium text-slate-900">{student.first_name} {student.last_name}</TableCell>
                        <TableCell className="text-slate-500">{student.roll_number || '-'}</TableCell>
                        <TableCell>
                          {status ? <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold ${status === 'present' ? 'bg-slate-900 text-white' : status === 'absent' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{status}</span> : <span className="text-xs text-slate-500">Not marked</span>}
                        </TableCell>
                        <TableCell>
                          <TooltipProvider>
                            <div className="flex gap-1">
                              {statusButtons.map(btn => {
                                const Icon = btn.icon; const isActive = status === btn.value;
                                return (
                                  <Tooltip key={btn.value}>
                                    <TooltipTrigger asChild>
                                      <Button size="sm" variant={isActive ? 'default' : 'outline'} className={`h-8 px-2.5 rounded-xl text-xs font-bold gap-1 ${isActive ? btn.activeColor : 'hover:border-slate-900'}`} onClick={() => handleAttendanceChange(student.student_id, btn.value)} disabled={!canEdit || isHoliday} data-testid={`mark-${btn.value}-${student.student_id}`}>
                                        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                                        {btn.label}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{btn.tooltip}</TooltipContent>
                                  </Tooltip>
                                );
                              })}
                            </div>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>

        </TabsContent>

        {/* ====== EMPLOYEE ATTENDANCE ====== */}
        {isAdmin && (
          <TabsContent value="employee">
            {/* Controls */}
            <Card className="mb-6"><CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-900">Date</label>
                  <SessionDatePicker value={empAttDate} onChange={(d) => { empDateUserSet.current = true; setEmpAttDate(d); }} data-testid="emp-att-date" />
                </div>
                <Button variant="outline" className="rounded-xl text-xs" onClick={() => {
                  const n = {};
                  employees.filter(e => e.is_active).forEach(e => { n[e.employee_id] = 'present'; });
                  setEmpAttData(n);
                }} data-testid="mark-all-emp-present"><CheckCircle className="h-4 w-4 mr-2" strokeWidth={1.5} /> Mark All Present</Button>
                <Button onClick={saveEmployeeAttendance} disabled={savingEmpAtt} className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs" data-testid="save-emp-attendance">
                  {savingEmpAtt ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : <><Save className="h-4 w-4 mr-2" strokeWidth={1.5} />Submit & Save</>}
                </Button>
              </div>
            </CardContent></Card>

            {/* Mark Attendance Table */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {employees.filter(e => e.is_active).length === 0 ? (
                <div className="text-center py-12 text-slate-500"><Users className="h-12 w-12 mx-auto mb-4" strokeWidth={1} /><p className="font-medium">No active employees found</p></div>
              ) : (
                <Table>
                  <TableHeader><TableRow className="bg-slate-50">
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Emp. ID</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Name</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Designation</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Status</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {employees.filter(e => e.is_active).map(emp => {
                      const status = empAttData[emp.employee_id] || '';
                      return (
                        <TableRow key={emp.employee_id}>
                          <TableCell className="font-mono text-xs text-slate-500">{emp.employee_id}</TableCell>
                          <TableCell className="font-medium text-slate-900">{emp.first_name} {emp.last_name}</TableCell>
                          <TableCell className="text-slate-500">{emp.designation || '-'}</TableCell>
                          <TableCell>
                            {status ? <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold ${status === 'present' ? 'bg-slate-900 text-white' : status === 'absent' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{status}</span> : <span className="text-xs text-slate-500">Not marked</span>}
                          </TableCell>
                          <TableCell>
                            <TooltipProvider>
                              <div className="flex gap-1">
                                {[
                                  { value: 'present', icon: CheckCircle, label: 'P', tooltip: 'Present', activeColor: 'bg-slate-900 text-white' },
                                  { value: 'absent',  icon: XCircle,     label: 'A', tooltip: 'Absent',  activeColor: 'bg-red-500 text-white' },
                                  { value: 'leave',   icon: Clock,        label: 'L', tooltip: 'Leave',   activeColor: 'bg-slate-500 text-white' },
                                ].map(btn => {
                                  const Icon = btn.icon; const isActive = status === btn.value;
                                  return (
                                    <Tooltip key={btn.value}>
                                      <TooltipTrigger asChild>
                                        <Button size="sm" variant={isActive ? 'default' : 'outline'} className={`h-8 px-2.5 rounded-xl text-xs font-bold gap-1 ${isActive ? btn.activeColor : 'hover:border-slate-900'}`} onClick={() => setEmpAttData(prev => ({ ...prev, [emp.employee_id]: btn.value }))}>
                                          <Icon className="h-3.5 w-3.5" strokeWidth={2} />{btn.label}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{btn.tooltip}</TooltipContent>
                                    </Tooltip>
                                  );
                                })}
                              </div>
                            </TooltipProvider>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>
        )}

        {/* ====== REPORT TAB ====== */}
        <TabsContent value="report">
          {isAdmin && (
            <Tabs value={reportSubTab} onValueChange={setReportSubTab} className="mb-4">
              <TabsList className="rounded-xl h-10 bg-slate-100">
                <TabsTrigger value="class" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="report-sub-class">Students</TabsTrigger>
                <TabsTrigger value="employee" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="report-sub-employee">Employees</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {(!isAdmin || reportSubTab === 'class') && <>
          {/* ── Class Attendance Report ── */}
          <div className="flex items-center gap-3 mb-4">
            <div className="h-8 w-8 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
              <Calendar className="h-4 w-4 text-[#E88A1A]" strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">Class Attendance Report</h2>
              <p className="text-[11px] text-slate-400">Filter by class and date to view student-wise attendance</p>
            </div>
          </div>
          <Card className="mb-4"><CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-900">Class</label>
                <Select value={reportClass || 'all'} onValueChange={v => setReportClass(v === 'all' ? '' : v)}>
                  <SelectTrigger className="w-[150px]" data-testid="report-class"><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Classes</SelectItem>{classes.map(c => <SelectItem key={c.name} value={c.name}>{c.display_name || c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-900">Date</label>
                <SessionDatePicker value={reportDate} onChange={setReportDate} data-testid="report-date" />
              </div>
              <Button onClick={fetchReport} disabled={reportLoading} className="bg-[#E88A1A] hover:bg-[#C97516] text-white rounded-xl text-xs" data-testid="generate-report-btn">
                {reportLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null} Generate Report
              </Button>
              {reportData && (() => {
                const header = ['Student ID', 'Class', 'Section', 'Date', 'Status'];
                const rows = reportData.records?.map(r => [r.entity_id, r.class_name, r.section, r.date, r.status]) || [];
                return (
                  <>
                    <Button variant="outline" className="rounded-xl text-xs border-[#E88A1A] text-[#E88A1A] hover:bg-orange-50" onClick={() => {
                      previewReport({
                        title: 'Class Attendance Report',
                        subtitle: `${reportClass ? 'Class ' + reportClass : 'All classes'}${reportDate ? ' · ' + reportDate : ''}`,
                        summary: [
                          { label: 'Total', value: reportData.total_records },
                          { label: 'Present', value: reportData.present },
                          { label: 'Absent', value: reportData.absent },
                          { label: 'Attendance %', value: `${reportData.percentage}%` },
                        ],
                        columns: header, rows,
                      });
                    }} data-testid="preview-student-report">
                      <FileText className="h-4 w-4 mr-2" strokeWidth={1.5} /> Preview
                    </Button>
                  </>
                );
              })()}
            </div>
          </CardContent></Card>
          {reportData && (
            <div className="space-y-4 mb-10">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="bg-[#E88A1A] p-5 rounded-2xl"><p className="text-[10px] uppercase tracking-widest text-orange-100 font-bold">Total</p><p className="text-2xl font-bold text-white">{reportData.total_records}</p></div>
                <div className="bg-white border border-slate-200 p-5 rounded-2xl"><p className="stat-label">Present</p><p className="text-2xl font-bold text-slate-900">{reportData.present}</p></div>
                <div className="bg-white border border-slate-200 p-5 rounded-2xl"><p className="stat-label">Absent</p><p className="text-2xl font-bold text-slate-900">{reportData.absent}</p></div>
                <div className="bg-white border border-slate-200 p-5 rounded-2xl"><p className="stat-label">Attendance %</p><p className="text-2xl font-bold text-slate-900">{reportData.percentage}%</p></div>
              </div>
              {reportData.records?.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <Table>
                    <TableHeader><TableRow className="bg-orange-50">
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Student</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Class</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Date</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Status</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {reportData.records.slice(0, 100).map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{r.entity_id}</TableCell>
                          <TableCell>{r.class_name}-{r.section}</TableCell>
                          <TableCell>{r.date}</TableCell>
                          <TableCell><span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold ${r.status === 'present' ? 'bg-slate-900 text-white' : r.status === 'absent' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{r.status}</span></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          </>}

          {isAdmin && reportSubTab === 'employee' && (<>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                <Users className="h-4 w-4 text-slate-600" strokeWidth={1.5} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900 tracking-tight">Employee Attendance Report</h2>
                <p className="text-[11px] text-slate-400">Monthly summary of employee-wise attendance</p>
              </div>
            </div>
            <Card className="mb-4"><CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-900">Month</label>
                  <input type="month" className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm" value={empReportMonth} onChange={e => setEmpReportMonth(e.target.value)} />
                </div>
                <Button onClick={fetchEmployeeReport} disabled={empReportLoading} className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs" data-testid="generate-emp-report-btn">
                  {empReportLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null} Generate Report
                </Button>
                {empReportData && (() => {
                  const header = ['Emp. ID', 'Name', 'Total Days', 'Present', 'Absent', 'Leave', 'Attendance %'];
                  const rows = Object.entries(empReportData.summary).map(([empId, s]) => {
                    const emp = employees.find(e => e.employee_id === empId);
                    const name = emp ? `${emp.first_name} ${emp.last_name}` : empId;
                    const pct = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0;
                    return [empId, name, s.total, s.present || 0, s.absent || 0, s.leave || 0, `${pct}%`];
                  });
                  const tot = (k) => Object.values(empReportData.summary).reduce((a, e) => a + (e[k] || 0), 0);
                  return (
                    <>
                      <Button variant="outline" className="rounded-xl text-xs border-slate-900 text-slate-900" onClick={() => {
                        previewReport({
                          title: 'Employee Attendance Report',
                          subtitle: empReportMonth,
                          summary: [
                            { label: 'Total Days', value: tot('total') },
                            { label: 'Present', value: tot('present') },
                            { label: 'Absent', value: tot('absent') },
                            { label: 'Leave', value: tot('leave') },
                          ],
                          columns: header, rows,
                        });
                      }} data-testid="preview-emp-report">
                        <FileText className="h-4 w-4 mr-2" strokeWidth={1.5} /> Preview
                      </Button>
                    </>
                  );
                })()}
              </div>
            </CardContent></Card>
            {empReportData && (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="bg-slate-900 p-5 rounded-2xl"><p className="stat-label-dark">Total Days</p><p className="text-2xl font-bold text-white">{Object.values(empReportData.summary).reduce((s, e) => s + e.total, 0)}</p></div>
                  <div className="bg-white border border-slate-200 p-5 rounded-2xl"><p className="stat-label">Present</p><p className="text-2xl font-bold text-slate-900">{Object.values(empReportData.summary).reduce((s, e) => s + (e.present || 0), 0)}</p></div>
                  <div className="bg-white border border-slate-200 p-5 rounded-2xl"><p className="stat-label">Absent</p><p className="text-2xl font-bold text-slate-900">{Object.values(empReportData.summary).reduce((s, e) => s + (e.absent || 0), 0)}</p></div>
                  <div className="bg-white border border-slate-200 p-5 rounded-2xl"><p className="stat-label">Leave</p><p className="text-2xl font-bold text-slate-900">{Object.values(empReportData.summary).reduce((s, e) => s + (e.leave || 0), 0)}</p></div>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <Table>
                    <TableHeader><TableRow className="bg-slate-50">
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Employee</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Total Days</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Present</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Absent</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Leave</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Attendance %</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {Object.entries(empReportData.summary).length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-500">No records for this month</TableCell></TableRow>
                      ) : Object.entries(empReportData.summary).map(([empId, s]) => {
                        const pct = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0;
                        const emp = employees.find(e => e.employee_id === empId);
                        const name = emp ? `${emp.first_name} ${emp.last_name}` : empId;
                        return (
                          <TableRow key={empId}>
                            <TableCell><p className="font-medium text-slate-900">{name}</p><p className="text-xs text-slate-500">{empId}</p></TableCell>
                            <TableCell>{s.total}</TableCell>
                            <TableCell><span className="font-semibold text-slate-900">{s.present || 0}</span></TableCell>
                            <TableCell><span className="font-semibold text-red-600">{s.absent || 0}</span></TableCell>
                            <TableCell><span className="font-semibold text-slate-500">{s.leave || 0}</span></TableCell>
                            <TableCell><span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold ${pct >= 75 ? 'bg-slate-900 text-white' : 'bg-red-100 text-red-700'}`}>{pct}%</span></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </>)}
        </TabsContent>

        {/* ====== ALERTS TAB (commented out) ====== */}
        {false && <TabsContent value="alerts">
          <Card className="mb-6"><CardContent className="p-4">
            <div className="flex gap-4 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider">Threshold (%)</Label>
                <Input type="number" className="w-24" value={alertThreshold} onChange={e => setAlertThreshold(e.target.value)} data-testid="alert-threshold" />
              </div>
              <Button onClick={fetchAlerts} disabled={alertsLoading} className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs" data-testid="check-alerts-btn">
                {alertsLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <AlertTriangle className="h-4 w-4 mr-2" strokeWidth={1.5} />} Check Alerts
              </Button>
            </div>
          </CardContent></Card>

          {alerts && (
            <div className="space-y-4">
              <div className="bg-slate-900 px-5 py-3 rounded-2xl flex items-center justify-between">
                <span className="text-white text-sm font-medium">Students below {alerts.threshold}% attendance</span>
                <span className="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-xl">{alerts.total_flagged} flagged</span>
              </div>
              {alerts.alerts.length > 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <Table>
                    <TableHeader><TableRow className="bg-slate-50">
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Student</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Class</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Present</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Absent</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Attendance %</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Shortfall</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {alerts.alerts.map(a => (
                        <TableRow key={a.student_id}>
                          <TableCell><p className="font-medium text-slate-900">{a.student_name}</p><p className="text-xs text-slate-500">{a.admission_number}</p></TableCell>
                          <TableCell>{a.class_name}-{a.section}</TableCell>
                          <TableCell>{a.present_days}/{a.total_days}</TableCell>
                          <TableCell className="font-semibold text-slate-900">{a.absent_days}</TableCell>
                          <TableCell><span className="font-bold text-slate-900">{a.attendance_percentage}%</span></TableCell>
                          <TableCell className="text-slate-500">-{a.shortfall}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500"><CheckCircle className="h-8 w-8 mx-auto mb-2 text-slate-900" /><p>All students are above the threshold</p></div>
              )}
            </div>
          )}
        </TabsContent>}

        {/* ====== HOLIDAYS TAB ====== */}
        {isAdmin && (
          <TabsContent value="holidays">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-slate-500">Manage school holidays — attendance cannot be marked on holidays</p>
              <Button className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs" onClick={() => setShowHolidayDialog(true)} data-testid="add-holiday-btn">
                <Plus className="h-4 w-4 mr-2" strokeWidth={1.5} /> Add Holiday
              </Button>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <Table>
                <TableHeader><TableRow className="bg-slate-50">
                  <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Date</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Name</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Type</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500 text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {holidays.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-slate-500">No holidays added yet</TableCell></TableRow>
                  ) : holidays.map(h => (
                    <TableRow key={h.holiday_id} className="hover:bg-slate-50">
                      <TableCell className="font-medium text-slate-900">{h.date}</TableCell>
                      <TableCell className="font-semibold">{h.name}</TableCell>
                      <TableCell><span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold bg-slate-100 text-slate-500">{h.type}</span></TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" className="text-xs text-slate-600 hover:text-slate-900 hover:border-slate-900" onClick={() => setDeleteHolidayTarget(h)} data-testid={`delete-holiday-${h.holiday_id}`}><Trash2 className="h-3 w-3 mr-1" /> Remove</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Dialog open={showHolidayDialog} onOpenChange={setShowHolidayDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="text-slate-900">Add Holiday</DialogTitle>
                  <DialogDescription>Attendance cannot be marked on holidays</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wider">Date</Label>
                    <SessionDatePicker value={holidayForm.date} onChange={v => setHolidayForm({ ...holidayForm, date: v })} data-testid="holiday-date" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wider">Name</Label>
                    <Input value={holidayForm.name} onChange={e => setHolidayForm({ ...holidayForm, name: e.target.value })} placeholder="e.g. Republic Day" data-testid="holiday-name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wider">Type</Label>
                    <Select value={holidayForm.type} onValueChange={v => setHolidayForm({ ...holidayForm, type: v })}>
                      <SelectTrigger data-testid="holiday-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="public">Public Holiday</SelectItem>
                        <SelectItem value="school">School Holiday</SelectItem>
                        <SelectItem value="optional">Optional Holiday</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowHolidayDialog(false)}>Cancel</Button>
                  <Button className="bg-slate-900 text-white hover:bg-slate-800" onClick={addHoliday} data-testid="save-holiday-btn">Add Holiday</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>
        )}

        {/* ====== BULK UNLOCK (#8) - commented out ====== */}
        {false && isAdmin && (
          <TabsContent value="bulk-unlock">
            <Card>
              <CardContent className="p-6">
                <h3 className="font-semibold text-slate-900 mb-1">Bulk Attendance Unlock</h3>
                <p className="text-xs text-slate-500 mb-4">Add one or more class/section/date combinations to unlock all at once.</p>
                <div className="space-y-3">
                  {bulkUnlockSessions.map((s, i) => (
                    <div key={i} className="flex gap-3 items-end flex-wrap">
                      <div className="space-y-1 flex-1 min-w-[140px]">
                        <Label className="text-xs">Class</Label>
                        <Select value={s.class_name} onValueChange={v => {
                          const updated = [...bulkUnlockSessions]; updated[i] = { ...s, class_name: v, section: '' }; setBulkUnlockSessions(updated);
                        }}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select class" /></SelectTrigger>
                          <SelectContent>{classes.map(c => <SelectItem key={c.name} value={c.name}>{c.display_name || (c.name.startsWith('Class ') ? c.name : `Class ${c.name}`)}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1 flex-1 min-w-[100px]">
                        <Label className="text-xs">Section</Label>
                        <Select value={s.section} onValueChange={v => {
                          const updated = [...bulkUnlockSessions]; updated[i] = { ...s, section: v }; setBulkUnlockSessions(updated);
                        }}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Section" /></SelectTrigger>
                          <SelectContent>{(classes.find(c => c.name === s.class_name)?.sections || []).map(sec => <SelectItem key={sec.section_name} value={sec.section_name}>{sec.section_name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1 flex-1 min-w-[140px]">
                        <Label className="text-xs">Date</Label>
                        <SessionDatePicker value={s.date} onChange={v => {
                          const updated = [...bulkUnlockSessions]; updated[i] = { ...s, date: v }; setBulkUnlockSessions(updated);
                        }} />
                      </div>
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 mb-0.5" onClick={() => setBulkUnlockSessions(bulkUnlockSessions.filter((_, j) => j !== i))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 mt-4">
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setBulkUnlockSessions([...bulkUnlockSessions, { class_name: '', section: '', date: '' }])}>
                    <Plus className="h-4 w-4 mr-1" /> Add Row
                  </Button>
                  <Button
                    size="sm"
                    className="bg-slate-900 text-white hover:bg-slate-800 text-xs"
                    disabled={bulkUnlocking}
                    data-testid="bulk-unlock-btn"
                    onClick={async () => {
                      const valid = bulkUnlockSessions.filter(s => s.class_name && s.section && s.date);
                      if (!valid.length) { toast.error('Add at least one complete session'); return; }
                      setBulkUnlocking(true);
                      try {
                        const res = await api.post('/attendance/bulk-unlock', { sessions: valid });
                        toast.success(res.data.message);
                        setBulkUnlockSessions([{ class_name: '', section: '', date: '' }]);
                      } catch (err) {
                        toast.error(err.response?.data?.detail || 'Bulk unlock failed');
                      } finally { setBulkUnlocking(false); }
                    }}
                  >
                    {bulkUnlocking ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Unlock className="h-4 w-4 mr-1" strokeWidth={1.5} />}
                    Unlock All
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Holiday Delete Confirmation */}
      <AlertDialog open={!!deleteHolidayTarget} onOpenChange={(open) => !open && setDeleteHolidayTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Holiday</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{deleteHolidayTarget?.name}</strong> ({deleteHolidayTarget?.date}) from the holiday calendar?
              Attendance may now be markable on this date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-slate-900 text-white hover:bg-slate-800"
              onClick={() => deleteHolidayTarget && deleteHoliday(deleteHolidayTarget.holiday_id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ====== MAIN COMPONENT ======
const AttendancePage = () => {
  const { user } = useAuth();
  if (user?.role === 'student' || user?.role === 'parent') return <StudentAttendanceView />;
  return <MarkAttendanceView />;
};

export default AttendancePage;
