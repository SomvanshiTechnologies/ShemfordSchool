import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import { getCached, setCached, invalidatePrefix } from '../../lib/pageCache';
import { toast } from 'sonner';
import {
  CheckCircle, XCircle, Clock, Lock, Unlock, Loader2, Calendar,
  Users, Plus, Trash2, Download, X, FileText, Save,
} from 'lucide-react';
import { previewReportInTab } from '../../lib/preview';

// ─── Shared bits ───────────────────────────────────────────────────────────

const formLabel = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#666',
  marginBottom: 6,
};

const STATUS_STYLES = {
  present: { bg: '#dcfce7', color: '#15803d', label: 'Present' },
  absent:  { bg: '#fee2e2', color: '#dc2626', label: 'Absent' },
  leave:   { bg: '#f1f5f9', color: '#475569', label: 'Leave' },
};

const StatusBadge = ({ status }) => {
  const s = STATUS_STYLES[status] || { bg: '#F8F8F8', color: '#888', label: status || '—' };
  return (
    <span style={{
      display:'inline-flex',alignItems:'center',padding:'3px 8px',borderRadius:6,
      fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.04em',
      background:s.bg,color:s.color,
    }}>{s.label}</span>
  );
};

const TabBar = ({ tabs, active, onChange }) => (
  <div style={{display:'flex',gap:6,padding:4,background:'#F0F0F0',borderRadius:12,marginBottom:12,overflowX:'auto'}}>
    {tabs.map(t => (
      <button
        key={t.key}
        onClick={() => onChange(t.key)}
        style={{
          flex:1, minWidth:'fit-content', padding:'8px 12px', borderRadius:8, border:'none',
          background: active === t.key ? '#FFF' : 'transparent',
          color: active === t.key ? '#1A1A1A' : '#888',
          fontSize:12, fontWeight:700, cursor:'pointer',
          boxShadow: active === t.key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
          whiteSpace:'nowrap',
        }}
        data-testid={`m-att-tab-${t.key}`}
      >
        {t.label}
      </button>
    ))}
  </div>
);

