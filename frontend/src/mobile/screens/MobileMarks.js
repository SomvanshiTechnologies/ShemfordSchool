import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import { getCached, setCached, invalidatePrefix } from '../../lib/pageCache';
import { previewInTab } from '../../lib/preview';
import { currentAcademicYear } from '../../lib/academicYear';
import { toast } from 'sonner';
import {
  GraduationCap, FileText, Plus, Lock, Unlock, Eye, Loader2, Save,
  X, Trash2, Download, Search, ChevronRight, Award,
} from 'lucide-react';

// ─── Shared helpers ────────────────────────────────────────────────────────

const GRADE_MAP = (pct) => {
  if (pct >= 91) return { grade: 'A1', bg: '#dcfce7', color: '#047857' };
  if (pct >= 81) return { grade: 'A2', bg: '#d1fae5', color: '#15803d' };
  if (pct >= 71) return { grade: 'B1', bg: '#dbeafe', color: '#1d4ed8' };
  if (pct >= 61) return { grade: 'B2', bg: '#e0f2fe', color: '#0369a1' };
  if (pct >= 51) return { grade: 'C1', bg: '#fef3c7', color: '#a16207' };
  if (pct >= 41) return { grade: 'C2', bg: '#ffedd5', color: '#c2410c' };
  if (pct >= 33) return { grade: 'D',  bg: '#fee2e2', color: '#dc2626' };
  return                { grade: 'E',  bg: '#fecaca', color: '#991b1b' };
};

const formLabel = {
  display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase',
  letterSpacing:'0.06em', color:'#666', marginBottom:6,
};

const MARKS_PAGE_SIZE = 10;
const MPager = ({ page, total, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / MARKS_PAGE_SIZE));
  if (total <= MARKS_PAGE_SIZE) return null;
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'8px 2px 4px'}}>
      <span style={{fontSize:11,color:'#888'}}>{(page - 1) * MARKS_PAGE_SIZE + 1}–{Math.min(page * MARKS_PAGE_SIZE, total)} of {total}</span>
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        <button className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}} disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
        <span style={{fontSize:11,color:'#666'}}>Page {page}/{pages}</span>
        <button className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
};

const TabBar = ({ tabs, active, onChange }) => (
  <div style={{display:'flex',gap:6,padding:4,background:'#F0F0F0',borderRadius:12,marginBottom:12,overflowX:'auto'}}>
    {tabs.map(t => (
      <button key={t.key} onClick={() => onChange(t.key)}
        style={{
          flex:1,minWidth:'fit-content',padding:'8px 12px',borderRadius:8,border:'none',
          background: active === t.key ? '#FFF' : 'transparent',
          color: active === t.key ? '#1A1A1A' : '#888',
          fontSize:12,fontWeight:700,cursor:'pointer',
          boxShadow: active === t.key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
          whiteSpace:'nowrap',
        }}
        data-testid={`m-marks-tab-${t.key}`}
      >
        {t.label}
      </button>
    ))}
  </div>
);

const Sheet = ({ title, sub, onClose, footer, children }) => {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:240,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
      <div onClick={(e) => e.stopPropagation()}
        style={{background:'#FFF',width:'100%',maxWidth:520,borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:'94dvh',display:'flex',flexDirection:'column',paddingBottom:'env(safe-area-inset-bottom, 0)'}}>
        <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
          <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
        </div>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0',gap:8}}>
          <div style={{minWidth:0,flex:1}}>
            <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{title}</h2>
            {sub && <p style={{fontSize:11,color:'#888'}}>{sub}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888',flexShrink:0}}>
            <X size={20} />
          </button>
        </div>
        <div style={{padding:16,flex:1,overflowY:'auto'}}>{children}</div>
        {footer && <div style={{display:'flex',gap:8,padding:12,borderTop:'1px solid #F0F0F0',background:'#FFF'}}>{footer}</div>}
      </div>
    </div>
  );
};

const GradePill = ({ pct }) => {
  if (pct == null || isNaN(pct)) return null;
  const g = GRADE_MAP(pct);
  return (
    <span style={{display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,background:g.bg,color:g.color}}>
      {g.grade}
    </span>
  );
};

// ─── Main ──────────────────────────────────────────────────────────────────

