import React, { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';
import { Trash2, AlertTriangle, Check, X, Loader2, ShieldCheck } from 'lucide-react';

const formLabel = {
  display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase',
  letterSpacing:'0.06em', color:'#666', marginBottom:6,
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

const MobileAccountDeletions = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/account-deletion/requests', { params: { status: 'pending' } })
      .then(r => setRequests(Array.isArray(r.data) ? r.data : []))
      .catch((e) => { if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to load requests'); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    if (actingId) return;
    if (!window.confirm('Permanently delete this account and ALL of the user’s data? This cannot be undone.')) return;
    setActingId(id);
    try {
      const res = await api.post(`/account-deletion/${id}/approve`);
      toast.success(res.data.message || 'Account deleted.');
      load();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to approve');
    } finally { setActingId(null); }
  };

  const doReject = async () => {
    if (!rejectId) return;
    setActingId(rejectId);
    try {
      await api.post(`/account-deletion/${rejectId}/reject`, { reason: rejectReason.trim() || undefined });
      toast.success('Request rejected.');
      setRejectId(null);
      setRejectReason('');
      load();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to reject');
    } finally { setActingId(null); }
  };

  return (
    <div data-testid="m-account-deletions">
      <div className="m-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:6}}><Trash2 size={22} color="#dc2626" /> Deletion Requests</h1>
          <p className="m-header-sub">Approve or reject account deletion requests</p>
        </div>
      </div>

      {loading ? (
        [1,2].map(i => <div key={i} className="m-skeleton" style={{height:110,borderRadius:14,marginBottom:8}} />)
      ) : requests.length === 0 ? (
        <div className="m-empty"><ShieldCheck className="m-empty-icon" /><p>No pending deletion requests</p></div>
      ) : (
        <>
          <div style={{display:'flex',gap:6,padding:'8px 10px',background:'#fee2e2',border:'1px solid #fecaca',borderRadius:10,marginBottom:12}}>
            <AlertTriangle size={14} color="#dc2626" style={{flexShrink:0,marginTop:1}} />
            <span style={{fontSize:11,color:'#991b1b'}}>Approving permanently deletes the user’s account and all their data. This cannot be undone.</span>
          </div>
          {requests.map(r => (
            <div key={r.request_id} style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:12,marginBottom:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
                <div style={{minWidth:0,flex:1}}>
                  <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.user_name || r.user_id}</p>
                  <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.user_email}</p>
                </div>
                <span className="m-badge m-badge-dark" style={{textTransform:'uppercase'}}>{r.user_role}</span>
              </div>
              {r.reason && <p style={{fontSize:12,color:'#555',marginTop:6}}>“{r.reason}”</p>}
              <p style={{fontSize:10,color:'#aaa',marginTop:4}}>Requested {r.requested_at?.slice(0, 10)}</p>
              <div style={{display:'flex',gap:8,marginTop:10}}>
                <button onClick={() => approve(r.request_id)} disabled={actingId === r.request_id}
                  style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px',borderRadius:10,background:'#dcfce7',border:'1px solid #bbf7d0',color:'#15803d',fontSize:12,fontWeight:700,cursor:'pointer'}}
                  data-testid={`m-del-approve-${r.request_id}`}>
                  {actingId === r.request_id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve & Delete
                </button>
                <button onClick={() => { setRejectId(r.request_id); setRejectReason(''); }} disabled={actingId === r.request_id}
                  style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px',borderRadius:10,background:'#fee2e2',border:'1px solid #fecaca',color:'#dc2626',fontSize:12,fontWeight:700,cursor:'pointer'}}
                  data-testid={`m-del-reject-${r.request_id}`}>
                  <X size={14} /> Reject
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {rejectId && (
        <Sheet title="Reject Deletion Request" onClose={() => !actingId && setRejectId(null)}>
          <p style={{fontSize:13,color:'#666',marginBottom:10}}>The user keeps their account. Optionally tell them why.</p>
          <label style={formLabel}>Reason (optional)</label>
          <input className="m-input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Outstanding dues" />
          <div style={{display:'flex',gap:8,marginTop:12}}>
            <button onClick={() => setRejectId(null)} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
            <button onClick={doReject} disabled={!!actingId} className="m-btn" style={{flex:1,background:'#dc2626',color:'#FFF'}}>
              {actingId === rejectId ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Confirm Reject
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
};

export default MobileAccountDeletions;
