import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { History, RotateCcw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '../../lib/utils';

const ENTITY_LABELS = {
  student: 'Student',
  employee: 'Employee',
  holiday: 'Holiday',
  announcement: 'Announcement',
  pos_device: 'POS Device',
};

const summarize = (e) => {
  const c = e.changes || {};
  return c.name || c.title || c.date || c.device_id || e.entity_id;
};

const MobileAuditTrail = () => {
  const [entries, setEntries] = useState([]);
  const [restorable, setRestorable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(null);
  const [restoring, setRestoring] = useState(false);

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/audit-trail', {
        params: { only_non_admin: true, include_restored: true, limit: 200 },
      });
      setEntries(res.data.entries || []);
      setRestorable(res.data.restorable_entity_types || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to load audit trail');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEntries(); }, []);

  const doRestore = async () => {
    if (!confirming) return;
    setRestoring(true);
    try {
      const res = await api.post(`/admin/audit-trail/${confirming.log_id}/restore`);
      toast.success(res.data.message || 'Restored');
      setConfirming(null);
      fetchEntries();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  if (loading) return (
    <div>
      <div className="m-header"><div><h1>Audit Trails</h1></div></div>
      {[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:84,borderRadius:14,marginBottom:8}} />)}
    </div>
  );

  return (
    <div data-testid="m-audit-trail">
      <div className="m-header">
        <div>
          <h1>Audit Trails</h1>
          <p className="m-header-sub">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="m-empty">
          <ShieldCheck className="m-empty-icon" />
          <p>No deletion events to show</p>
        </div>
      ) : (
        <div className="m-list">
          {entries.map((e) => {
            const isRestored = !!e.restored_at;
            const canRestore = !isRestored && restorable.includes(e.entity_type);
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
                <p style={{fontWeight:700,fontSize:14,color:'#1A1A1A'}}>{summarize(e)}</p>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#888'}}>
                  <span>{e.performed_by_name || e.performed_by} ({e.performed_by_role || '?'})</span>
                  <span>{formatDateTime(e.created_at)}</span>
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
      )}

      {confirming && (
        <div
          onClick={() => !restoring && setConfirming(null)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'flex-end',zIndex:50}}
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