const MobileMarks = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';
  const canEditMarks = isAdmin || isTeacher;
  const isStudentOrParent = user?.role === 'student' || user?.role === 'parent';

  const [tab, setTab] = useState(isAdmin ? 'exams' : (canEditMarks ? 'entry' : 'view'));
  const [showMarksheet, setShowMarksheet] = useState(false);
  const [showExamForm, setShowExamForm] = useState(false);

  // Shared lookups
  const [classes, setClasses] = useState(getCached('classes') || []);
  const [subjects, setSubjects] = useState(getCached('subjects') || []);
  const [exams, setExams] = useState(getCached('marks:exams') || []);

  useEffect(() => {
    (async () => {
      try {
        const [c, s, e] = await Promise.all([
          api.get('/classes'),
          api.get('/subjects'),
          api.get('/exams'),
        ]);
        const cs = Array.isArray(c.data) ? c.data : [];
        const ss = Array.isArray(s.data) ? s.data : [];
        const es = Array.isArray(e.data) ? e.data : [];
        setClasses(cs); setSubjects(ss); setExams(es);
        setCached('classes', cs);
        setCached('subjects', ss);
        setCached('marks:exams', es);
      } catch {}
    })();
  }, []);

  const refreshExams = useCallback(async () => {
    try {
      const r = await api.get('/exams');
      const arr = Array.isArray(r.data) ? r.data : [];
      setExams(arr);
      setCached('marks:exams', arr);
    } catch {}
  }, []);

  const tabs = [
    ...(isAdmin ? [{ key: 'exams', label: 'Exams' }] : []),
    ...(canEditMarks ? [{ key: 'entry', label: 'Marks Entry' }] : []),
    ...(!isTeacher ? [{ key: 'view', label: isAdmin ? 'View Marks' : 'My Marks' }] : []),
  ];

  return (
    <div data-testid="m-marks" style={{minWidth:0}}>
      <div className="m-header" style={{gap:8,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:0}}>
          <h1>Marks</h1>
          <p className="m-header-sub">Exams · Entry · Marksheets</p>
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          <button onClick={() => setShowMarksheet(true)}
            style={{display:'flex',alignItems:'center',gap:4,padding:'8px 10px',borderRadius:10,background:'#FFF',border:'1.5px solid #E5E5E5',fontSize:12,fontWeight:700,color:'#1A1A1A',cursor:'pointer'}}
            data-testid="m-marksheet-btn">
            <FileText size={14} /> Marksheet
          </button>
          {isAdmin && (
            <button onClick={() => setShowExamForm(true)}
              style={{display:'flex',alignItems:'center',gap:4,padding:'8px 10px',borderRadius:10,background:'#1A1A1A',border:'none',fontSize:12,fontWeight:700,color:'#FFF',cursor:'pointer'}}
              data-testid="m-create-exam-btn">
              <Plus size={14} /> Exam
            </button>
          )}
        </div>
      </div>

      {tabs.length > 1 && <TabBar tabs={tabs} active={tab} onChange={setTab} />}

      {tab === 'exams' && isAdmin && (
        <ExamsTab exams={exams} onChanged={refreshExams} />
      )}
      {tab === 'entry' && canEditMarks && (
        <EntryTab exams={exams} classes={classes} isAdmin={isAdmin} />
      )}
      {tab === 'view' && !isTeacher && (
        isStudentOrParent
          ? <MyMarksTab />
          : <ViewTab exams={exams} classes={classes} />
      )}

      {showMarksheet && (
        <MarksheetSheet
          canEditMarks={canEditMarks}
          onClose={() => setShowMarksheet(false)}
        />
      )}

      {showExamForm && isAdmin && (
        <ExamFormSheet
          classes={classes}
          subjects={subjects}
          onClose={() => setShowExamForm(false)}
          onCreated={() => { setShowExamForm(false); refreshExams(); }}
        />
      )}
    </div>
  );
};

export default MobileMarks;

// ─── Exams tab ─────────────────────────────────────────────────────────────

