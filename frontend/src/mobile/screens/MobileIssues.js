import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import { getCached, setCached } from '../../lib/pageCache';
import { toast } from 'sonner';
import {
  Plus, TicketCheck, Search, Clock, CheckCircle, AlertCircle, Loader2, X,
} from 'lucide-react';
import { formatDateTime } from '../../lib/utils';

// Categories / priorities / statuses are system constants — hardcoded on the
// desktop too (IssuesPage.js), so mirroring them here is correct parity.
const CATEGORIES = ['academic', 'fee', 'transport', 'facility', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
];

const STATUS_BADGE = {
  open: { bg: '#f1f5f9', color: '#0f172a', label: 'Open' },
  in_progress: { bg: '#fffbeb', color: '#a16207', label: 'In Progress' },
  resolved: { bg: '#1A1A1A', color: '#FFF', label: 'Resolved' },
  closed: { bg: '#e2e8f0', color: '#475569', label: 'Closed' },
};
const CATEGORY_BG = {
  academic: { bg: '#f1f5f9', color: '#0f172a' },
  fee: { bg: '#f1f5f9', color: '#0f172a' },
  transport: { bg: '#fffbeb', color: '#a16207' },
  facility: { bg: '#cffafe', color: '#155e75' },
  other: { bg: '#f3f4f6', color: '#374151' },
};

const formLabel = {
  display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase',
  letterSpacing:'0.06em', color:'#666', marginBottom:6,
};

const StatusIcon = ({ status, size = 18 }) => {
  if (status === 'open') return <AlertCircle size={size} color="#64748b" />;
  if (status === 'in_progress') return <Clock size={size} color="#f59e0b" />;
  if (status === 'resolved') return <CheckCircle size={size} color="#1A1A1A" />;
  return <TicketCheck size={size} color="#6b7280" />;
};

const Badge = ({ map, value }) => {
  const s = map[value] || { bg: '#f3f4f6', color: '#374151', label: value };
  return (
    <span style={{padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,background:s.bg,color:s.color,whiteSpace:'nowrap',textTransform:'capitalize'}}>
      {s.label || value}
    </span>
  );
};

const Sheet = ({ title, onClose, children }) => {
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
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0'}}>
          <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888'}}><X size={20} /></button>
        </div>
        <div style={{padding:16,overflowY:'auto',flex:1}}>{children}</div>
      </div>
    </div>
  );
};

