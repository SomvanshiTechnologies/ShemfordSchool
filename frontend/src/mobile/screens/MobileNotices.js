import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { getCached, setCached, invalidatePrefix } from '../../lib/pageCache';
import { toast } from 'sonner';
import {
  Bell, Plus, X, Pencil, Trash2, Loader2, Search, AlertTriangle, Megaphone,
  Mic,
} from 'lucide-react';
import {
  VoiceNotePlayer, VoiceNoteRecorder, useVoiceRecorder,
} from '../../components/VoiceNote';

// ─── Shared bits ───────────────────────────────────────────────────────────

const ALL_CATEGORIES = [
  { key: 'general',   label: 'General' },
  { key: 'homework',  label: 'Homework' },
  { key: 'classwork', label: 'Classwork' },
  { key: 'employees', label: 'Employees' },
];

const PRIORITIES = [
  { value: 'low',    label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high',   label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const PRIORITY_STYLE = {
  urgent: { bg: '#fee2e2', color: '#dc2626' },
  high:   { bg: '#fef3c7', color: '#a16207' },
  normal: { bg: '#F1F5F9', color: '#475569' },
  low:    { bg: '#FFF', color: '#888', border: '#E5E5E5' },
};

const AUDIENCE_LABEL = {
  student: 'Students',
  parent: 'Parents',
  teacher: 'Teachers',
  employee: 'Employees',
};

const formLabel = {
  display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase',
  letterSpacing:'0.06em', color:'#666', marginBottom:6,
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
          whiteSpace:'nowrap',display:'flex',alignItems:'center',justifyContent:'center',gap:4,
        }}
        data-testid={`m-notices-tab-${t.key}`}
      >
        {t.label}
        {typeof t.count === 'number' && (
          <span style={{fontSize:10,color: active === t.key ? '#888' : '#aaa'}}>({t.count})</span>
        )}
      </button>
    ))}
  </div>
);

