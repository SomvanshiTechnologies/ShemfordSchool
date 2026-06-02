import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { getCached, setCached, invalidatePrefix } from '../../lib/pageCache';
import { copyText } from '../../lib/clipboard';
import { toast } from 'sonner';
import {
  Users, Search, X, Copy, Eye, EyeOff, GraduationCap,
  Plus, Upload, Edit, UserX, UserCheck, Loader2, AlertCircle, FileUp, CheckCircle,
  KeyRound, RefreshCw,
} from 'lucide-react';
import MobileStudentOnboarding from './MobileStudentOnboarding';
import MobileStudentCsvImport from './MobileStudentCsvImport';

const REQUIRED_DOCUMENTS = [
  { type: 'birth_certificate', name: 'Birth Certificate', mandatory: false },
  { type: 'aadhaar_card', name: 'Aadhaar Card', mandatory: false },
  { type: 'passport_photo', name: 'Passport Photo', mandatory: false },
  { type: 'previous_marksheet', name: 'Previous Marksheet', mandatory: false },
  { type: 'transfer_certificate', name: 'Transfer Certificate (TC)', mandatory: false },
  { type: 'caste_certificate', name: 'Caste Certificate', mandatory: false },
  { type: 'medical_certificate', name: 'Medical Certificate', mandatory: false },
];

const PAGE_SIZE = 20;
const STREAMS_FOR_CLASS = ['11th', '12th'];
const STREAM_SECTIONS = [{ section_name: 'Science' }, { section_name: 'Humanities' }];

