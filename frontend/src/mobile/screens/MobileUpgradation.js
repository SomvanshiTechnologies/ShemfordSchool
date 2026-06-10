import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSession } from '../../contexts/SessionContext';
import api from '../../lib/api';
import { getCached, setCached, invalidatePrefix } from '../../lib/pageCache';
import { fetchPaymentMethods, PAYMENT_METHODS_WITH_POS, fmtPaymentMethod } from '../../lib/paymentMethods';
import { toast } from 'sonner';
import {
  ArrowUpCircle, Search, CheckCircle2, AlertCircle, Loader2,
  Eye, CreditCard, Check, X, ChevronRight, ChevronLeft, Download,
} from 'lucide-react';

const STREAMS = ['Science', 'Humanities'];
const CLASSES_WITH_STREAMS = ['Class 11', 'Class 12', '11th', '12th'];
const STREAM_SECTIONS = STREAMS.map(s => ({ section_name: s, capacity: 999 }));
const isStreamClass = (cn) => CLASSES_WITH_STREAMS.includes(cn) || /^(11|12)(th)?$/i.test((cn || '').replace(/^Class\s*/i, ''));

const fmtClassSec = (cls, section, stream) => {
  if (!cls) return '—';
  if (isStreamClass(cls)) {
    const raw = String(stream || '').trim() ||
      (STREAMS.map(s => s.toLowerCase()).includes(String(section || '').toLowerCase()) ? section : '');
    const pretty = raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : '';
    return pretty ? `${cls} (${pretty})` : cls;
  }
  return `${cls}${section ? ` – ${section}` : ''}`;
};

const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const isoToDisplay = (s) => {
  if (!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s);
};

// Remaining balance for a ledger entry: prefer the server's remaining_balance,
// else net_amount − amount_paid. Mirrors desktop UpgradationPage.
const remainingOf = (e) => {
  const paid = Number(e.amount_paid || 0);
  return e.remaining_balance != null && e.remaining_balance >= 0
    ? Number(e.remaining_balance)
    : Math.max(0, Number(e.net_amount || 0) - paid);
};

const HISTORY_PAGE_SIZE = 10;

const formLabel = {
  display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase',
  letterSpacing:'0.06em', color:'#666', marginBottom:6,
};

const TabBar = ({ tabs, active, onChange }) => (
  <div style={{display:'flex',gap:6,padding:4,background:'transparent',borderRadius:12,marginBottom:12,overflowX:'auto',scrollbarWidth:'none',msOverflowStyle:'none'}}>
    {tabs.map(t => (
      <button key={t.key} onClick={() => onChange(t.key)}
        style={{
          flex:1,minWidth:'fit-content',padding:'8px 12px',borderRadius:12,border:'none',
          background: active === t.key ? '#FFF' : 'transparent',
          color: active === t.key ? '#1A1A1A' : '#888',
          fontSize:12,fontWeight:700,cursor:'pointer',
          boxShadow: active === t.key ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
          whiteSpace:'nowrap',
        }}
      >
        {t.label}
      </button>
    ))}
  </div>
);

