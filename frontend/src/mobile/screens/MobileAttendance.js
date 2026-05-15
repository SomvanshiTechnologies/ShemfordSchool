import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import { toast } from 'sonner';
import { CheckCircle, XCircle, Clock, Lock, Unlock, Loader2, Calendar } from 'lucide-react';

const MobileAttendance = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isStudentOrParent = user?.role === 'student' || user?.role === 'parent';

  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [attData, setAttData] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState(null);

  const [selClass, setSelClass] = useState('');
  const [selSection, setSelSection] = useState('');
  const [selDate, setSelDate] = useState(new Date().toISOString().split('T')[0]);

  // Student view
  const [myRecords, setMyRecords] = useState([]);
  const [myLoading, setMyLoading] = useState(true);

  useEffect(() => {
    if (isStudentOrParent) {
      api.get('/attendance', { params: { entity_type: 'student' } })
        .then(r => setMyRecords(r.data))
        .finally(() => setMyLoading(false));
    } else {
      api.get('/classes').then(r => setClasses(r.data));
    }
  }, [isStudentOrParent]);

  useEffect(() => {
    if (selClass && selSection && !isStudentOrParent) {
      setLoading(true);
      Promise.all([
        api.get('/students', { params: { class_name: selClass, section: selSection } }),
        api.get('/attendance', { params: { entity_type: 'student', date: selDate, class_name: selClass, section: selSection } }),
        api.get('/attendance/session-status', { params: { class_name: selClass, section: selSection, date: selDate } }),
      ]).then(([s, a, sess]) => {
        setStudents(s.data.students ?? s.data ?? []);
        setSession(sess.data);
        const m = {};
        a.data.forEach(r => { m[r.entity_id] = r.status; });
        setAttData(m);
      }).finally(() => setLoading(false));
    }
  }, [selClass, selSection, selDate, isStudentOrParent]);

  const isLocked = session?.is_locked && session?.submitted;
  const isHoliday = session?.is_holiday;
  const canEdit = (!isLocked && !isHoliday) || isAdmin;

  const markAll = (status) => { const n = {}; students.forEach(s => { n[s.student_id] = status; }); setAttData(n); };

  const submitAttendance = async () => {
    setSaving(true);
    try {
      const records = students.map(s => ({
        entity_type: 'student', entity_id: s.student_id, date: selDate,
        status: attData[s.student_id] || 'absent', class_name: selClass, section: selSection,
      }));
      const res = await api.post('/attendance', { class_name: selClass, section: selSection, date: selDate, records });
      toast.success('Attendance submitted');
      if (res.data.parents_notified > 0) toast.info(`${res.data.parents_notified} parent(s) notified`);
      setSession({ submitted: true, is_locked: true, ...res.data });
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const unlock = async () => {
    try {
      await api.post('/attendance/unlock', { class_name: selClass, section: selSection, date: selDate });
      toast.success('Unlocked');
      setSession({ ...session, is_locked: false });
    } catch (e) { toast.error('Failed'); }
  };

  // ====== STUDENT/PARENT VIEW ======
  if (isStudentOrParent) {
    const present = myRecords.filter(r => r.status === 'present').length;
    const absent = myRecords.filter(r => r.status === 'absent').length;
    const total = myRecords.length;
    const pct = total > 0 ? Math.round(present / total * 100) : 0;

    return (
      <div data-testid="m-my-attendance">
        <div className="m-header"><div><h1>My Attendance</h1><p className="m-header-sub">{total} days recorded</p></div></div>
        <div className="m-stat-grid">
          <div className="m-stat"><p className="m-stat-label">Present</p><p className="m-stat-value">{present}</p></div>
          <div className="m-stat m-stat-accent"><p className="m-stat-label">Absent</p><p className="m-stat-value">{absent}</p></div>
          <div className="m-stat"><p className="m-stat-label">Total</p><p className="m-stat-value">{total}</p></div>
          <div className="m-stat"><p className="m-stat-label">Percentage</p><p className="m-stat-value">{pct}%</p></div>
        </div>
        <div className="m-list">
          {myRecords.slice(0, 30).map((r, i) => (
            <div key={i} className="m-list-item">
              <span style={{fontWeight:600,fontSize:13,color:'#1A1A1A'}}>{r.date}</span>
              <span className={`m-badge ${r.status === 'present' ? 'm-badge-dark' : r.status === 'absent' ? 'm-badge-orange' : 'm-badge-muted'}`}>{r.status}</span>
            </div>
          ))}
          {myRecords.length === 0 && <div className="m-empty"><Calendar className="m-empty-icon" /><p>No records yet</p></div>}
        </div>
      </div>
    );
  }

  // ====== TEACHER/ADMIN VIEW ======
  const sections = classes.find(c => c.name === selClass)?.sections || [];

  return (
    <div data-testid="m-attendance">
      <div className="m-header"><div><h1>Attendance</h1><p className="m-header-sub">{selDate}</p></div></div>

      {/* Class selector */}
      <p className="m-section">Select Class</p>
      <div className="m-chips" style={{marginBottom:12}}>
        {classes.map(c => (
          <button key={c.name} className={`m-chip ${selClass === c.name ? 'active' : ''}`} onClick={() => { setSelClass(c.name); setSelSection(''); setSession(null); }}>
            {c.display_name || c.name}
          </button>
        ))}
      </div>

      {selClass && (
        <>
          <div className="m-chips" style={{marginBottom:12}}>
            {sections.map(s => {
              const n = typeof s === 'string' ? s : s.section_name;
              return <button key={n} className={`m-chip ${selSection === n ? 'active' : ''}`} onClick={() => setSelSection(n)}>{n}</button>;
            })}
          </div>
          <input type="date" className="m-input" value={selDate} onChange={e => setSelDate(e.target.value)} style={{marginBottom:16}} />
        </>
      )}

      {/* Holiday banner */}
      {isHoliday && (
        <div className="m-card-orange" style={{textAlign:'center'}}>
          <Calendar size={20} color="#FFF" style={{margin:'0 auto 8px'}} />
          <p style={{fontWeight:700,color:'#FFF'}}>{session?.holiday_name}</p>
          <p style={{fontSize:12,color:'rgba(255,255,255,0.7)'}}>Holiday — attendance blocked</p>
        </div>
      )}

      {/* Locked banner */}
      {isLocked && !isHoliday && (
        <div className="m-card-dark" style={{display:'flex',alignItems:'center',gap:12}}>
          <Lock size={18} color="#E88A1A" />
          <div style={{flex:1}}>
            <p style={{fontWeight:700,color:'#FFF',fontSize:13}}>Submitted & Locked</p>
            <p style={{fontSize:11,color:'#888'}}>{!isAdmin && 'Contact admin to edit'}</p>
          </div>
          {isAdmin && <button className="m-btn m-btn-sm" style={{background:'#E88A1A',color:'#FFF',width:'auto'}} onClick={unlock}><Unlock size={14} /> Unlock</button>}
        </div>
      )}

      {/* Quick actions */}
      {canEdit && students.length > 0 && !isHoliday && (
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <button className="m-btn m-btn-outline m-btn-sm" style={{flex:1}} onClick={() => markAll('present')}><CheckCircle size={14} /> All Present</button>
          <button className="m-btn m-btn-primary m-btn-sm" style={{flex:1}} onClick={submitAttendance} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Submit & Lock
          </button>
        </div>
      )}

      {/* Student list */}
      {loading ? (
        <div>{[1,2,3,4,5].map(i => <div key={i} className="m-skeleton" style={{height:56,borderRadius:14,marginBottom:8}} />)}</div>
      ) : students.length === 0 && selClass && selSection ? (
        <div className="m-empty"><p>No students found</p></div>
      ) : (
        <div className="m-list">
          {students.map(s => {
            const status = attData[s.student_id] || '';
            return (
              <div key={s.student_id} className="m-att-row">
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontWeight:600,fontSize:13,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.first_name} {s.last_name}</p>
                  <p style={{fontSize:10,color:'#888'}}>{s.roll_number || s.admission_number}</p>
                </div>
                <div className="m-att-btns">
                  <button className={`m-att-btn ${status === 'present' ? 'active' : ''}`} onClick={() => canEdit && setAttData(p => ({...p, [s.student_id]: 'present'}))} disabled={!canEdit}>
                    <CheckCircle size={16} />
                  </button>
                  <button className={`m-att-btn ${status === 'absent' ? 'active-absent' : ''}`} onClick={() => canEdit && setAttData(p => ({...p, [s.student_id]: 'absent'}))} disabled={!canEdit}>
                    <XCircle size={16} />
                  </button>
                  <button className={`m-att-btn ${status === 'leave' ? 'active-leave' : ''}`} onClick={() => canEdit && setAttData(p => ({...p, [s.student_id]: 'leave'}))} disabled={!canEdit}>
                    <Clock size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MobileAttendance;
