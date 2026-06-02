import React, { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';
import { Trash2, AlertTriangle, Check, X, Loader2, ShieldCheck, RotateCcw, Clock } from 'lucide-react';

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
  const [rejectType, setRejectType] = useState('deletion'); // 'deletion' | 'revoke'

  const load = useCallback(() => {
    setLoading(true);
    api.get('/account-deletion/requests')
      .then(r => setRequests(Array.isArray(r.data) ? r.data : []))
      .catch((e) => { if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to load requests'); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    if (actingId) return;
    if (!window.confirm("Permanently delete this account and ALL of the user's data? This cannot be undone.")) return;
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
      const endpoint = rejectType === 'revoke'
        ? `/account-deletion/${rejectId}/reject-revoke`
        : `/account-deletion/${rejectId}/reject`;
      await api.post(endpoint, { reason: rejectReason.trim() || undefined });
      toast.success(rejectType === 'revoke' ? 'Revoke request rejected — deletion proceeds.' : 'Request rejected.');
      setRejectId(null);
      setRejectReason('');
      load();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to reject');
    } finally { setActingId(null); }
  };

  const approveRevoke = async (id) => {
    if (actingId) return;
    setActingId(id);
    try {
      const res = await api.post(`/account-deletion/${id}/approve-revoke`);
      toast.success(res.data.message || 'Account restored.');
      load();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to approve revoke');
    } finally { setActingId(null); }
  };

  const executeDeletion = async (id, force = false) => {
    if (actingId) return;
    const msg = force
      ? "Force-delete now? The 30-day window hasn't expired yet."
      : "Permanently delete this account now? This cannot be undone.";
    if (!window.confirm(msg)) return;
    setActingId(id);
    try {
      const res = await api.post(`/account-deletion/${id}/execute`, { force });
      toast.success(res.data.message || 'Account deleted.');
      load();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to execute deletion');
    } finally { setActingId(null); }
  };

  const daysRemaining = (isoDate) => {
    if (!isoDate) return null;
    const diff = new Date(isoDate) - new Date();
    return Math.max(0, Math.ceil(diff / 86400000));
  };

  const deletionReqs = requests.filter(r => r.status === 'pending');
  const revokeReqs   = requests.filter(r => r.status === 'revoke_pending');
  const approvedReqs = requests.filter(r => r.status === 'approved');

  const actionRow = (label, color, bg, border, onClick, disabled, icon) => ({
    display:'flex',alignItems:'center',justifyContent:'center',gap:6,
    flex:1,padding:'10px',borderRadius:10,background:bg,border:`1px solid ${border}`,
    color,fontSize:12,fontWeight:700,cursor:'pointer',
    opacity: disabled ? 0.6 : 1,
  });

  return (
    <div data-testid="m-account-deletions">
      <div className="m-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:6}}><Trash2 size={22} color="#dc2626" /> Deletion Requests</h1>
          <p className="m-header-sub">Review and act on account deletion requests</p>
        </div>
      </div>

      {loading ? (
        [1,2].map(i => <div key={i} className="m-skeleton" style={{height:110,borderRadius:14,marginBottom:8}} />)
      ) : (
        <>
          {/* ── Restoration Requests (revoke_pending) ── */}
          {revokeReqs.length > 0 && (
            <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:14,padding:12,marginBottom:12}}>
              <p style={{fontSize:12,fontWeight:800,color:'#1d4ed8',display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
                <RotateCcw size={14} /> Account Restoration Requests
              </p>
              <div style={{display:'flex',gap:6,padding:'6px 8px',background:'#dbeafe',border:'1px solid #bfdbfe',borderRadius:8,marginBottom:10}}>
                <AlertTriangle size={12} color="#1d4ed8" style={{flexShrink:0,marginTop:1}} />
                <span style={{fontSize:11,color:'#1e40af'}}>These users changed their mind. Approving will reactivate their account.</span>
              </div>
              {revokeReqs.map(r => (
                <div key={r.request_id} style={{background:'#FFF',border:'1px solid #bfdbfe',borderRadius:12,padding:12,marginBottom:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
                    <div style={{minWidth:0,flex:1}}>
                      <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.user_name || r.user_id}</p>
                      <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.user_email}</p>
                      <p style={{fontSize:10,color:'#aaa',marginTop:3}}>
                        Deletion requested {r.requested_at?.slice(0, 10)}
                        {r.revoke_requested_at && <span> · Revoke requested {r.revoke_requested_at.slice(0, 10)}</span>}
                      </p>
                    </div>
                    <span className="m-badge m-badge-dark" style={{textTransform:'uppercase'}}>{r.user_role}</span>
                  </div>
                  <div style={{display:'flex',gap:8,marginTop:10}}>
                    <button onClick={() => approveRevoke(r.request_id)} disabled={actingId === r.request_id}
                      style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px',borderRadius:10,background:'#dbeafe',border:'1px solid #bfdbfe',color:'#1d4ed8',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                      {actingId === r.request_id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Restore Account
                    </button>
                    <button onClick={() => { setRejectId(r.request_id); setRejectReason(''); setRejectType('revoke'); }} disabled={actingId === r.request_id}
                      style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px',borderRadius:10,background:'#fee2e2',border:'1px solid #fecaca',color:'#dc2626',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                      <X size={14} /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Approved — 30-day grace period ── */}
          {approvedReqs.length > 0 && (
            <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:14,padding:12,marginBottom:12}}>
              <p style={{fontSize:12,fontWeight:800,color:'#b45309',display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
                <Clock size={14} /> Scheduled for Deletion (30-day window)
              </p>
              <div style={{display:'flex',gap:6,padding:'6px 8px',background:'#fef3c7',border:'1px solid #fde68a',borderRadius:8,marginBottom:10}}>
                <AlertTriangle size={12} color="#b45309" style={{flexShrink:0,marginTop:1}} />
                <span style={{fontSize:11,color:'#92400e'}}>Approved for deletion. Users can revoke within 30 days. Execute once the window closes or force-delete immediately.</span>
              </div>
              {approvedReqs.map(r => {
                const days = daysRemaining(r.final_deletion_at);
                const expired = days === 0;
                return (
                  <div key={r.request_id} style={{background:'#FFF',border:'1px solid #fde68a',borderRadius:12,padding:12,marginBottom:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
                      <div style={{minWidth:0,flex:1}}>
                        <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.user_name || r.user_id}</p>
                        <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.user_email}</p>
                        <p style={{fontSize:10,color:'#aaa',marginTop:3}}>
                          Approved {r.reviewed_at?.slice(0, 10)}
                          {r.final_deletion_at && <span> · Deletes {r.final_deletion_at.slice(0, 10)}</span>}
                        </p>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,flexShrink:0}}>
                        <span className="m-badge m-badge-dark" style={{textTransform:'uppercase'}}>{r.user_role}</span>
                        {expired
                          ? <span style={{fontSize:10,fontWeight:700,color:'#dc2626',background:'#fee2e2',padding:'2px 6px',borderRadius:6}}>Window expired</span>
                          : <span style={{fontSize:10,fontWeight:700,color:'#b45309',background:'#fef3c7',padding:'2px 6px',borderRadius:6}}>{days}d remaining</span>
                        }
                      </div>
                    </div>
                    <div style={{marginTop:10}}>
                      {expired ? (
                        <button onClick={() => executeDeletion(r.request_id, false)} disabled={actingId === r.request_id}
                          style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px',borderRadius:10,background:'#dc2626',border:'none',color:'#FFF',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                          {actingId === r.request_id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete Now
                        </button>
                      ) : (
                        <button onClick={() => executeDeletion(r.request_id, true)} disabled={actingId === r.request_id}
                          style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px',borderRadius:10,background:'#fee2e2',border:'1px solid #fecaca',color:'#dc2626',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                          {actingId === r.request_id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Force Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Pending Deletion Requests ── */}
          {deletionReqs.length === 0 && revokeReqs.length === 0 && approvedReqs.length === 0 ? (
            <div className="m-empty"><ShieldCheck className="m-empty-icon" /><p>No pending deletion requests</p></div>
          ) : deletionReqs.length > 0 && (
            <>
              <div style={{display:'flex',gap:6,padding:'8px 10px',background:'#fee2e2',border:'1px solid #fecaca',borderRadius:10,marginBottom:12}}>
                <AlertTriangle size={14} color="#dc2626" style={{flexShrink:0,marginTop:1}} />
                <span style={{fontSize:11,color:'#991b1b'}}>Approving permanently deletes the user's account and all their data. This cannot be undone.</span>
              </div>
              {deletionReqs.map(r => (
                <div key={r.request_id} style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:12,marginBottom:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
                    <div style={{minWidth:0,flex:1}}>
                      <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.user_name || r.user_id}</p>
                      <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.user_email}</p>
                    </div>
                    <span className="m-badge m-badge-dark" style={{textTransform:'uppercase'}}>{r.user_role}</span>
                  </div>
                  {r.reason && <p style={{fontSize:12,color:'#555',marginTop:6}}>"{r.reason}"</p>}
                  <p style={{fontSize:10,color:'#aaa',marginTop:4}}>
                    Requested {r.requested_at?.slice(0, 10)}
                    {r.expires_at && <span> · Revoke window until {r.expires_at.slice(0, 10)}</span>}
                  </p>
                  <div style={{display:'flex',gap:8,marginTop:10}}>
                    <button onClick={() => approve(r.request_id)} disabled={actingId === r.request_id}
                      style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px',borderRadius:10,background:'#dcfce7',border:'1px solid #bbf7d0',color:'#15803d',fontSize:12,fontWeight:700,cursor:'pointer'}}
                      data-testid={`m-del-approve-${r.request_id}`}>
                      {actingId === r.request_id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve & Delete
                    </button>
                    <button onClick={() => { setRejectId(r.request_id); setRejectReason(''); setRejectType('deletion'); }} disabled={actingId === r.request_id}
                      style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px',borderRadius:10,background:'#fee2e2',border:'1px solid #fecaca',color:'#dc2626',fontSize:12,fontWeight:700,cursor:'pointer'}}
                      data-testid={`m-del-reject-${r.request_id}`}>
                      <X size={14} /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {rejectId && (
        <Sheet
          title={rejectType === 'revoke' ? 'Reject Restore Request' : 'Reject Deletion Request'}
          onClose={() => !actingId && setRejectId(null)}
        >
          <p style={{fontSize:13,color:'#666',marginBottom:10}}>
            {rejectType === 'revoke'
              ? 'Deletion will proceed as originally requested.'
              : 'The user keeps their account.'}
            {' '}Optionally tell them why.
          </p>
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