// ─── Receipt preview hook + sheet ────────────────────────────────────────────
// Fetches the receipt PDF and shows it inline. Pass ledgerId to scope the
// receipt to a single fee (shows that fee's full payment trail).
const useReceipt = () => {
  const [preview, setPreview] = useState(null);
  const openPreview = useCallback(async (paymentId, receiptNumber, ledgerId) => {
    if (!paymentId) return;
    try {
      const qs = ledgerId ? `?ledger_id=${encodeURIComponent(ledgerId)}` : '';
      const res = await api.get(`/fees/receipt/${paymentId}/pdf${qs}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      setPreview({ url, paymentId, receiptNumber });
    } catch {
      toast.error('Receipt generated but preview failed.');
    }
  }, []);
  const close = useCallback(() => {
    setPreview(prev => { if (prev?.url) URL.revokeObjectURL(prev.url); return null; });
  }, []);
  return { preview, openPreview, close };
};

const ReceiptPreviewSheet = ({ preview, onClose }) => {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  if (!preview) return null;
  const download = () => {
    const a = document.createElement('a');
    a.href = preview.url;
    a.download = `receipt-${preview.receiptNumber || 'fee'}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:260,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
      <div onClick={(e) => e.stopPropagation()}
        style={{background:'#FFF',width:'100%',maxWidth:560,borderTopLeftRadius:20,borderTopRightRadius:20,height:'92dvh',display:'flex',flexDirection:'column',paddingBottom:'env(safe-area-inset-bottom, 0)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderBottom:'1px solid #F0F0F0'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
            <CheckCircle2 size={18} color="#16a34a" />
            <span style={{fontSize:14,fontWeight:800,color:'#1A1A1A'}}>Payment recorded</span>
            {preview.receiptNumber && (
              <span style={{fontSize:11,color:'#888',fontFamily:'ui-monospace, monospace',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{preview.receiptNumber}</span>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888'}}><X size={20} /></button>
        </div>
        <div style={{flex:1,background:'#F0F0F0',minHeight:0}}>
          <iframe src={preview.url} title="Fee receipt" style={{width:'100%',height:'100%',border:0}} />
        </div>
        <div style={{display:'flex',gap:8,padding:12,borderTop:'1px solid #F0F0F0'}}>
          <button onClick={() => window.open(preview.url, '_blank')} className="m-btn m-btn-outline" style={{flex:1}}>
            <Eye size={14} /> Open
          </button>
          <button onClick={download} className="m-btn" style={{flex:1,background:'#1A1A1A',color:'#FFF'}}>
            <Download size={14} /> Download
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Collect-fee flow hook (shared by Upgrade + History tabs) ────────────────
const useCollectFlow = (onPaid) => {
  const [show, setShow] = useState(false);
  const [student, setStudent] = useState(null);
  const [rowId, setRowId] = useState(null);
  const [entries, setEntries] = useState([]);
  const [ids, setIds] = useState([]);
  const [method, setMethod] = useState('cash');
  const [txn, setTxn] = useState('');
  const [partial, setPartial] = useState('');
  const [splitCash, setSplitCash] = useState('');
  const [splitOnline, setSplitOnline] = useState('');
  const [paying, setPaying] = useState(false);
  const [loading, setLoading] = useState(false);

  const open = useCallback(async (stu, rid = null) => {
    if (!stu?.student_id) return;
    setStudent(stu);
    setRowId(rid);
    setIds([]);
    setPartial(''); setSplitCash(''); setSplitOnline('');
    setLoading(true);
    setShow(true);
    try {
      const res = await api.get(`/fees/ledger/${stu.student_id}`);
      const ledger = res.data?.ledger || {};
      const all = [...(ledger.one_time || []), ...(ledger.yearly || []), ...(ledger.monthly || [])];
      const pending = all.filter(e => e.status === 'pending' || e.status === 'overdue');
      setEntries(pending);
      // When opened from a history row, pre-select and lock the upgradation fee
      // (mandatory) — admin can additionally tick other dues but cannot uncheck
      // the upgrade fee. Mirrors desktop openCollectDialog.
      if (rid) {
        const upgEntry = pending.find(e => e.fee_component === 'upgradation');
        setIds(upgEntry ? [upgEntry.ledger_id] : []);
      }
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to load pending fees');
      setShow(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const close = useCallback(() => setShow(false), []);

  const pay = useCallback(async () => {
    if (!ids.length) { toast.error('Select at least one entry'); return; }
    if (!student) return;
    const payload = {
      student_id: student.student_id,
      ledger_ids: ids,
      payment_method: method,
      transaction_id: txn || undefined,
    };
    const partialVal = parseFloat(partial);
    if (partial && partialVal > 0) payload.amount = partialVal;
    if (method === 'split') {
      const cash = parseFloat(splitCash) || 0;
      const online = parseFloat(splitOnline) || 0;
      if (cash <= 0 && online <= 0) { toast.error('Enter at least one split amount'); return; }
      payload.split_payments = { cash, online };
    }
    // Scope the receipt to a single fee when exactly one was collected, so it
    // shows that fee's full payment trail (previous partials + this one).
    const singleLedgerId = ids.length === 1 ? ids[0] : null;
    const rid = rowId;
    const stu = student;
    setPaying(true);
    try {
      const res = await api.post('/fees/pay', payload);
      toast.success(res.data.message || 'Fees collected successfully');
      setShow(false);
      setIds([]); setTxn(''); setPartial(''); setSplitCash(''); setSplitOnline('');
      const paymentId = res.data.payment?.payment_id;
      onPaid && (await onPaid({
        paymentId,
        receiptNumber: res.data.receipt_number,
        ledgerId: singleLedgerId,
        rowId: rid,
        student: stu,
      }));
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Payment failed');
    } finally {
      setPaying(false);
    }
  }, [ids, student, method, txn, partial, splitCash, splitOnline, rowId, onPaid]);

  return {
    show, student, rowId, entries, ids, setIds, method, setMethod, txn, setTxn,
    partial, setPartial, splitCash, setSplitCash, splitOnline, setSplitOnline,
    paying, loading, open, close, pay,
  };
};

// ─── Main ──────────────────────────────────────────────────────────────────

const MobileUpgradation = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [tab, setTab] = useState('upgrade');
  const [classes, setClasses] = useState(getCached('classes') || []);
  const [payMethods, setPayMethods] = useState(PAYMENT_METHODS_WITH_POS);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/classes');
        const arr = Array.isArray(r.data) ? r.data : [];
        setClasses(arr);
        setCached('classes', arr);
      } catch {}
    })();
    // Payment methods are admin-configurable in the DB — fetch the live list
    // (same source the desktop collect dialogs use). Falls back to defaults.
    fetchPaymentMethods({ withPos: true }).then(setPayMethods).catch(() => {});
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

      {tab === 'upgrade' && <UpgradeTab classes={classes} payMethods={payMethods} />}
      {tab === 'history' && <HistoryTab isAdmin={isAdmin} payMethods={payMethods} />}
    </div>
  );
};

export default MobileUpgradation;

// ─── Upgrade Tab ───────────────────────────────────────────────────────────

const UpgradeTab = ({ classes, payMethods }) => {
  const { viewSession } = useSession();

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);

  const [toClass, setToClass] = useState('');
  const [toSection, setToSection] = useState('');
  const [toStream, setToStream] = useState('');
  const [toAY, setToAY] = useState('');
  const [notes, setNotes] = useState('');
  const [upgrading, setUpgrading] = useState(false);
  const [graduating, setGraduating] = useState(false);
  const [result, setResult] = useState(null);

  const [feeBlockMsg, setFeeBlockMsg] = useState(null);
  // True when the selected student had pending/overdue fees — even after the
  // dues are collected, their upgrade goes through admin approval (queued in
  // history) rather than upgrading immediately. Clean accounts upgrade directly.
  const [requiresApproval, setRequiresApproval] = useState(false);
  // True when the collect dialog was opened from the 12th pass-out flow — fees
  // cleared → auto-graduate instead of auto-upgrade.
  const [graduateAfterCollect, setGraduateAfterCollect] = useState(false);
  const [ledgerEntries, setLedgerEntries] = useState([]); // full ledger (all statuses)
  const [pendingEntries, setPendingEntries] = useState([]);
  const [duesLoading, setDuesLoading] = useState(false);

  // Upgradation fee dialog state (mirrors desktop UpgradationPage)
  const [upgFeeRecord, setUpgFeeRecord] = useState(null);
  const [showUpgFeeDialog, setShowUpgFeeDialog] = useState(false);
  const [upgFeeDate, setUpgFeeDate] = useState('');
  const [upgFeeMethod, setUpgFeeMethod] = useState('cash');
  const [upgFeeTxn, setUpgFeeTxn] = useState('');
  const [upgFeeRemarks, setUpgFeeRemarks] = useState('');
  const [upgFeePartial, setUpgFeePartial] = useState('');
  const [upgFeeSplitCash, setUpgFeeSplitCash] = useState('');
  const [upgFeeSplitOnline, setUpgFeeSplitOnline] = useState('');
  const [upgFeeProcessing, setUpgFeeProcessing] = useState(false);

  const upgradingRef = useRef(false);
  const searchTimer = useRef(null);

  const { preview, openPreview, close: closePreview } = useReceipt();

  // Default the destination ("promote to") year to the year *after* the viewed
  // session — not the live clock — so promotions target the correct year for
  // whichever session is selected. Overridden per-student on selection.
  useEffect(() => {
    if (selected) return;
    const m = /^(\d{4})-(\d{4})$/.exec(viewSession || '');
    if (m) {
      const start = parseInt(m[1], 10);
      setToAY(`${start + 1}-${start + 2}`);
    }
  }, [viewSession, selected]);

  // Refresh the dues tables (full ledger + pending) for the selected student.
  const refreshDues = useCallback(async (studentId) => {
    try {
      const res = await api.get(`/fees/ledger/${studentId}`);
      const ledger = res.data?.ledger || {};
      const all = [...(ledger.one_time || []), ...(ledger.yearly || []), ...(ledger.monthly || [])];
      setLedgerEntries(all);
      setPendingEntries(all.filter(e => e.status === 'pending' || e.status === 'overdue'));
    } catch { /* non-fatal */ }
  }, []);

  // Debounced search. /students search matches parents too — narrow to
  // student name / admission so the picker doesn't surface unrelated people.
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

    if (s.fee_status === 'pending' || s.fee_status === 'overdue') {
      const yr = s.academic_year || 'current year';
      setFeeBlockMsg(`Fees for ${yr} are ${s.fee_status}.`);
      setRequiresApproval(true);   // had dues → upgrade goes through approval
      setLedgerEntries([]);
      setPendingEntries([]);
      setDuesLoading(true);
      refreshDues(s.student_id).finally(() => setDuesLoading(false));
    } else {
      setFeeBlockMsg(null);
      setRequiresApproval(false);  // clean account → direct upgrade
      setLedgerEntries([]);
      setPendingEntries([]);
    }

    // Auto-advance academic year from the student's current year.
    if (s.academic_year && /^\d{4}-\d{4}$/.test(s.academic_year)) {
      const startYear = parseInt(s.academic_year.split('-')[0], 10);
      setToAY(`${startYear + 1}-${startYear + 2}`);
    }

    // Auto-pick the next class.
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
    setRequiresApproval(false);
    setLedgerEntries([]);
    setPendingEntries([]);
    setResult(null);
  };

  const sectionOptions = useMemo(() => {
    if (!toClass) return [];
    if (isStreamClass(toClass)) return STREAM_SECTIONS;
    return classes.find(c => c.name === toClass)?.sections || [];
  }, [classes, toClass]);

  const eligibleClasses = useMemo(() => {
    const active = (classes || []).filter(c => c.is_active);
    if (!selected) return active;
    const idx = active.findIndex(c => c.name === selected.class_name);
    return idx >= 0 ? active.slice(idx + 1) : active;
  }, [classes, selected]);

  const doUpgrade = async (opts = {}) => {
    if (!selected || !toClass || !toSection) {
      toast.error('Select target class and section');
      return;
    }
    const effectiveStream = isStreamClass(toClass) ? (toStream || (toSection || '').toLowerCase()) : toStream;
    if (isStreamClass(toClass) && !effectiveStream) {
      toast.error(`Stream is required for ${toClass}`);
      return;
    }
    if (upgradingRef.current) return;
    upgradingRef.current = true;
    setUpgrading(true);
    try {
      // force_upgrade=false lets the backend auto-approve when there are no
      // dues; =true queues the request for admin approval (used when the
      // student had dues).
      const forceUpgrade = typeof opts.forceUpgrade === 'boolean' ? opts.forceUpgrade : false;
      const r = await api.post(`/students/${selected.student_id}/upgrade`, {
        to_class: toClass,
        to_section: toSection,
        to_stream: effectiveStream || null,
        academic_year: toAY,
        notes,
        force_upgrade: forceUpgrade,
      });
      toast.success(r.data.message || (r.data.auto_approved
        ? 'Student upgraded.'
        : 'Upgrade request sent to History for approval.'));
      invalidatePrefix('m-upgradation:');
      resetSelection();
    } catch (e) {
      const detail = e.response?.data?.detail || '';
      const isFeeBlock = e.response?.status === 400 && detail.toLowerCase().includes('fees pending');
      if (isFeeBlock) setFeeBlockMsg(detail);
      else if (!e._handled) toast.error(detail || 'Upgrade failed');
    } finally {
      upgradingRef.current = false;
      setUpgrading(false);
    }
  };

  const doGraduate = async () => {
    if (!selected || graduating) return;
    setGraduating(true);
    try {
      const r = await api.post(`/students/${selected.student_id}/graduate`, { remarks: notes });
      toast.success(r.data.message || 'Student marked as passed out');
      setResult({ graduated: true, message: r.data.message });
    } catch (e) { if (!e._handled) toast.error(e.response?.data?.detail || 'Pass out failed'); }
    finally { setGraduating(false); }
  };

  // "Collect Fee & Upgrade" — same as desktop initUpgFeePayment.
  // Creates the fee entry, then opens the UpgFee dialog if a fee is configured.
  const initUpgFeePayment = async () => {
    if (!selected || !toClass || !toSection) {
      toast.error('Select target class and section first');
      return;
    }
    const effectiveStream = isStreamClass(toClass) ? (toStream || (toSection || '').toLowerCase()) : toStream;
    setUpgrading(true);
    try {
      const res = await api.post(`/students/${selected.student_id}/upgrade/create-fee-entry`, {
        to_class: toClass,
        to_section: toSection,
        to_stream: effectiveStream || null,
        academic_year: toAY,
      });
      if (!res.data.ledger_id) {
        // No fee configured — upgrade directly
        doUpgrade({ forceUpgrade: false });
        return;
      }
      setUpgFeeRecord({ ...res.data, auto_upgrade: true });
      setUpgFeeDate(new Date().toISOString().slice(0, 10));
      setUpgFeeMethod('cash');
      setUpgFeeTxn('');
      setUpgFeeRemarks('');
      setUpgFeePartial(String(res.data.upgradation_fee));
      setUpgFeeSplitCash('');
      setUpgFeeSplitOnline('');
      setShowUpgFeeDialog(true);
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to load fee details');
    } finally {
      setUpgrading(false);
    }
  };

  // Submit the upgradation fee payment, then auto-upgrade.
  const submitUpgFeePayment = async () => {
    if (!upgFeeRecord) return;
    const effectiveStream = isStreamClass(toClass) ? (toStream || (toSection || '').toLowerCase()) : toStream;
    const partial = parseFloat(upgFeePartial);
    const payload = {
      student_id: upgFeeRecord.student_id || selected?.student_id,
      ledger_ids: [upgFeeRecord.ledger_id],
      payment_method: upgFeeMethod,
      payment_date: upgFeeDate || undefined,
      transaction_id: upgFeeTxn || undefined,
      remarks: upgFeeRemarks || undefined,
    };
    if (upgFeePartial && partial > 0) payload.amount = partial;
    if (upgFeeMethod === 'split') {
      const cash = parseFloat(upgFeeSplitCash) || 0;
      const online = parseFloat(upgFeeSplitOnline) || 0;
      if (cash <= 0 && online <= 0) { toast.error('Enter at least one split amount'); return; }
      payload.split_payments = { cash, online };
      payload.amount = cash + online;
    }
    setUpgFeeProcessing(true);
    try {
      const payRes = await api.post('/fees/pay', payload);
      toast.success(payRes.data.message || 'Fee collected');
      setShowUpgFeeDialog(false);

      if (upgFeeRecord.auto_upgrade !== false) {
        const upRes = await api.post(`/students/${payload.student_id}/upgrade`, {
          to_class: toClass,
          to_section: toSection,
          to_stream: effectiveStream || null,
          academic_year: toAY,
          notes,
          upgradation_fee_pre_paid: true,
        });
        toast.success(upRes.data.message || 'Student upgraded successfully');
        invalidatePrefix('m-upgradation:');
        resetSelection();
      }
      setUpgFeeRecord(null);
      if (payRes.data.payment?.payment_id) {
        openPreview(payRes.data.payment.payment_id, payRes.data.receipt_number, upgFeeRecord.ledger_id);
      }
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Payment or upgrade failed');
    } finally {
      setUpgFeeProcessing(false);
    }
  };

  // After collecting dues: show receipt, refresh the student + dues. When dues
  // clear, drop the approval requirement and auto-upgrade (or prompt to pick a
  // target). Mirrors desktop UpgradationPage.payPendingFees.
  const onCollected = useCallback(async ({ paymentId, receiptNumber, ledgerId, student }) => {
    openPreview(paymentId, receiptNumber, ledgerId);
    if (!student) return;
    await refreshDues(student.student_id);
    try {
      const sr = await api.get(`/students/${student.student_id}`);
      const updated = sr.data;
      setSelected(updated);
      if (updated.fee_status === 'paid') {
        setFeeBlockMsg(null);
        setRequiresApproval(false);
        if (graduateAfterCollect) {
          // 12th pass-out flow: fees cleared → graduate immediately
          setGraduateAfterCollect(false);
          toast.success('Fees cleared — marking student as passed out.');
          doGraduate();
        } else if (toClass && toSection) {
          toast.success('Fees cleared — upgrading student.');
          doUpgrade({ forceUpgrade: false });
        } else {
          toast.success('All fees cleared. Pick the target class & section, then Confirm Upgrade.', { duration: 6000 });
        }
      }
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPreview, refreshDues, graduateAfterCollect, toClass, toSection]);

  const collect = useCollectFlow(onCollected);

  const totalPending = pendingEntries.reduce((s, e) => s + remainingOf(e), 0);

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
              {' · Admission no: '}{selected.admission_number || '—'}
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
            <div style={{marginBottom:10}}>
              <div style={{padding:'8px 10px',background:'#fee2e2',border:'1px solid #fecaca',borderRadius:8,fontSize:11,color:'#dc2626',marginBottom:8}}>
                ⚠ Student has {selected.fee_status} fees — collect dues first to complete pass out.
              </div>
              <button
                onClick={() => { setGraduateAfterCollect(true); collect.open(selected); }}
                className="m-btn"
                style={{width:'100%',background:'#1A1A1A',color:'#FFF',padding:'10px 14px'}}
                data-testid="m-upg-collect-dues-passout"
              >
                <CreditCard size={14} /> Collect Dues &amp; Pass Out
              </button>
            </div>
          )}
          <div style={{marginBottom:10}}>
            <label style={formLabel}>Remarks (optional)</label>
            <input className="m-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Passed Class 12 Board 2027" />
          </div>
          <button onClick={doGraduate}
            disabled={graduating || selected.fee_status === 'pending' || selected.fee_status === 'overdue'}
            className="m-btn"
            style={{
              width:'100%',
              background: (selected.fee_status === 'pending' || selected.fee_status === 'overdue') ? '#9ca3af' : '#16a34a',
              color:'#FFF',padding:14,
              cursor: (selected.fee_status === 'pending' || selected.fee_status === 'overdue') ? 'not-allowed' : 'pointer',
            }}
            data-testid="m-upg-graduate">
            {graduating ? <Loader2 size={14} className="animate-spin" /> : null} Mark as Passed Out
          </button>
        </div>
      )}

      {/* Fee blocked banner with full dues ledger (per-fee status + receipt) */}
      {selected && selected.class_name !== '12th' && feeBlockMsg && (
        <div style={{background:'#fee2e2',border:'1px solid #fecaca',borderRadius:14,padding:14,marginBottom:12}}>
          <p style={{fontSize:13,fontWeight:700,color:'#dc2626',marginBottom:6}}>⚠ Cannot Upgrade — Fees Pending</p>
          <p style={{fontSize:11,color:'#991b1b',marginBottom:10}}>{feeBlockMsg}</p>
          {duesLoading ? (
            <div style={{display:'flex',alignItems:'center',gap:6,color:'#991b1b',fontSize:12}}>
              <Loader2 size={14} className="animate-spin" /> Loading pending dues…
            </div>
          ) : ledgerEntries.length > 0 ? (
            <div style={{background:'#FFF',border:'1px solid #fecaca',borderRadius:10,overflow:'hidden'}}>
              {ledgerEntries.map(e => {
                const isPaid = e.status === 'paid';
                const paid = Number(e.amount_paid || 0);
                const isPartial = !isPaid && paid > 0 && remainingOf(e) > 0;
                const badge = isPaid ? { bg:'#dcfce7', color:'#15803d', label:'paid' }
                  : isPartial ? { bg:'#dbeafe', color:'#1d4ed8', label:'partially paid' }
                  : e.status === 'overdue' ? { bg:'#fee2e2', color:'#dc2626', label:'overdue' }
                  : { bg:'#fef3c7', color:'#a16207', label:'pending' };
                return (
                  <div key={e.ledger_id} style={{padding:10,borderBottom:'1px solid #fef2f2',display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
                    <div style={{minWidth:0,flex:1}}>
                      <p style={{fontSize:12,fontWeight:600,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{(e.description || e.fee_component || '').replace(' (seeded due)', '')}</p>
                      <p style={{fontSize:10,color:'#888',marginTop:2}}>
                        Due {e.due_date || '—'} ·
                        <span style={{marginLeft:4,padding:'1px 6px',borderRadius:5,fontWeight:700,background:badge.bg,color:badge.color}}>{badge.label}</span>
                      </p>
                      {isPartial && (
                        <p style={{fontSize:10,color:'#64748b',marginTop:2}}>Paid Rs.{fmt(paid)} · Bal Rs.{fmt(remainingOf(e))}</p>
                      )}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                      <p style={{fontSize:13,fontWeight:800,color:'#dc2626'}}>Rs.{fmt(e.net_amount)}</p>
                      {e.payment_id && (
                        <button onClick={() => openPreview(e.payment_id, e.receipt_number, e.ledger_id)}
                          title="View / download receipt"
                          style={{background:'none',border:'none',padding:4,cursor:'pointer',color:'#64748b'}}>
                          <Download size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div style={{padding:10,background:'#fef2f2',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,fontWeight:700,color:'#991b1b'}}>Total Pending</span>
                <span style={{fontSize:14,fontWeight:800,color:'#dc2626'}}>Rs.{fmt(totalPending)}</span>
              </div>
            </div>
          ) : null}
          <button onClick={() => collect.open(selected)}
            style={{marginTop:10,width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'12px 14px',borderRadius:12,background:'#dc2626',border:'none',color:'#FFF',fontSize:13,fontWeight:700,cursor:'pointer'}}
            data-testid="m-upg-collect-fee">
            <CreditCard size={14} /> Collect
          </button>
        </div>
      )}

      {collect.show && <CollectFeeSheet flow={collect} payMethods={payMethods} />}
      <ReceiptPreviewSheet preview={preview} onClose={closePreview} />

      {/* Upgradation Fee Payment Sheet */}
      {showUpgFeeDialog && upgFeeRecord && (
        <div onClick={() => !upgFeeProcessing && setShowUpgFeeDialog(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:250,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
          <div onClick={(e) => e.stopPropagation()}
            style={{background:'#FFF',width:'100%',maxWidth:520,borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:'90dvh',display:'flex',flexDirection:'column',paddingBottom:'env(safe-area-inset-bottom, 0)'}}>
            <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
              <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
            </div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0'}}>
              <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>Collect Payment</h2>
              <button onClick={() => setShowUpgFeeDialog(false)} style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888'}}><X size={20} /></button>
            </div>
            <div style={{padding:16,overflowY:'auto',flex:1}}>
              <p style={{fontSize:13,color:'#666',marginBottom:14}}>
                Upgradation fee: <strong>Rs.{fmt(upgFeeRecord.upgradation_fee)}</strong>
              </p>
              <div style={{marginBottom:12}}>
                <label style={formLabel}>Payment Date</label>
                <input className="m-input" type="date" lang="en-IN" value={upgFeeDate} onChange={(e) => setUpgFeeDate(e.target.value)} />
              </div>
              {upgFeeMethod !== 'split' && (
                <div style={{marginBottom:12}}>
                  <label style={formLabel}>Amount to collect <span style={{fontWeight:400,textTransform:'none'}}>(blank = full)</span></label>
                  <input className="m-input" type="number" min="0" step="0.01"
                    placeholder={`Full: Rs.${fmt(upgFeeRecord.upgradation_fee)}`}
                    value={upgFeePartial} onChange={(e) => setUpgFeePartial(e.target.value)} />
                  <p style={{fontSize:10,color:'#aaa',marginTop:4}}>Enter a smaller amount to record a partial payment.</p>
                </div>
              )}
              <div style={{marginBottom:12}}>
                <label style={formLabel}>Payment Method</label>
                <select className="m-input" value={upgFeeMethod} onChange={(e) => setUpgFeeMethod(e.target.value)}>
                  {payMethods.filter(m => m.value !== 'pos_terminal').map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              {upgFeeMethod === 'split' && (
                <>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,padding:10,background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:10,marginBottom:8}}>
                    <div>
                      <label style={formLabel}>Cash</label>
                      <input className="m-input" type="number" min="0" step="0.01" value={upgFeeSplitCash} onChange={(e) => setUpgFeeSplitCash(e.target.value)} placeholder="0" />
                    </div>
                    <div>
                      <label style={formLabel}>Online</label>
                      <input className="m-input" type="number" min="0" step="0.01" value={upgFeeSplitOnline} onChange={(e) => setUpgFeeSplitOnline(e.target.value)} placeholder="0" />
                    </div>
                    <p style={{gridColumn:'1 / span 2',fontSize:10,color:'#888',margin:0}}>Cash + Online must equal the total amount.</p>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',background:'#F8F8F8',borderRadius:10,marginBottom:12}}>
                    <span style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#666'}}>Amount to collect</span>
                    <span style={{fontSize:15,fontWeight:800,color:'#1A1A1A'}}>Rs.{fmt((parseFloat(upgFeeSplitCash) || 0) + (parseFloat(upgFeeSplitOnline) || 0))}</span>
                  </div>
                </>
              )}
              {upgFeeMethod !== 'cash' && upgFeeMethod !== 'split' && (
                <div style={{marginBottom:12}}>
                  <label style={formLabel}>Transaction ID / Ref No.</label>
                  <input className="m-input" value={upgFeeTxn} onChange={(e) => setUpgFeeTxn(e.target.value)} placeholder="UTR / Cheque no." />
                </div>
              )}
              <div style={{marginBottom:12}}>
                <label style={formLabel}>Remarks</label>
                <input className="m-input" value={upgFeeRemarks} onChange={(e) => setUpgFeeRemarks(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div style={{display:'flex',gap:8,padding:12,borderTop:'1px solid #F0F0F0'}}>
              <button onClick={() => setShowUpgFeeDialog(false)} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
              <button onClick={submitUpgFeePayment} disabled={upgFeeProcessing}
                className="m-btn" style={{flex:1,background:'#E88A1A',color:'#FFF',borderColor:'#E88A1A'}}>
                {upgFeeProcessing ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                {upgFeeRecord?.auto_upgrade === false ? 'Collect Fee' : 'Collect & Upgrade'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Target class form — shown for any non-12th student (even when fees are
          pending, so the admin can Send for Approval to upgrade later). */}
      {selected && selected.class_name !== '12th' && (
        <div style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:14,marginBottom:12,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
          <p className="m-section" style={{margin:'0 0 10px'}}>Step 2 — Target Class & Year</p>
          {feeBlockMsg && (
            <p style={{fontSize:11,color:'#b45309',marginBottom:10,lineHeight:1.5}}>
              Collect the fee above to upgrade now — or tap <strong>Send for Approval</strong> to upgrade later: the request waits in History until an admin approves it.
            </p>
          )}
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
              <select
                className="m-input"
                value={toSection}
                onChange={(e) => {
                  const v = e.target.value;
                  setToSection(v);
                  if (isStreamClass(toClass)) setToStream(v.toLowerCase());
                }}
                disabled={!toClass}
              >
                <option value="">Select</option>
                {sectionOptions.map(s => (
                  <option key={s.section_name} value={s.section_name}>
                    {isStreamClass(toClass) ? s.section_name : `${s.section_name} (cap ${s.capacity || 40})`}
                  </option>
                ))}
              </select>
            </div>
          </div>
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
          <button onClick={initUpgFeePayment} disabled={upgrading}
            className="m-btn m-btn-primary"
            style={{width:'100%',padding:14,marginBottom:8,background:'#E88A1A',borderColor:'#E88A1A'}}
            data-testid="m-upg-collect-fee-upgrade">
            {upgrading ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
            Collect Fee &amp; Upgrade
          </button>
          <button onClick={() => doUpgrade({ forceUpgrade: true })} disabled={upgrading}
            className="m-btn m-btn-outline"
            style={{width:'100%',padding:12}}
            data-testid="m-upg-send-approval">
            Send for Approval (skip fee)
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

const HistoryTab = ({ isAdmin, payMethods }) => {
  const [year, setYear] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [viewRow, setViewRow] = useState(null);
  const [page, setPage] = useState(1);
  // upg_id -> {paymentId, receiptNumber, ledgerId} for the just-collected fee.
  const [collectedReceipts, setCollectedReceipts] = useState({});

  const { preview, openPreview, close: closePreview } = useReceipt();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = year ? { academic_year: year } : {};
      const r = await api.get('/upgradation/history', { params });
      setHistory(Array.isArray(r.data) ? r.data : []);
      setPage(1);
    } catch (e) { if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to load history'); }
    finally { setLoading(false); }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const onCollected = useCallback(async ({ paymentId, receiptNumber, ledgerId, rowId }) => {
    openPreview(paymentId, receiptNumber, ledgerId);
    if (rowId && paymentId) {
      setCollectedReceipts(prev => ({ ...prev, [rowId]: { paymentId, receiptNumber, ledgerId } }));
    }
    load();
  }, [openPreview, load]);

  const collect = useCollectFlow(onCollected);

  // Pre-create the upgradation fee ledger entry (if not already present) before
  // opening the collect dialog — mirrors desktop openHistoryCollectDialog.
  const openHistoryCollect = useCallback(async (row) => {
    try {
      await api.post(`/students/${row.student_id}/upgrade/create-fee-entry`, {
        to_class: row.to_class,
        to_section: row.to_section,
        to_stream: row.to_stream || null,
        academic_year: row.academic_year,
      });
    } catch { /* non-fatal — entry may already exist */ }
    collect.open(
      { student_id: row.student_id, first_name: row.student_name, last_name: '' },
      row.upgradation_id,
    );
  }, [collect]);

  const approve = async (id) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const r = await api.post(`/upgradation/${id}/approve`);
      toast.success(r.data.message || 'Approved');
      load();
    } catch (e) { if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to approve'); }
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
    } catch (e) { if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to reject'); }
    finally { setBusyId(null); }
  };

  const totalPages = Math.ceil(history.length / HISTORY_PAGE_SIZE);
  const pageRows = history.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);

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
        <>
        {pageRows.map(r => {
          const status = r.status || 'pending_approval';
          const isPending = status === 'pending_approval';
          const feePaid = r.upgradation_fee_status === 'paid' || r.upgradation_fee_paid;
          const receiptAvailable = collectedReceipts[r.upgradation_id] || r.upgradation_fee_payment_id;
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
                <span style={{color:'#666'}}>{fmtClassSec(r.from_class, r.from_section, r.from_stream)}</span>
                <ArrowUpCircle size={12} color="#E88A1A" />
                <span style={{fontWeight:700}}>{fmtClassSec(r.to_class, r.to_section, r.to_stream)}</span>
              </div>

              {/* Fee status line: dues badge while pending approval, else
                  upgradation-fee status. Mirrors desktop. */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  {isPending ? (
                    r.student_dues_total > 0 ? (
                      <span style={{padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,background:'#fee2e2',color:'#dc2626'}}>
                        Dues Rs.{fmt(r.student_dues_total)}
                      </span>
                    ) : (
                      <span style={{padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,background:'#dcfce7',color:'#15803d'}}>No dues</span>
                    )
                  ) : r.upgradation_fee > 0 ? (
                    <>
                      <span style={{fontSize:11,color:'#666'}}>Fee Rs.{fmt(r.upgradation_fee)}</span>
                      <span style={{
                        padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,
                        background: feePaid ? '#dcfce7' : '#fef3c7',
                        color: feePaid ? '#15803d' : '#a16207',
                      }}>
                        {feePaid ? 'Paid' : 'Pending'}
                      </span>
                    </>
                  ) : null}
                </div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
                  {isAdmin && isPending && (r.student_dues_total > 0 || (r.upgradation_fee > 0 && !feePaid)) && (
                    <button onClick={() => openHistoryCollect(r)}
                      style={{padding:'6px 10px',borderRadius:8,background:'#1A1A1A',border:'none',color:'#FFF',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}
                      data-testid={`m-upg-collect-${r.upgradation_id}`}>
                      <CreditCard size={12} /> Collect
                    </button>
                  )}
                  {isAdmin && isPending && (
                    <>
                      {(() => {
                        const feeUnpaid = r.upgradation_fee > 0 && !feePaid;
                        return (
                          <button onClick={() => approve(r.upgradation_id)}
                            disabled={busyId === r.upgradation_id || feeUnpaid}
                            title={feeUnpaid ? `Collect Rs.${fmt(r.upgradation_fee)} upgradation fee first` : 'Approve upgrade'}
                            style={{
                              padding:'6px 10px',borderRadius:8,fontSize:11,fontWeight:700,
                              display:'flex',alignItems:'center',gap:4,cursor: feeUnpaid ? 'not-allowed' : 'pointer',
                              background: feeUnpaid ? '#F8F8F8' : '#dcfce7',
                              border: feeUnpaid ? '1px solid #E5E5E5' : '1px solid #bbf7d0',
                              color: feeUnpaid ? '#aaa' : '#15803d',
                              opacity: feeUnpaid ? 0.6 : 1,
                            }}
                            data-testid={`m-upg-approve-${r.upgradation_id}`}>
                            {busyId === r.upgradation_id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
                          </button>
                        );
                      })()}
                      <button onClick={() => { setRejectFor(r.upgradation_id); setRejectReason(''); }} disabled={busyId === r.upgradation_id}
                        style={{padding:'6px 10px',borderRadius:8,background:'#fee2e2',border:'1px solid #fecaca',color:'#dc2626',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}
                        data-testid={`m-upg-reject-${r.upgradation_id}`}>
                        <X size={12} /> Reject
                      </button>
                    </>
                  )}
                  {receiptAvailable && (
                    <button onClick={() => {
                        const c = collectedReceipts[r.upgradation_id];
                        if (c) openPreview(c.paymentId, c.receiptNumber, c.ledgerId);
                        else openPreview(r.upgradation_fee_payment_id, r.upgradation_fee_receipt, r.upgradation_fee_ledger_id);
                      }}
                      title="View / download receipt"
                      style={{padding:'6px 10px',borderRadius:8,background:'#FFF',border:'1px solid #E5E5E5',color:'#1A1A1A',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}>
                      <Download size={12} /> Receipt
                    </button>
                  )}
                  <button onClick={() => setViewRow(r)}
                    style={{padding:'6px 10px',borderRadius:8,background:'#FFF',border:'1px solid #E5E5E5',color:'#1A1A1A',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}>
                    <Eye size={12} /> View
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {history.length > HISTORY_PAGE_SIZE && (
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,paddingTop:4}}>
            <span style={{fontSize:11,color:'#888'}}>
              {(page - 1) * HISTORY_PAGE_SIZE + 1}–{Math.min(page * HISTORY_PAGE_SIZE, history.length)} of {history.length}
            </span>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <button className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}} disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
              <span style={{fontSize:11,color:'#666'}}>Page {page} / {totalPages}</span>
              <button className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}} disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
            </div>
          </div>
        )}
        </>
      )}

      {collect.show && <CollectFeeSheet flow={collect} payMethods={payMethods} />}
      <ReceiptPreviewSheet preview={preview} onClose={closePreview} />

      {rejectFor && (
        <ConfirmReject
          reason={rejectReason}
          setReason={setRejectReason}
          onCancel={() => { setRejectFor(null); setRejectReason(''); }}
          onConfirm={reject}
          busy={busyId === rejectFor}
        />
      )}

      {viewRow && <ViewSheet row={viewRow} onClose={() => setViewRow(null)} openPreview={openPreview} />}
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

// Collect Pending Fees — select fees (with select-all/clear), partial amount,
// and split (cash + online) payment. Mirrors desktop UpgradationPage dialog.
const CollectFeeSheet = ({ flow, payMethods }) => {
  const {
    student, rowId, entries, ids, setIds, method, setMethod, txn, setTxn,
    partial, setPartial, splitCash, setSplitCash, splitOnline, setSplitOnline,
    paying, loading, close, pay,
  } = flow;

  // When opened from a history row, the upgradation fee is mandatory — lock it.
  const mandatoryIds = rowId
    ? entries.filter(e => e.fee_component === 'upgradation').map(e => e.ledger_id)
    : [];
  const isMandatory = (id) => mandatoryIds.includes(id);

  const toggle = (id) => {
    if (isMandatory(id)) return;
    setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const selectedRemaining = entries
    .filter(e => ids.includes(e.ledger_id))
    .reduce((s, e) => s + remainingOf(e), 0);

  return (
    <Sheet title="Collect Pending Fees" onClose={close}>
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
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
            <span style={{fontSize:11,color:'#888'}}>Select the fees to collect</span>
            <div style={{display:'flex',gap:12,fontSize:11}}>
              <button type="button" onClick={() => setIds(entries.map(e => e.ledger_id))}
                style={{color:'#E88A1A',fontWeight:700,background:'none',border:'none',cursor:'pointer',padding:0}}>Select all</button>
              <button type="button" onClick={() => setIds(mandatoryIds)}
                style={{color:'#888',fontWeight:700,background:'none',border:'none',cursor:'pointer',padding:0}}>Clear</button>
            </div>
          </div>

          <div style={{border:'1px solid #E5E5E5',borderRadius:10,overflow:'hidden',marginBottom:10,maxHeight:220,overflowY:'auto'}}>
            {entries.map(e => {
              const paid = Number(e.amount_paid || 0);
              const mandatory = isMandatory(e.ledger_id);
              const checked = ids.includes(e.ledger_id);
              return (
                <div key={e.ledger_id}
                  onClick={() => toggle(e.ledger_id)}
                  style={{
                    display:'flex',alignItems:'center',gap:10,padding:10,borderBottom:'1px solid #F5F5F5',
                    cursor: mandatory ? 'default' : 'pointer',
                    background: mandatory ? '#fff7ed' : undefined,
                  }}>
                  {/* Custom checkbox: white tick on orange/grey background */}
                  <div style={{
                    width:18,height:18,borderRadius:4,flexShrink:0,
                    background: checked ? '#E88A1A' : '#FFF',
                    border: checked ? 'none' : '2px solid #D1D5DB',
                    display:'flex',alignItems:'center',justifyContent:'center',
                    opacity: mandatory && !checked ? 0.4 : 1,
                  }}>
                    {checked && <Check size={12} color="#FFF" strokeWidth={3} />}
                  </div>
                  <div style={{minWidth:0,flex:1}}>
                    <p style={{fontSize:12,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                      {(e.description || e.fee_component || '').replace(' (seeded due)', '')}
                      {mandatory && <span style={{marginLeft:6,fontSize:10,fontWeight:700,color:'#E88A1A',textTransform:'uppercase',letterSpacing:'0.05em'}}>Required</span>}
                    </p>
                    {paid > 0 ? (
                      <p style={{fontSize:10,color:'#a16207'}}>Paid Rs.{fmt(paid)} of Rs.{fmt(e.net_amount)}</p>
                    ) : (
                      <p style={{fontSize:10,color:'#888'}}>Due {e.due_date || '—'} · <span style={{textTransform:'capitalize'}}>{e.status}</span></p>
                    )}
                  </div>
                  <p style={{fontSize:13,fontWeight:800,color:'#1A1A1A',flexShrink:0}}>Rs.{fmt(remainingOf(e))}</p>
                </div>
              );
            })}
          </div>

          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',background:'#F8F8F8',borderRadius:10,marginBottom:12}}>
            <span style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#666'}}>Total to collect</span>
            <span style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>Rs.{fmt(selectedRemaining)}</span>
          </div>

          {ids.length >= 1 && method !== 'split' && (
            <div style={{marginBottom:10}}>
              <label style={formLabel}>Amount to collect <span style={{color:'#aaa',fontWeight:400,textTransform:'none'}}>(blank = full)</span></label>
              <input
                className="m-input" type="number" min="0" step="0.01" max={selectedRemaining}
                placeholder={`Full: Rs.${fmt(selectedRemaining)}`}
                value={partial}
                onChange={(e) => setPartial(e.target.value)}
              />
              <p style={{fontSize:10,color:'#aaa',marginTop:4}}>
                Leave blank to collect the full Rs.{fmt(selectedRemaining)}. Enter a smaller amount to record a partial payment{ids.length > 1 ? ' (applied oldest fee first)' : ''}.
              </p>
            </div>
          )}

          <div style={{marginBottom:10}}>
            <label style={formLabel}>Payment Method</label>
            <select className="m-input" value={method} onChange={(e) => setMethod(e.target.value)}>
              {payMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {method === 'split' && (
            <>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,padding:10,border:'1px solid #fed7aa',background:'#fff7ed',borderRadius:10,marginBottom:8}}>
                <div>
                  <label style={formLabel}>Cash</label>
                  <input className="m-input" type="number" min={0} step="0.01" value={splitCash} onChange={(e) => setSplitCash(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label style={formLabel}>Online</label>
                  <input className="m-input" type="number" min={0} step="0.01" value={splitOnline} onChange={(e) => setSplitOnline(e.target.value)} placeholder="0" />
                </div>
                <p style={{gridColumn:'1 / span 2',fontSize:10,color:'#888',margin:0}}>Cash + Online must equal the amount being collected.</p>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',background:'#F8F8F8',borderRadius:10,marginBottom:10}}>
                <span style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#666'}}>Amount to collect</span>
                <span style={{fontSize:15,fontWeight:800,color:'#1A1A1A'}}>Rs.{fmt((parseFloat(splitCash) || 0) + (parseFloat(splitOnline) || 0))}</span>
              </div>
            </>
          )}

          {method !== 'cash' && method !== 'split' && (
            <div style={{marginBottom:10}}>
              <label style={formLabel}>Transaction ID</label>
              <input className="m-input" value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="UTR / cheque no." />
            </div>
          )}
        </>
      )}

      <div style={{display:'flex',gap:8,marginTop:12}}>
        <button onClick={close} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
        {!loading && entries.length > 0 && (
          <button onClick={pay} disabled={paying || !ids.length}
            className="m-btn"
            style={{flex:1,background:'#E88A1A',color:'#FFF'}}
            data-testid="m-upg-collect-confirm">
            {paying ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
            Collect {method === 'split'
              ? `Rs.${fmt((parseFloat(splitCash) || 0) + (parseFloat(splitOnline) || 0))}`
              : `Rs.${fmt(partial && parseFloat(partial) > 0 ? parseFloat(partial) : selectedRemaining)}`}
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

// View details + per-payment timeline (partial payments generate multiple
// receipts on the same upgradation_fee_ledger_id). Mirrors desktop.
const ViewSheet = ({ row, onClose, openPreview }) => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ledgerId = row?.upgradation_fee_ledger_id;
    if (!row?.student_id || !ledgerId) { setPayments([]); return; }
    let active = true;
    setLoading(true);
    api.get('/fees/payments', { params: { student_id: row.student_id } })
      .then(res => {
        if (!active) return;
        const all = Array.isArray(res.data) ? res.data : [];
        const filtered = all.filter(p => (p.installment_ids || []).includes(ledgerId));
        filtered.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
        setPayments(filtered);
      })
      .catch(() => { if (active) setPayments([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [row]);

  return (
    <Sheet title="Upgradation Details" onClose={onClose}>
      <DetailRow label="Student" value={row.student_name || row.student_id} />
      <DetailRow label="Admission" value={row.admission_number} mono />
      <DetailRow label="Academic Year" value={row.academic_year} />
      <DetailRow label="From" value={fmtClassSec(row.from_class, row.from_section, row.from_stream)} />
      <DetailRow label="To" value={fmtClassSec(row.to_class, row.to_section, row.to_stream)} />
      {row.upgradation_fee > 0 && <DetailRow label="Upgradation Fee" value={`Rs.${fmt(row.upgradation_fee)}`} />}
      <DetailRow label="Submitted" value={isoToDisplay(row.created_at)} />
      <DetailRow label="Status" value={(row.status || 'pending_approval').replace('_', ' ')} />
      {row.notes && <DetailRow label="Notes" value={row.notes} />}
      {row.reject_reason && <DetailRow label="Reject Reason" value={row.reject_reason} accent="#dc2626" />}

      {row.upgradation_fee > 0 && (
        <div style={{marginTop:14,paddingTop:12,borderTop:'1px solid #F0F0F0'}}>
          <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',marginBottom:8}}>Payment History</p>
          {loading ? (
            <p style={{fontSize:11,color:'#888',display:'flex',alignItems:'center',gap:6}}><Loader2 size={12} className="animate-spin" /> Loading…</p>
          ) : payments.length === 0 ? (
            <p style={{fontSize:11,color:'#888'}}>No payments recorded yet.</p>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {payments.map(p => (
                <div key={p.payment_id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'8px 10px',background:'#F8F8F8',border:'1px solid #F0F0F0',borderRadius:8}}>
                  <div style={{minWidth:0}}>
                    <p style={{fontSize:12,fontWeight:700,color:'#1A1A1A'}}>
                      Rs.{fmt(p.amount)} <span style={{fontWeight:400,color:'#888'}}>· {fmtPaymentMethod(p.payment_method)}</span>
                    </p>
                    <p style={{fontSize:10,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                      {isoToDisplay(p.payment_date || p.created_at)}{p.receipt_number ? ` · ${p.receipt_number}` : ''}
                    </p>
                  </div>
                  <button onClick={() => openPreview(p.payment_id, p.receipt_number)}
                    title="Preview / download receipt"
                    style={{background:'none',border:'none',padding:4,cursor:'pointer',color:'#64748b',flexShrink:0}}>
                    <Download size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
};

const DetailRow = ({ label, value, mono, accent }) => (
  <div style={{display:'flex',justifyContent:'space-between',gap:12,padding:'8px 0',borderBottom:'1px solid #F5F5F5'}}>
    <span style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888',flexShrink:0}}>{label}</span>
    <span style={{fontSize:13,fontWeight:600,color: accent || '#1A1A1A',fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,textAlign:'right',wordBreak:'break-word',minWidth:0,textTransform: accent ? 'none' : undefined}}>
      {value || '—'}
    </span>
  </div>
);