const ExamsTab = ({ exams, onChanged }) => {
  const [busyId, setBusyId] = useState(null);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [exams]);

  const toggleLock = async (exam) => {
    setBusyId(exam.exam_id);
    try {
      if (exam.is_locked) await api.post(`/exams/${exam.exam_id}/unlock`);
      else await api.post(`/exams/${exam.exam_id}/lock`);
      toast.success(exam.is_locked ? 'Unlocked' : 'Locked');
      onChanged();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setBusyId(null); }
  };

  const publish = async (exam) => {
    setBusyId(exam.exam_id);
    try {
      await api.post(`/exams/${exam.exam_id}/publish`);
      toast.success('Results published');
      onChanged();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setBusyId(null); }
  };

  if (exams.length === 0) {
    return <div className="m-empty"><GraduationCap className="m-empty-icon" /><p>No exams defined yet</p></div>;
  }

  return (
    <div>
      {exams.slice((page - 1) * MARKS_PAGE_SIZE, page * MARKS_PAGE_SIZE).map(exam => {
        const subjects = exam.subjects?.map(s => s.subject).join(', ') || '';
        return (
          <div key={exam.exam_id} style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:12,marginBottom:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
              <div style={{minWidth:0,flex:1}}>
                <p style={{fontSize:14,fontWeight:700,color:'#1A1A1A',wordBreak:'break-word'}}>{exam.name}</p>
                <p style={{fontSize:11,color:'#888',marginTop:2,textTransform:'capitalize'}}>
                  {exam.exam_type?.replace('_', ' ')} · Class {exam.class_name} · {exam.academic_year}
                </p>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0,alignItems:'flex-end'}}>
                {exam.is_locked && <Badge bg="#F1F5F9" color="#475569"><Lock size={9} /> Locked</Badge>}
                {exam.is_published && <Badge bg="#fef3c7" color="#a16207"><Eye size={9} /> Published</Badge>}
                {!exam.is_locked && !exam.is_published && <Badge bg="#dbeafe" color="#1d4ed8">Draft</Badge>}
              </div>
            </div>
            {subjects && (
              <p style={{fontSize:11,color:'#666',marginTop:8,wordBreak:'break-word'}}>{subjects}</p>
            )}
            <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
              <button onClick={() => toggleLock(exam)} disabled={busyId === exam.exam_id}
                style={{display:'flex',alignItems:'center',gap:4,padding:'6px 10px',borderRadius:8,background:'#FFF',border:'1px solid #E5E5E5',fontSize:11,fontWeight:700,color:'#1A1A1A',cursor:'pointer'}}
                data-testid={`m-toggle-lock-${exam.exam_id}`}>
                {busyId === exam.exam_id ? <Loader2 size={12} className="animate-spin" /> : (exam.is_locked ? <Unlock size={12} /> : <Lock size={12} />)}
                {exam.is_locked ? 'Unlock' : 'Lock'}
              </button>
              {!exam.is_published && (
                <button onClick={() => publish(exam)} disabled={busyId === exam.exam_id}
                  style={{display:'flex',alignItems:'center',gap:4,padding:'6px 10px',borderRadius:8,background:'#1A1A1A',border:'none',fontSize:11,fontWeight:700,color:'#FFF',cursor:'pointer'}}
                  data-testid={`m-publish-${exam.exam_id}`}>
                  <Eye size={12} /> Publish
                </button>
              )}
            </div>
          </div>
        );
      })}
      <MPager page={page} total={exams.length} onPage={setPage} />
    </div>
  );
};

const Badge = ({ children, bg, color }) => (
  <span style={{
    display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',borderRadius:6,
    fontSize:10,fontWeight:700,background:bg,color,
  }}>{children}</span>
);

// ─── Entry tab ─────────────────────────────────────────────────────────────

