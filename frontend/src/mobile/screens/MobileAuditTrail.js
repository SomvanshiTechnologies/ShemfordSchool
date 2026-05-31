import React, { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { History, RotateCcw, ShieldCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '../../lib/utils';

const PAGE_SIZE = 30;

const ENTITY_LABELS = {
  student: 'Student',
  employee: 'Employee',
  holiday: 'Holiday',
  announcement: 'Announcement',
  pos_device: 'POS Device',
};

// Role badge colours mirror the desktop AuditTrailPage ROLE_COLORS.
const ROLE_BADGE = {
  admin: { bg: '#1e293b', color: '#FFF' },
  teacher: { bg: '#fffbeb', color: '#92400e' },
  student: { bg: '#eff6ff', color: '#1d4ed8' },
  parent: { bg: '#faf5ff', color: '#7e22ce' },
  accountant: { bg: '#ecfdf5', color: '#047857' },
};

const summarize = (e) => {
  const c = e.changes || {};
  return c.name || c.title || c.date || c.device_id || e.entity_id;
};

const MobileAuditTrail = () => {
  const [entries, setEntries] = useState([]);
  const [restorable, setRestorable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalEntries, setTotalEntries] = useState(0);
  const [entityType, setEntityType] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [restoring, setRestoring] = useState(false);

  const fetchEntries = useCallback(async (pg = 1, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const params = { only_non_admin: true, include_restored: true, page: pg, limit: PAGE_SIZE };
      if (entityType) params.entity_type = entityType;
      const res = await api.get('/admin/audit-trail', { params });
      const arr = res.data.entries || [];
      const total = parseInt(res.headers?.['x-total-count'] ?? res.data?.count ?? arr.length, 10);
      const pages = parseInt(res.headers?.['x-total-pages'] ?? 1, 10);
      setEntries(prev => append ? [...prev, ...arr] : arr);
      setTotalEntries(Number.isNaN(total) ? arr.length : total);
      setTotalPages(Number.isNaN(pages) ? 1 : pages);
      setRestorable(res.data.restorable_entity_types || []);
    } catch (err) {
      if (!append) toast.error(err.response?.data?.detail || 'Failed to load audit trail');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [entityType]);

  // Reload from page 1 whenever the entity filter changes.
  useEffect(() => { setPage(1); fetchEntries(1, false); }, [fetchEntries]);

  const loadMore = () => {
    const next = page + 1;
    if (next <= totalPages && !loadingMore) { setPage(next); fetchEntries(next, true); }
  };

  const doRestore = async () => {
    if (!confirming) return;
    setRestoring(true);
    try {
      const res = await api.post(`/admin/audit-trail/${confirming.log_id}/restore`);
      toast.success(res.data.message || 'Restored');
      setConfirming(null);
      setPage(1);
      fetchEntries(1, false);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div data-testid="m-audit-trail">
      <div className="m-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:6}}><History size={22} color="#E88A1A" /> Audit Trails</h1>
          <p className="m-header-sub">{loading ? 'Loading…' : `${entries.length} of ${totalEntries} ${totalEntries === 1 ? 'entry' : 'entries'}`}</p>
        </div>
      </div>

      {/* Entity-type filter (populated from the API's restorable types) */}
      <div style={{marginBottom:12}}>
        <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#666',marginBottom:6}}>Filter by type</label>
        <select className="m-input" value={entityType} onChange={(e) => setEntityType(e.target.value)} data-testid="m-audit-filter">
          <option value="">All entity types</option>
          {restorable.map(t => <option key={t} value={t}>{ENTITY_LABELS[t] || t}</option>)}
        </select>
      </div>

      {loading && entries.length === 0 ? (
        [1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:84,borderRadius:14,marginBottom:8}} />)
      ) : entries.length === 0 ? (
        <div className="m-empty">
          <ShieldCheck className="m-empty-icon" />
          <p>No matching deletion events</p>
        </div>
      ) : (
        <>
          <div className="m-list">
            {entries.map((e) => {
              const isRestored = !!e.restored_at;
              const canRestore = !isRestored && restorable.includes(e.entity_type);
              const roleStyle = ROLE_BADGE[e.performed_by_role] || { bg: '#f1f5f9', color: '#475569' };
              return (
                <div key={e.log_id} className="m-list-item" style={{flexDirection:'column',alignItems:'stretch',gap:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',width:'100%',alignItems:'center',gap:8}}>
                    <span className="m-badge m-badge-outline" style={{textTransform:'capitalize'}}>
                      {ENTITY_LABELS[e.entity_type] || e.entity_type}
                    </span>
                    <span className={`m-badge ${isRestored ? 'm-badge-muted' : 'm-badge-orange'}`}>
                      {isRestored ? 'Restored' : 'Deleted'}
                    </span>
                  </div>
                  <div>
                    <p style={{fontWeight:700,fontSize:14,color:'#1A1A1A'}}>{summarize(e)}</p>
                    <p style={{fontSize:10,color:'#aaa',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',marginTop:2,wordBreak:'break-all'}}>{e.entity_id}</p>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:11,color:'#888',gap:8}}>
                    <span style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>
                      <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.performed_by_name || e.performed_by}</span>
                      {e.performed_by_role && (
                        <span style={{padding:'1px 6px',borderRadius:5,fontSize:9,fontWeight:700,textTransform:'capitalize',background:roleStyle.bg,color:roleStyle.color,flexShrink:0}}>
                          {e.performed_by_role}
                        </span>
                      )}
                    </span>
                    <span style={{flexShrink:0}}>{formatDateTime(e.created_at)}</span>
                  </div>
                  {isRestored ? (
                    <p style={{fontSize:11,color:'#888'}}>Restored by {e.restored_by_name || e.restored_by}</p>
                  ) : canRestore ? (
                    <button
                      className="m-btn m-btn-outline m-btn-sm"
                      onClick={() => setConfirming(e)}
                      data-testid={`m-restore-${e.log_id}`}
                    >
                      <RotateCcw size={14} /> Restore
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          {page < totalPages && (
            <button className="m-btn m-btn-outline" style={{marginTop:12}} onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null} Load more
            </button>
          )}
          {page >= totalPages && totalEntries > 0 && (
            <p style={{textAlign:'center',fontSize:11,color:'#aaa',padding:'12px 0'}}>{totalEntries} {totalEntries === 1 ? 'entry' : 'entries'} total</p>
          )}
        </>
      )}

      {confirming && (
        <div
          onClick={() => !restoring && setConfirming(null)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'flex-end',zIndex:1000,paddingBottom:'calc(68px + env(safe-area-inset-bottom, 0px))'}}
        >
          <div
            onClick={(ev) => ev.stopPropagation()}
            style={{background:'#FFF',width:'100%',padding:20,borderTopLeftRadius:20,borderTopRightRadius:20}}
          >
            <h3 style={{fontSize:18,fontWeight:700,marginBottom:8}}>
              Restore {ENTITY_LABELS[confirming.entity_type] || confirming.entity_type}?
            </h3>
            <p style={{fontSize:13,color:'#666',marginBottom:16}}>
              Are you sure you want to restore {(ENTITY_LABELS[confirming.entity_type] || confirming.entity_type).toLowerCase()}?
            </p>
            <div style={{display:'flex',gap:8}}>
              <button className="m-btn m-btn-outline" onClick={() => setConfirming(null)} disabled={restoring} style={{flex:1}}>Cancel</button>
              <button className="m-btn m-btn-primary" onClick={doRestore} disabled={restoring} style={{flex:1}}>
                {restoring ? 'Restoring…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileAuditTrail;
