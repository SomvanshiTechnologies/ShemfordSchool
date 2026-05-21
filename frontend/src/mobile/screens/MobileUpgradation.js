import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import { getCached, setCached, invalidatePrefix } from '../../lib/pageCache';
import { toast } from 'sonner';
import {
  ArrowUpCircle, History, Search, CheckCircle2, AlertCircle, Loader2,
  Eye, CreditCard, Check, X, ChevronRight, ChevronLeft, Receipt,
} from 'lucide-react';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card', label: 'Card' },
];

const STREAMS = ['Science', 'Arts', 'Commerce'];
const CLASSES_WITH_STREAMS = ['Class 11', 'Class 12'];

const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const currentAY = () => {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() + 1 >= 4 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
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
          whiteSpace:'nowrap',
        }}
      >
        {t.label}
      </button>
    ))}
  </div>
);

// ─── Main ──────────────────────────────────────────────────────────────────

const MobileUpgradation = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [tab, setTab] = useState('upgrade');
  const [classes, setClasses] = useState(getCached('classes') || []);

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

  return (
    <div data-testid="m-upgradation" style={{minWidth:0}}>
      <div className="m-header" style={{gap:8}}>
        <div style={{flex:1,minWidth:0}}>
          <h1 style={{display:'flex',alignItems:'center',gap:6}}>
            <ArrowUpCircle size={22} color="#E88A1A" /> Upgradation
          </h1>
          <p className="m-header-sub">Promote students to next class / academic year</p>
        </div>
      </div>

      <TabBar tabs={[
        { key: 'upgrade', label: 'Upgrade' },
        { key: 'history', label: 'History' },
      ]} active={tab} onChange={setTab} />

      {tab === 'upgrade' && <UpgradeTab classes={classes} isAdmin={isAdmin} />}
      {tab === 'history' && <HistoryTab isAdmin={isAdmin} />}
    </div>
  );
};

export default MobileUpgradation;

// ─── Upgrade Tab ───────────────────────────────────────────────────────────