const EntryTab = ({ exams, classes, isAdmin }) => {
  const [selectedExam, setSelectedExam] = useState(null);
  const [selSection, setSelSection] = useState('');
  const [students, setStudents] = useState([]);
  const [marksData, setMarksData] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [students]);

  const examOptions = useMemo(() => exams.filter(e => !e.is_locked || isAdmin), [exams, isAdmin]);

  const sections = useMemo(() => {
    if (!selectedExam) return [];
    return classes.find(c => c.name === selectedExam.class_name)?.sections || [];
  }, [classes, selectedExam]);

  const load = useCallback(async () => {
    if (!selectedExam || !selSection) return;
    const cacheKey = `m-marks:${selectedExam.exam_id}:${selSection}`;
    const cached = getCached(cacheKey);
    if (cached) {
      setStudents(cached.students);
      setMarksData(cached.marksData);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const [s, m] = await Promise.all([
        api.get('/students', { params: { class_name: selectedExam.class_name, section: selSection } }),
        api.get('/marks', { params: { exam_id: selectedExam.exam_id, class_name: selectedExam.class_name, section: selSection } }),
      ]);
      const stArr = s.data?.students ?? (Array.isArray(s.data) ? s.data : []);
      const marksArr = Array.isArray(m.data) ? m.data : [];
      const map = {};
      marksArr.forEach(mk => {
        if (!map[mk.student_id]) map[mk.student_id] = {};
        map[mk.student_id][mk.subject] = mk.marks_obtained;
      });
      setStudents(stArr);
      setMarksData(map);
      setCached(cacheKey, { students: stArr, marksData: map });
    } catch {
      if (!cached) toast.error('Failed to load students or marks');
    } finally { setLoading(false); }
  }, [selectedExam, selSection]);

  useEffect(() => { load(); }, [load]);

  const handleMark = (studentId, subject, value, maxMarks) => {
    const num = parseFloat(value);
    if (value !== '' && !isNaN(num) && num > maxMarks) return;
    setMarksData(p => ({ ...p, [studentId]: { ...(p[studentId] || {}), [subject]: value } }));
  };

  const save = async () => {
    if (!selectedExam) return;
    // Validation
    for (const s of students) {
      for (const subj of (selectedExam.subjects || [])) {
        const val = marksData[s.student_id]?.[subj.subject];
        if (val !== undefined && val !== '') {
          const num = parseFloat(val);
          if (!isNaN(num)) {
            if (num > subj.max_marks) { toast.error(`${s.first_name}: ${subj.subject} > max (${subj.max_marks})`); return; }
            if (num < 0) { toast.error(`${s.first_name}: ${subj.subject} cannot be negative`); return; }
          }
        }
      }
    }
    setSaving(true);
    try {
      const records = [];
      students.forEach(s => {
        (selectedExam.subjects || []).forEach(subj => {
          const val = marksData[s.student_id]?.[subj.subject];
          if (val !== undefined && val !== '') {
            records.push({
              student_id: s.student_id,
              subject: subj.subject,
              marks_obtained: parseFloat(val),
              max_marks: subj.max_marks,
              section: selSection,
            });
          }
        });
      });
      if (records.length === 0) { toast.error('No marks to save'); setSaving(false); return; }
      const r = await api.post('/marks', { exam_id: selectedExam.exam_id, records });
      if (r.data.failed > 0) toast.warning(`${r.data.success} saved, ${r.data.failed} failed`);
      else toast.success(`${r.data.success} marks saved`);
      invalidatePrefix('m-marks:');
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div style={{marginBottom:10}}>
        <label style={formLabel}>Exam</label>
        <select className="m-input" value={selectedExam?.exam_id || ''} onChange={(e) => {
          const ex = examOptions.find(x => x.exam_id === e.target.value);
          setSelectedExam(ex || null);
          setSelSection('');
        }}>
          <option value="">Choose an exam</option>
          {examOptions.map(e => (
            <option key={e.exam_id} value={e.exam_id}>
              {e.name} — {e.class_name}{e.is_locked ? ' (Locked)' : ''}
            </option>
          ))}
        </select>
      </div>

      {selectedExam && (
        <div style={{marginBottom:10}}>
          <label style={formLabel}>Section</label>
          <select className="m-input" value={selSection} onChange={(e) => setSelSection(e.target.value)}>
            <option value="">Select section</option>
            {sections.map(s => {
              const name = typeof s === 'string' ? s : s.section_name;
              return <option key={name} value={name}>{name}</option>;
            })}
          </select>
        </div>
      )}

      {selectedExam?.is_locked && (
        <div className="m-card-dark" style={{display:'flex',alignItems:'center',gap:10}}>
          <Lock size={16} color="#E88A1A" />
          <p style={{fontSize:12,color:'#FFF'}}>This exam is locked. {isAdmin ? 'Unlock from Exams tab to edit.' : 'Contact admin.'}</p>
        </div>
      )}

      {selectedExam && selSection && students.length > 0 && (
        <button onClick={save} disabled={saving || (selectedExam.is_locked && !isAdmin)}
          className="m-btn m-btn-primary"
          style={{marginBottom:12}}
          data-testid="m-save-marks">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Marks
        </button>
      )}

      {!selectedExam || !selSection ? (
        <div className="m-empty"><GraduationCap className="m-empty-icon" /><p>Select an exam and section to enter marks</p></div>
      ) : loading && students.length === 0 ? (
        <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:120,borderRadius:14,marginBottom:8}} />)}</div>
      ) : students.length === 0 ? (
        <div className="m-empty"><p>No students in {selectedExam.class_name}-{selSection}</p></div>
      ) : (
        students.slice((page - 1) * MARKS_PAGE_SIZE, page * MARKS_PAGE_SIZE).map(student => {
          const sm = marksData[student.student_id] || {};
          let totalObt = 0, totalMax = 0;
          (selectedExam.subjects || []).forEach(subj => {
            const v = parseFloat(sm[subj.subject]);
            if (!isNaN(v)) { totalObt += v; totalMax += subj.max_marks; }
          });
          const pct = totalMax > 0 ? (totalObt / totalMax) * 100 : null;
          return (
            <div key={student.student_id} style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:12,marginBottom:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:8}}>
                <div style={{minWidth:0,flex:1}}>
                  <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{student.first_name} {student.last_name}</p>
                  <p style={{fontSize:10,color:'#888'}}>{student.admission_number}</p>
                </div>
                {pct != null && (
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <p style={{fontSize:13,fontWeight:800,color:'#1A1A1A'}}>{totalObt}/{totalMax}</p>
                    <div style={{display:'flex',alignItems:'center',gap:4,justifyContent:'flex-end',marginTop:2}}>
                      <span style={{fontSize:10,color:'#888'}}>{pct.toFixed(1)}%</span>
                      <GradePill pct={pct} />
                    </div>
                  </div>
                )}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(110px, 1fr))',gap:8}}>
                {(selectedExam.subjects || []).map(subj => {
                  const val = sm[subj.subject];
                  const num = parseFloat(val);
                  const over = !isNaN(num) && num > subj.max_marks;
                  return (
                    <div key={subj.subject}>
                      <label style={{display:'block',fontSize:10,fontWeight:700,color:'#888',marginBottom:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                        {subj.subject} <span style={{color:'#bbb'}}>/{subj.max_marks}</span>
                      </label>
                      <input
                        type="number"
                        className="m-input"
                        value={val ?? ''}
                        onChange={(e) => handleMark(student.student_id, subj.subject, e.target.value, subj.max_marks)}
                        disabled={selectedExam.is_locked && !isAdmin}
                        min="0"
                        max={subj.max_marks}
                        style={{padding:'8px 10px',fontSize:14,textAlign:'center',borderColor: over ? '#dc2626' : undefined}}
                        data-testid={`m-mark-${student.student_id}-${subj.subject}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
      <MPager page={page} total={students.length} onPage={setPage} />
    </>
  );
};

// ─── View tab (admin) ──────────────────────────────────────────────────────

const ViewTab = ({ exams, classes }) => {
  const [selectedExam, setSelectedExam] = useState(null);
  const [selSection, setSelSection] = useState('');
  const [students, setStudents] = useState([]);
  const [marksData, setMarksData] = useState({});
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [students]);

  const sections = useMemo(() => {
    if (!selectedExam) return [];
    return classes.find(c => c.name === selectedExam.class_name)?.sections || [];
  }, [classes, selectedExam]);

  const load = useCallback(async () => {
    if (!selectedExam || !selSection) return;
    setLoading(true);
    try {
      const [s, m] = await Promise.all([
        api.get('/students', { params: { class_name: selectedExam.class_name, section: selSection } }),
        api.get('/marks', { params: { exam_id: selectedExam.exam_id, class_name: selectedExam.class_name, section: selSection } }),
      ]);
      const stArr = s.data?.students ?? (Array.isArray(s.data) ? s.data : []);
      const marksArr = Array.isArray(m.data) ? m.data : [];
      const map = {};
      marksArr.forEach(mk => {
        if (!map[mk.student_id]) map[mk.student_id] = {};
        map[mk.student_id][mk.subject] = mk.marks_obtained;
      });
      setStudents(stArr);
      setMarksData(map);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  }, [selectedExam, selSection]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div style={{marginBottom:10}}>
        <label style={formLabel}>Exam</label>
        <select className="m-input" value={selectedExam?.exam_id || ''} onChange={(e) => {
          const ex = exams.find(x => x.exam_id === e.target.value);
          setSelectedExam(ex || null);
          setSelSection('');
        }}>
          <option value="">Choose an exam</option>
          {exams.map(e => <option key={e.exam_id} value={e.exam_id}>{e.name} — {e.class_name}</option>)}
        </select>
      </div>
      {selectedExam && (
        <div style={{marginBottom:10}}>
          <label style={formLabel}>Section</label>
          <select className="m-input" value={selSection} onChange={(e) => setSelSection(e.target.value)}>
            <option value="">Select section</option>
            {sections.map(s => {
              const name = typeof s === 'string' ? s : s.section_name;
              return <option key={name} value={name}>{name}</option>;
            })}
          </select>
        </div>
      )}

      {!selectedExam || !selSection ? (
        <div className="m-empty"><GraduationCap className="m-empty-icon" /><p>Select exam + section to view</p></div>
      ) : loading ? (
        <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:80,borderRadius:14,marginBottom:8}} />)}</div>
      ) : students.length === 0 ? (
        <div className="m-empty"><p>No students</p></div>
      ) : (
        students.slice((page - 1) * MARKS_PAGE_SIZE, page * MARKS_PAGE_SIZE).map(student => {
          const sm = marksData[student.student_id] || {};
          let totalObt = 0, totalMax = 0;
          (selectedExam.subjects || []).forEach(subj => {
            const v = parseFloat(sm[subj.subject]);
            if (!isNaN(v)) { totalObt += v; totalMax += subj.max_marks; }
          });
          const pct = totalMax > 0 ? (totalObt / totalMax) * 100 : null;
          return (
            <div key={student.student_id} style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:12,marginBottom:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:8}}>
                <div style={{minWidth:0,flex:1}}>
                  <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{student.first_name} {student.last_name}</p>
                  <p style={{fontSize:10,color:'#888'}}>{student.admission_number}</p>
                </div>
                {pct != null && (
                  <div style={{textAlign:'right',flexShrink:0,display:'flex',alignItems:'center',gap:6}}>
                    <p style={{fontSize:13,fontWeight:800,color:'#1A1A1A'}}>{totalObt}/{totalMax}</p>
                    <GradePill pct={pct} />
                  </div>
                )}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(100px, 1fr))',gap:6}}>
                {(selectedExam.subjects || []).map(subj => (
                  <div key={subj.subject} style={{padding:8,background:'#F8F8F8',borderRadius:8,textAlign:'center'}}>
                    <p style={{fontSize:10,fontWeight:600,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{subj.subject}</p>
                    <p style={{fontSize:13,fontWeight:800,color:'#1A1A1A',marginTop:2}}>
                      {sm[subj.subject] !== undefined ? sm[subj.subject] : '—'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
      <MPager page={page} total={students.length} onPage={setPage} />
    </>
  );
};

// ─── My Marks (student/parent) ─────────────────────────────────────────────

const MyMarksTab = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/marks');
        setRecords(Array.isArray(r.data) ? r.data : []);
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  // Group by subject
  const bySubject = useMemo(() => {
    const grp = {};
    records.forEach(m => {
      if (!grp[m.subject]) grp[m.subject] = [];
      grp[m.subject].push(m);
    });
    return grp;
  }, [records]);

  if (loading) return <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:60,borderRadius:14,marginBottom:8}} />)}</div>;
  if (records.length === 0) {
    return <div className="m-empty"><GraduationCap className="m-empty-icon" /><p>No marks published yet</p></div>;
  }

  return (
    <div className="m-list">
      {Object.entries(bySubject).map(([subject, mks]) => {
        const totalObt = mks.reduce((s, m) => s + (m.marks_obtained || 0), 0);
        const totalMax = mks.reduce((s, m) => s + (m.max_marks || 0), 0);
        const pct = totalMax > 0 ? (totalObt / totalMax) * 100 : 0;
        return (
          <div key={subject} className="m-list-item" style={{gap:8}}>
            <div style={{minWidth:0,flex:1}}>
              <p style={{fontWeight:700,fontSize:13,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{subject}</p>
              <p style={{fontSize:11,color:'#888'}}>{totalObt}/{totalMax} · {mks.length} record{mks.length === 1 ? '' : 's'}</p>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
              <span style={{fontSize:13,fontWeight:800,color:'#1A1A1A'}}>{pct.toFixed(0)}%</span>
              <GradePill pct={pct} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Marksheet sheet ───────────────────────────────────────────────────────

const MarksheetSheet = ({ canEditMarks, onClose }) => {
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [year, setYear] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Auto-load for student/parent (single record self/child)
  useEffect(() => {
    if (canEditMarks) return;
    (async () => {
      try {
        const r = await api.get('/students');
        const arr = r.data?.students ?? (Array.isArray(r.data) ? r.data : []);
        if (arr.length === 1) {
          const self = arr[0];
          setStudentId(self.student_id);
          setSearch(`${self.first_name} ${self.last_name} (${self.admission_number})`);
          const params = { academic_year: currentAcademicYear() };
          const mr = await api.get(`/marks/marksheet/${self.student_id}`, { params });
          setData(mr.data);
        }
      } catch {}
    })();
  }, [canEditMarks]);

  // Debounced server-side search.
  // The /students search matches against parent names too, which makes the
  // marksheet picker confusing — searching "pooja" returns students whose
  // *mother* is named Pooja. Narrow client-side to student-name +
  // admission-number matches only.
  useEffect(() => {
    if (!canEditMarks) return;
    if (search.length < 2 || studentId) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.get('/students', { params: { search, limit: 30 } });
        const arr = Array.isArray(r.data) ? r.data : (r.data?.students ?? []);
        const needle = search.trim().toLowerCase();
        const narrowed = arr.filter(stu => {
          const fullName = `${stu.first_name || ''} ${stu.last_name || ''}`.toLowerCase();
          const admission = (stu.admission_number || '').toLowerCase();
          return fullName.includes(needle) || admission.includes(needle);
        });
        setResults(narrowed);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [search, studentId, canEditMarks]);

  const yearOptions = useMemo(() => {
    const cur = currentAcademicYear();
    const [y] = cur.split('-').map(Number);
    return ['all', cur, `${y - 1}-${y}`, `${y - 2}-${y - 1}`];
  }, []);

  const generate = async () => {
    if (!studentId) { toast.error('Select a student first'); return; }
    setLoading(true);
    try {
      const params = (year && year !== 'all') ? { academic_year: year } : {};
      const r = await api.get(`/marks/marksheet/${studentId}`, { params });
      setData(r.data);
      if (r.data.summary?.total_max === 0) toast.warning('No marks found for this student');
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to generate marksheet'); }
    finally { setLoading(false); }
  };

  const downloadPdf = async () => {
    if (!studentId) return;
    setDownloading(true);
    try {
      const params = (year && year !== 'all') ? { academic_year: year } : {};
      await previewInTab(
        () => api.get(`/marks/marksheet/${studentId}/pdf`, { params, responseType: 'blob' }),
        { kind: 'pdf', errorMessage: 'Failed to load marksheet' },
      );
    } finally { setDownloading(false); }
  };

  return (
    <Sheet title="Marksheet" sub={canEditMarks ? 'Search a student to generate' : 'Your marksheet'} onClose={onClose}>
      {canEditMarks && (
        <>
          <div style={{marginBottom:10}}>
            <label style={formLabel}>Search Student</label>
            <div style={{position:'relative'}}>
              <Search size={14} style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'#888'}} />
              <input className="m-input" style={{paddingLeft:34}}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setStudentId(''); }}
                placeholder="Name, admission no., class..."
                data-testid="m-marksheet-search"
              />
            </div>
            {searching && <p style={{fontSize:11,color:'#888',marginTop:4}}>Searching…</p>}
            {!searching && search.length >= 2 && !studentId && results.length > 0 && (
              <div style={{border:'1px solid #E5E5E5',borderRadius:10,maxHeight:200,overflowY:'auto',marginTop:6}}>
                {results.map(s => (
                  <button key={s.student_id}
                    onClick={() => {
                      setStudentId(s.student_id);
                      setSearch(`${s.first_name} ${s.last_name} (${s.admission_number})`);
                      setResults([]);
                    }}
                    style={{width:'100%',textAlign:'left',padding:10,background:'none',border:'none',borderBottom:'1px solid #F5F5F5',cursor:'pointer',display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}>
                    <div style={{minWidth:0,flex:1}}>
                      <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.first_name} {s.last_name}</p>
                      <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                        {s.class_name}-{s.section} · {s.admission_number}
                      </p>
                    </div>
                    <ChevronRight size={14} color="#888" />
                  </button>
                ))}
              </div>
            )}
            {!searching && search.length >= 2 && !studentId && results.length === 0 && (
              <p style={{fontSize:11,color:'#888',marginTop:4}}>No students found</p>
            )}
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <div>
              <label style={formLabel}>Academic Year</label>
              <select className="m-input" value={year} onChange={(e) => setYear(e.target.value)}>
                {yearOptions.map(y => <option key={y} value={y}>{y === 'all' ? 'All years' : y}</option>)}
              </select>
            </div>
            <div style={{display:'flex',alignItems:'flex-end'}}>
              <button onClick={generate} disabled={!studentId || loading}
                className="m-btn m-btn-primary"
                style={{height:46}}
                data-testid="m-generate-marksheet">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Award size={14} />} Generate
              </button>
            </div>
          </div>
        </>
      )}

      {data && <MarksheetPreview data={data} />}

      {data && (
        <button onClick={downloadPdf} disabled={downloading}
          className="m-btn m-btn-dark"
          style={{marginTop:12}}
          data-testid="m-marksheet-pdf">
          {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download PDF
        </button>
      )}
    </Sheet>
  );
};

const MarksheetPreview = ({ data }) => {
  const student = data.student || {};
  const summary = data.summary || {};
  const pctVal = parseFloat(summary.percentage ?? 0);

  return (
    <div style={{background:'#FFF',border:'1px solid #E5E5E5',borderRadius:14,padding:14,marginTop:8}}>
      <div style={{textAlign:'center',borderBottom:'1px solid #E5E5E5',paddingBottom:10,marginBottom:10}}>
        <p style={{fontSize:14,fontWeight:800,color:'#1A1A1A'}}>SHEMFORD FUTURISTIC SCHOOL</p>
        <p style={{fontSize:10,color:'#888'}}>Katwa, West Bengal · CBSE Affiliated</p>
        <p style={{fontSize:12,fontWeight:700,color:'#1A1A1A',marginTop:6}}>Progress Report</p>
        <p style={{fontSize:10,color:'#888'}}>Academic Year: {data.academic_year || 'All'}</p>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,padding:10,background:'#F8F8F8',borderRadius:10,marginBottom:12}}>
        <InfoCell label="Student" value={`${student.first_name || ''} ${student.last_name || ''}`} />
        <InfoCell label="Admission" value={student.admission_number} />
        <InfoCell label="Class" value={`${student.class_name || ''}${student.section ? '-' + student.section : ''}`} />
        <InfoCell label="Roll" value={student.roll_number || '—'} />
      </div>

      {Object.entries(data.subjects || {}).map(([subject, marks]) => {
        const obt = marks.reduce((s, m) => s + (m.marks_obtained || 0), 0);
        const max = marks.reduce((s, m) => s + (m.max_marks || 0), 0);
        const pct = max > 0 ? (obt / max) * 100 : 0;
        return (
          <div key={subject} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid #F5F5F5',gap:8}}>
            <p style={{fontSize:12,fontWeight:700,color:'#1A1A1A',minWidth:0,flex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{subject}</p>
            <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
              <span style={{fontSize:12,color:'#1A1A1A',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace'}}>{obt}/{max}</span>
              <span style={{fontSize:11,color:'#666',width:48,textAlign:'right'}}>{pct.toFixed(1)}%</span>
              <GradePill pct={pct} />
            </div>
          </div>
        );
      })}

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:12}}>
        <SummaryTile label="Total" value={`${summary.total_obtained || 0}/${summary.total_max || 0}`} dark />
        <SummaryTile label="Percentage" value={`${pctVal.toFixed(2)}%`} />
        <SummaryTile label="Grade" value={summary.grade || '—'} />
        <SummaryTile label="Result" value={summary.result || '—'} accent={summary.result === 'PASS' ? '#15803d' : '#dc2626'} />
      </div>
    </div>
  );
};

const InfoCell = ({ label, value }) => (
  <div style={{minWidth:0}}>
    <p style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888'}}>{label}</p>
    <p style={{fontSize:12,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{value || '—'}</p>
  </div>
);

const SummaryTile = ({ label, value, dark, accent }) => (
  <div style={{
    padding:10,borderRadius:10,textAlign:'center',
    background: dark ? '#1A1A1A' : '#F8F8F8',
    color: dark ? '#FFF' : (accent || '#1A1A1A'),
  }}>
    <p style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color: dark ? 'rgba(255,255,255,0.6)' : '#888'}}>{label}</p>
    <p style={{fontSize:13,fontWeight:800,marginTop:2}}>{value}</p>
  </div>
);

// ─── Exam form sheet ───────────────────────────────────────────────────────

const EXAM_TYPES = [
  { value: 'unit_test', label: 'Unit Test' },
  { value: 'term', label: 'Term Exam' },
  { value: 'annual', label: 'Annual Exam' },
];

const ExamFormSheet = ({ classes, subjects, onClose, onCreated }) => {
  const [form, setForm] = useState({
    name: '', exam_type: 'term', class_name: '', academic_year: currentAcademicYear(),
    subjects: [{ subject: '', max_marks: 100 }], start_date: '', end_date: '',
  });
  const [saving, setSaving] = useState(false);

  const addSubject = () => setForm(p => ({ ...p, subjects: [...p.subjects, { subject: '', max_marks: 100 }] }));
  const removeSubject = (idx) => setForm(p => ({ ...p, subjects: p.subjects.filter((_, i) => i !== idx) }));
  const updateSubject = (idx, field, value) => setForm(p => ({ ...p, subjects: p.subjects.map((s, i) => i === idx ? { ...s, [field]: value } : s) }));

  const save = async () => {
    if (!form.name?.trim() || !form.class_name) { toast.error('Fill name + class'); return; }
    const validSubjects = form.subjects.filter(s => s.subject && parseFloat(s.max_marks) > 0);
    if (validSubjects.length === 0) { toast.error('Add at least one subject with max marks'); return; }
    setSaving(true);
    try {
      await api.post('/exams', {
        ...form,
        subjects: validSubjects.map(s => ({ subject: s.subject, max_marks: parseFloat(s.max_marks) })),
      });
      toast.success('Exam created');
      onCreated();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to create exam'); }
    finally { setSaving(false); }
  };

  return (
    <Sheet
      title="Create Exam"
      sub="Define exam with subjects and max marks"
      onClose={onClose}
      footer={(
        <>
          <button onClick={onClose} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
          <button onClick={save} disabled={saving} className="m-btn m-btn-primary" style={{flex:1}} data-testid="m-exam-save">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
          </button>
        </>
      )}
    >
      <div style={{marginBottom:10}}>
        <label style={formLabel}>Exam Name</label>
        <input className="m-input" value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Term 1 Exam" />
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
        <div>
          <label style={formLabel}>Type</label>
          <select className="m-input" value={form.exam_type} onChange={(e) => setForm(p => ({ ...p, exam_type: e.target.value }))}>
            {EXAM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={formLabel}>Class</label>
          <select className="m-input" value={form.class_name} onChange={(e) => setForm(p => ({ ...p, class_name: e.target.value }))}>
            <option value="">Select</option>
            {classes.map(c => <option key={c.name} value={c.name}>{c.display_name || `Class ${c.name}`}</option>)}
          </select>
        </div>
      </div>
      <div style={{marginBottom:10}}>
        <label style={formLabel}>Academic Year</label>
        <input className="m-input" value={form.academic_year} onChange={(e) => setForm(p => ({ ...p, academic_year: e.target.value }))} />
      </div>

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
        <label style={formLabel}>Subjects & Max Marks</label>
        <button onClick={addSubject} style={{display:'flex',alignItems:'center',gap:4,padding:'6px 10px',borderRadius:8,background:'#FFF',border:'1px solid #E5E5E5',fontSize:11,fontWeight:700,color:'#1A1A1A',cursor:'pointer'}}>
          <Plus size={12} /> Add
        </button>
      </div>
      {form.subjects.map((s, idx) => (
        <div key={idx} style={{display:'flex',gap:6,alignItems:'flex-start',marginBottom:8}}>
          <select className="m-input" style={{flex:1,minWidth:0}} value={s.subject} onChange={(e) => updateSubject(idx, 'subject', e.target.value)}>
            <option value="">Subject</option>
            {subjects.map(sb => <option key={sb} value={sb}>{sb}</option>)}
          </select>
          <input className="m-input" type="number" min="1" value={s.max_marks}
            onChange={(e) => updateSubject(idx, 'max_marks', e.target.value)}
            style={{width:80,flexShrink:0,textAlign:'center'}} placeholder="Max" />
          {form.subjects.length > 1 && (
            <button onClick={() => removeSubject(idx)} aria-label="Remove subject"
              style={{padding:10,borderRadius:8,background:'#FFF',border:'1px solid #fecaca',color:'#dc2626',cursor:'pointer',flexShrink:0,display:'flex',alignItems:'center'}}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
    </Sheet>
  );
};
