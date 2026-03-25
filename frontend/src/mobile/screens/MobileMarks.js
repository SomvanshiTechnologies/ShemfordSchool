import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import { toast } from 'sonner';
import { GraduationCap, Lock, Loader2, Save } from 'lucide-react';

const GRADE = (pct) => {
  if (pct >= 91) return 'A1'; if (pct >= 81) return 'A2'; if (pct >= 71) return 'B1';
  if (pct >= 61) return 'B2'; if (pct >= 51) return 'C1'; if (pct >= 41) return 'C2';
  if (pct >= 33) return 'D'; return 'E';
};

const MobileMarks = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';
  const isStudentOrParent = user?.role === 'student' || user?.role === 'parent';

  const [exams, setExams] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selExam, setSelExam] = useState(null);
  const [selSection, setSelSection] = useState('');
  const [students, setStudents] = useState([]);
  const [marks, setMarks] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Student view
  const [myMarks, setMyMarks] = useState([]);

  useEffect(() => {
    if (isStudentOrParent) {
      api.get('/marks').then(r => setMyMarks(r.data)).finally(() => setLoading(false));
    } else {
      Promise.all([
        api.get('/exams'), api.get('/classes'),
      ]).then(([e, c]) => {
        setExams(e.data); setClasses(c.data);
      }).finally(() => setLoading(false));
    }
  }, [isStudentOrParent]);

  useEffect(() => {
    if (selExam && selSection) {
      setLoading(true);
      Promise.all([
        api.get('/students', { params: { class_name: selExam.class_name, section: selSection } }),
        api.get('/marks', { params: { exam_id: selExam.exam_id, class_name: selExam.class_name, section: selSection } }),
      ]).then(([s, m]) => {
        setStudents(s.data);
        const map = {};
        m.data.forEach(mk => {
          if (!map[mk.student_id]) map[mk.student_id] = {};
          map[mk.student_id][mk.subject] = mk.marks_obtained;
        });
        setMarks(map);
      }).finally(() => setLoading(false));
    }
  }, [selExam, selSection]);

  const saveMarks = async () => {
    setSaving(true);
    try {
      const records = [];
      students.forEach(s => {
        (selExam.subjects || []).forEach(subj => {
          const val = marks[s.student_id]?.[subj.subject];
          if (val !== undefined && val !== '') {
            records.push({ student_id: s.student_id, subject: subj.subject, marks_obtained: parseFloat(val), max_marks: subj.max_marks, section: selSection });
          }
        });
      });
      const res = await api.post('/marks', { exam_id: selExam.exam_id, records });
      toast.success(`${res.data.success} marks saved`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  // ====== STUDENT VIEW ======
  if (isStudentOrParent) {
    const bySubject = {};
    myMarks.forEach(m => {
      if (!bySubject[m.subject]) bySubject[m.subject] = [];
      bySubject[m.subject].push(m);
    });

    return (
      <div data-testid="m-my-marks">
        <div className="m-header"><div><h1>My Marks</h1><p className="m-header-sub">{myMarks.length} records</p></div></div>
        {Object.keys(bySubject).length === 0 ? (
          <div className="m-empty"><GraduationCap className="m-empty-icon" /><p>No marks published yet</p></div>
        ) : (
          <div className="m-list">
            {Object.entries(bySubject).map(([subject, mks]) => {
              const totalObt = mks.reduce((s, m) => s + m.marks_obtained, 0);
              const totalMax = mks.reduce((s, m) => s + m.max_marks, 0);
              const pct = totalMax > 0 ? (totalObt / totalMax * 100) : 0;
              return (
                <div key={subject} className="m-list-item">
                  <div>
                    <p style={{fontWeight:700,fontSize:14,color:'#1A1A1A'}}>{subject}</p>
                    <p style={{fontSize:12,color:'#888'}}>{totalObt}/{totalMax}</p>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <span className={`m-badge ${pct >= 60 ? 'm-badge-dark' : pct >= 33 ? 'm-badge-muted' : 'm-badge-orange'}`}>{GRADE(pct)}</span>
                    <p style={{fontSize:12,fontWeight:700,color:'#1A1A1A',marginTop:4}}>{pct.toFixed(0)}%</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ====== TEACHER/ADMIN VIEW ======
  const examSections = selExam ? (classes.find(c => c.name === selExam.class_name)?.sections || []) : [];

  return (
    <div data-testid="m-marks">
      <div className="m-header"><div><h1>Marks</h1><p className="m-header-sub">{exams.length} exams defined</p></div></div>

      <p className="m-section">Select Exam</p>
      <div className="m-chips" style={{marginBottom:12}}>
        {exams.map(e => (
          <button key={e.exam_id} className={`m-chip ${selExam?.exam_id === e.exam_id ? 'active' : ''}`} onClick={() => { setSelExam(e); setSelSection(''); }}>
            {e.name} {e.is_locked ? '🔒' : ''}
          </button>
        ))}
      </div>

      {selExam && (
        <div className="m-chips" style={{marginBottom:12}}>
          {examSections.map(s => {
            const n = typeof s === 'string' ? s : s.section_name;
            return <button key={n} className={`m-chip ${selSection === n ? 'active' : ''}`} onClick={() => setSelSection(n)}>{n}</button>;
          })}
        </div>
      )}

      {selExam?.is_locked && (
        <div className="m-card-dark" style={{display:'flex',alignItems:'center',gap:10}}>
          <Lock size={16} color="#E88A1A" />
          <p style={{fontSize:13,fontWeight:600,color:'#FFF'}}>Exam locked — {isAdmin ? 'unlock from web app' : 'contact admin'}</p>
        </div>
      )}

      {selExam && selSection && !loading && (
        <>
          {!selExam.is_locked && (
            <button className="m-btn m-btn-primary" style={{marginBottom:16}} onClick={saveMarks} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Marks
            </button>
          )}

          <div className="m-list">
            {students.map(s => {
              const sm = marks[s.student_id] || {};
              return (
                <div key={s.student_id} style={{padding:'12px 16px',borderBottom:'1px solid #F5F5F5'}}>
                  <p style={{fontWeight:700,fontSize:13,color:'#1A1A1A',marginBottom:8}}>{s.first_name} {s.last_name}</p>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                    {(selExam.subjects || []).map(subj => (
                      <div key={subj.subject} style={{flex:'1 1 80px'}}>
                        <p style={{fontSize:10,fontWeight:600,color:'#888',marginBottom:4}}>{subj.subject}</p>
                        <input
                          type="number"
                          className="m-input"
                          style={{padding:'8px 10px',fontSize:16,textAlign:'center'}}
                          placeholder={`/${subj.max_marks}`}
                          value={sm[subj.subject] ?? ''}
                          onChange={e => setMarks(p => ({...p, [s.student_id]: {...(p[s.student_id] || {}), [subj.subject]: e.target.value}}))}
                          disabled={selExam.is_locked && !isAdmin}
                          max={subj.max_marks}
                          min="0"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {loading && selExam && selSection && (
        <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:80,borderRadius:14,marginBottom:8}} />)}</div>
      )}
    </div>
  );
};

export default MobileMarks;