const downloadCSV = (rows, filename) => {
  const csv = rows.map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ─── Main ──────────────────────────────────────────────────────────────────

const MobileAttendance = () => {
  const { user } = useAuth();
  const role = user?.role;
  const isAdmin = role === 'admin';
  const isStudentOrParent = role === 'student' || role === 'parent';

  if (isStudentOrParent) return <StudentAttendance />;
  return <AdminAttendance isAdmin={isAdmin} />;
};

export default MobileAttendance;

// ─── Student / Parent view ─────────────────────────────────────────────────

const StudentAttendance = () => {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const key = `m-att:student:${month}`;
    const cached = getCached(key);
    if (cached) { setRecords(cached); setLoading(false); }
    else setLoading(true);
    try {
      const r = await api.get('/attendance', { params: { entity_type: 'student', month } });
      const arr = Array.isArray(r.data) ? r.data : [];
      setRecords(arr);
      setCached(key, arr);
    } catch { toast.error('Failed to fetch attendance'); }
    finally { setLoading(false); }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const present = records.filter(r => r.status === 'present').length;
  const absent = records.filter(r => r.status === 'absent').length;
  const leave = records.filter(r => r.status === 'leave').length;
  const total = records.length;
  const pct = total > 0 ? Math.round((present / total) * 100) : 0;

  return (
    <div data-testid="m-my-attendance" style={{minWidth:0}}>
      <div className="m-header">
        <div><h1>My Attendance</h1><p className="m-header-sub">{total} day{total === 1 ? '' : 's'} recorded</p></div>
      </div>

      <div style={{marginBottom:12}}>
        <label style={formLabel}>Month</label>
        <input
          type="month"
          className="m-input"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
          style={{cursor:'pointer'}}
        />
      </div>

      <div className="m-stat-grid">
        <div className="m-stat"><p className="m-stat-label">Present</p><p className="m-stat-value">{present}</p></div>
        <div className="m-stat m-stat-accent"><p className="m-stat-label">Absent</p><p className="m-stat-value">{absent}</p></div>
        <div className="m-stat"><p className="m-stat-label">Leave</p><p className="m-stat-value">{leave}</p></div>
        <div className="m-stat"><p className="m-stat-label">Percentage</p><p className="m-stat-value">{pct}%</p></div>
      </div>

      {loading && records.length === 0 ? (
        <div>{[1,2,3,4].map(i => <div key={i} className="m-skeleton" style={{height:48,borderRadius:12,marginBottom:8}} />)}</div>
      ) : records.length === 0 ? (
        <div className="m-empty"><Calendar className="m-empty-icon" /><p>No attendance records for this month</p></div>
      ) : (
        <div className="m-list">
          {records.map((r, i) => (
            <div key={i} className="m-list-item">
              <span style={{fontWeight:600,fontSize:13,color:'#1A1A1A'}}>{r.date}</span>
              <StatusBadge status={r.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Admin / Teacher tabs container ────────────────────────────────────────

const AdminAttendance = ({ isAdmin }) => {
  const [tab, setTab] = useState('students');
  const [classes, setClasses] = useState(getCached('classes') || []);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/classes');
        const arr = Array.isArray(r.data) ? r.data : [];
        setClasses(arr);
        setCached('classes', arr);
      } catch {}
    })();
  }, []);

  const tabs = [
    { key: 'students', label: 'Students' },
    ...(isAdmin ? [{ key: 'employees', label: 'Employees' }] : []),
    { key: 'report', label: 'Report' },
    ...(isAdmin ? [{ key: 'holidays', label: 'Holidays' }] : []),
  ];

  return (
    <div data-testid="m-attendance" style={{minWidth:0}}>
      <div className="m-header">
        <div><h1>Attendance</h1><p className="m-header-sub">Mark · Report · Holidays</p></div>
      </div>

      <TabBar tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'students' && <StudentsTab classes={classes} isAdmin={isAdmin} />}
      {tab === 'employees' && isAdmin && <EmployeesTab />}
      {tab === 'report' && <ReportTab classes={classes} isAdmin={isAdmin} />}
      {tab === 'holidays' && isAdmin && <HolidaysTab />}
    </div>
  );
};

// ─── Tab 1: Mark Student Attendance ────────────────────────────────────────

const StudentsTab = ({ classes, isAdmin }) => {
  const [selClass, setSelClass] = useState('');
  const [selSection, setSelSection] = useState('');
  const [selDate, setSelDate] = useState(() => new Date().toISOString().split('T')[0]);

  const [students, setStudents] = useState([]);
  const [attMap, setAttMap] = useState({});
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  const sections = useMemo(() => {
    const cls = classes.find(c => c.name === selClass);
    return cls?.sections || [];
  }, [classes, selClass]);

  const load = useCallback(async () => {
    if (!selClass || !selSection || !selDate) return;
    const cacheKey = `m-att:admin:${selClass}:${selSection}:${selDate}`;
    const cached = getCached(cacheKey);
    if (cached) {
      setStudents(cached.students);
      setSession(cached.session);
      setAttMap(cached.attMap);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const [s, a, sess] = await Promise.all([
        api.get('/students', { params: { class_name: selClass, section: selSection } }),
        api.get('/attendance', { params: { entity_type: 'student', date: selDate, class_name: selClass, section: selSection } }),
        api.get('/attendance/session-status', { params: { class_name: selClass, section: selSection, date: selDate } }),
      ]);
      const studentList = s.data?.students ?? (Array.isArray(s.data) ? s.data : []);
      const m = {};
      (Array.isArray(a.data) ? a.data : []).forEach(r => { m[r.entity_id] = r.status; });
      setStudents(studentList);
      setSession(sess.data);
      setAttMap(m);
      setCached(cacheKey, { students: studentList, session: sess.data, attMap: m });
    } catch {
      if (!cached) toast.error('Failed to fetch attendance');
    } finally { setLoading(false); }
  }, [selClass, selSection, selDate]);

  useEffect(() => { load(); }, [load]);

  const isLocked = session?.is_locked && session?.submitted;
  const isHoliday = session?.is_holiday;
  const canEdit = (!isLocked && !isHoliday) || isAdmin;

  const setStatus = (id, status) => { if (canEdit) setAttMap(p => ({ ...p, [id]: status })); };
  const markAll = (status) => {
    if (!canEdit) return;
    const n = {};
    students.forEach(s => { n[s.student_id] = status; });
    setAttMap(n);
  };

  const submit = async () => {
    setSaving(true);
    try {
      const records = students.map(s => ({
        entity_type: 'student', entity_id: s.student_id, date: selDate,
        status: attMap[s.student_id] || 'absent',
        class_name: selClass, section: selSection,
      }));
      const res = await api.post('/attendance', { class_name: selClass, section: selSection, date: selDate, records });
      toast.success(res.data.message || 'Attendance submitted');
      if (res.data.parents_notified > 0) toast.info(`${res.data.parents_notified} parent(s) notified`);
      setSession({ ...(session || {}), submitted: true, is_locked: true });
      invalidatePrefix('m-att:admin:');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to submit'); }
    finally { setSaving(false); }
  };

  const unlock = async () => {
    setUnlocking(true);
    try {
      await api.post('/attendance/unlock', { class_name: selClass, section: selSection, date: selDate });
      toast.success('Attendance unlocked');
      setSession({ ...(session || {}), is_locked: false });
      invalidatePrefix('m-att:admin:');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to unlock'); }
    finally { setUnlocking(false); }
  };

  const summary = useMemo(() => {
    const p = Object.values(attMap).filter(v => v === 'present').length;
    const a = Object.values(attMap).filter(v => v === 'absent').length;
    const l = Object.values(attMap).filter(v => v === 'leave').length;
    return { p, a, l };
  }, [attMap]);

  return (
    <>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
        <div>
          <label style={formLabel}>Class</label>
          <select className="m-input" value={selClass}
            onChange={(e) => { setSelClass(e.target.value); setSelSection(''); setSession(null); setStudents([]); setAttMap({}); }}>
            <option value="">Select class</option>
            {classes.map(c => <option key={c.name} value={c.name}>{c.display_name || `Class ${c.name}`}</option>)}
          </select>
        </div>
        <div>
          <label style={formLabel}>Section</label>
          <select className="m-input" value={selSection} onChange={(e) => setSelSection(e.target.value)} disabled={!selClass}>
            <option value="">Select section</option>
            {sections.map(s => {
              const name = typeof s === 'string' ? s : s.section_name;
              return <option key={name} value={name}>{name}</option>;
            })}
          </select>
        </div>
      </div>

      <div style={{marginBottom:12}}>
        <label style={formLabel}>Date</label>
        <input
          type="date" className="m-input"
          value={selDate}
          onChange={(e) => setSelDate(e.target.value)}
          onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
          style={{cursor:'pointer'}}
        />
      </div>

      {isHoliday && (
        <div className="m-card-orange" style={{textAlign:'center'}}>
          <Calendar size={20} color="#FFF" style={{margin:'0 auto 8px'}} />
          <p style={{fontWeight:700,color:'#FFF'}}>{session?.holiday_name || 'Holiday'}</p>
          <p style={{fontSize:12,color:'rgba(255,255,255,0.7)'}}>Holiday — attendance blocked</p>
        </div>
      )}

      {isLocked && !isHoliday && (
        <div className="m-card-dark" style={{display:'flex',alignItems:'center',gap:12}}>
          <Lock size={18} color="#E88A1A" />
          <div style={{flex:1,minWidth:0}}>
            <p style={{fontWeight:700,color:'#FFF',fontSize:13}}>Submitted & Locked</p>
            {!isAdmin && <p style={{fontSize:11,color:'#888'}}>Contact admin to edit</p>}
          </div>
          {isAdmin && (
            <button onClick={unlock} disabled={unlocking} style={{padding:'8px 12px',borderRadius:10,background:'#E88A1A',color:'#FFF',border:'none',fontSize:12,fontWeight:700,display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}>
              {unlocking ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />} Unlock
            </button>
          )}
        </div>
      )}

      {students.length > 0 && (
        <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
          <span style={{padding:'4px 10px',borderRadius:8,background:'#dcfce7',color:'#15803d',fontSize:11,fontWeight:700}}>Present {summary.p}</span>
          <span style={{padding:'4px 10px',borderRadius:8,background:'#fee2e2',color:'#dc2626',fontSize:11,fontWeight:700}}>Absent {summary.a}</span>
          <span style={{padding:'4px 10px',borderRadius:8,background:'#f1f5f9',color:'#475569',fontSize:11,fontWeight:700}}>Leave {summary.l}</span>
          <span style={{padding:'4px 10px',borderRadius:8,background:'#FFF',border:'1px solid #E5E5E5',color:'#666',fontSize:11,fontWeight:700}}>Total {students.length}</span>
        </div>
      )}

      {canEdit && students.length > 0 && !isHoliday && (
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <button onClick={() => markAll('present')} className="m-btn m-btn-outline m-btn-sm" style={{flex:1}}>
            <CheckCircle size={14} /> All Present
          </button>
          <button onClick={submit} disabled={saving} className="m-btn m-btn-primary m-btn-sm" style={{flex:1}}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Submit
          </button>
        </div>
      )}

      {!selClass || !selSection ? (
        <div className="m-empty"><Calendar className="m-empty-icon" /><p>Select a class and section</p></div>
      ) : loading && students.length === 0 ? (
        <div>{[1,2,3,4,5].map(i => <div key={i} className="m-skeleton" style={{height:56,borderRadius:14,marginBottom:8}} />)}</div>
      ) : students.length === 0 ? (
        <div className="m-empty"><p>No students in this class/section</p></div>
      ) : (
        <div className="m-list">
          {students.map(s => {
            const status = attMap[s.student_id] || '';
            return (
              <div key={s.student_id} className="m-att-row" style={{gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontWeight:600,fontSize:13,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.first_name} {s.last_name}</p>
                  <p style={{fontSize:10,color:'#888'}}>{s.roll_number || s.admission_number}</p>
                </div>
                <div className="m-att-btns">
                  <button className={`m-att-btn ${status === 'present' ? 'active' : ''}`}
                    onClick={() => setStatus(s.student_id, 'present')} disabled={!canEdit} aria-label="Present">
                    <CheckCircle size={16} />
                  </button>
                  <button className={`m-att-btn ${status === 'absent' ? 'active-absent' : ''}`}
                    onClick={() => setStatus(s.student_id, 'absent')} disabled={!canEdit} aria-label="Absent">
                    <XCircle size={16} />
                  </button>
                  <button className={`m-att-btn ${status === 'leave' ? 'active-leave' : ''}`}
                    onClick={() => setStatus(s.student_id, 'leave')} disabled={!canEdit} aria-label="Leave">
                    <Clock size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

// ─── Tab 2: Employees ──────────────────────────────────────────────────────

const EmployeesTab = () => {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [employees, setEmployees] = useState(getCached('m-att:employees') || []);
  const [attMap, setAttMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await api.get('/employees');
        const arr = Array.isArray(r.data) ? r.data : [];
        setEmployees(arr);
        setCached('m-att:employees', arr);
      } catch { toast.error('Failed to load employees'); }
      finally { setLoading(false); }
    })();
  }, []);

  const setStatus = (id, status) => setAttMap(p => ({ ...p, [id]: status }));
  const markAll = (status) => {
    const n = {};
    employees.filter(e => e.is_active).forEach(e => { n[e.employee_id] = status; });
    setAttMap(n);
  };

  const submit = async () => {
    setSaving(true);
    try {
      const records = employees.filter(e => e.is_active).map(e => ({
        employee_id: e.employee_id,
        status: attMap[e.employee_id] || 'present',
      }));
      const res = await api.post('/attendance/employee', { date, records });
      toast.success(res.data.message || 'Employee attendance saved');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to submit'); }
    finally { setSaving(false); }
  };

  const active = employees.filter(e => e.is_active);

  return (
    <>
      <div style={{marginBottom:12}}>
        <label style={formLabel}>Date</label>
        <input
          type="date" className="m-input" value={date}
          onChange={(e) => setDate(e.target.value)}
          onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
          style={{cursor:'pointer'}}
        />
      </div>

      {active.length > 0 && (
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <button onClick={() => markAll('present')} className="m-btn m-btn-outline m-btn-sm" style={{flex:1}}>
            <CheckCircle size={14} /> All Present
          </button>
          <button onClick={submit} disabled={saving} className="m-btn m-btn-primary m-btn-sm" style={{flex:1}}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Submit
          </button>
        </div>
      )}

      {loading && active.length === 0 ? (
        <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:56,borderRadius:14,marginBottom:8}} />)}</div>
      ) : active.length === 0 ? (
        <div className="m-empty"><Users className="m-empty-icon" /><p>No active employees</p></div>
      ) : (
        <div className="m-list">
          {active.map(emp => {
            const status = attMap[emp.employee_id] || '';
            return (
              <div key={emp.employee_id} className="m-att-row" style={{gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontWeight:600,fontSize:13,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {emp.first_name} {emp.last_name}
                  </p>
                  <p style={{fontSize:10,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {emp.employee_id}{emp.designation ? ` · ${emp.designation}` : ''}
                  </p>
                </div>
                <div className="m-att-btns">
                  <button className={`m-att-btn ${status === 'present' ? 'active' : ''}`}
                    onClick={() => setStatus(emp.employee_id, 'present')} aria-label="Present">
                    <CheckCircle size={16} />
                  </button>
                  <button className={`m-att-btn ${status === 'absent' ? 'active-absent' : ''}`}
                    onClick={() => setStatus(emp.employee_id, 'absent')} aria-label="Absent">
                    <XCircle size={16} />
                  </button>
                  <button className={`m-att-btn ${status === 'leave' ? 'active-leave' : ''}`}
                    onClick={() => setStatus(emp.employee_id, 'leave')} aria-label="Leave">
                    <Clock size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

// ─── Tab 3: Report ─────────────────────────────────────────────────────────

const ReportTab = ({ classes, isAdmin }) => {
  const [sub, setSub] = useState('class');
  const [reportClass, setReportClass] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  const [empMonth, setEmpMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [empReportData, setEmpReportData] = useState(null);
  const [empReportLoading, setEmpReportLoading] = useState(false);
  const [employees, setEmployees] = useState(getCached('m-att:employees') || []);

  useEffect(() => {
    if (isAdmin && employees.length === 0) {
      (async () => {
        try {
          const r = await api.get('/employees');
          const arr = Array.isArray(r.data) ? r.data : [];
          setEmployees(arr);
          setCached('m-att:employees', arr);
        } catch {}
      })();
    }
  }, [isAdmin, employees.length]);

  const fetchReport = async () => {
    setReportLoading(true);
    try {
      const params = {};
      if (reportClass) params.class_name = reportClass;
      if (reportDate) params.date = reportDate;
      const r = await api.get('/reports/attendance', { params });
      setReportData(r.data);
      if (!r.data?.total_records) {
        toast.info('No attendance records for the selected filter');
      }
    } catch { toast.error('Failed to fetch report'); }
    finally { setReportLoading(false); }
  };

  const fetchEmpReport = async () => {
    setEmpReportLoading(true);
    try {
      const r = await api.get('/attendance/employees', { params: { month: empMonth } });
      const records = Array.isArray(r.data) ? r.data : [];
      const byEmp = {};
      records.forEach(rec => {
        if (!byEmp[rec.entity_id]) byEmp[rec.entity_id] = { present: 0, absent: 0, leave: 0, total: 0 };
        byEmp[rec.entity_id][rec.status] = (byEmp[rec.entity_id][rec.status] || 0) + 1;
        byEmp[rec.entity_id].total += 1;
      });
      setEmpReportData({ records, summary: byEmp });
      if (records.length === 0) {
        toast.info('No employee attendance records for this month');
      }
    } catch { toast.error('Failed to fetch employee report'); }
    finally { setEmpReportLoading(false); }
  };

  // Preview in a new tab with Print + Excel-download buttons (same UX as
  // Fees Reports / Payroll). Replaces the prior direct-CSV-download which
  // surprised users with a file download instead of an on-screen view.
  const previewStudentReport = () => {
    if (!reportData) return;
    const rows = reportData.records || [];
    previewReportInTab(
      `Class Attendance Report${reportDate ? ` — ${reportDate}` : ''}`,
      [{
        title: reportData.total_records
          ? `Summary — ${reportData.present || 0} present / ${reportData.absent || 0} absent / ${reportData.total_records} total (${reportData.percentage || 0}%)`
          : null,
        columns: [
          { label: 'Student ID', get: r => r.entity_id },
          { label: 'Class',      get: r => r.class_name },
          { label: 'Section',    get: r => r.section },
          { label: 'Date',       get: r => r.date },
          { label: 'Status',     get: r => r.status },
        ],
        rows,
      }],
    );
  };

  const previewEmpReport = () => {
    if (!empReportData) return;
    const rows = Object.entries(empReportData.summary).map(([empId, s]) => {
      const emp = employees.find(e => e.employee_id === empId);
      const name = emp ? `${emp.first_name} ${emp.last_name}` : empId;
      const pct = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0;
      return { empId, name, total: s.total, present: s.present || 0, absent: s.absent || 0, leave: s.leave || 0, pct };
    });
    previewReportInTab(
      `Employee Attendance Report — ${empMonth}`,
      [{
        title: `Month: ${empMonth} · ${rows.length} employee${rows.length === 1 ? '' : 's'}`,
        columns: [
          { label: 'Emp. ID', get: r => r.empId },
          { label: 'Name',    get: r => r.name },
          { label: 'Total',   get: r => r.total },
          { label: 'Present', get: r => r.present },
          { label: 'Absent',  get: r => r.absent },
          { label: 'Leave',   get: r => r.leave },
          { label: '%',       get: r => `${r.pct}%` },
        ],
        rows,
      }],
    );
  };

  const subTabs = isAdmin
    ? [{ key: 'class', label: 'Students' }, { key: 'employees', label: 'Employees' }]
    : [{ key: 'class', label: 'Students' }];

  return (
    <>
      {isAdmin && <TabBar tabs={subTabs} active={sub} onChange={setSub} />}

      {sub === 'class' && <>
      <p className="m-section" style={{marginTop:0,marginBottom:8}}>Class Attendance Report</p>

      <div style={{marginBottom:10}}>
        <label style={formLabel}>Class</label>
        <select className="m-input" value={reportClass} onChange={(e) => setReportClass(e.target.value)}>
          <option value="">All Classes</option>
          {classes.map(c => <option key={c.name} value={c.name}>{c.display_name || `Class ${c.name}`}</option>)}
        </select>
      </div>

      <div style={{marginBottom:10}}>
        <label style={formLabel}>Date (leave blank for all dates)</label>
        <input
          type="date" className="m-input" value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
          style={{cursor:'pointer'}}
        />
      </div>
      <div style={{display:'flex',gap:8,marginBottom:12}}>
        <button onClick={fetchReport} disabled={reportLoading} className="m-btn m-btn-primary m-btn-sm" style={{flex:1}}>
          {reportLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Generate
        </button>
        {reportData && (
          <button onClick={previewStudentReport} className="m-btn m-btn-outline m-btn-sm" style={{flex:1}}>
            <FileText size={14} /> Preview
          </button>
        )}
      </div>

      {reportData && !reportData.total_records && (
        <div className="m-empty"><Calendar className="m-empty-icon" /><p>No attendance records for this filter</p></div>
      )}

      {reportData && reportData.total_records > 0 && (
        <div className="m-stat-grid">
          <div className="m-stat"><p className="m-stat-label">Total</p><p className="m-stat-value">{reportData.total_records || 0}</p></div>
          <div className="m-stat"><p className="m-stat-label">Present</p><p className="m-stat-value">{reportData.present || 0}</p></div>
          <div className="m-stat m-stat-accent"><p className="m-stat-label">Absent</p><p className="m-stat-value">{reportData.absent || 0}</p></div>
          <div className="m-stat"><p className="m-stat-label">%</p><p className="m-stat-value">{reportData.percentage || 0}%</p></div>
        </div>
      )}

      {reportData?.records?.length > 0 && (
        <div className="m-list" style={{marginBottom:16}}>
          {reportData.records.slice(0, 100).map((r, i) => (
            <div key={i} className="m-list-item" style={{gap:8}}>
              <div style={{minWidth:0,flex:1}}>
                <p style={{fontWeight:600,fontSize:12,color:'#1A1A1A',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.entity_id}</p>
                <p style={{fontSize:10,color:'#888'}}>{r.class_name}-{r.section} · {r.date}</p>
              </div>
              <StatusBadge status={r.status} />
            </div>
          ))}
          {reportData.records.length > 100 && (
            <div style={{padding:'8px 12px',fontSize:11,color:'#888',textAlign:'center',background:'#F8F8F8'}}>
              Showing 100 of {reportData.records.length} — open Preview for the full report
            </div>
          )}
        </div>
      )}
      </>}

      {sub === 'employees' && isAdmin && <>
        <p className="m-section" style={{marginTop:0,marginBottom:8}}>Employee Attendance Report</p>
        <div style={{marginBottom:10}}>
          <label style={formLabel}>Month</label>
          <input
            type="month" className="m-input" value={empMonth}
            onChange={(e) => setEmpMonth(e.target.value)}
            onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
            style={{cursor:'pointer'}}
          />
        </div>
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <button onClick={fetchEmpReport} disabled={empReportLoading} className="m-btn m-btn-primary m-btn-sm" style={{flex:1}}>
            {empReportLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Generate
          </button>
          {empReportData && (
            <button onClick={previewEmpReport} className="m-btn m-btn-outline m-btn-sm" style={{flex:1}}>
              <FileText size={14} /> Preview
            </button>
          )}
        </div>

        {empReportData && empReportData.records.length === 0 && (
          <div className="m-empty"><Calendar className="m-empty-icon" /><p>No employee attendance for {empMonth}</p></div>
        )}

        {empReportData && empReportData.records.length > 0 && (() => {
          const totals = Object.values(empReportData.summary);
          const totalDays = totals.reduce((s, e) => s + e.total, 0);
          const totalP = totals.reduce((s, e) => s + (e.present || 0), 0);
          const totalA = totals.reduce((s, e) => s + (e.absent || 0), 0);
          const totalL = totals.reduce((s, e) => s + (e.leave || 0), 0);
          return (
            <>
              <div className="m-stat-grid">
                <div className="m-stat"><p className="m-stat-label">Days</p><p className="m-stat-value">{totalDays}</p></div>
                <div className="m-stat"><p className="m-stat-label">Present</p><p className="m-stat-value">{totalP}</p></div>
                <div className="m-stat m-stat-accent"><p className="m-stat-label">Absent</p><p className="m-stat-value">{totalA}</p></div>
                <div className="m-stat"><p className="m-stat-label">Leave</p><p className="m-stat-value">{totalL}</p></div>
              </div>
              <div className="m-list">
                {Object.entries(empReportData.summary).map(([empId, s]) => {
                  const emp = employees.find(e => e.employee_id === empId);
                  const name = emp ? `${emp.first_name} ${emp.last_name}` : empId;
                  const pct = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0;
                  return (
                    <div key={empId} className="m-list-item" style={{gap:8}}>
                      <div style={{minWidth:0,flex:1}}>
                        <p style={{fontWeight:600,fontSize:13,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{name}</p>
                        <p style={{fontSize:10,color:'#888'}}>P {s.present || 0} · A {s.absent || 0} · L {s.leave || 0}</p>
                      </div>
                      <span style={{fontSize:13,fontWeight:800,color: pct >= 75 ? '#15803d' : '#dc2626',flexShrink:0}}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}
      </>}
    </>
  );
};

// ─── Tab 4: Holidays ───────────────────────────────────────────────────────

const HolidaysTab = () => {
  const [holidays, setHolidays] = useState(getCached('m-att:holidays') || []);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/holidays');
      const arr = Array.isArray(r.data) ? r.data : [];
      setHolidays(arr);
      setCached('m-att:holidays', arr);
    } catch { toast.error('Failed to load holidays'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    if (!confirmDelete) return;
    try {
      await api.delete(`/holidays/${confirmDelete.holiday_id}`);
      toast.success('Holiday removed');
      setConfirmDelete(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to remove'); }
  };

  return (
    <>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,gap:8}}>
        <p style={{fontSize:11,color:'#666',flex:1,minWidth:0}}>
          Holidays block attendance for that day
        </p>
        <button onClick={() => setShowAdd(true)} className="m-btn m-btn-primary m-btn-sm" style={{width:'auto'}}>
          <Plus size={14} /> Add
        </button>
      </div>

      {loading && holidays.length === 0 ? (
        <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:56,borderRadius:14,marginBottom:8}} />)}</div>
      ) : holidays.length === 0 ? (
        <div className="m-empty"><Calendar className="m-empty-icon" /><p>No holidays added yet</p></div>
      ) : (
        <div className="m-list">
          {holidays.map(h => (
            <div key={h.holiday_id} className="m-list-item" style={{gap:8}}>
              <div style={{minWidth:0,flex:1}}>
                <p style={{fontWeight:700,fontSize:13,color:'#1A1A1A'}}>{h.name}</p>
                <p style={{fontSize:11,color:'#888'}}>{h.date} · <span style={{textTransform:'capitalize'}}>{h.type}</span></p>
              </div>
              <button
                onClick={() => setConfirmDelete(h)}
                aria-label="Remove"
                style={{padding:'6px 10px',borderRadius:8,background:'#FFF',border:'1px solid #fecaca',color:'#dc2626',fontSize:11,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:4,flexShrink:0}}
              >
                <Trash2 size={12} /> Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddHolidaySheet
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); load(); }}
        />
      )}

      {confirmDelete && (
        <ConfirmSheet
          title="Remove holiday?"
          message={`Remove "${confirmDelete.name}" on ${confirmDelete.date}? Attendance for that day will be allowed again.`}
          danger
          confirmLabel="Remove"
          onConfirm={remove}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
};

const AddHolidaySheet = ({ onClose, onAdded }) => {
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('public');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const save = async () => {
    if (!date || !name.trim()) { toast.error('Date and name required'); return; }
    setSaving(true);
    try {
      await api.post('/holidays', { date, name: name.trim(), type });
      toast.success('Holiday added');
      onAdded();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to add holiday'); }
    finally { setSaving(false); }
  };

  return (
    <div
      onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:240,display:'flex',alignItems:'flex-end',justifyContent:'center'}}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{background:'#FFF',width:'100%',maxWidth:520,borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:'94dvh',display:'flex',flexDirection:'column',paddingBottom:'env(safe-area-inset-bottom, 0)'}}
      >
        <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
          <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0'}}>
          <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>Add Holiday</h2>
          <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888'}}>
            <X size={20} />
          </button>
        </div>
        <div style={{padding:16,flex:1,overflowY:'auto'}}>
          <div style={{marginBottom:10}}>
            <label style={formLabel}>Date</label>
            <input
              type="date" className="m-input" value={date}
              onChange={(e) => setDate(e.target.value)}
              onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
              style={{cursor:'pointer'}}
            />
          </div>
          <div style={{marginBottom:10}}>
            <label style={formLabel}>Name</label>
            <input className="m-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Republic Day" />
          </div>
          <div style={{marginBottom:10}}>
            <label style={formLabel}>Type</label>
            <select className="m-input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="public">Public Holiday</option>
              <option value="school">School Holiday</option>
              <option value="optional">Optional Holiday</option>
            </select>
          </div>
        </div>
        <div style={{display:'flex',gap:8,padding:12,borderTop:'1px solid #F0F0F0',background:'#FFF'}}>
          <button onClick={onClose} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
          <button onClick={save} disabled={saving} className="m-btn m-btn-primary" style={{flex:1}}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Add
          </button>
        </div>
      </div>
    </div>
  );
};

const ConfirmSheet = ({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }) => {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const confirm = async () => {
    setLoading(true);
    try { await onConfirm(); }
    finally { setLoading(false); }
  };

  return (
    <div
      onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:260,display:'flex',alignItems:'center',justifyContent:'center'}}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{background:'#FFF',width:'100%',maxWidth:520,margin:16,borderRadius:16}}
      >
        <div style={{padding:20}}>
          <h3 style={{fontSize:16,fontWeight:800,color:'#1A1A1A',marginBottom:8}}>{title}</h3>
          <p style={{fontSize:13,color:'#666',lineHeight:1.5}}>{message}</p>
        </div>
        <div style={{display:'flex',gap:8,padding:12,borderTop:'1px solid #F0F0F0'}}>
          <button onClick={onClose} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
          <button onClick={confirm} disabled={loading} className="m-btn" style={{flex:1, background: danger ? '#dc2626' : '#1A1A1A', color:'#FFF'}}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : null} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