const MobileStudents = () => {
  const { isAdmin, isAccountant } = useAuth();
  const canManage = isAdmin || isAccountant;

  // Seed from cache so revisits paint instantly
  const initialCacheKey = 'm-students::1';
  const initialCache = getCached(initialCacheKey);
  const initialClasses = getCached('classes') || [];

  const [students, setStudents] = useState(initialCache?.students || []);
  const [classes, setClasses] = useState(initialClasses);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(!initialCache);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialCache?.pages || 1);
  const [total, setTotal] = useState(initialCache?.total || 0);
  const searchDebounce = useRef(null);

  // Detail-sheet state
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [currentPw, setCurrentPw] = useState(null);
  const [currentPwVisible, setCurrentPwVisible] = useState(false);
  const [parentPw, setParentPw] = useState(null);
  const [parentPwVisible, setParentPwVisible] = useState(false);

  // Admin flows
  const [editingStudent, setEditingStudent] = useState(null);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);

  const fetchStudents = useCallback(async (pg = 1, q = '') => {
    const cacheKey = `m-students:${q || ''}:${pg}`;
    const cached = getCached(cacheKey);

    if (cached) { // SWR: show stale, revalidate in background
      setStudents(cached.students);
      setTotalPages(cached.pages);
      setTotal(cached.total);
      setLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const params = { page: pg, limit: PAGE_SIZE };
      if (q.trim()) params.search = q.trim();
      const r = await api.get('/students', { params });
      const arr = Array.isArray(r.data) ? r.data : (r.data?.students ?? []);
      const pages = parseInt(r.headers?.['x-total-pages'] ?? r.data?.pages ?? 1, 10) || 1;
      const tot = parseInt(r.headers?.['x-total-count'] ?? r.data?.total ?? arr.length, 10) || arr.length;
      setStudents(arr);
      setTotalPages(pages);
      setTotal(tot);
      setCached(cacheKey, { students: arr, pages, total: tot });
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const fetchClasses = useCallback(async () => {
    try {
      const r = await api.get('/classes');
      const arr = Array.isArray(r.data) ? r.data : [];
      setClasses(arr);
      setCached('classes', arr);
    } catch {}
  }, []);

  useEffect(() => { fetchStudents(1, '', false); fetchClasses(); }, [fetchStudents, fetchClasses]);

  const goToPage = (pg) => {
    if (pg < 1 || pg > totalPages || loading) return;
    setPage(pg);
    fetchStudents(pg, search);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setPage(1);
      setStudents([]);
      fetchStudents(1, val, false);
    }, 400);
  };

  const refreshList = () => {
    invalidatePrefix('m-students:');
    setPage(1);
    fetchStudents(1, search, false);
  };

  const openStudent = async (student) => {
    setSelected(student);
    setDetailLoading(true);
    setCurrentPw(null); setCurrentPwVisible(false);
    setParentPw(null); setParentPwVisible(false);
    try {
      const calls = [api.get(`/students/${student.student_id}`)];
      if (isAdmin) {
        calls.push(api.get(`/students/${student.student_id}/password`));
        calls.push(api.get(`/students/${student.student_id}/parent-password`));
      }
      const [r0, r1, r2] = await Promise.allSettled(calls);
      if (r0.status === 'fulfilled') setSelected(r0.value.data);
      if (r1?.status === 'fulfilled') setCurrentPw(r1.value.data.password);
      if (r2?.status === 'fulfilled') setParentPw(r2.value.data.password);
    } catch {}
    finally { setDetailLoading(false); }
  };

  const closeSheet = () => {
    setSelected(null);
    setCurrentPw(null); setCurrentPwVisible(false);
    setParentPw(null); setParentPwVisible(false);
  };

  const copy = async (val, label) => {
    if (!val) return;
    const ok = await copyText(val);
    toast[ok ? 'success' : 'error'](ok ? `${label} copied` : `Copy failed`);
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await api.delete(`/students/${deactivateTarget.student_id}`);
      toast.success(`${deactivateTarget.first_name} ${deactivateTarget.last_name} deactivated`);
      setDeactivateTarget(null);
      closeSheet();
      refreshList();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to deactivate'); }
  };

  const resetStudentPassword = async (generate, customPassword) => {
    if (!selected) return null;
    try {
      const body = generate ? {} : { password: customPassword };
      const res = await api.post(`/students/${selected.student_id}/reset-password`, body);
      setCurrentPw(res.data.password);
      setCurrentPwVisible(true);
      toast.success('Password updated');
      return res.data.password;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to reset password');
      return null;
    }
  };

  const handleToggleWebLogin = async (student) => {
    const newVal = student.web_login_enabled === false ? true : false;
    try {
      await api.patch(`/students/${student.student_id}/web-login`, { web_login_enabled: newVal });
      setSelected(prev => prev ? { ...prev, web_login_enabled: newVal } : prev);
      setStudents(prev => prev.map(s => s.student_id === student.student_id ? { ...s, web_login_enabled: newVal } : s));
      toast.success(newVal ? 'Login enabled' : 'Login restricted to app only');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update');
    }
  };

  const handleReactivate = async (student) => {
    try {
      await api.put(`/students/${student.student_id}/reactivate`);
      toast.success(`${student.first_name} ${student.last_name} reactivated`);
      closeSheet();
      refreshList();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to reactivate'); }
  };

  if (loading) return (
    <div>
      <div className="m-header"><div><div className="m-skeleton" style={{width:120,height:24}} /></div></div>
      {[1,2,3,4,5].map(i => <div key={i} className="m-skeleton" style={{height:60,borderRadius:14,marginBottom:8}} />)}
    </div>
  );

  return (
    <div data-testid="m-students" style={{minWidth:0}}>
      <div className="m-header" style={{flexWrap:'wrap',gap:8}}>
        <div style={{minWidth:0,flex:1}}><h1>Students</h1><p className="m-header-sub">{total} enrolled</p></div>
        {canManage && (
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {isAdmin && (
              <button
                onClick={() => setShowCsvImport(true)}
                style={headerBtn('outline')}
                data-testid="m-csv-import-btn"
                aria-label="Bulk import"
              >
                <Upload size={14} />
                <span style={{whiteSpace:'nowrap'}}>Import</span>
              </button>
            )}
            <button
              onClick={() => setShowOnboarding(true)}
              style={headerBtn('dark')}
              data-testid="m-new-admission-btn"
              aria-label="New admission"
            >
              <Plus size={14} />
              <span style={{whiteSpace:'nowrap'}}>Admission</span>
            </button>
          </div>
        )}
      </div>

      <div style={{position:'relative',marginBottom:16}}>
        <Search size={16} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'#888'}} />
        <input className="m-input" style={{paddingLeft:38}} placeholder="Search students..." value={search} onChange={e => handleSearch(e.target.value)} />
      </div>

      <div className="m-list">
        {students.map(s => (
          <div
            key={s.student_id}
            className="m-list-item"
            role="button"
            tabIndex={0}
            onClick={() => openStudent(s)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStudent(s); } }}
            style={{cursor:'pointer',gap:8}}
            data-testid={`m-student-${s.student_id}`}
          >
            <div style={{display:'flex',gap:10,alignItems:'center',minWidth:0,flex:1}}>
              <div className="m-avatar" style={{background:'#F5F5F5',color:'#1A1A1A',width:36,height:36,fontSize:14,borderRadius:10}}>
                {s.first_name?.charAt(0)}
              </div>
              <div style={{minWidth:0,flex:1}}>
                <p style={{fontWeight:600,fontSize:13,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.first_name} {s.last_name}</p>
                <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.class_name}-{s.section} | {s.admission_number}</p>
              </div>
            </div>
            <span
              className="m-badge"
              style={{
                flexShrink:0,
                background: s.is_active !== false ? '#dcfce7' : '#fee2e2',
                color: s.is_active !== false ? '#15803d' : '#dc2626',
                border: `1px solid ${s.is_active !== false ? '#bbf7d0' : '#fecaca'}`,
              }}
            >
              {s.is_active !== false ? 'Active' : 'Inactive'}
            </span>
          </div>
        ))}
        {!loading && students.length === 0 && (
          <div className="m-empty"><Users className="m-empty-icon" /><p>No students found</p></div>
        )}
      </div>

      {students.length > 0 && totalPages > 1 && (
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:12,marginBottom:8}}>
          <span style={{fontSize:11,color:'#888'}}>Page {page} of {totalPages} · {total} total</span>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <button className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}} disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>Prev</button>
            <button className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}} disabled={page >= totalPages || loading} onClick={() => goToPage(page + 1)}>Next</button>
          </div>
        </div>
      )}

      {selected && (
        <StudentDetailSheet
          student={selected}
          loading={detailLoading}
          isAdmin={isAdmin}
          currentPw={currentPw}
          currentPwVisible={currentPwVisible}
          setCurrentPwVisible={setCurrentPwVisible}
          parentPw={parentPw}
          parentPwVisible={parentPwVisible}
          setParentPwVisible={setParentPwVisible}
          onCopy={copy}
          onClose={closeSheet}
          onEdit={() => setEditingStudent(selected)}
          onDeactivate={() => setDeactivateTarget(selected)}
          onReactivate={() => handleReactivate(selected)}
          onResetPassword={resetStudentPassword}
          onToggleWebLogin={() => handleToggleWebLogin(selected)}
        />
      )}

      {editingStudent && (
        <StudentEditSheet
          student={editingStudent}
          classes={classes}
          onClose={() => setEditingStudent(null)}
          onSaved={() => { setEditingStudent(null); refreshList(); closeSheet(); }}
        />
      )}

      {deactivateTarget && (
        <ConfirmSheet
          title="Deactivate student?"
          message={`${deactivateTarget.first_name} ${deactivateTarget.last_name} will be marked inactive and excluded from active lists.`}
          confirmLabel="Deactivate"
          danger
          onConfirm={handleDeactivate}
          onClose={() => setDeactivateTarget(null)}
        />
      )}

      {showOnboarding && (
        <MobileStudentOnboarding
          classes={classes}
          onClose={() => setShowOnboarding(false)}
          onCompleted={refreshList}
        />
      )}

      {showCsvImport && (
        <MobileStudentCsvImport
          classes={classes}
          onClose={() => setShowCsvImport(false)}
          onCompleted={refreshList}
        />
      )}
    </div>
  );
};