const MobileIssues = () => {
  const { isAdmin, isTeacher } = useAuth();
  const canManage = isAdmin || isTeacher;

  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: 'academic', priority: 'normal' });

  const [selected, setSelected] = useState(null);
  const [resolution, setResolution] = useState('');
  const [updating, setUpdating] = useState(false);

  const fetchIssues = useCallback(async () => {
    const cacheKey = `m-issues:${filterStatus || 'all'}`;
    const cached = getCached(cacheKey);
    if (cached) { setIssues(cached); setLoading(false); }
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      const res = await api.get('/issues', { params });
      const arr = Array.isArray(res.data) ? res.data : [];
      setIssues(arr);
      setCached(cacheKey, arr);
    } catch (e) {
      if (!cached && !e._handled) toast.error(e.response?.data?.detail || 'Failed to fetch issues');
    } finally { setLoading(false); }
  }, [filterStatus]);

  useEffect(() => { fetchIssues(); }, [fetchIssues]);

  const submit = async () => {
    if (!form.title.trim() || !form.description.trim()) { toast.error('Title and description are required'); return; }
    setSubmitting(true);
    try {
      await api.post('/issues', form);
      toast.success('Issue reported successfully');
      setShowAdd(false);
      setForm({ title: '', description: '', category: 'academic', priority: 'normal' });
      fetchIssues();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to report issue');
    } finally { setSubmitting(false); }
  };

  const updateStatus = async (newStatus) => {
    if (!selected) return;
    setUpdating(true);
    try {
      const payload = { status: newStatus };
      if (newStatus === 'resolved' && resolution.trim()) payload.resolution = resolution.trim();
      await api.put(`/issues/${selected.issue_id}`, payload);
      toast.success('Issue updated');
      setSelected(null);
      setResolution('');
      fetchIssues();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to update issue');
    } finally { setUpdating(false); }
  };

  const filtered = issues.filter(i =>
    (i.title || '').toLowerCase().includes(search.toLowerCase()) ||
    (i.description || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div data-testid="m-issues">
      <div className="m-header" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
        <div style={{minWidth:0}}>
          <h1 style={{display:'flex',alignItems:'center',gap:6}}><TicketCheck size={22} color="#E88A1A" /> Issues</h1>
          <p className="m-header-sub">Report and track issues</p>
        </div>
        <button className="m-btn m-btn-primary m-btn-sm" style={{width:'auto'}} onClick={() => setShowAdd(true)} data-testid="m-raise-issue-btn">
          <Plus size={16} /> Raise
        </button>
      </div>

      {/* Search */}
      <div style={{position:'relative',marginBottom:10}}>
        <Search size={14} style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'#888'}} />
        <input className="m-input" style={{paddingLeft:34}} placeholder="Search issues..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="m-search-issues" />
      </div>

      {/* Status filter tabs */}
      <div style={{display:'flex',gap:6,padding:4,background:'#F0F0F0',borderRadius:12,marginBottom:12,overflowX:'auto'}}>
        {STATUS_TABS.map(t => (
          <button key={t.key || 'all'} onClick={() => setFilterStatus(t.key)}
            style={{
              flex:'1 0 auto',padding:'8px 12px',borderRadius:8,border:'none',whiteSpace:'nowrap',
              background: filterStatus === t.key ? '#FFF' : 'transparent',
              color: filterStatus === t.key ? '#1A1A1A' : '#888',
              fontSize:12,fontWeight:700,cursor:'pointer',
              boxShadow: filterStatus === t.key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && issues.length === 0 ? (
        [1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:96,borderRadius:14,marginBottom:8}} />)
      ) : filtered.length === 0 ? (
        <div className="m-empty"><TicketCheck className="m-empty-icon" /><p>No issues found</p></div>
      ) : (
        filtered.map(issue => (
          <div key={issue.issue_id}
            onClick={() => { setSelected(issue); setResolution(''); }}
            style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:12,marginBottom:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)',cursor:'pointer'}}
            data-testid={`m-issue-${issue.issue_id}`}>
            <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
              <div style={{marginTop:2,flexShrink:0}}><StatusIcon status={issue.status} /></div>
              <div style={{minWidth:0,flex:1}}>
                <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
                  <p style={{fontSize:14,fontWeight:700,color:'#1A1A1A',minWidth:0,wordBreak:'break-word'}}>{issue.title}</p>
                  <Badge map={STATUS_BADGE} value={issue.status} />
                </div>
                <p style={{fontSize:12,color:'#666',marginTop:4,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{issue.description}</p>
                <div style={{display:'flex',alignItems:'center',gap:6,marginTop:8,flexWrap:'wrap'}}>
                  <Badge map={CATEGORY_BG} value={issue.category} />
                  <span style={{fontSize:10,color:'#aaa'}}>{formatDateTime(issue.created_at)} · {issue.raised_by_role}</span>
                </div>
              </div>
            </div>
          </div>
        ))
      )}

      {/* Raise issue sheet */}
      {showAdd && (
        <Sheet title="Raise New Issue" onClose={() => !submitting && setShowAdd(false)}>
          <div style={{marginBottom:12}}>
            <label style={formLabel}>Title *</label>
            <input className="m-input" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Brief description of the issue" data-testid="m-issue-title" />
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
            <div>
              <label style={formLabel}>Category</label>
              <select className="m-input" value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} style={{textTransform:'capitalize'}}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={formLabel}>Priority</label>
              <select className="m-input" value={form.priority} onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))} style={{textTransform:'capitalize'}}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div style={{marginBottom:12}}>
            <label style={formLabel}>Description *</label>
            <textarea className="m-input" style={{minHeight:90,resize:'vertical',padding:10}} value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Provide details about the issue..." data-testid="m-issue-description" />
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={() => setShowAdd(false)} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
            <button onClick={submit} disabled={submitting} className="m-btn m-btn-primary" style={{flex:1}} data-testid="m-submit-issue-btn">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Submit
            </button>
          </div>
        </Sheet>
      )}

      {/* Detail sheet */}
      {selected && (
        <Sheet title="Issue Details" onClose={() => !updating && setSelected(null)}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start',marginBottom:8}}>
            <h3 style={{fontSize:16,fontWeight:800,color:'#1A1A1A',minWidth:0,wordBreak:'break-word'}}>{selected.title}</h3>
            <Badge map={STATUS_BADGE} value={selected.status} />
          </div>
          <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
            <Badge map={CATEGORY_BG} value={selected.category} />
            <span style={{padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,background:'#FFF',border:'1px solid #E5E5E5',color:'#475569',textTransform:'capitalize'}}>Priority: {selected.priority}</span>
          </div>
          <div style={{padding:12,background:'#F8F8F8',borderRadius:12,marginBottom:12}}>
            <p style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888',marginBottom:4}}>Description</p>
            <p style={{fontSize:13,color:'#1A1A1A',whiteSpace:'pre-wrap'}}>{selected.description}</p>
          </div>
          {selected.resolution && (
            <div style={{padding:12,background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:12,marginBottom:12}}>
              <p style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#15803d',marginBottom:4}}>Resolution</p>
              <p style={{fontSize:13,color:'#166534',whiteSpace:'pre-wrap'}}>{selected.resolution}</p>
            </div>
          )}
          <p style={{fontSize:10,color:'#aaa',marginBottom:4}}>Issue ID: {selected.issue_id}</p>
          <p style={{fontSize:10,color:'#aaa'}}>Reported {formatDateTime(selected.created_at)} by {selected.raised_by_role}</p>

          {canManage && selected.status !== 'resolved' && selected.status !== 'closed' && (
            <div style={{borderTop:'1px solid #F0F0F0',marginTop:14,paddingTop:14}}>
              <label style={formLabel}>Resolution Notes</label>
              <textarea className="m-input" style={{minHeight:70,resize:'vertical',padding:10,marginBottom:10}} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Add resolution notes..." />
              <div style={{display:'flex',gap:8}}>
                {selected.status === 'open' && (
                  <button onClick={() => updateStatus('in_progress')} disabled={updating} className="m-btn m-btn-outline" style={{flex:1}}>
                    {updating ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />} In Progress
                  </button>
                )}
                <button onClick={() => updateStatus('resolved')} disabled={updating} className="m-btn m-btn-primary" style={{flex:1}}>
                  {updating ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Resolve
                </button>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
};

export default MobileIssues;