const UpgradeTab = ({ classes }) => {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);

  const [toClass, setToClass] = useState('');
  const [toSection, setToSection] = useState('');
  const [toStream, setToStream] = useState('');
  const [toAY, setToAY] = useState(currentAY());
  const [notes, setNotes] = useState('');
  const [upgrading, setUpgrading] = useState(false);
  const [graduating, setGraduating] = useState(false);
  const [result, setResult] = useState(null);

  const [feeBlockMsg, setFeeBlockMsg] = useState(null);
  const [pendingEntries, setPendingEntries] = useState([]);
  const [duesLoading, setDuesLoading] = useState(false);

  // Collect-fee dialog state (mirrors desktop UpgradationPage)
  const [showCollect, setShowCollect] = useState(false);
  const [collectIds, setCollectIds] = useState([]);
  const [collectMethod, setCollectMethod] = useState('cash');
  const [collectTxn, setCollectTxn] = useState('');
  const [collectPaying, setCollectPaying] = useState(false);
  const [collectLoading, setCollectLoading] = useState(false);

  const upgradingRef = useRef(false);
  const searchTimer = useRef(null);

  // Debounced search.
  // /students search matches parents too — narrow to student name/admission
  // so the upgrade picker doesn't surface Ankit when you search "pooja".
  useEffect(() => {
    if (selected) return;
    clearTimeout(searchTimer.current);
    if (!search.trim() || search.length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.get('/students', { params: { search: search.trim(), limit: 20 } });
        const arr = r.data?.students ?? (Array.isArray(r.data) ? r.data : []);
        const needle = search.trim().toLowerCase();
        setResults(arr.filter(stu => {
          const fullName = `${stu.first_name || ''} ${stu.last_name || ''}`.toLowerCase();
          const admission = (stu.admission_number || '').toLowerCase();
          return fullName.includes(needle) || admission.includes(needle);
        }));
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 350);
  }, [search, selected]);

  const selectStudent = (s) => {
    setSelected(s);
    setResults([]);
    setSearch(`${s.first_name} ${s.last_name} (${s.admission_number || s.student_id})`);
    setResult(null);
    setFeeBlockMsg(null);
    setPendingEntries([]);

    // Fee status check
    if (s.fee_status === 'pending' || s.fee_status === 'overdue') {
      const yr = s.academic_year || 'current year';
      setFeeBlockMsg(`Fees for ${yr} are ${s.fee_status}.`);
      setDuesLoading(true);
      api.get(`/fees/ledger/${s.student_id}`).then(r => {
        const ledger = r.data?.ledger || {};
        const all = [...(ledger.one_time || []), ...(ledger.yearly || []), ...(ledger.monthly || [])];
        const dues = all.filter(e => e.status === 'pending' || e.status === 'overdue');
        setPendingEntries(dues);
        setCollectIds(dues.map(e => e.ledger_id));
      }).catch(() => {}).finally(() => setDuesLoading(false));
    }

    // Auto-advance academic year
    if (s.academic_year && /^\d{4}-\d{4}$/.test(s.academic_year)) {
      const startYear = parseInt(s.academic_year.split('-')[0], 10);
      setToAY(`${startYear + 1}-${startYear + 2}`);
    }

    // Auto-pick the next class
    const active = (classes || []).filter(c => c.is_active);
    const idx = active.findIndex(c => c.name === s.class_name);
    if (idx >= 0 && idx + 1 < active.length) {
      setToClass(active[idx + 1].name);
      setToSection('');
      setToStream('');
    } else {
      setToClass('');
    }
  };

  const resetSelection = () => {
    setSelected(null);
    setSearch('');
    setToClass('');
    setToSection('');
    setToStream('');
    setNotes('');
    setFeeBlockMsg(null);
    setPendingEntries([]);
    setResult(null);
  };

  const sectionOptions = useMemo(() => {
    if (!toClass) return [];
    return classes.find(c => c.name === toClass)?.sections || [];
  }, [classes, toClass]);

  const eligibleClasses = useMemo(() => {
    const active = (classes || []).filter(c => c.is_active);
    if (!selected) return active;
    const idx = active.findIndex(c => c.name === selected.class_name);
    return idx >= 0 ? active.slice(idx + 1) : active;
  }, [classes, selected]);

  const doUpgrade = async () => {
    if (!selected || !toClass || !toSection) {
      toast.error('Select target class and section');
      return;
    }
    if (CLASSES_WITH_STREAMS.includes(toClass) && !toStream) {
      toast.error(`Stream is required for ${toClass}`);
      return;
    }
    if (upgradingRef.current) return;
    upgradingRef.current = true;
    setUpgrading(true);
    try {
      const r = await api.post(`/students/${selected.student_id}/upgrade`, {
        to_class: toClass,
        to_section: toSection,
        to_stream: toStream || null,
        academic_year: toAY,
        notes,
      });
      toast.success(r.data.message || 'Upgrade request submitted. Awaiting admin approval.');
      invalidatePrefix('m-upgradation:');
      resetSelection();
    } catch (e) {
      const detail = e.response?.data?.detail || '';
      const isFeeBlock = e.response?.status === 400 && detail.toLowerCase().includes('fees pending');
      if (isFeeBlock) setFeeBlockMsg(detail);
      else toast.error(detail || 'Upgrade failed');
    } finally {
      upgradingRef.current = false;
      setUpgrading(false);
    }
  };

  const openCollect = async () => {
    if (!selected) return;
    setCollectLoading(true);
    setShowCollect(true);
    try {
      const r = await api.get(`/fees/ledger/${selected.student_id}`);
      const ledger = r.data?.ledger || {};
      const all = [...(ledger.one_time || []), ...(ledger.yearly || []), ...(ledger.monthly || [])];
      const entries = all.filter(e => e.status === 'pending' || e.status === 'overdue');
      setPendingEntries(entries);
      setCollectIds(entries.map(e => e.ledger_id));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load pending fees');
      setShowCollect(false);
    } finally { setCollectLoading(false); }
  };

  const payPendingFees = async () => {
    if (!collectIds.length) { toast.error('Select at least one entry'); return; }
    setCollectPaying(true);
    try {
      const r = await api.post('/fees/pay', {
        student_id: selected.student_id,
        ledger_ids: collectIds,
        payment_method: collectMethod,
        transaction_id: collectTxn || undefined,
      });
      toast.success(r.data.message || 'Fees collected successfully');
      setShowCollect(false);
      setCollectIds([]);
      setCollectTxn('');
      // Re-fetch student to update fee_status so the block clears
      try {
        const sr = await api.get(`/students/${selected.student_id}`);
        const updated = sr.data;
        setSelected(updated);
        if (updated.fee_status === 'paid') {
          setFeeBlockMsg(null);
          setPendingEntries([]);
          toast.success('All fees cleared — you can now upgrade the student.');
        } else {
          // Refresh pending dues for the still-blocked view
          const lr = await api.get(`/fees/ledger/${updated.student_id}`);
          const ledger = lr.data?.ledger || {};
          const all = [...(ledger.one_time || []), ...(ledger.yearly || []), ...(ledger.monthly || [])];
          setPendingEntries(all.filter(e => e.status === 'pending' || e.status === 'overdue'));
        }
      } catch {}
    } catch (e) { toast.error(e.response?.data?.detail || 'Payment failed'); }
    finally { setCollectPaying(false); }
  };

  const doGraduate = async () => {
    if (!selected || graduating) return;
    setGraduating(true);
    try {
      const r = await api.post(`/students/${selected.student_id}/graduate`, { remarks: notes });
      toast.success(r.data.message || 'Student marked as passed out');
      setResult({ graduated: true, message: r.data.message });
    } catch (e) { toast.error(e.response?.data?.detail || 'Pass out failed'); }
    finally { setGraduating(false); }
  };

  return (
    <>
      {/* Step 1: Search */}
      <div style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:14,marginBottom:12,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
        <p className="m-section" style={{margin:'0 0 8px'}}>Step 1 — Select Student</p>
        <div style={{position:'relative'}}>
          <Search size={14} style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'#888'}} />
          <input
            className="m-input"
            style={{paddingLeft:34}}
            placeholder="Search by name or admission number..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); if (selected) resetSelection(); }}
            data-testid="m-upg-search"
          />
          {searching && <Loader2 size={14} className="animate-spin" style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',color:'#888'}} />}
        </div>

        {!selected && results.length > 0 && (
          <div style={{border:'1px solid #E5E5E5',borderRadius:10,maxHeight:240,overflowY:'auto',marginTop:8}}>
            {results.map(s => (
              <button
                key={s.student_id}
                onClick={() => selectStudent(s)}
                style={{width:'100%',textAlign:'left',padding:10,background:'none',border:'none',borderBottom:'1px solid #F5F5F5',cursor:'pointer',display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}
              >
                <div style={{minWidth:0,flex:1}}>
                  <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.first_name} {s.last_name}</p>
                  <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {s.class_name}-{s.section}{s.stream ? ` (${s.stream})` : ''} · {s.admission_number || s.student_id}
                  </p>
                </div>
                <ChevronRight size={14} color="#888" />
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div style={{
            marginTop:10,padding:12,borderRadius:12,
            background: (selected.fee_status === 'pending' || selected.fee_status === 'overdue') ? '#fee2e2' : '#fff7ed',
            border: (selected.fee_status === 'pending' || selected.fee_status === 'overdue') ? '1px solid #fecaca' : '1px solid #fed7aa',
          }}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
              <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',minWidth:0,flex:1,wordBreak:'break-word'}}>
                {selected.first_name} {selected.last_name}
              </p>
              {(selected.fee_status === 'pending' || selected.fee_status === 'overdue') && (
                <span style={{padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,background:'#fee2e2',color:'#dc2626',whiteSpace:'nowrap'}}>
                  ⚠ {selected.fee_status} — blocked
                </span>
              )}
            </div>
            <p style={{fontSize:11,color:'#666',marginTop:4}}>
              {selected.class_name} – {selected.section}{selected.stream ? ` (${selected.stream})` : ''}
              {' · Adm '}{selected.admission_number || '—'}
              {selected.academic_year && ` · Year ${selected.academic_year}`}
            </p>
            <button onClick={resetSelection}
              style={{marginTop:8,fontSize:11,color:'#666',background:'none',border:'none',cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
              <ChevronLeft size={12} /> Change student
            </button>
          </div>
        )}
      </div>

      {/* Graduate option for 12th class */}
      {selected && selected.class_name === '12th' && !result && (
        <div style={{background:'#ecfdf5',border:'1px solid #a7f3d0',borderRadius:14,padding:14,marginBottom:12}}>
          <p style={{fontSize:13,fontWeight:700,color:'#047857',marginBottom:6}}>Step 2 — 12th Pass Out</p>
          <p style={{fontSize:12,color:'#065f46',lineHeight:1.5,marginBottom:10}}>
            This student is in 12th class — the final year. Mark them as Passed Out to deactivate the student record.
          </p>
          {(selected.fee_status === 'pending' || selected.fee_status === 'overdue') && (
            <div style={{padding:'8px 10px',background:'#fee2e2',border:'1px solid #fecaca',borderRadius:8,fontSize:11,color:'#dc2626',marginBottom:10}}>
              ⚠ Student has {selected.fee_status} fees — pass out will be blocked until dues are cleared.
            </div>
          )}
          <div style={{marginBottom:10}}>
            <label style={formLabel}>Remarks (optional)</label>
            <input className="m-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Passed Class 12 Board 2027" />
          </div>
          <button onClick={doGraduate} disabled={graduating}
            className="m-btn"
            style={{width:'100%',background:'#16a34a',color:'#FFF',padding:14}}
            data-testid="m-upg-graduate">
            {graduating ? <Loader2 size={14} className="animate-spin" /> : null} Mark as Passed Out
          </button>
        </div>
      )}

      {/* Fee blocked banner with pending dues */}
      {selected && selected.class_name !== '12th' && feeBlockMsg && (
        <div style={{background:'#fee2e2',border:'1px solid #fecaca',borderRadius:14,padding:14,marginBottom:12}}>
          <p style={{fontSize:13,fontWeight:700,color:'#dc2626',marginBottom:6}}>⚠ Cannot Upgrade — Fees Pending</p>
          <p style={{fontSize:11,color:'#991b1b',marginBottom:10}}>{feeBlockMsg}</p>
          {duesLoading ? (
            <div style={{display:'flex',alignItems:'center',gap:6,color:'#991b1b',fontSize:12}}>
              <Loader2 size={14} className="animate-spin" /> Loading pending dues…
            </div>
          ) : pendingEntries.length > 0 ? (
            <div style={{background:'#FFF',border:'1px solid #fecaca',borderRadius:10,overflow:'hidden'}}>
              {pendingEntries.map(e => (
                <div key={e.ledger_id} style={{padding:10,borderBottom:'1px solid #fef2f2',display:'flex',justifyContent:'space-between',gap:8}}>
                  <div style={{minWidth:0,flex:1}}>
                    <p style={{fontSize:12,fontWeight:600,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.description || e.fee_component}</p>
                    <p style={{fontSize:10,color:'#888'}}>Due {e.due_date || '—'} · {e.status}</p>
                  </div>
                  <p style={{fontSize:13,fontWeight:800,color:'#dc2626',flexShrink:0}}>₹{fmt(e.net_amount)}</p>
                </div>
              ))}
              <div style={{padding:10,background:'#fef2f2',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,fontWeight:700,color:'#991b1b'}}>Total Pending</span>
                <span style={{fontSize:14,fontWeight:800,color:'#dc2626'}}>
                  ₹{fmt(pendingEntries.reduce((s, e) => s + (e.net_amount || 0), 0))}
                </span>
              </div>
            </div>
          ) : null}
          <button onClick={openCollect}
            style={{marginTop:10,width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'12px 14px',borderRadius:12,background:'#dc2626',border:'none',color:'#FFF',fontSize:13,fontWeight:700,cursor:'pointer'}}
            data-testid="m-upg-collect-fee">
            <CreditCard size={14} /> Collect Fee
          </button>
        </div>
      )}

      {showCollect && (
        <CollectFeeSheet
          student={selected}
          entries={pendingEntries}
          loading={collectLoading}
          selectedIds={collectIds}
          setSelectedIds={setCollectIds}
          method={collectMethod}
          setMethod={setCollectMethod}
          txn={collectTxn}
          setTxn={setCollectTxn}
          paying={collectPaying}
          onConfirm={payPendingFees}
          onClose={() => setShowCollect(false)}
        />
      )}

      {/* Target class form */}
      {selected && selected.class_name !== '12th' && !feeBlockMsg && (
        <div style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:14,marginBottom:12,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
          <p className="m-section" style={{margin:'0 0 10px'}}>Step 2 — Target Class & Year</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <div>
              <label style={formLabel}>New Class</label>
              <select className="m-input" value={toClass} onChange={(e) => { setToClass(e.target.value); setToSection(''); setToStream(''); }}>
                <option value="">Select</option>
                {eligibleClasses.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={formLabel}>New Section</label>
              <select className="m-input" value={toSection} onChange={(e) => setToSection(e.target.value)} disabled={!toClass}>
                <option value="">Select</option>
                {sectionOptions.map(s => (
                  <option key={s.section_name} value={s.section_name}>
                    {s.section_name} (cap {s.capacity || 40})
                  </option>
                ))}
              </select>
            </div>
          </div>
          {CLASSES_WITH_STREAMS.includes(toClass) && (
            <div style={{marginBottom:10}}>
              <label style={formLabel}>Stream <span style={{color:'#dc2626'}}>*</span></label>
              <select className="m-input" value={toStream} onChange={(e) => setToStream(e.target.value)}>
                <option value="">Select stream</option>
                {STREAMS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          <div style={{marginBottom:10}}>
            <label style={formLabel}>Academic Year</label>
            <input className="m-input" value={toAY} readOnly style={{background:'#F8F8F8'}} />
            {selected?.academic_year && toAY && (
              <p style={{fontSize:11,color:'#666',marginTop:4}}>
                Upgrading from <strong>{selected.academic_year}</strong> → <strong style={{color:'#E88A1A'}}>{toAY}</strong>
                {selected.academic_year === toAY && <span style={{color:'#d97706',marginLeft:4}}>⚠ Same as current</span>}
              </p>
            )}
          </div>
          <div style={{marginBottom:12}}>
            <label style={formLabel}>Notes (optional)</label>
            <input className="m-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for upgradation..." />
          </div>
          <button onClick={doUpgrade} disabled={upgrading}
            className="m-btn m-btn-primary"
            style={{width:'100%',padding:14}}
            data-testid="m-upg-confirm">
            {upgrading ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpCircle size={16} />}
            Confirm Upgrade
          </button>
        </div>
      )}

      {result && result.graduated && (
        <div style={{background:'#ecfdf5',border:'1px solid #a7f3d0',borderRadius:14,padding:14}}>
          <div style={{display:'flex',alignItems:'center',gap:8,color:'#047857'}}>
            <CheckCircle2 size={18} />
            <p style={{fontSize:14,fontWeight:700}}>Student Passed Out</p>
          </div>
          <p style={{fontSize:12,color:'#065f46',marginTop:6}}>{result.message}</p>
        </div>
      )}
    </>
  );
};

// ─── History Tab ───────────────────────────────────────────────────────────

const HistoryTab = ({ isAdmin }) => {
  const [year, setYear] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [viewRow, setViewRow] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = year ? { academic_year: year } : {};
      const r = await api.get('/upgradation/history', { params });
      setHistory(Array.isArray(r.data) ? r.data : []);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load history'); }
    finally { setLoading(false); }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const r = await api.post(`/upgradation/${id}/approve`);
      toast.success(r.data.message || 'Approved');
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to approve'); }
    finally { setBusyId(null); }
  };

  const reject = async () => {
    if (!rejectFor) return;
    setBusyId(rejectFor);
    try {
      const r = await api.post(`/upgradation/${rejectFor}/reject`, { reason: rejectReason });
      toast.success(r.data.message || 'Rejected');
      setRejectFor(null);
      setRejectReason('');
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to reject'); }
    finally { setBusyId(null); }
  };

  return (
    <>
      <div style={{display:'flex',gap:8,alignItems:'flex-end',marginBottom:12,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:140}}>
          <label style={formLabel}>Academic Year (optional)</label>
          <input className="m-input" value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 2025-2026" />
        </div>
        <button onClick={load} disabled={loading} className="m-btn m-btn-outline m-btn-sm" style={{width:'auto',marginTop:18}}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : 'Load'}
        </button>
      </div>

      {loading && history.length === 0 ? (
        <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:96,borderRadius:14,marginBottom:8}} />)}</div>
      ) : history.length === 0 ? (
        <div className="m-empty"><AlertCircle className="m-empty-icon" /><p>No upgradation records</p></div>
      ) : (
        history.map(r => {
          const status = r.status || 'pending_approval';
          const isPending = status === 'pending_approval';
          const feePaid = r.upgradation_fee_status === 'paid' || r.upgradation_fee_paid;
          return (
            <div key={r.upgradation_id}
              style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:12,marginBottom:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start',marginBottom:8}}>
                <div style={{minWidth:0,flex:1}}>
                  <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {r.student_name || r.student_id}
                  </p>
                  <p style={{fontSize:10,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {r.admission_number} · {r.academic_year}
                  </p>
                </div>
                <StatusBadge status={status} />
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#1A1A1A',marginBottom:8,flexWrap:'wrap'}}>
                <span style={{color:'#666'}}>{r.from_class}-{r.from_section}{r.from_stream ? ` (${r.from_stream})` : ''}</span>
                <ArrowUpCircle size={12} color="#E88A1A" />
                <span style={{fontWeight:700}}>{r.to_class}-{r.to_section}{r.to_stream ? ` (${r.to_stream})` : ''}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  {r.upgradation_fee > 0 && (
                    <>
                      <span style={{fontSize:11,color:'#666'}}>Fee ₹{fmt(r.upgradation_fee)}</span>
                      <span style={{
                        padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,
                        background: feePaid ? '#dcfce7' : '#fef3c7',
                        color: feePaid ? '#15803d' : '#a16207',
                      }}>
                        {feePaid ? 'Paid' : 'Pending'}
                      </span>
                    </>
                  )}
                </div>
                <div style={{display:'flex',gap:6}}>
                  {isAdmin && isPending && (
                    <>
                      <button onClick={() => approve(r.upgradation_id)} disabled={busyId === r.upgradation_id}
                        style={{padding:'6px 10px',borderRadius:8,background:'#dcfce7',border:'1px solid #bbf7d0',color:'#15803d',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}
                        data-testid={`m-upg-approve-${r.upgradation_id}`}>
                        {busyId === r.upgradation_id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
                      </button>
                      <button onClick={() => { setRejectFor(r.upgradation_id); setRejectReason(''); }} disabled={busyId === r.upgradation_id}
                        style={{padding:'6px 10px',borderRadius:8,background:'#fee2e2',border:'1px solid #fecaca',color:'#dc2626',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}
                        data-testid={`m-upg-reject-${r.upgradation_id}`}>
                        <X size={12} /> Reject
                      </button>
                    </>
                  )}
                  <button onClick={() => setViewRow(r)}
                    style={{padding:'6px 10px',borderRadius:8,background:'#FFF',border:'1px solid #E5E5E5',color:'#1A1A1A',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}>
                    <Eye size={12} /> View
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}

      {rejectFor && (
        <ConfirmReject
          reason={rejectReason}
          setReason={setRejectReason}
          onCancel={() => { setRejectFor(null); setRejectReason(''); }}
          onConfirm={reject}
          busy={busyId === rejectFor}
        />
      )}

      {viewRow && (
        <ViewSheet row={viewRow} onClose={() => setViewRow(null)} />
      )}
    </>
  );
};

const StatusBadge = ({ status }) => {
  const map = {
    pending_approval: { bg: '#fef3c7', color: '#a16207', label: 'Pending' },
    approved: { bg: '#dcfce7', color: '#15803d', label: 'Approved' },
    rejected: { bg: '#fee2e2', color: '#dc2626', label: 'Rejected' },
  };
  const s = map[status] || map.pending_approval;
  return (
    <span style={{padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:700,background:s.bg,color:s.color,whiteSpace:'nowrap',flexShrink:0}}>
      {s.label}
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

const CollectFeeSheet = ({
  student, entries, loading, selectedIds, setSelectedIds,
  method, setMethod, txn, setTxn, paying, onConfirm, onClose,
}) => {
  const toggle = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const total = entries
    .filter(e => selectedIds.includes(e.ledger_id))
    .reduce((s, e) => s + (e.net_amount || 0), 0);

  return (
    <Sheet title="Collect Pending Fees" onClose={onClose}>
      <p style={{fontSize:12,color:'#666',marginBottom:10}}>
        Student: <strong style={{color:'#1A1A1A'}}>{student?.first_name} {student?.last_name}</strong>
      </p>

      {loading ? (
        <div style={{display:'flex',justifyContent:'center',padding:20}}>
          <Loader2 size={20} className="animate-spin" color="#E88A1A" />
        </div>
      ) : entries.length === 0 ? (
        <div style={{display:'flex',alignItems:'center',gap:8,padding:12,background:'#dcfce7',border:'1px solid #bbf7d0',borderRadius:10,color:'#15803d'}}>
          <CheckCircle2 size={16} />
          <span style={{fontSize:13,fontWeight:600}}>No pending fees found.</span>
        </div>
      ) : (
        <>
          <div style={{border:'1px solid #E5E5E5',borderRadius:10,overflow:'hidden',marginBottom:10}}>
            {entries.map(e => (
              <label key={e.ledger_id}
                style={{display:'flex',alignItems:'center',gap:10,padding:10,borderBottom:'1px solid #F5F5F5',cursor:'pointer'}}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(e.ledger_id)}
                  onChange={() => toggle(e.ledger_id)}
                  style={{width:16,height:16,flexShrink:0,accentColor:'#1A1A1A'}}
                />
                <div style={{minWidth:0,flex:1}}>
                  <p style={{fontSize:12,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {e.description || e.fee_component}
                  </p>
                  <p style={{fontSize:10,color:'#888'}}>
                    Due {e.due_date || '—'} · <span style={{textTransform:'capitalize'}}>{e.status}</span>
                  </p>
                </div>
                <p style={{fontSize:13,fontWeight:800,color:'#1A1A1A',flexShrink:0}}>₹{fmt(e.net_amount)}</p>
              </label>
            ))}
          </div>

          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',background:'#F8F8F8',borderRadius:10,marginBottom:12}}>
            <span style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#666'}}>Total to collect</span>
            <span style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>₹{fmt(total)}</span>
          </div>

          <div style={{marginBottom:10}}>
            <label style={formLabel}>Payment Method</label>
            <select className="m-input" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {method !== 'cash' && (
            <div style={{marginBottom:10}}>
              <label style={formLabel}>Transaction ID</label>
              <input className="m-input" value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="UTR / cheque no." />
            </div>
          )}
        </>
      )}

      <div style={{display:'flex',gap:8,marginTop:12}}>
        <button onClick={onClose} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
        {!loading && entries.length > 0 && (
          <button onClick={onConfirm} disabled={paying || !selectedIds.length}
            className="m-btn"
            style={{flex:1,background:'#E88A1A',color:'#FFF'}}
            data-testid="m-upg-collect-confirm">
            {paying ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
            Confirm
          </button>
        )}
      </div>
    </Sheet>
  );
};

const ConfirmReject = ({ reason, setReason, onCancel, onConfirm, busy }) => (
  <Sheet title="Reject Upgradation" onClose={onCancel}>
    <p style={{fontSize:13,color:'#666',marginBottom:10}}>Please provide a reason. This will be saved with the upgrade record.</p>
    <textarea
      className="m-input"
      style={{minHeight:80,resize:'vertical',padding:10}}
      placeholder="Reason for rejection..."
      value={reason}
      onChange={(e) => setReason(e.target.value)}
    />
    <div style={{display:'flex',gap:8,marginTop:12}}>
      <button onClick={onCancel} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
      <button onClick={onConfirm} disabled={busy} className="m-btn" style={{flex:1,background:'#dc2626',color:'#FFF'}}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Reject
      </button>
    </div>
  </Sheet>
);

const ViewSheet = ({ row, onClose }) => (
  <Sheet title="Upgradation Details" onClose={onClose}>
    <DetailRow label="Student" value={row.student_name || row.student_id} />
    <DetailRow label="Admission" value={row.admission_number} mono />
    <DetailRow label="Academic Year" value={row.academic_year} />
    <DetailRow label="From" value={`${row.from_class}-${row.from_section}${row.from_stream ? ` (${row.from_stream})` : ''}`} />
    <DetailRow label="To" value={`${row.to_class}-${row.to_section}${row.to_stream ? ` (${row.to_stream})` : ''}`} />
    {row.upgradation_fee > 0 && (
      <DetailRow label="Upgradation Fee" value={`₹${fmt(row.upgradation_fee)}`} />
    )}
    <DetailRow label="Submitted" value={row.created_at?.slice(0, 10) || '—'} />
    <DetailRow label="Status" value={(row.status || 'pending_approval').replace('_', ' ')} />
    {row.notes && <DetailRow label="Notes" value={row.notes} />}
    {row.reject_reason && <DetailRow label="Reject Reason" value={row.reject_reason} accent="#dc2626" />}
  </Sheet>
);

const DetailRow = ({ label, value, mono, accent }) => (
  <div style={{display:'flex',justifyContent:'space-between',gap:12,padding:'8px 0',borderBottom:'1px solid #F5F5F5'}}>
    <span style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888',flexShrink:0}}>{label}</span>
    <span style={{fontSize:13,fontWeight:600,color: accent || '#1A1A1A',fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,textAlign:'right',wordBreak:'break-word',minWidth:0,textTransform: accent ? 'none' : undefined}}>
      {value || '—'}
    </span>
  </div>
);