const headerBtn = (variant) => ({
  display:'flex', alignItems:'center', gap:4,
  padding:'8px 10px',
  borderRadius:10,
  fontSize:12, fontWeight:700,
  cursor:'pointer',
  border: variant === 'outline' ? '1.5px solid #E5E5E5' : 'none',
  background: variant === 'dark' ? '#1A1A1A' : '#FFF',
  color: variant === 'dark' ? '#FFF' : '#1A1A1A',
});

const Field = ({ label, value, mono }) => (
  <div style={{minWidth:0}}>
    <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#AAA',marginBottom:2}}>{label}</p>
    <p style={{fontSize:13,fontWeight:600,color:'#1A1A1A',fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined, wordBreak:'break-word'}}>{value || '—'}</p>
  </div>
);

const sheetOverlay = { position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:200, display:'flex', alignItems:'flex-end', justifyContent:'center' };
const sheetPanel = { background:'#FFF', width:'100%', maxWidth:520, borderTopLeftRadius:20, borderTopRightRadius:20, maxHeight:'94dvh', display:'flex', flexDirection:'column', paddingBottom:'env(safe-area-inset-bottom, 0)' };

const StudentDetailSheet = ({
  student, loading, isAdmin,
  currentPw, currentPwVisible, setCurrentPwVisible,
  parentPw, parentPwVisible, setParentPwVisible,
  onCopy, onClose, onEdit, onDeactivate, onReactivate, onResetPassword, onToggleWebLogin,
}) => {
  const [pwInput, setPwInput] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [lastReset, setLastReset] = useState(null);

  const doSet = async () => {
    if (pwInput.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setPwBusy(true);
    const np = await onResetPassword(false, pwInput);
    if (np) { setLastReset(np); setPwInput(''); }
    setPwBusy(false);
  };
  const doGenerate = async () => {
    setPwBusy(true);
    const np = await onResetPassword(true);
    if (np) setLastReset(np);
    setPwBusy(false);
  };
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const isActive = student.is_active !== false;

  return (
    <div onClick={onClose} style={sheetOverlay} data-testid="m-student-sheet">
      <div onClick={(e) => e.stopPropagation()} style={sheetPanel}>
        <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
          <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0'}}>
          <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>Student Details</h2>
          <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888'}}>
            <X size={20} />
          </button>
        </div>

        <div style={{overflowY:'auto',padding:16,flex:1}}>
          <div style={{display:'flex',gap:12,alignItems:'center',background:'#F8F8F8',padding:12,borderRadius:14}}>
            <div style={{width:52,height:52,borderRadius:14,background:'#F0F0F0',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <GraduationCap size={26} color="#888" />
            </div>
            <div style={{flex:1,minWidth:0}}>
              <p style={{fontSize:16,fontWeight:800,color:'#1A1A1A',lineHeight:1.2,wordBreak:'break-word'}}>
                {student.first_name} {student.last_name}
              </p>
              <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4,flexWrap:'wrap'}}>
                <span style={{fontSize:11,color:'#888'}}>Adm:</span>
                <span
                  style={{fontSize:11,fontWeight:700,color:'#1A1A1A',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',wordBreak:'break-all',userSelect:'none',WebkitUserSelect:'none'}}
                  onCopy={e => e.preventDefault()}
                  onContextMenu={e => e.preventDefault()}
                >
                  {student.admission_number}
                </span>
                <button onClick={() => onCopy(student.admission_number, 'Admission number')} style={{background:'none',border:'none',padding:2,cursor:'pointer',color:'#888',display:'inline-flex',alignItems:'center'}} aria-label="Copy admission number">
                  <Copy size={12} />
                </button>
              </div>
            </div>
            <span className={`m-badge ${student.fee_status === 'paid' ? 'm-badge-dark' : student.fee_status === 'overdue' ? 'm-badge-orange' : 'm-badge-muted'}`} style={{flexShrink:0}}>
              {student.fee_status || 'pending'}
            </span>
          </div>

          {loading && (
            <div style={{textAlign:'center',padding:'12px 0',color:'#888',fontSize:12}}>Loading details…</div>
          )}

          <p className="m-section">Academic</p>
          <div style={card2col}>
            <Field label="Class" value={`${student.class_name || ''}${student.section ? '-' + student.section : ''}${student.stream ? ' (' + student.stream + ')' : ''}`} />
            <Field label="Academic Year" value={student.academic_year} />
            <Field label="Roll Number" value={student.roll_number} />
            <Field label="Gender" value={student.gender} />
            <Field label="Date of Birth" value={student.date_of_birth} />
            <Field label="Blood Group" value={student.blood_group} />
          </div>

          <p className="m-section">Contact</p>
          <div style={card2col}>
            <Field label="Phone" value={student.phone} />
            <Field label="Emergency" value={student.emergency_contact} />
            <div style={{gridColumn:'1 / -1'}}><Field label="Email" value={student.email} /></div>
            <div style={{gridColumn:'1 / -1'}}><Field label="Address" value={student.address} /></div>
          </div>

          <p className="m-section">Father</p>
          <div style={card2col}>
            <Field label="Name" value={student.father_name || student.parent_name} />
            <Field label="Phone" value={student.father_phone || student.parent_phone} />
            <div style={{gridColumn:'1 / -1'}}><Field label="Occupation" value={student.father_occupation} /></div>
          </div>

          <p className="m-section">Mother</p>
          <div style={card2col}>
            <Field label="Name" value={student.mother_name} />
            <Field label="Phone" value={student.mother_phone} />
            <div style={{gridColumn:'1 / -1'}}><Field label="Occupation" value={student.mother_occupation} /></div>
          </div>

          <p className="m-section">Parent Login</p>
          <div style={card1col}>
            <Field label="Parent Email" value={student.parent_email} />
            {isAdmin && (
              <CredentialRow label="Parent Password" value={parentPw} visible={parentPwVisible}
                onToggle={() => setParentPwVisible(v => !v)}
                onCopy={() => onCopy(parentPw, 'Parent password')} />
            )}
          </div>

          {isAdmin && (
            <>
              <p className="m-section">Student Login</p>
              <div style={card1col}>
                <CredentialRow label="Student Password" value={currentPw} visible={currentPwVisible}
                  onToggle={() => setCurrentPwVisible(v => !v)}
                  onCopy={() => onCopy(currentPw, 'Student password')} />
              </div>

              <p className="m-section" style={{display:'flex',alignItems:'center',gap:6}}><KeyRound size={14} /> Password Management</p>
              <div style={card1col}>
                {lastReset && (
                  <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:10,background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:10,marginBottom:8}}>
                    <CheckCircle size={14} color="#16a34a" />
                    <div style={{minWidth:0,flex:1}}>
                      <p style={{fontSize:11,fontWeight:700,color:'#15803d'}}>Password updated</p>
                      <p style={{fontSize:12,fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',color:'#1A1A1A',wordBreak:'break-all'}}>{lastReset}</p>
                    </div>
                    <button onClick={() => onCopy(lastReset, 'Password')} style={{background:'none',border:'none',padding:4,cursor:'pointer',color:'#15803d'}} aria-label="Copy">
                      <Copy size={14} />
                    </button>
                  </div>
                )}
                <input
                  className="m-input"
                  type="text"
                  placeholder="Enter new password (min 6 chars)"
                  value={pwInput}
                  onChange={(e) => setPwInput(e.target.value)}
                />
                <div style={{display:'flex',gap:6,marginTop:8}}>
                  <button onClick={doSet} disabled={pwBusy || pwInput.length < 6} style={{...actionBtn('outline'), flex:1, padding:'10px 12px', fontSize:12}}>
                    {pwBusy ? <Loader2 size={12} className="animate-spin" /> : null} Set
                  </button>
                  <button onClick={doGenerate} disabled={pwBusy} style={{...actionBtn('dark'), flex:1, padding:'10px 12px', fontSize:12}}>
                    {pwBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Generate
                  </button>
                </div>
              </div>
            </>
          )}

          {isAdmin && isActive && (
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:12,marginTop:8}}>
              <div>
                <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A'}}>Portal Login</p>
                <p style={{fontSize:11,color:'#888',marginTop:2}}>
                  {student.web_login_enabled !== false ? 'Can login via website & app' : 'App login only'}
                </p>
              </div>
              <label style={{display:'flex',alignItems:'center',cursor:'pointer'}}>
                <input
                  type="checkbox"
                  style={{width:20,height:20,accentColor:'#E88A1A',cursor:'pointer'}}
                  checked={student.web_login_enabled !== false}
                  onChange={onToggleWebLogin}
                />
              </label>
            </div>
          )}

          <div style={{height:8}} />
        </div>

        {isAdmin && (
          <div style={{display:'flex',gap:8,padding:12,borderTop:'1px solid #F0F0F0',background:'#FFF',flexWrap:'wrap'}}>
            {isActive ? (
              <>
                <button onClick={onEdit} style={{...actionBtn('outline'), flex:1, minWidth:0}} data-testid="m-edit-student">
                  <Edit size={14} /> Edit
                </button>
                <button onClick={onDeactivate} style={{...actionBtn('outline'), flex:1, minWidth:0, color:'#dc2626', borderColor:'#fecaca'}} data-testid="m-deactivate-student">
                  <UserX size={14} /> Deactivate
                </button>
              </>
            ) : (
              <button onClick={onReactivate} style={{...actionBtn('dark'), flex:1, minWidth:0, background:'#16a34a'}} data-testid="m-reactivate-student">
                <UserCheck size={14} /> Reactivate
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const card2col = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, background:'#FFF', padding:14, borderRadius:14, border:'1px solid rgba(0,0,0,0.04)', boxShadow:'0 1px 3px rgba(0,0,0,0.04)' };
const card1col = { display:'grid', gridTemplateColumns:'1fr', gap:12, background:'#FFF', padding:14, borderRadius:14, border:'1px solid rgba(0,0,0,0.04)', boxShadow:'0 1px 3px rgba(0,0,0,0.04)' };

const actionBtn = (variant) => ({
  display:'flex', alignItems:'center', justifyContent:'center', gap:6,
  padding:'12px 14px',
  borderRadius:12,
  fontSize:13, fontWeight:700,
  cursor:'pointer',
  border: variant === 'outline' ? '1.5px solid #E5E5E5' : 'none',
  background: variant === 'dark' ? '#1A1A1A' : '#FFF',
  color: variant === 'dark' ? '#FFF' : '#1A1A1A',
});

const CredentialRow = ({ label, value, visible, onToggle, onCopy }) => (
  <div>
    <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#AAA',marginBottom:4}}>{label}</p>
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
      <span style={{fontSize:13,fontWeight:600,color:'#1A1A1A',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',wordBreak:'break-all'}}>
        {value == null ? '—' : visible ? value : '••••••••••'}
      </span>
      {value && (
        <>
          <button onClick={onToggle} aria-label="Toggle visibility" style={{background:'none',border:'none',padding:4,cursor:'pointer',color:'#888',display:'inline-flex',alignItems:'center'}}>
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onCopy} aria-label="Copy" style={{background:'none',border:'none',padding:4,cursor:'pointer',color:'#888',display:'inline-flex',alignItems:'center'}}>
            <Copy size={14} />
          </button>
        </>
      )}
    </div>
  </div>
);

const buildEditForm = (s) => ({
  phone: s.phone || '',
  email: s.email || '',
  address: s.address || '',
  parent_name: s.parent_name || s.father_name || '',
  parent_phone: s.parent_phone || s.father_phone || '',
  parent_email: s.parent_email || '',
  father_name: s.father_name || s.parent_name || '',
  father_phone: s.father_phone || s.parent_phone || '',
  father_occupation: s.father_occupation || '',
  mother_name: s.mother_name || '',
  mother_phone: s.mother_phone || '',
  mother_occupation: s.mother_occupation || '',
  class_name: s.class_name || '',
  section: s.section || '',
  stream: s.stream || '',
  roll_number: s.roll_number || '',
  blood_group: s.blood_group || '',
  emergency_contact: s.emergency_contact || '',
  admission_number: s.admission_number || '',
});

const StudentEditSheet = ({ student, classes, onClose, onSaved }) => {
  const [form, setForm] = useState(() => buildEditForm(student));
  const [saving, setSaving] = useState(false);
  const [hydrating, setHydrating] = useState(false);

  // Refresh from the full record in case the parent passed a sparse list-projection.
  // Per-field merge: only fill blanks — never overwrite user's in-progress edits.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!student?.student_id) return;
      setHydrating(true);
      try {
        const { data: full } = await api.get(`/students/${student.student_id}`);
        if (cancelled) return;
        const filled = buildEditForm(full);
        setForm(prev => {
          const next = { ...prev };
          for (const k of Object.keys(filled)) {
            if (!next[k] && filled[k]) next[k] = filled[k];
          }
          return next;
        });
      } catch {}
      finally { if (!cancelled) setHydrating(false); }
    })();
    return () => { cancelled = true; };
  }, [student?.student_id]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const update = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const getSections = (cn) => {
    if (STREAMS_FOR_CLASS.includes(cn)) return STREAM_SECTIONS;
    return classes.find(c => c.name === cn)?.sections || [];
  };

  const save = async () => {
    if (!form.email?.trim()) { toast.error('Email is required'); return; }
    if (!form.phone?.trim()) { toast.error('Phone is required'); return; }
    if (!form.address?.trim()) { toast.error('Address is required'); return; }
    setSaving(true);
    try {
      await api.put(`/students/${student.student_id}`, form);
      toast.success('Student updated successfully');
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to update'); }
    finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{...sheetOverlay, zIndex:250}} data-testid="m-edit-sheet">
      <div onClick={(e) => e.stopPropagation()} style={sheetPanel}>
        <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
          <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0'}}>
          <div style={{minWidth:0}}>
            <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>Edit Student</h2>
            <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{student.first_name} {student.last_name}</p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888'}}>
            <X size={20} />
          </button>
        </div>

        <div style={{overflowY:'auto',padding:16,flex:1}}>
          <FormField label="Admission Number" value={form.admission_number} onChange={(v) => update('admission_number', v)} mono />

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div>
              <label style={formLabel}>Class</label>
              <select className="m-input" value={form.class_name} onChange={(e) => { update('class_name', e.target.value); update('section', ''); }}>
                <option value="">Select</option>
                {classes.map(c => <option key={c.name} value={c.name}>{c.display_name || `Class ${c.name}`}</option>)}
              </select>
            </div>
            <div>
              <label style={formLabel}>Section</label>
              <select
                className="m-input"
                value={form.section}
                onChange={(e) => {
                  const v = e.target.value;
                  const isStreamClass = STREAMS_FOR_CLASS.includes(form.class_name);
                  setForm(p => ({ ...p, section: v, ...(isStreamClass ? { stream: v.toLowerCase() } : {}) }));
                }}
              >
                <option value="">Select</option>
                {getSections(form.class_name).map(s => <option key={s.section_name} value={s.section_name}>{s.section_name}</option>)}
              </select>
            </div>
          </div>

          <div style={{marginTop:10,display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <FormField label="Email *" type="email" value={form.email} onChange={(v) => update('email', v)} />
            <FormField label="Phone *" value={form.phone} onChange={(v) => update('phone', v)} />
          </div>
          <FormField label="Address *" value={form.address} onChange={(v) => update('address', v)} />
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <FormField label="Roll Number" value={form.roll_number} onChange={(v) => update('roll_number', v)} />
            <FormField label="Blood Group" value={form.blood_group} onChange={(v) => update('blood_group', v)} />
          </div>
          <FormField label="Emergency Contact" value={form.emergency_contact} onChange={(v) => update('emergency_contact', v)} />

          <p className="m-section">Father / Guardian</p>
          <FormField label="Name" value={form.father_name} onChange={(v) => update('father_name', v)} />
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <FormField label="Phone" value={form.father_phone} onChange={(v) => update('father_phone', v)} />
            <FormField label="Occupation" value={form.father_occupation} onChange={(v) => update('father_occupation', v)} />
          </div>

          <p className="m-section">Mother</p>
          <FormField label="Name" value={form.mother_name} onChange={(v) => update('mother_name', v)} />
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <FormField label="Phone" value={form.mother_phone} onChange={(v) => update('mother_phone', v)} />
            <FormField label="Occupation" value={form.mother_occupation} onChange={(v) => update('mother_occupation', v)} />
          </div>

          <FormField label="Parent Email" type="email" value={form.parent_email} onChange={(v) => update('parent_email', v)} />

          <p className="m-section" style={{display:'flex',alignItems:'center',gap:6}}><FileUp size={14} /> Documents</p>
          <p style={{fontSize:11,color:'#888',marginTop:-6,marginBottom:10}}>Upload or replace admission documents for this student.</p>
          <DocumentList studentId={student.student_id} />
        </div>

        <div style={{display:'flex',gap:8,padding:12,borderTop:'1px solid #F0F0F0',background:'#FFF'}}>
          <button onClick={onClose} style={{...actionBtn('outline'), flex:1}}>Cancel</button>
          <button onClick={save} disabled={saving} style={{...actionBtn('dark'), flex:1}} data-testid="m-save-edit">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Save
          </button>
        </div>
      </div>
    </div>
  );
};

const formLabel = { display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'#666', marginBottom:6 };

const FormField = ({ label, value, onChange, type='text', mono }) => (
  <div style={{marginBottom:10}}>
    <label style={formLabel}>{label}</label>
    <input
      className="m-input"
      type={type}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      style={mono ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } : undefined}
    />
  </div>
);

const DocumentList = ({ studentId }) => {
  const [uploaded, setUploaded] = useState({});
  const [uploading, setUploading] = useState({});

  const upload = async (doc) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(p => ({ ...p, [doc.type]: true }));
      try {
        const fd = new FormData();
        fd.append('file', file);
        const upRes = await api.post('/upload', fd);
        const { file_url, file_name } = upRes.data;
        const docFd = new FormData();
        docFd.append('document_type', doc.type);
        docFd.append('document_name', doc.name);
        docFd.append('file_url', file_url);
        docFd.append('file_name', file_name);
        await api.post(`/students/${studentId}/documents`, docFd);
        setUploaded(p => ({ ...p, [doc.type]: { file_name, file_url } }));
        toast.success(`${doc.name} uploaded`);
      } catch (err) {
        toast.error(err.response?.data?.detail || `Failed to upload ${doc.name}`);
      } finally {
        setUploading(p => ({ ...p, [doc.type]: false }));
      }
    };
    input.click();
  };

  return (
    <div>
      {REQUIRED_DOCUMENTS.map(doc => {
        const up = uploaded[doc.type];
        const dl = uploading[doc.type];
        return (
          <div key={doc.type} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:10,marginBottom:8,borderRadius:10,background: up ? '#f0fdf4' : '#F8F8F8',border: up ? '1px solid #bbf7d0' : '1px solid #E5E5E5',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0,flex:1}}>
              {up ? <CheckCircle size={14} color="#16a34a" style={{flexShrink:0}} /> : (
                <span style={{fontSize:9,fontWeight:800,textTransform:'uppercase',color: doc.mandatory ? '#dc2626' : '#888',flexShrink:0}}>
                  {doc.mandatory ? 'Req' : 'Opt'}
                </span>
              )}
              <div style={{minWidth:0}}>
                <p style={{fontSize:12,fontWeight:600,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{doc.name}</p>
                {up && <p style={{fontSize:10,color:'#16a34a',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{up.file_name}</p>}
              </div>
            </div>
            <button onClick={() => upload(doc)} disabled={dl} style={{display:'flex',alignItems:'center',gap:4,padding:'6px 10px',borderRadius:8,background:'#FFF',color:'#1A1A1A',border:'1px solid #E5E5E5',fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0}}>
              {dl ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
              {up ? 'Replace' : 'Upload'}
            </button>
          </div>
        );
      })}
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
    <div onClick={onClose} style={{...sheetOverlay, zIndex:260, alignItems:'center'}} data-testid="m-confirm-sheet">
      <div onClick={(e) => e.stopPropagation()} style={{...sheetPanel, borderRadius:16, margin:16, maxHeight:'auto'}}>
        <div style={{padding:20}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
            {danger && <AlertCircle size={20} color="#dc2626" />}
            <h3 style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>{title}</h3>
          </div>
          <p style={{fontSize:13,color:'#666',lineHeight:1.5}}>{message}</p>
        </div>
        <div style={{display:'flex',gap:8,padding:12,borderTop:'1px solid #F0F0F0'}}>
          <button onClick={onClose} style={{...actionBtn('outline'), flex:1}}>Cancel</button>
          <button onClick={confirm} disabled={loading} style={{...actionBtn('dark'), flex:1, background: danger ? '#dc2626' : '#1A1A1A'}}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : null} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MobileStudents;