const Sheet = ({ title, sub, onClose, footer, zIndex = 240, children }) => {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
      <div onClick={(e) => e.stopPropagation()}
        style={{background:'#FFF',width:'100%',maxWidth:520,borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:'94dvh',display:'flex',flexDirection:'column',paddingBottom:'env(safe-area-inset-bottom, 0)'}}>
        <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
          <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
        </div>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0',gap:8}}>
          <div style={{minWidth:0,flex:1}}>
            <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{title}</h2>
            {sub && <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</p>}
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

const PriorityBadge = ({ priority }) => {
  if (!priority || priority === 'low') return null;
  const s = PRIORITY_STYLE[priority] || PRIORITY_STYLE.normal;
  return (
    <span style={{
      display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:6,
      fontSize:10,fontWeight:700,textTransform:'capitalize',
      background:s.bg,color:s.color,border: s.border ? `1px solid ${s.border}` : 'none',
      whiteSpace:'nowrap',flexShrink:0,
    }}>{priority}</span>
  );
};

const targetLabel = (a) => {
  if (!a) return '';
  const { target_type, target_value, target_audiences } = a;
  const audiences = Array.isArray(target_audiences) ? target_audiences : [];
  if (target_type === 'class') {
    const cls = `Class ${target_value}`;
    return audiences.length ? `${cls} · ${audiences.map(x => AUDIENCE_LABEL[x] || x).join(', ')}` : cls;
  }
  if (target_type === 'department') return `Dept: ${target_value}`;
  if (target_type === 'user') return 'Specific person';
  if (target_type === 'audience' && audiences.length) return audiences.map(x => AUDIENCE_LABEL[x] || x).join(', ');
  if (target_type === 'all') return 'Everyone';
  return target_type || 'Everyone';
};

// ─── Main ──────────────────────────────────────────────────────────────────

const MobileNotices = () => {
  const { user } = useAuth();
  const role = user?.role;
  const isAdmin = role === 'admin';
  const isTeacher = role === 'teacher';
  const canManage = isAdmin || isTeacher;
  const isStaff = canManage || role === 'accountant';

  const categories = isStaff ? ALL_CATEGORIES : ALL_CATEGORIES.filter(c => c.key !== 'employees');

  const [tab, setTab] = useState('general');
  const [searchTerm, setSearchTerm] = useState('');
  const [announcements, setAnnouncements] = useState(getCached('m-notices') || []);
  const [loading, setLoading] = useState(!announcements.length);

  // Create / Edit state
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(!announcements.length);
    try {
      const r = await api.get('/announcements');
      const arr = Array.isArray(r.data) ? r.data : [];
      setAnnouncements(arr);
      setCached('m-notices', arr);
    } catch { toast.error('Failed to load announcements'); }
    finally { setLoading(false); }
  }, [announcements.length]);

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, []);

  const filteredByTab = useMemo(() => {
    return announcements.filter(a => (a.announcement_type || 'general') === tab);
  }, [announcements, tab]);

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return filteredByTab;
    const s = searchTerm.toLowerCase();
    return filteredByTab.filter(a =>
      (a.title || '').toLowerCase().includes(s) ||
      (a.content || '').toLowerCase().includes(s)
    );
  }, [filteredByTab, searchTerm]);

  const counts = useMemo(() => {
    const map = {};
    for (const c of categories) {
      map[c.key] = announcements.filter(a => (a.announcement_type || 'general') === c.key).length;
    }
    return map;
  }, [announcements, categories]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/announcements/${deleteTarget.announcement_id}`);
      toast.success('Announcement deleted');
      setDeleteTarget(null);
      invalidatePrefix('m-notices');
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || 'Delete failed'); }
  };

  return (
    <div data-testid="m-notices" style={{minWidth:0}}>
      <div className="m-header" style={{gap:8,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:0}}>
          <h1>Announcements</h1>
          <p className="m-header-sub">{announcements.length} total</p>
        </div>
        {canManage && (
          <button onClick={() => setShowCreate(true)}
            style={{display:'flex',alignItems:'center',gap:4,padding:'8px 12px',borderRadius:10,background:'#1A1A1A',border:'none',fontSize:12,fontWeight:700,color:'#FFF',cursor:'pointer'}}
            data-testid="m-new-announcement-btn">
            <Plus size={14} /> New Announcement
          </button>
        )}
      </div>

      {/* Category tabs */}
      <TabBar
        tabs={categories.map(c => ({ key: c.key, label: c.label, count: counts[c.key] || 0 }))}
        active={tab}
        onChange={setTab}
      />

      {/* Search */}
      <div style={{position:'relative',marginBottom:12}}>
        <Search size={14} style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'#888'}} />
        <input
          className="m-input"
          style={{paddingLeft:34,paddingRight:searchTerm ? 36 : 14}}
          placeholder="Search announcements..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm('')}
            style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',padding:4,cursor:'pointer',color:'#888'}}>
            <X size={14} />
          </button>
        )}
      </div>

      {loading && announcements.length === 0 ? (
        <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:90,borderRadius:14,marginBottom:8}} />)}</div>
      ) : filtered.length === 0 ? (
        <div className="m-empty"><Megaphone className="m-empty-icon" /><p>No announcements</p></div>
      ) : (
        filtered.map(a => (
          <AnnouncementCard
            key={a.announcement_id}
            announcement={a}
            canManage={canManage}
            onEdit={() => setEditTarget(a)}
            onDelete={() => setDeleteTarget(a)}
          />
        ))
      )}

      {showCreate && canManage && (
        <ComposeSheet
          mode="create"
          activeCategory={tab}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); invalidatePrefix('m-notices'); fetchData(); }}
        />
      )}

      {editTarget && canManage && (
        <ComposeSheet
          mode="edit"
          announcement={editTarget}
          activeCategory={editTarget.announcement_type || tab}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); invalidatePrefix('m-notices'); fetchData(); }}
        />
      )}

      {deleteTarget && (
        <Sheet title="Delete announcement?" onClose={() => setDeleteTarget(null)} zIndex={260}>
          <p style={{fontSize:13,color:'#666',marginBottom:12,lineHeight:1.5}}>
            "{deleteTarget.title}" will be permanently removed.
          </p>
          <div style={{display:'flex',gap:8}}>
            <button onClick={() => setDeleteTarget(null)} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
            <button onClick={handleDelete} className="m-btn" style={{flex:1,background:'#dc2626',color:'#FFF'}}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
};

export default MobileNotices;

// ─── Announcement card ─────────────────────────────────────────────────────

const AnnouncementCard = ({ announcement: a, canManage, onEdit, onDelete }) => (
  <div style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:12,marginBottom:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,marginBottom:6}}>
      <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0,flex:1}}>
        <Bell size={14} color="#E88A1A" style={{flexShrink:0}} />
        <p style={{fontSize:14,fontWeight:700,color:'#1A1A1A',wordBreak:'break-word'}}>{a.title}</p>
      </div>
      <PriorityBadge priority={a.priority} />
    </div>

    {a.content && (
      <p style={{fontSize:12,color:'#444',lineHeight:1.5,whiteSpace:'pre-wrap',wordBreak:'break-word',marginBottom:6}}>
        {a.content}
      </p>
    )}

    {a.voice_note_id && (
      <div style={{marginBottom:8}}>
        <VoiceNotePlayer url={`/api/media/voice-notes/${a.voice_note_id}`} />
      </div>
    )}

    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',marginTop:6}}>
      <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',minWidth:0}}>
        <span style={{fontSize:10,color:'#888',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.04em'}}>
          {targetLabel(a)}
        </span>
        <span style={{fontSize:10,color:'#aaa'}}>· {a.created_at?.slice(0, 10) || 'Recent'}</span>
      </div>
      {canManage && (
        <div style={{display:'flex',gap:6}}>
          <button onClick={onEdit}
            style={{display:'flex',alignItems:'center',gap:4,padding:'5px 10px',borderRadius:8,background:'#FFF',border:'1px solid #E5E5E5',fontSize:11,fontWeight:700,color:'#1A1A1A',cursor:'pointer'}}
            data-testid={`m-edit-${a.announcement_id}`}>
            <Pencil size={11} /> Edit
          </button>
          <button onClick={onDelete}
            style={{display:'flex',alignItems:'center',gap:4,padding:'5px 10px',borderRadius:8,background:'#FFF',border:'1px solid #fecaca',color:'#dc2626',fontSize:11,fontWeight:700,cursor:'pointer'}}
            data-testid={`m-delete-${a.announcement_id}`}>
            <Trash2 size={11} /> Delete
          </button>
        </div>
      )}
    </div>
  </div>
);

// ─── Compose / Edit sheet ──────────────────────────────────────────────────

const ComposeSheet = ({ mode, announcement, activeCategory, onClose, onSaved }) => {
  const isEdit = mode === 'edit';
  const voice = useVoiceRecorder();

  const [type, setType] = useState(activeCategory || 'general');
  const [title, setTitle] = useState(announcement?.title || '');
  const [content, setContent] = useState(announcement?.content || '');
  const [priority, setPriority] = useState(announcement?.priority || 'normal');

  // Target state — mirrors desktop's derived target_* fields
  const [targetMode, setTargetMode] = useState(() => {
    if (!isEdit) return 'all';
    if (!announcement) return 'all';
    const { target_type, target_audiences } = announcement;
    const audiences = Array.isArray(target_audiences) ? target_audiences : [];
    if (target_type === 'all') return 'all';
    if (target_type === 'department') return 'department';
    if (target_type === 'class') return 'specific_class';
    if (target_type === 'user') return 'specific_user';
    if (audiences.includes('teacher')) return 'all_teachers';
    if (audiences.includes('student')) return 'all_students';
    if (audiences.includes('parent')) return 'all_parents';
    if (audiences.includes('employee')) return 'all_employees';
    return 'all';
  });
  const [targetValue, setTargetValue] = useState(announcement?.target_value || '');
  const [targetAudiences, setTargetAudiences] = useState(
    Array.isArray(announcement?.target_audiences) ? announcement.target_audiences : []
  );
  const [useClassFilter, setUseClassFilter] = useState(
    !!(announcement?.target_type === 'class' && (announcement?.target_audiences?.length || 0))
  );

  const [classes, setClasses] = useState(getCached('classes') || []);
  const [departments, setDepartments] = useState([]);
  const [saving, setSaving] = useState(false);

  // Load directories
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

  useEffect(() => {
    if (type !== 'employees') return;
    (async () => {
      try {
        const r = await api.get('/employees/departments');
        setDepartments(Array.isArray(r.data) ? r.data : []);
      } catch (err) {
        // Skip the fallback fetch on auth/permission errors — the interceptor
        // is already handling token refresh, and a second 401 just adds noise.
        const status = err?.response?.status;
        if (status === 401 || status === 403) return;
        try {
          const r = await api.get('/employees', { params: { limit: 500 } });
          const arr = r.data?.employees ?? (Array.isArray(r.data) ? r.data : []);
          const set = new Set(arr.map(e => e.department).filter(Boolean));
          setDepartments(Array.from(set).sort());
        } catch {}
      }
    })();
  }, [type]);

  const audienceOptionsFor = (cat) => {
    if (cat === 'homework' || cat === 'classwork') {
      return [
        { value: 'student', label: 'Students' },
        { value: 'parent',  label: 'Parents' },
        { value: 'teacher', label: 'Teachers' },
      ];
    }
    return [];
  };

  const toggleAudience = (val) => {
    setTargetAudiences(prev => {
      const arr = Array.isArray(prev) ? prev : [];
      return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
    });
  };

  // Build the API payload from target_mode + value + audiences
  const buildPayload = () => {
    let target_type = 'all';
    let target_value = null;
    let target_audiences = null;

    if (type === 'employees') {
      if (targetMode === 'department' && targetValue) {
        target_type = 'department';
        target_value = targetValue;
        target_audiences = ['employee'];
      } else {
        target_type = 'audience';
        target_audiences = ['employee'];
      }
    } else if (type === 'general') {
      switch (targetMode) {
        case 'all_teachers':
          target_type = 'audience'; target_audiences = ['teacher']; break;
        case 'all_students':
          target_type = 'audience'; target_audiences = ['student']; break;
        case 'all_parents':
          target_type = 'audience'; target_audiences = ['parent']; break;
        case 'all_employees':
          target_type = 'audience'; target_audiences = ['employee']; break;
        case 'specific_class':
          if (!targetValue) { toast.error('Pick a class'); return null; }
          target_type = 'class'; target_value = targetValue; break;
        case 'specific_user':
          if (!targetValue) { toast.error('Enter a user id'); return null; }
          target_type = 'user'; target_value = targetValue; break;
        case 'all':
        default:
          target_type = 'all'; break;
      }
    } else {
      // homework / classwork
      const audiences = Array.isArray(targetAudiences) ? targetAudiences : [];
      if (useClassFilter && targetValue) {
        target_type = 'class';
        target_value = targetValue;
        target_audiences = audiences.length ? audiences : null;
      } else if (audiences.length === 0) {
        target_type = 'all';
      } else {
        target_type = 'audience';
        target_audiences = audiences;
      }
    }

    return {
      title,
      content,
      priority,
      announcement_type: type,
      target_type,
      target_value,
      target_audiences,
    };
  };

  const uploadVoice = async (annId) => {
    if (!voice.audioBlob || !annId) return;
    try {
      const fd = new FormData();
      fd.append('file', voice.audioBlob, 'voice_note.webm');
      if (voice.duration) fd.append('duration_seconds', voice.duration);
      await api.post(`/announcements/${annId}/voice-note`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } catch {
      toast.error('Saved, but voice note failed to upload.');
    }
  };

  const save = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    const payload = buildPayload();
    if (!payload) return;
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/announcements/${announcement.announcement_id}`, payload);
        if (voice.audioBlob) await uploadVoice(announcement.announcement_id);
        toast.success('Announcement updated');
      } else {
        const r = await api.post('/announcements', payload);
        const annId = r.data?.announcement_id;
        if (voice.audioBlob && annId) await uploadVoice(annId);
        toast.success('Announcement posted');
      }
      voice.discard();
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <Sheet
      title={isEdit ? 'Edit Announcement' : 'New Announcement'}
      sub={`Category: ${ALL_CATEGORIES.find(c => c.key === type)?.label || type}`}
      onClose={onClose}
      footer={(
        <>
          <button onClick={onClose} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
          <button onClick={save} disabled={saving} className="m-btn m-btn-primary" style={{flex:1}} data-testid="m-ann-save">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} {isEdit ? 'Save' : 'Post'}
          </button>
        </>
      )}
    >
      {/* Category — only when creating; edit keeps the original type */}
      {!isEdit && (
        <div style={{marginBottom:10}}>
          <label style={formLabel}>Category</label>
          <select className="m-input" value={type}
            onChange={(e) => { setType(e.target.value); setTargetMode('all'); setTargetValue(''); setTargetAudiences([]); setUseClassFilter(false); }}>
            {ALL_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
      )}

      <div style={{marginBottom:10}}>
        <label style={formLabel}>Title <span style={{color:'#dc2626'}}>*</span></label>
        <input className="m-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title" />
      </div>

      <div style={{marginBottom:10}}>
        <label style={formLabel}>Content</label>
        <textarea className="m-input" rows={5}
          style={{padding:10,resize:'vertical',fontFamily:'inherit'}}
          value={content} onChange={(e) => setContent(e.target.value)}
          placeholder="Write your announcement..." />
      </div>

      {/* Target — varies by category */}
      {type === 'general' && (
        <div style={{marginBottom:10}}>
          <label style={formLabel}>Target Audience</label>
          <select className="m-input" value={targetMode}
            onChange={(e) => { setTargetMode(e.target.value); setTargetValue(''); }}>
            <option value="all">Everyone</option>
            <option value="all_teachers">All Teachers</option>
            <option value="all_students">All Students</option>
            <option value="all_parents">All Parents</option>
            <option value="all_employees">All Employees</option>
            <option value="specific_class">Specific Class</option>
            <option value="specific_user">Specific User (by ID)</option>
          </select>
          {targetMode === 'specific_class' && (
            <select className="m-input" style={{marginTop:8}} value={targetValue} onChange={(e) => setTargetValue(e.target.value)}>
              <option value="">Select class</option>
              {classes.map(c => <option key={c.name} value={c.name}>{c.display_name || `Class ${c.name}`}</option>)}
            </select>
          )}
          {targetMode === 'specific_user' && (
            <input className="m-input" style={{marginTop:8}} value={targetValue} onChange={(e) => setTargetValue(e.target.value)} placeholder="User ID (e.g. user_abc123)" />
          )}
        </div>
      )}

      {type === 'employees' && (
        <div style={{marginBottom:10}}>
          <label style={formLabel}>Target Audience</label>
          <select className="m-input" value={targetMode}
            onChange={(e) => { setTargetMode(e.target.value); setTargetValue(''); }}>
            <option value="all">All Employees</option>
            <option value="department">Specific Department</option>
          </select>
          {targetMode === 'department' && (
            <select className="m-input" style={{marginTop:8}} value={targetValue} onChange={(e) => setTargetValue(e.target.value)}>
              <option value="">Select department</option>
              {departments.length === 0 && <option value="" disabled>No departments found</option>}
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </div>
      )}

      {(type === 'homework' || type === 'classwork') && (
        <>
          <div style={{marginBottom:10}}>
            <label style={formLabel}>Target Audience</label>
            <p style={{fontSize:11,color:'#888',marginBottom:6}}>Tick one or more. Leave all unticked to send to everyone.</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {audienceOptionsFor(type).map(opt => (
                <label key={opt.value}
                  style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:10,background:'#F8F8F8',border:'1px solid #E5E5E5',cursor:'pointer',fontSize:12,fontWeight:600,color:'#1A1A1A'}}>
                  <input type="checkbox"
                    checked={targetAudiences.includes(opt.value)}
                    onChange={() => toggleAudience(opt.value)}
                    style={{width:14,height:14,accentColor:'#1A1A1A'}}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <label style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:10,background:'#F8F8F8',border:'1px solid #E5E5E5',cursor:'pointer',fontSize:12,fontWeight:600,color:'#1A1A1A'}}>
              <input type="checkbox" checked={useClassFilter}
                onChange={(e) => { setUseClassFilter(e.target.checked); if (!e.target.checked) setTargetValue(''); }}
                style={{width:14,height:14,accentColor:'#1A1A1A'}} />
              Limit to a specific class
            </label>
            {useClassFilter && (
              <select className="m-input" style={{marginTop:8}} value={targetValue} onChange={(e) => setTargetValue(e.target.value)}>
                <option value="">Select class</option>
                {classes.map(c => <option key={c.name} value={c.name}>{c.display_name || `Class ${c.name}`}</option>)}
              </select>
            )}
          </div>
        </>
      )}

      <div style={{marginBottom:10}}>
        <label style={formLabel}>Priority</label>
        <select className="m-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {/* Existing voice note (edit mode) */}
      {isEdit && announcement?.voice_note_id && !voice.audioBlob && (
        <div style={{marginBottom:10,padding:10,background:'#F8F8F8',borderRadius:10}}>
          <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#666',marginBottom:6}}>Current voice note</p>
          <VoiceNotePlayer url={`/api/media/voice-notes/${announcement.voice_note_id}`} />
          <p style={{fontSize:10,color:'#888',marginTop:6}}>Recording a new note below will replace this one.</p>
        </div>
      )}

      <div style={{marginBottom:6,display:'flex',alignItems:'center',gap:4,color:'#666',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>
        <Mic size={12} /> Voice Note (optional)
      </div>
      <VoiceNoteRecorder voice={voice} />
    </Sheet>
  );
};
