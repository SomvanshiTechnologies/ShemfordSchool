import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSession } from '../../contexts/SessionContext';
import api from '../../lib/api';
import { getCached, setCached, invalidatePrefix } from '../../lib/pageCache';
import { previewReportInTab } from '../../lib/preview';
import { fetchPaymentMethods, PAYMENT_METHODS, fmtPaymentMethod } from '../../lib/paymentMethods';
import { toast } from 'sonner';
import {
  CreditCard, Search, X, Loader2, AlertTriangle, CheckCircle2, Clock,
  ChevronRight, ChevronDown, Edit2, Plus, TrendingUp, Download,
  ArrowLeft, Settings, FileText, Mail, RefreshCw, Receipt,
} from 'lucide-react';

// ─── Mobile Razorpay button ────────────────────────────────────────────────
// Self-contained: loads the Razorpay script, creates an order, opens the
// checkout modal, and verifies on the backend. Used by student fee view.
const MobileRazorpayButton = ({ studentId, ledgerIds, amount, onSuccess, style }) => {
  const [busy, setBusy] = useState(false);
  const orderRef = useRef(null);

  const loadScript = () => new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });

  // Cancel order on unmount if mid-payment
  useEffect(() => () => {
    if (orderRef.current) {
      api.post('/payments/razorpay/cancel', { internal_order_id: orderRef.current }).catch(() => {});
      orderRef.current = null;
    }
  }, []);

  const pay = async () => {
    if (busy || !ledgerIds.length) return;
    const ok = await loadScript();
    if (!ok) { toast.error('Failed to load payment module. Check your internet.'); return; }
    setBusy(true);
    let orderId = null;
    try {
      const { data: order } = await api.post('/payments/razorpay/create-order', {
        student_id: studentId, ledger_ids: ledgerIds,
      });
      orderId = order.internal_order_id;
      orderRef.current = orderId;
      api.post('/payments/razorpay/initiate', { internal_order_id: orderId }).catch(() => {});

      await new Promise((resolve, reject) => {
        const options = {
          key: order.key_id,
          amount: order.amount_paise,
          currency: order.currency,
          name: 'Shemford Futuristic School',
          description: order.description,
          image: '/logo.webp',
          order_id: order.rzp_order_id,
          prefill: { name: order.student_name, email: order.student_email, contact: order.student_phone },
          theme: { color: '#E88A1A' },
          handler: async (response) => {
            try {
              const { data: result } = await api.post('/payments/razorpay/verify', {
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
              });
              orderRef.current = null;
              toast.success(`Payment successful! Receipt: ${result.receipt_number}`);
              onSuccess?.(result);
              resolve(result);
            } catch (err) {
              const msg = err.response?.data?.detail || 'Payment verification failed.';
              toast.error(msg); reject(new Error(msg));
            }
          },
          modal: {
            ondismiss: async () => {
              try { await api.post('/payments/razorpay/cancel', { internal_order_id: orderId }); } catch (_) {}
              orderRef.current = null;
              resolve(null);
            },
            escape: false, backdropclose: false,
          },
        };
        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', async (response) => {
          try { await api.post('/payments/razorpay/cancel', { internal_order_id: orderId }); } catch (_) {}
          orderRef.current = null;
          toast.error(`Payment failed: ${response.error?.description || 'Unknown error'}`);
          reject(new Error('Payment failed'));
        });
        rzp.open();
      });
    } catch (err) {
      if (orderId) { api.post('/payments/razorpay/cancel', { internal_order_id: orderId }).catch(() => {}); orderRef.current = null; }
      if (!err._handled && !err.message?.includes('Payment failed')) {
        toast.error(err.response?.data?.detail || err.message || 'Payment could not be started.', { duration: 6000 });
      }
    } finally { setBusy(false); }
  };

  if (!process.env.REACT_APP_RAZORPAY_KEY_ID) return null;

  return (
    <button onClick={pay} disabled={busy || !ledgerIds.length}
      style={{
        display:'flex', alignItems:'center', justifyContent:'center', gap:8,
        width:'100%', padding:'14px', borderRadius:14, border:'none', cursor:'pointer',
        background:'#E88A1A', color:'#FFF', fontSize:15, fontWeight:800,
        boxShadow:'0 6px 20px rgba(232,138,26,0.35)',
        opacity: (busy || !ledgerIds.length) ? 0.6 : 1,
        ...style,
      }}>
      {busy ? <Loader2 size={18} className="animate-spin" /> : <CreditCard size={18} />}
      {busy ? 'Processing…' : `Pay Now — Rs.${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
    </button>
  );
};

// ─── Helpers ───────────────────────────────────────────────────────────────

const fmt = (n) => n != null ? `Rs.${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0 })}` : '—';

const CURRENT_YEAR = (() => {
  const now = new Date();
  return now.getMonth() >= 3 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;
})();
const ACADEMIC_YEARS = [
  CURRENT_YEAR,
  (() => { const [s] = CURRENT_YEAR.split('-'); return `${+s + 1}-${+s + 2}`; })(),
  (() => { const [s] = CURRENT_YEAR.split('-'); return `${+s - 1}-${+s}`; })(),
];

const REPORT_PAGE_SIZE = 20;
// Prev/Next pager for the report lists (client-side over the loaded rows).
const ReportPager = ({ page, total, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE));
  if (total <= REPORT_PAGE_SIZE) return null;
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'10px 4px 2px'}}>
      <span style={{fontSize:11,color:'#888'}}>{(page - 1) * REPORT_PAGE_SIZE + 1}–{Math.min(page * REPORT_PAGE_SIZE, total)} of {total}</span>
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        <button className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}} disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
        <span style={{fontSize:11,color:'#666'}}>{page}/{pages}</span>
        <button className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
};

const isoToDDMMYYYY = (iso) => {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const ddmmyyyyToIso = (str) => {
  if (!str) return '';
  const m = String(str).trim().match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  if (Number.isNaN(d.getTime()) || d.getDate() !== +dd || d.getMonth() + 1 !== +mm) return '';
  return `${yyyy}-${mm}-${dd}`;
};
const todayDDMMYYYY = () => isoToDDMMYYYY(new Date().toISOString().slice(0, 10));

const downloadReceipt = async (paymentId) => {
  if (!paymentId) return;
  try {
    const r = await api.get(`/fees/receipt/${paymentId}/pdf`, { responseType: 'blob' });
    const blob = r.data instanceof Blob ? r.data : new Blob([r.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipt-${paymentId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    toast.error('Failed to download receipt');
  }
};

const STATUS_STYLE = {
  paid: { bg: '#dcfce7', color: '#15803d', icon: CheckCircle2 },
  pending: { bg: '#fef3c7', color: '#b45309', icon: Clock },
  overdue: { bg: '#fee2e2', color: '#dc2626', icon: AlertTriangle },
  partially_paid: { bg: '#dbeafe', color: '#1d4ed8', icon: Clock },
  waived: { bg: '#f1f5f9', color: '#64748b', icon: CheckCircle2 },
};
const StatusPill = ({ status }) => {
  const s = STATUS_STYLE[status] || STATUS_STYLE.pending;
  const Icon = s.icon;
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,textTransform:'capitalize',background:s.bg,color:s.color,whiteSpace:'nowrap'}}>
      <Icon size={10} /> {status?.replace('_', ' ')}
    </span>
  );
};

// ─── Main ──────────────────────────────────────────────────────────────────

const MobileFees = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isAccountant = user?.role === 'accountant';
  const isAdminAcc = isAdmin || isAccountant;
  const isParent = user?.role === 'parent';
  const isStudent = user?.role === 'student';

  if (isAdminAcc) return <AdminFees isAdmin={isAdmin} />;
  return <ParentStudentFees isParent={isParent} />;
};

// ─── Admin / Accountant view ───────────────────────────────────────────────

const AdminFees = ({ isAdmin }) => {
  const [tab, setTab] = useState('collect');
  return (
    <div data-testid="m-fees-admin" style={{minWidth:0}}>
      <div className="m-header">
        <div><h1>Fees</h1><p className="m-header-sub">Manage collection, reports & config</p></div>
      </div>
      <TabBar tabs={[
        { key: 'collect', label: 'Collect' },
        { key: 'reports', label: 'Reports' },
        { key: 'config', label: 'Config' },
      ]} active={tab} onChange={setTab} />
      <div style={{marginTop:12}}>
        {tab === 'collect' && <CollectTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'config' && <ConfigTab isAdmin={isAdmin} />}
      </div>
    </div>
  );
};

const TabBar = ({ tabs, active, onChange }) => (
  <div style={{display:'flex',gap:6,padding:'4px',background:'transparent',borderRadius:12,flexShrink:0,overflowX:'auto',scrollbarWidth:'none',msOverflowStyle:'none'}}>
    {tabs.map(t => (
      <button
        key={t.key}
        onClick={() => onChange(t.key)}
        style={{
          flex:1, padding:'8px 12px', borderRadius:12, border:'none',
          background: active === t.key ? '#FFF' : 'transparent',
          color: active === t.key ? '#1A1A1A' : '#888',
          fontSize:12, fontWeight:700, cursor:'pointer',
          boxShadow: active === t.key ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
          whiteSpace:'nowrap',
        }}
        data-testid={`m-fees-tab-${t.key}`}
      >
        {t.label}
      </button>
    ))}
  </div>
);

// ─── Collect Tab ───────────────────────────────────────────────────────────

const CollectTab = () => {
  const { viewSession } = useSession();
  const dueCacheKey = `m-fees:due-chart:${viewSession || ''}`;
  const initialDue = getCached(dueCacheKey) || null;
  const [dueChart, setDueChart] = useState(initialDue || []);
  const [loadingDue, setLoadingDue] = useState(!initialDue);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchDebounce = useRef(null);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [ledger, setLedger] = useState(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [payIds, setPayIds] = useState([]);
  const [showPay, setShowPay] = useState(false);

  const fetchDue = useCallback(async () => {
    try {
      const ay = viewSession ? { academic_year: viewSession } : {};
      const r = await api.get('/fees/due-chart', { params: ay });
      const arr = Array.isArray(r.data) ? r.data : [];
      setDueChart(arr);
      setCached(dueCacheKey, arr);
    } catch {}
  }, [viewSession, dueCacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const controller = new AbortController();
    // Bust cache on mount so new fields (total_paid) are always fresh.
    invalidatePrefix(`m-fees:due-chart:${viewSession || ''}`);
    setLoadingDue(true);
    const ay = viewSession ? { academic_year: viewSession } : {};
    api.get('/fees/due-chart', { params: ay, signal: controller.signal })
      .then(r => {
        const arr = Array.isArray(r.data) ? r.data : [];
        setDueChart(arr);
        setCached(dueCacheKey, arr);
      })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoadingDue(false); });
    return () => controller.abort();
  }, [viewSession, dueCacheKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [duePage, setDuePage] = useState(1);
  useEffect(() => { setDuePage(1); }, [dueChart]);

  const fetchLedger = useCallback(async (sid) => {
    if (!sid) return;
    setLoadingLedger(true);
    setPayIds([]);
    try {
      const r = await api.get(`/fees/ledger/${sid}`);
      setLedger(r.data);
    } catch (e) {
      toast.error('Failed to load ledger');
      setLedger(null);
    } finally { setLoadingLedger(false); }
  }, []);

  useEffect(() => {
    if (selectedStudentId) fetchLedger(selectedStudentId);
    else setLedger(null);
  }, [selectedStudentId, fetchLedger]);

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(searchDebounce.current);
    if (!val.trim()) { setSearchResults([]); return; }
    searchDebounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.get('/fees/search-students', { params: { q: val } });
        setSearchResults(Array.isArray(r.data) ? r.data : []);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 350);
  };

  const goBack = () => {
    setSelectedStudentId('');
    setSearch('');
    setSearchResults([]);
    setLedger(null);
    setPayIds([]);
  };

  if (selectedStudentId && (loadingLedger || ledger)) {
    return (
      <>
        <button onClick={goBack} style={{display:'flex',alignItems:'center',gap:4,padding:'4px 0',background:'none',border:'none',color:'#666',fontSize:12,cursor:'pointer',marginBottom:8}}>
          <ArrowLeft size={14} /> Back to all students
        </button>
        {loadingLedger && !ledger && (
          <div style={{textAlign:'center',padding:'30px 0',color:'#888'}}><Loader2 className="animate-spin" size={20} /></div>
        )}
        {ledger && (
          <Ledger
            ledger={ledger}
            payIds={payIds}
            setPayIds={setPayIds}
            onPay={() => setShowPay(true)}
            onReload={() => fetchLedger(selectedStudentId)}
          />
        )}
        {showPay && (
          <PaymentSheet
            studentId={selectedStudentId}
            ledger={ledger}
            payIds={payIds}
            onClose={() => setShowPay(false)}
            onSuccess={() => { setShowPay(false); setPayIds([]); fetchLedger(selectedStudentId); fetchDue(); }}
          />
        )}
      </>
    );
  }

  return (
    <>
      {/* Search */}
      <div style={{position:'relative',marginBottom:12}}>
        <Search size={16} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'#888'}} />
        <input
          className="m-input"
          style={{paddingLeft:38,paddingRight:search ? 38 : 14}}
          placeholder="Search by name, roll, admission no."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
        {searching && <Loader2 size={14} className="animate-spin" style={{position:'absolute',right:14,top:'50%',transform:'translateY(-50%)',color:'#888'}} />}
        {!searching && search && (
          <button onClick={() => { setSearch(''); setSearchResults([]); }}
            style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',padding:4,cursor:'pointer',color:'#888'}}>
            <X size={14} />
          </button>
        )}
      </div>

      {search.trim() && searchResults.length > 0 && (
        <div style={{background:'#FFF',border:'1px solid #E5E5E5',borderRadius:12,overflow:'hidden',marginBottom:12}}>
          {searchResults.map(s => (
            <button
              key={s.student_id}
              onClick={() => { setSelectedStudentId(s.student_id); setSearch(''); setSearchResults([]); }}
              style={{width:'100%',textAlign:'left',padding:12,background:'none',border:'none',borderBottom:'1px solid #F5F5F5',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}
            >
              <div style={{minWidth:0,flex:1}}>
                <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.name}</p>
                <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.class_name}-{s.section}{s.stream ? ` (${s.stream})` : ''} · Admission no: {s.admission_number || '—'}</p>
              </div>
              <ChevronRight size={14} color="#888" />
            </button>
          ))}
        </div>
      )}

      {/* Due students */}
      <p className="m-section" style={{margin:'4px 0 8px'}}>Students with Pending Fees ({dueChart.length})</p>
      {loadingDue ? (
        <div>{[1,2,3,4].map(i => <div key={i} className="m-skeleton" style={{height:60,borderRadius:14,marginBottom:8}} />)}</div>
      ) : dueChart.length === 0 ? (
        <div style={{display:'flex',alignItems:'center',gap:8,padding:14,background:'#dcfce7',border:'1px solid #bbf7d0',borderRadius:12,color:'#15803d',fontSize:13,fontWeight:600}}>
          <CheckCircle2 size={16} /> All fees collected — no pending dues.
        </div>
      ) : (
        <div className="m-list">
          {[...dueChart]
            .sort((a, b) => {
              const ta = a.last_payment_at || '';
              const tb = b.last_payment_at || '';
              if (tb !== ta) return tb > ta ? 1 : -1;
              return (b.total_due || 0) - (a.total_due || 0);
            })
            .slice((duePage - 1) * REPORT_PAGE_SIZE, duePage * REPORT_PAGE_SIZE)
            .map(s => (
            <button
              key={s.student_id}
              onClick={() => setSelectedStudentId(s.student_id)}
              className="m-list-item"
              style={{background:'none',border:'none',width:'100%',textAlign:'left',cursor:'pointer',gap:8}}
            >
              <div style={{minWidth:0,flex:1}}>
                <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.name}</p>
                <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.class_name}-{s.section} · {s.admission_number || '—'}</p>
                {s.total_paid > 0 && <p style={{fontSize:11,color:'#16a34a',fontWeight:600}}>Paid: {fmt(s.total_paid)}</p>}
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <p style={{fontWeight:800,fontSize:13,color:'#dc2626'}}>{fmt(s.total_due)}</p>
                {s.entries_overdue > 0 && <p style={{fontSize:10,color:'#dc2626'}}>{s.entries_overdue} overdue</p>}
              </div>
            </button>
          ))}
          <ReportPager page={duePage} total={dueChart.length} onPage={setDuePage} />
        </div>
      )}
    </>
  );
};

// ─── Ledger ────────────────────────────────────────────────────────────────

const SECTION_DEFS = [
  { key: 'one_time', label: 'One-Time Fees' },
  { key: 'yearly', label: 'Yearly Fees' },
  { key: 'monthly', label: 'Monthly Tuition' },
];

const Ledger = ({ ledger, payIds, setPayIds, onPay, renderPayButton }) => {
  const [expanded, setExpanded] = useState({ one_time: true, yearly: true, monthly: false });
  const { student, summary, ledger: grouped } = ledger;

  const allEntries = [
    ...(grouped.one_time || []),
    ...(grouped.yearly || []),
    ...(grouped.monthly || []),
  ];
  const payable = allEntries.filter(e => ['pending','overdue','partially_paid'].includes(e.status));
  const overdueOnly = allEntries.filter(e => e.status === 'overdue');

  const toggle = (k) => setExpanded(p => ({ ...p, [k]: !p[k] }));
  const togglePay = (id) => setPayIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const selectAll = () => setPayIds(payable.map(e => e.ledger_id));
  const selectOverdue = () => setPayIds(overdueOnly.map(e => e.ledger_id));
  const clearSel = () => setPayIds([]);

  const selectedTotal = allEntries
    .filter(e => payIds.includes(e.ledger_id))
    .reduce((s, e) => s + (e.remaining_balance > 0 ? e.remaining_balance : e.net_amount), 0);

  return (
    <div>
      {/* Student summary card */}
      <div style={{background:'#1A1A1A',color:'#FFF',padding:14,borderRadius:14,marginBottom:12}}>
        <p style={{fontSize:14,fontWeight:800,lineHeight:1.2,wordBreak:'break-word'}}>{student.name}</p>
        <p style={{fontSize:11,color:'rgba(255,255,255,0.6)',marginTop:2,wordBreak:'break-word'}}>
          {student.class_name}-{student.section}{student.stream ? ` · ${student.stream}` : ''} · Admission no: {student.admission_number || '—'}
        </p>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:12}}>
          <Stat label="Pending" value={summary.total_pending} color="#fca5a5" />
          <Stat label="Overdue" value={summary.total_overdue} color="#fca5a5" />
          <Stat label="Paid" value={summary.total_paid} color="#86efac" />
        </div>
        {(summary.total_concession > 0 || summary.total_late_fees > 0) && (
          <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
            {summary.total_concession > 0 && (
              <span style={{fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:6,background:'rgba(134,239,172,0.2)',color:'#86efac'}}>
                Concession -{fmt(summary.total_concession)}
              </span>
            )}
            {summary.total_late_fees > 0 && (
              <span style={{fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:6,background:'rgba(252,165,165,0.2)',color:'#fca5a5'}}>
                Late fees +{fmt(summary.total_late_fees)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Quick select chips */}
      {payable.length > 0 && (
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
          <button onClick={selectAll} style={chipBtn(false)}>All due ({payable.length})</button>
          {overdueOnly.length > 0 && <button onClick={selectOverdue} style={chipBtn(false, '#dc2626', '#fee2e2', '#fca5a5')}>Overdue ({overdueOnly.length})</button>}
          {payIds.length > 0 && <button onClick={clearSel} style={chipBtn(false, '#888')}>Clear</button>}
        </div>
      )}

      {/* Sections */}
      {SECTION_DEFS.map(sec => {
        const entries = grouped[sec.key] || [];
        if (entries.length === 0) return null;
        const open = expanded[sec.key];
        const dueCount = entries.filter(e => e.status !== 'paid').length;
        return (
          <div key={sec.key} style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,marginBottom:10,overflow:'hidden'}}>
            <button onClick={() => toggle(sec.key)} style={{width:'100%',padding:'12px 14px',background:'none',border:'none',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span style={{fontSize:13,fontWeight:700,color:'#1A1A1A'}}>{sec.label}</span>
                <span style={{fontSize:10,color:'#888'}}>({entries.length})</span>
              </div>
              {dueCount > 0 && <span style={{fontSize:11,fontWeight:700,color:'#dc2626'}}>{dueCount} due</span>}
            </button>
            {open && entries.map(e => (
              <LedgerRow
                key={e.ledger_id}
                entry={e}
                checked={payIds.includes(e.ledger_id)}
                onToggle={() => togglePay(e.ledger_id)}
                disabled={e.status === 'paid' || e.status === 'waived'}
              />
            ))}
          </div>
        );
      })}

      {/* Payment history */}
      {ledger.payments && ledger.payments.length > 0 && (
        <div style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,marginBottom:10,overflow:'hidden'}}>
          <div style={{padding:'12px 14px',borderBottom:'1px solid #F5F5F5',display:'flex',alignItems:'center',gap:6}}>
            <Receipt size={14} color="#1A1A1A" />
            <span style={{fontSize:13,fontWeight:700,color:'#1A1A1A'}}>Payment History</span>
            <span style={{fontSize:10,color:'#888'}}>({ledger.payments.length})</span>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
              <thead>
                <tr style={{background:'#F8F8F8',borderBottom:'1px solid #F0F0F0'}}>
                  {['Receipt No.','Date','Amount','Method','Txn ID','Receipt'].map(h => (
                    <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.payments.map(p => (
                  <tr key={p.payment_id} style={{borderTop:'1px solid #F5F5F5'}}>
                    <td style={{padding:'9px 10px',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',fontSize:11,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap'}}>{p.receipt_number}</td>
                    <td style={{padding:'9px 10px',color:'#444',whiteSpace:'nowrap'}}>{isoToDDMMYYYY(p.payment_date) || p.payment_date}</td>
                    <td style={{padding:'9px 10px',fontWeight:800,color:'#15803d',whiteSpace:'nowrap'}}>{fmt(p.amount)}</td>
                    <td style={{padding:'9px 10px',color:'#444',whiteSpace:'nowrap'}}>{fmtPaymentMethod(p.payment_method)}</td>
                    <td style={{padding:'9px 10px',color:'#888',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',fontSize:10,whiteSpace:'nowrap'}}>{p.transaction_id || '—'}</td>
                    <td style={{padding:'9px 10px'}}>
                      <button
                        onClick={() => downloadReceipt(p.payment_id)}
                        aria-label="Download receipt"
                        style={{display:'flex',alignItems:'center',gap:4,padding:'5px 8px',borderRadius:7,background:'#FFF',border:'1px solid #E5E5E5',cursor:'pointer',fontSize:10,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap'}}
                        data-testid={`m-receipt-${p.payment_id}`}
                      >
                        <Download size={11} /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Floating pay bar above the bottom nav */}
      {payIds.length > 0 && (
        <>
          <div style={{height:80}} />
          <div style={{
            position:'fixed',
            left:12, right:12,
            bottom:`calc(76px + env(safe-area-inset-bottom, 0px))`,
            zIndex:90,
          }}>
            {renderPayButton
              ? renderPayButton({ payIds, total: selectedTotal })
              : (
                <button onClick={onPay} style={{...actionBtn('dark'), width:'100%', padding:'14px', boxShadow:'0 6px 20px rgba(0,0,0,0.18)'}}>
                  <CreditCard size={16} /> Collect {fmt(selectedTotal)}
                </button>
              )
            }
          </div>
        </>
      )}
    </div>
  );
};

const Stat = ({ label, value, color }) => (
  <div>
    <p style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(255,255,255,0.5)'}}>{label}</p>
    <p style={{fontSize:14,fontWeight:800,color}}>{fmt(value)}</p>
  </div>
);

const LedgerRow = ({ entry, checked, onToggle, disabled }) => {
  const isPaid = entry.status === 'paid' || entry.status === 'waived';
  const label = (entry.description || entry.label || entry.component_label || entry.month || '—').replace(' (seeded due)', '');
  return (
    <label style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderTop:'1px solid #F5F5F5',cursor: disabled ? 'default' : 'pointer',opacity: disabled ? 0.7 : 1}}>
      <input
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={onToggle}
        style={{width:16,height:16,flexShrink:0,accentColor:'#1A1A1A'}}
      />
      <div style={{minWidth:0,flex:1}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
          <p style={{fontSize:12,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label}</p>
          <p style={{fontSize:13,fontWeight:800,color: isPaid ? '#15803d' : '#1A1A1A',flexShrink:0}}>
            {fmt(entry.remaining_balance > 0 ? entry.remaining_balance : entry.net_amount)}
          </p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:2,flexWrap:'wrap'}}>
          <StatusPill status={entry.status} />
          {entry.due_date && <span style={{fontSize:10,color:'#888'}}>Due {fmtDate(entry.due_date)}</span>}
          {entry.concession_amount > 0 && <span style={{fontSize:10,color:'#15803d'}}>-{fmt(entry.concession_amount)} conc.</span>}
        </div>
      </div>
      {isPaid && entry.payment_id && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); downloadReceipt(entry.payment_id); }}
          aria-label="Download receipt"
          style={{display:'flex',alignItems:'center',gap:4,padding:'6px 10px',borderRadius:8,background:'#FFF',border:'1px solid #E5E5E5',cursor:'pointer',fontSize:11,fontWeight:700,color:'#1A1A1A',flexShrink:0}}
        >
          <Download size={12} /> PDF
        </button>
      )}
    </label>
  );
};

// ─── Payment sheet ─────────────────────────────────────────────────────────

const PaymentSheet = ({ studentId, ledger, payIds, onClose, onSuccess }) => {
  const [method, setMethod] = useState('cash');
  // Payment methods are admin-configurable in the DB (same source desktop uses).
  // POS terminal is excluded here as the mobile collect flow has no Ezetap step.
  const [payMethods, setPayMethods] = useState(PAYMENT_METHODS);
  useEffect(() => { fetchPaymentMethods({ withPos: false }).then(setPayMethods).catch(() => {}); }, []);
  const [transactionId, setTransactionId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayDDMMYYYY());
  const [splitCash, setSplitCash] = useState('');
  const [splitOnline, setSplitOnline] = useState('');
  const [processing, setProcessing] = useState(false);

  const allEntries = [
    ...(ledger?.ledger?.one_time || []),
    ...(ledger?.ledger?.yearly || []),
    ...(ledger?.ledger?.monthly || []),
  ];
  const total = allEntries
    .filter(e => payIds.includes(e.ledger_id))
    .reduce((s, e) => s + (e.remaining_balance > 0 ? e.remaining_balance : e.net_amount), 0);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const submit = async () => {
    const iso = paymentDate ? ddmmyyyyToIso(paymentDate) : '';
    if (paymentDate && !iso) { toast.error('Payment date must be DD/MM/YYYY'); return; }
    if (iso && iso > new Date().toISOString().slice(0, 10)) { toast.error('Payment date cannot be in the future'); return; }
    setProcessing(true);
    try {
      const payload = {
        student_id: studentId,
        ledger_ids: payIds,
        payment_method: method,
        transaction_id: transactionId || undefined,
        remarks: remarks || undefined,
        payment_date: iso || undefined,
      };
      if (method === 'split') {
        const c = parseFloat(splitCash) || 0;
        const o = parseFloat(splitOnline) || 0;
        if (c <= 0 && o <= 0) { toast.error('Enter at least one split amount'); setProcessing(false); return; }
        payload.split_payments = { cash: c, online: o };
        // Split total = amount collected (spread across selected entries oldest-first).
        payload.amount = c + o;
      }
      const res = await api.post('/fees/pay', payload);
      toast.success(res.data.message || 'Payment recorded');
      if (res.data.receipt_number) toast.success(`Receipt: ${res.data.receipt_number}`);
      invalidatePrefix('m-fees:');
      onSuccess();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Payment failed');
    } finally { setProcessing(false); }
  };

  return (
    <div onClick={onClose} style={overlay} data-testid="m-pay-sheet">
      <div onClick={(e) => e.stopPropagation()} style={panel}>
        <Handle />
        <Header title={`Collect ${fmt(total)}`} onClose={onClose} sub={`${payIds.length} ${payIds.length === 1 ? 'entry' : 'entries'} selected`} />

        <div style={body}>
          <FormSelect label="Payment Method" value={method} onChange={setMethod}
            options={payMethods.map(m => [m.value, m.label])}
          />
          {method !== 'cash' && method !== 'split' && (
            <FormInput label={method === 'cheque' ? 'Cheque Number' : 'Transaction / UTR'} value={transactionId} onChange={setTransactionId} placeholder={method === 'cheque' ? 'e.g. 123456' : 'UTR / Ref'} />
          )}
          {method === 'split' && (
            <>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <FormInput label="Cash Amount" type="number" value={splitCash} onChange={setSplitCash} />
                <FormInput label="Online Amount" type="number" value={splitOnline} onChange={setSplitOnline} />
              </div>
              <FormInput label="Online Ref / UTR No." value={transactionId} onChange={setTransactionId} placeholder="UPI Ref / UTR / NEFT" />
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',background:'#F8F8F8',borderRadius:10}}>
                <span style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#666'}}>Amount to collect</span>
                <span style={{fontSize:15,fontWeight:800,color:'#1A1A1A'}}>{fmt((parseFloat(splitCash) || 0) + (parseFloat(splitOnline) || 0))}</span>
              </div>
            </>
          )}
          <FormInput label="Payment Date (DD/MM/YYYY)" value={paymentDate} onChange={setPaymentDate} placeholder="DD/MM/YYYY" />
          <FormInput label="Remarks (optional)" value={remarks} onChange={setRemarks} placeholder="e.g. Cash receipt #..." />

          <div style={{padding:10,background:'#F8F8F8',borderRadius:10,fontSize:11,color:'#666'}}>
            A receipt will be generated and emailed/SMS'd to the parent on success.
          </div>
        </div>

        <Footer>
          <button onClick={onClose} style={{...actionBtn('outline'), flex:1}}>Cancel</button>
          <button onClick={submit} disabled={processing} style={{...actionBtn('dark'), flex:1}} data-testid="m-pay-submit">
            {processing ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
            Collect {fmt(method === 'split' ? ((parseFloat(splitCash) || 0) + (parseFloat(splitOnline) || 0)) : total)}
          </button>
        </Footer>
      </div>
    </div>
  );
};

// ─── Reports Tab ───────────────────────────────────────────────────────────

const DURATIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'last_week', label: 'Last Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

const fmtDate = (s) => {
  if (!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s);
};

const openReportPdf = async (apiPath, params) => {
  const w = window.open('', '_blank');
  if (!w) { toast.error('Pop-up blocked — allow pop-ups to view the report'); return; }
  w.document.write('<div style="font-family:Arial;padding:40px;text-align:center;color:#64748b">Preparing report…</div>');
  w.document.close();
  try {
    const res = await api.get(`${apiPath}/pdf`, { params, responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    try { w.location.replace(url); } catch (_) {}
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    try { w.document.body.innerHTML = '<div style="font-family:Arial;padding:40px;color:#dc2626;text-align:center">Failed to load PDF.</div>'; } catch (_) {}
    toast.error(e.response?.data?.detail || 'Failed to open PDF');
  }
};

const ReportsTab = () => {
  const [sub, setSub] = useState('summary');
  return (
    <>
      <TabBar tabs={[
        { key: 'summary', label: 'Summary' },
        { key: 'collection', label: 'Collection' },
        { key: 'due', label: 'Due' },
      ]} active={sub} onChange={setSub} />
      <div style={{marginTop:12}}>
        {sub === 'summary' && <SummaryReport />}
        {sub === 'collection' && <CollectionReport />}
        {sub === 'due' && <DueReport />}
      </div>
    </>
  );
};

const SummaryReport = () => {
  const { viewSession } = useSession();
  const reportsCacheKey = `m-fees:reports:${viewSession || ''}`;
  const initial = getCached(reportsCacheKey) || null;
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(!initial);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [refreshingOverdue, setRefreshingOverdue] = useState(false);

  const load = useCallback(async () => {
    try {
      const ay = viewSession ? { academic_year: viewSession } : {};
      const r = await api.get('/fees/due-chart', { params: ay });
      const arr = Array.isArray(r.data) ? r.data : [];
      const totalDue = arr.reduce((s, x) => s + (x.total_due || 0), 0);
      const totalOverdue = arr.reduce((s, x) => s + (x.entries_overdue || 0), 0);
      const overdueStudents = arr.filter(x => (x.entries_overdue || 0) > 0).length;
      const result = { totalDue, totalOverdue, overdueStudents, students: arr.length };
      setData(result);
      setCached(reportsCacheKey, result);
    } catch {}
  }, [viewSession, reportsCacheKey]); // eslint-disable-line

  useEffect(() => {
    const controller = new AbortController();
    if (!initial) setLoading(true);
    const ay = viewSession ? { academic_year: viewSession } : {};
    api.get('/fees/due-chart', { params: ay, signal: controller.signal })
      .then(r => {
        const arr = Array.isArray(r.data) ? r.data : [];
        const totalDue = arr.reduce((s, x) => s + (x.total_due || 0), 0);
        const totalOverdue = arr.reduce((s, x) => s + (x.entries_overdue || 0), 0);
        const overdueStudents = arr.filter(x => (x.entries_overdue || 0) > 0).length;
        const result = { totalDue, totalOverdue, overdueStudents, students: arr.length };
        setData(result);
        setCached(reportsCacheKey, result);
      })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [viewSession, reportsCacheKey]); // eslint-disable-line

  const sendReminders = async () => {
    setSendingReminders(true);
    try {
      const r = await api.post('/notifications/send-fee-reminders');
      toast.success(`Reminders sent to ${r.data.sent || 0} parent(s)`);
    } catch { toast.error('Failed to send reminders'); }
    finally { setSendingReminders(false); }
  };

  const refreshOverdue = async () => {
    setRefreshingOverdue(true);
    try {
      const r = await api.post('/fees/refresh-overdue');
      toast.success(r.data.message || 'Overdue refreshed');
      load();
    } catch { toast.error('Failed to refresh overdue'); }
    finally { setRefreshingOverdue(false); }
  };

  if (loading) return <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:80,borderRadius:14,marginBottom:8}} />)}</div>;

  return (
    <>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
        <StatTile label="Total Pending" value={fmt(data?.totalDue)} accent="#dc2626" />
        <StatTile label="Overdue Entries" value={data?.totalOverdue || 0} accent="#d97706" />
        <StatTile label="Students with Dues" value={data?.students || 0} />
        <StatTile label="Overdue Students" value={data?.overdueStudents || 0} accent="#d97706" />
      </div>

      <p className="m-section">Actions</p>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        <button onClick={sendReminders} disabled={sendingReminders} style={{...actionBtn('outline'), justifyContent:'flex-start', padding:14}}>
          {sendingReminders ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
          <span style={{fontSize:13}}>Send Fee Reminders</span>
        </button>
        <button onClick={refreshOverdue} disabled={refreshingOverdue} style={{...actionBtn('outline'), justifyContent:'flex-start', padding:14}}>
          {refreshingOverdue ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          <span style={{fontSize:13}}>Refresh Overdue Status</span>
        </button>
      </div>
    </>
  );
};

const CollectionReport = () => {
  const { viewSession } = useSession();
  const [duration, setDuration] = useState('this_month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Only include start/end when duration is "custom" AND both dates set.
  const params = useMemo(() => {
    const p = { duration };
    if (duration === 'custom' && startDate && endDate) {
      p.start_date = startDate;
      p.end_date = endDate;
    }
    if (viewSession) p.academic_year = viewSession;
    return p;
  }, [duration, startDate, endDate, viewSession]);
  const cacheKey = useMemo(() => `m-fees:report-collection:${JSON.stringify(params)}`, [params]);

  // Skip fetching while user is still picking a custom range
  const customIncomplete = duration === 'custom' && (!startDate || !endDate);

  const load = useCallback(async () => {
    if (customIncomplete) return;
    const cached = getCached(cacheKey);
    if (cached) setRows(cached);
    setLoading(true);
    try {
      const r = await api.get('/fees/reports/collection', { params });
      const arr = Array.isArray(r.data) ? r.data : [];
      setRows(arr);
      setCached(cacheKey, arr);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load report');
    } finally { setLoading(false); }
  }, [params, cacheKey, customIncomplete]);

  useEffect(() => { load(); }, [load]);

  const download = async () => {
    if (customIncomplete) { toast.error('Pick start and end dates'); return; }
    setDownloading(true);
    try { await openReportPdf('/fees/reports/collection', params); }
    finally { setDownloading(false); }
  };

  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [rows]);
  const totalCollected = rows.reduce((s, r) => s + (Number(r.total_collected) || 0), 0);

  return (
    <>
      <DurationPicker value={duration} onChange={setDuration} />
      {duration === 'custom' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
          <div>
            <label style={{display:'block',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888',marginBottom:6}}>From</label>
            <input
              className="m-input"
              type="date"
              lang="en-IN"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
              style={{cursor:'pointer'}}
            />
          </div>
          <div>
            <label style={{display:'block',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888',marginBottom:6}}>To</label>
            <input
              className="m-input"
              type="date"
              lang="en-IN"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
              style={{cursor:'pointer'}}
            />
          </div>
        </div>
      )}
      <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:10}}>
        <div style={{flex:1,minWidth:0,background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',padding:'10px 12px',borderRadius:12}}>
          <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888'}}>Total Collected</p>
          <p style={{fontSize:16,fontWeight:800,color:'#15803d',marginTop:2}}>{fmt(totalCollected)}</p>
        </div>
        <button onClick={download} disabled={downloading || customIncomplete} style={{...actionBtn('dark'), padding:'10px 14px', fontSize:12, flexShrink:0, opacity: customIncomplete ? 0.5 : 1}}>
          {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} PDF
        </button>
      </div>
      {customIncomplete && (
        <div style={{padding:10,background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10,fontSize:11,color:'#92400e',marginBottom:10}}>
          Pick both start and end dates to load the custom-range report.
        </div>
      )}
      {loading && rows.length === 0 ? (
        <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:64,borderRadius:14,marginBottom:8}} />)}</div>
      ) : rows.length === 0 ? (
        <div style={{padding:20,textAlign:'center',color:'#888',background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,fontSize:13}}>
          No collection in this period
        </div>
      ) : (
        <div className="m-list">
          {rows.slice((page - 1) * REPORT_PAGE_SIZE, page * REPORT_PAGE_SIZE).map((r, i) => (
            <div key={i} className="m-list-item" style={{gap:8}}>
              <div style={{minWidth:0,flex:1}}>
                <p style={{fontSize:12,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.student_name}</p>
                <p style={{fontSize:10,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.admission_number} · {r.class_section} · Last: {fmtDate(r.last_payment_date)}</p>
              </div>
              <p style={{fontSize:13,fontWeight:800,color:'#15803d',flexShrink:0}}>{fmt(r.total_collected)}</p>
            </div>
          ))}
          <ReportPager page={page} total={rows.length} onPage={setPage} />
        </div>
      )}
    </>
  );
};

// Map a duration chip → a single date string (YYYY-MM-DD) for the
// /fees/reports/due endpoint, which accepts as_of_date but not duration/range.
const durationToAsOfDate = (duration, custom) => {
  const iso = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  switch (duration) {
    case 'today': return iso(today);
    case 'yesterday': { const d = new Date(today); d.setDate(d.getDate() - 1); return iso(d); }
    case 'this_week': return iso(today);
    case 'last_week': { const d = new Date(today); d.setDate(d.getDate() - 7); return iso(d); }
    case 'this_month': return iso(today);
    case 'last_month': { const d = new Date(today.getFullYear(), today.getMonth(), 0); return iso(d); }
    case 'this_year': return iso(today);
    case 'all_time': return '';
    case 'custom': return custom || '';
    default: return '';
  }
};

const DueReport = () => {
  const { viewSession } = useSession();
  const [duration, setDuration] = useState('all_time');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Due is point-in-time; for a custom From-To, "due as of <To>" is the
  // closest semantic match to the desktop API.
  const asOfDate = useMemo(() => durationToAsOfDate(duration, endDate), [duration, endDate]);
  const params = useMemo(() => {
    const p = asOfDate ? { as_of_date: asOfDate } : {};
    if (viewSession) p.academic_year = viewSession;
    return p;
  }, [asOfDate, viewSession]);
  const cacheKey = useMemo(() => `m-fees:report-due:${JSON.stringify(params)}`, [params]);

  const customIncomplete = duration === 'custom' && (!startDate || !endDate);

  const load = useCallback(async () => {
    if (customIncomplete) return;
    const cached = getCached(cacheKey);
    if (cached) setRows(cached);
    setLoading(true);
    try {
      const r = await api.get('/fees/reports/due', { params });
      const arr = Array.isArray(r.data) ? r.data : [];
      setRows(arr);
      setCached(cacheKey, arr);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load report');
    } finally { setLoading(false); }
  }, [params, cacheKey, customIncomplete]);

  useEffect(() => { load(); }, [load]);

  const download = async () => {
    if (customIncomplete) { toast.error('Pick an as-of date'); return; }
    setDownloading(true);
    try { await openReportPdf('/fees/reports/due', params); }
    finally { setDownloading(false); }
  };

  // Backend returns r.balance (amount - paid). Fall back if older payload.
  const dueOf = (r) => {
    if (r.balance != null) return Number(r.balance) || 0;
    if (r.amount != null) return (Number(r.amount) || 0) - (Number(r.paid) || 0);
    return Number(r.total_due) || 0;
  };

  // Filter out fully-paid rows just in case the endpoint includes them.
  // For Custom Range, also narrow to students whose oldest due falls inside [From, To]
  // — backend doesn't support range, so this is enforced client-side using oldest_due.
  const dueRows = useMemo(() => {
    let arr = rows.filter(r => dueOf(r) > 0);
    if (duration === 'custom' && startDate && endDate) {
      arr = arr.filter(r => {
        const od = r.oldest_due;
        if (!od) return false;
        return od >= startDate && od <= endDate;
      });
    }
    return arr;
  }, [rows, duration, startDate, endDate]);
  const totalDue = useMemo(() => dueRows.reduce((s, r) => s + dueOf(r), 0), [dueRows]);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [dueRows]);

  return (
    <>
      <DurationPicker value={duration} onChange={setDuration} />
      {duration === 'custom' && (
        <>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:6}}>
            <div>
              <label style={{display:'block',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888',marginBottom:6}}>From</label>
              <input
                className="m-input"
                type="date"
              lang="en-IN"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
                style={{cursor:'pointer'}}
              />
            </div>
            <div>
              <label style={{display:'block',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888',marginBottom:6}}>To</label>
              <input
                className="m-input"
                type="date"
              lang="en-IN"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
                style={{cursor:'pointer'}}
              />
            </div>
          </div>
          <p style={{fontSize:10,color:'#888',marginBottom:10}}>
            Shows students whose oldest unpaid due falls between From and To.
          </p>
        </>
      )}
      <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:10}}>
        <div style={{flex:1,minWidth:0,background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',padding:'10px 12px',borderRadius:12}}>
          <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888'}}>Total Due ({dueRows.length})</p>
          <p style={{fontSize:16,fontWeight:800,color:'#dc2626',marginTop:2}}>{fmt(totalDue)}</p>
        </div>
        <button onClick={download} disabled={downloading || customIncomplete} style={{...actionBtn('dark'), padding:'10px 14px', fontSize:12, flexShrink:0, opacity: customIncomplete ? 0.5 : 1}}>
          {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} PDF
        </button>
      </div>
      {customIncomplete && (
        <div style={{padding:10,background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10,fontSize:11,color:'#92400e',marginBottom:10}}>
          Pick an as-of date to load the custom report.
        </div>
      )}
      {loading && dueRows.length === 0 ? (
        <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:64,borderRadius:14,marginBottom:8}} />)}</div>
      ) : dueRows.length === 0 ? (
        <div style={{padding:20,textAlign:'center',color:'#15803d',background:'#dcfce7',border:'1px solid #bbf7d0',borderRadius:14,fontSize:13,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
          <CheckCircle2 size={16} /> No dues — all paid!
        </div>
      ) : (
        <div className="m-list">
          {dueRows.slice((page - 1) * REPORT_PAGE_SIZE, page * REPORT_PAGE_SIZE).map((r, i) => (
            <div key={i} className="m-list-item" style={{gap:8}}>
              <div style={{minWidth:0,flex:1}}>
                <p style={{fontSize:12,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.student_name}</p>
                <p style={{fontSize:10,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.admission_number} · {r.class_section}{r.oldest_due ? ` · Oldest: ${fmtDate(r.oldest_due)}` : ''}</p>
              </div>
              <p style={{fontSize:13,fontWeight:800,color:'#dc2626',flexShrink:0}}>{fmt(dueOf(r))}</p>
            </div>
          ))}
          <ReportPager page={page} total={dueRows.length} onPage={setPage} />
        </div>
      )}
    </>
  );
};

const DurationPicker = ({ value, onChange }) => (
  <div className="m-chips" style={{marginBottom:10}}>
    {DURATIONS.map(d => (
      <button
        key={d.value}
        className={`m-chip ${value === d.value ? 'active' : ''}`}
        onClick={() => onChange(d.value)}
      >
        {d.label}
      </button>
    ))}
  </div>
);

const StatTile = ({ label, value, accent }) => (
  <div style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',padding:14,borderRadius:14,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
    <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#888'}}>{label}</p>
    <p style={{fontSize:18,fontWeight:800,marginTop:4,color: accent || '#1A1A1A'}}>{value}</p>
  </div>
);

// ─── Config Tab ────────────────────────────────────────────────────────────

const FEE_KEYS = [
  ['registration_fee', 'Registration Fee'],
  ['admission_fee', 'Admission Fee'],
  ['caution_deposit', 'Caution Deposit'],
  ['annual_charge', 'Annual Charge'],
  ['activity_fee', 'Activity Fee'],
  ['exam_fee', 'Exam Fee'],
  ['lab_fee', 'Lab Fee'],
  ['ai_robotics_fee', 'AI & Robotics Fee'],
  ['monthly_tuition', 'Monthly Tuition'],
  ['upgradation_fee', 'Upgradation Fee'],
  ['late_fee', 'Late Fee (per month)'],
];

const ConfigTab = ({ isAdmin }) => {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [configs, setConfigs] = useState([]);
  const [classes, setClasses] = useState(getCached('classes') || []);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // existing config or new
  const [showIncrease, setShowIncrease] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, clsRes] = await Promise.all([
        api.get('/fees/components', { params: { academic_year: year } }).catch(() => ({ data: [] })),
        api.get('/classes').catch(() => ({ data: getCached('classes') || [] })),
      ]);
      setConfigs(Array.isArray(cfgRes.data) ? cfgRes.data : []);
      const cls = Array.isArray(clsRes.data) ? clsRes.data : [];
      setClasses(cls);
      setCached('classes', cls);
    } catch {} finally { setLoading(false); }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:140}}>
          <label style={formLabel}>Academic Year</label>
          <select className="m-input" value={year} onChange={(e) => setYear(e.target.value)}>
            {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {isAdmin && (
          <button onClick={() => setShowIncrease(true)} style={{...actionBtn('outline'), padding:'10px 12px', fontSize:12, marginTop:18}}>
            <TrendingUp size={14} /> Increase
          </button>
        )}
        <button onClick={() => setEditing({})} style={{...actionBtn('dark'), padding:'10px 12px', fontSize:12, marginTop:18}}>
          <Plus size={14} /> Add
        </button>
      </div>

      {loading ? (
        <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:64,borderRadius:14,marginBottom:8}} />)}</div>
      ) : configs.length === 0 ? (
        <div style={{padding:32,textAlign:'center',color:'#888',background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14}}>
          <Settings size={28} style={{margin:'0 auto 8px',opacity:0.4}} />
          <p style={{fontSize:13,fontWeight:600,color:'#1A1A1A'}}>No fee configurations for {year}</p>
          <p style={{fontSize:11,marginTop:4}}>Tap Add to set up fees for each class.</p>
        </div>
      ) : (
        <div className="m-list">
          {configs.map(cfg => {
            const total = FEE_KEYS.reduce((s, [k]) => s + (cfg[k] > 0 ? Number(cfg[k]) : 0), 0);
            return (
              <button
                key={cfg.config_id}
                onClick={() => setEditing(cfg)}
                className="m-list-item"
                style={{background:'none',border:'none',width:'100%',textAlign:'left',cursor:'pointer',gap:8}}
              >
                <div style={{minWidth:0,flex:1}}>
                  <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A'}}>
                    Class {cfg.class_name}{cfg.stream ? ` (${cfg.stream})` : ''}
                  </p>
                  <p style={{fontSize:11,color:'#888'}}>
                    Tuition {fmt(cfg.monthly_tuition)}/mo · Annual {fmt(cfg.annual_charge)}
                    {cfg.late_fee_enabled && cfg.late_fee > 0 && ` · Late ${fmt(cfg.late_fee)}/mo`}
                  </p>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <p style={{fontSize:11,color:'#888',fontWeight:700,textTransform:'uppercase'}}>Sum</p>
                  <p style={{fontSize:13,fontWeight:800,color:'#1A1A1A'}}>{fmt(total)}</p>
                </div>
                <span
                  aria-hidden
                  style={{display:'flex',alignItems:'center',gap:4,padding:'6px 10px',marginLeft:8,borderRadius:8,background:'#FFF',border:'1px solid #E5E5E5',fontSize:11,fontWeight:700,color:'#1A1A1A',flexShrink:0}}
                >
                  <Edit2 size={12} /> Edit
                </span>
              </button>
            );
          })}
        </div>
      )}

      {editing && (
        <ConfigEditSheet
          config={editing}
          year={year}
          classes={classes}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {showIncrease && (
        <AnnualIncreaseSheet
          year={year}
          onClose={() => setShowIncrease(false)}
          onApplied={() => { setShowIncrease(false); load(); }}
        />
      )}
    </>
  );
};

const ConfigEditSheet = ({ config, year, classes, onClose, onSaved }) => {
  const isNew = !config.config_id;
  const [form, setForm] = useState(() => ({
    class_name: config.class_name || '',
    stream: config.stream || '',
    academic_year: config.academic_year || year,
    registration_fee: config.registration_fee || 0,
    admission_fee: config.admission_fee || 0,
    caution_deposit: config.caution_deposit || 0,
    annual_charge: config.annual_charge || 0,
    activity_fee: config.activity_fee || 0,
    exam_fee: config.exam_fee || 0,
    lab_fee: config.lab_fee || 0,
    ai_robotics_fee: config.ai_robotics_fee || 0,
    monthly_tuition: config.monthly_tuition || 0,
    upgradation_fee: config.upgradation_fee || 0,
    due_day: config.due_day || 10,
    grace_days: config.grace_days || 0,
    late_fee: config.late_fee || 0,
    late_fee_enabled: config.late_fee_enabled || false,
    sibling_admission_discount_amount: config.sibling_admission_discount_amount || 0,
    sibling_tuition_discount_amount: config.sibling_tuition_discount_amount || 0,
    notes: config.notes || '',
  }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!form.class_name) { toast.error('Class is required'); return; }
    setSaving(true);
    try {
      if (config.config_id) {
        await api.put(`/fees/components/${config.config_id}`, form);
      } else {
        await api.post('/fees/components', form);
      }
      toast.success('Fee configuration saved');
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={overlay} data-testid="m-config-sheet">
      <div onClick={(e) => e.stopPropagation()} style={panel}>
        <Handle />
        <Header title={isNew ? 'Add Fee Config' : 'Edit Fee Config'} sub={`Year: ${form.academic_year}`} onClose={onClose} />

        <div style={body}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div>
              <label style={formLabel}>Class</label>
              <select className="m-input" value={form.class_name} onChange={(e) => set('class_name', e.target.value)}>
                <option value="">Select class</option>
                {classes.map(c => <option key={c.name} value={c.name}>{c.display_name || (c.name.startsWith('Class ') ? c.name : `Class ${c.name}`)}</option>)}
              </select>
            </div>
            <div>
              <label style={formLabel}>Stream (optional)</label>
              <select className="m-input" value={form.stream} onChange={(e) => set('stream', e.target.value)}>
                <option value="">—</option>
                <option value="science">Science</option>
                <option value="humanities">Humanities</option>
              </select>
            </div>
          </div>

          <p className="m-section">Fee Components</p>
          {FEE_KEYS.map(([k, label]) => (
            <NumberField key={k} label={label} value={form[k]} onChange={(v) => set(k, v)} />
          ))}

          <p className="m-section">Late Fee</p>
          <label style={{display:'flex',alignItems:'center',gap:8,padding:10,background:'#F8F8F8',borderRadius:10}}>
            <input type="checkbox" checked={form.late_fee_enabled} onChange={(e) => set('late_fee_enabled', e.target.checked)} />
            <span style={{fontSize:13,fontWeight:600,color:'#1A1A1A'}}>Enable Late Fee</span>
          </label>
          <NumberField label="Due Day (of month)" value={form.due_day} onChange={(v) => set('due_day', v)} />
          <NumberField label="Grace Days (after due date)" value={form.grace_days} onChange={(v) => set('grace_days', v)} />

          <p className="m-section">Sibling Discounts</p>
          <NumberField label="Sibling Admission Discount (Rs.)" value={form.sibling_admission_discount_amount} onChange={(v) => set('sibling_admission_discount_amount', v)} />
          <NumberField label="Sibling Tuition Discount (Rs./mo)" value={form.sibling_tuition_discount_amount} onChange={(v) => set('sibling_tuition_discount_amount', v)} />

          <FormInput label="Notes" value={form.notes} onChange={(v) => set('notes', v)} placeholder="Any notes about this config" />
        </div>

        <Footer>
          <button onClick={onClose} style={{...actionBtn('outline'), flex:1}}>Cancel</button>
          <button onClick={save} disabled={saving} style={{...actionBtn('dark'), flex:1}}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Save
          </button>
        </Footer>
      </div>
    </div>
  );
};

const AnnualIncreaseSheet = ({ year, onClose, onApplied }) => {
  const [percent, setPercent] = useState('10');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const apply = async () => {
    setApplying(true);
    try {
      const r = await api.post('/fees/components/increase', {
        from_year: year,
        increase_percent: parseFloat(percent),
      });
      toast.success(r.data.message || 'Increase applied');
      onApplied();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to apply'); }
    finally { setApplying(false); }
  };

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={{...panel, maxHeight:'auto'}}>
        <Handle />
        <Header title="Apply Annual Increase" sub={`From ${year}`} onClose={onClose} />
        <div style={body}>
          <p style={{fontSize:12,color:'#666',marginBottom:12,lineHeight:1.5}}>
            This will create new fee configurations for the next academic year by applying the given percentage increase to all monthly tuition and yearly fees.
          </p>
          <NumberField label="Increase Percentage (%)" value={percent} onChange={setPercent} />
        </div>
        <Footer>
          <button onClick={onClose} style={{...actionBtn('outline'), flex:1}}>Cancel</button>
          <button onClick={apply} disabled={applying} style={{...actionBtn('dark'), flex:1}}>
            {applying ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />} Apply
          </button>
        </Footer>
      </div>
    </div>
  );
};

// ─── Parent / Student view ─────────────────────────────────────────────────

const ParentStudentFees = ({ isParent }) => {
  const initialChildren = getCached('m-fees:children') || null;
  const [children, setChildren] = useState(initialChildren || []);
  const [selected, setSelected] = useState(initialChildren?.[0] || null);
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(!initialChildren);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [payIds, setPayIds] = useState([]);
  const [showPay, setShowPay] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/students');
        const list = r.data?.students ?? (Array.isArray(r.data) ? r.data : []);
        setChildren(list);
        setCached('m-fees:children', list);
        if (!selected && list[0]) setSelected(list[0]);
      } catch {} finally { setLoading(false); }
    })();
  }, []); // eslint-disable-line

  const loadLedger = useCallback(async (sid) => {
    if (!sid) return;
    setLoadingLedger(true);
    setPayIds([]);
    try {
      const r = await api.get(`/fees/ledger/${sid}`);
      setLedger(r.data);
    } catch { setLedger(null); }
    finally { setLoadingLedger(false); }
  }, []);

  useEffect(() => { if (selected) loadLedger(selected.student_id); }, [selected, loadLedger]);

  if (loading && children.length === 0) return (
    <div>
      <div className="m-header"><div><div className="m-skeleton" style={{width:100,height:24}} /></div></div>
      {[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:80,borderRadius:14,marginBottom:8}} />)}
    </div>
  );

  return (
    <div data-testid="m-fees-parent" style={{minWidth:0}}>
      <div className="m-header">
        <div><h1>My Fees</h1><p className="m-header-sub">{selected?.first_name} {selected?.last_name}</p></div>
      </div>

      {children.length > 1 && (
        <div className="m-chips" style={{marginBottom:12}}>
          {children.map(c => (
            <button key={c.student_id} className={`m-chip ${selected?.student_id === c.student_id ? 'active' : ''}`} onClick={() => setSelected(c)}>
              {c.first_name}
            </button>
          ))}
        </div>
      )}

      {/* No linked child — most common cause is parent_id missing on the
          students record. Tell the user instead of leaving the page blank. */}
      {!loading && children.length === 0 && (
        <div className="m-empty" style={{padding:24}}>
          <CreditCard className="m-empty-icon" />
          <p style={{fontWeight:600,color:'#1A1A1A'}}>No fee records yet</p>
          <p style={{fontSize:12,color:'#888',marginTop:6,maxWidth:300,marginLeft:'auto',marginRight:'auto',lineHeight:1.5}}>
            {isParent
              ? "We couldn't find a student linked to this parent account. Ask the school admin to link your child's record."
              : "Your fee ledger hasn't been set up yet. Ask the school admin if this is unexpected."}
          </p>
        </div>
      )}

      {loadingLedger && !ledger && children.length > 0 && (
        <div>{[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:80,borderRadius:14,marginBottom:8}} />)}</div>
      )}

      {/* Have a linked child but no ledger entries returned from /fees/ledger.
          Distinct from "no children linked" so the user knows the next step. */}
      {!loadingLedger && children.length > 0 && ledger && !(
        (ledger.ledger?.one_time?.length || 0) +
        (ledger.ledger?.yearly?.length || 0) +
        (ledger.ledger?.monthly?.length || 0)
      ) && (
        <div className="m-empty" style={{padding:24}}>
          <CreditCard className="m-empty-icon" />
          <p style={{fontWeight:600,color:'#1A1A1A'}}>No fee entries configured</p>
          <p style={{fontSize:12,color:'#888',marginTop:6,maxWidth:300,marginLeft:'auto',marginRight:'auto',lineHeight:1.5}}>
            Fee structure for {selected?.class_name}{selected?.section ? `-${selected.section}` : ''} hasn't been generated yet for the current academic year.
          </p>
        </div>
      )}

      {ledger && (
        <Ledger
          ledger={ledger}
          payIds={payIds}
          setPayIds={setPayIds}
          onPay={isParent ? () => setShowPay(true) : undefined}
          renderPayButton={!isParent ? ({ payIds: ids, total }) => (
            <MobileRazorpayButton
              studentId={selected?.student_id}
              ledgerIds={ids}
              amount={total}
              onSuccess={() => { setPayIds([]); loadLedger(selected.student_id); }}
            />
          ) : undefined}
        />
      )}

      {showPay && (
        <PaymentSheet
          studentId={selected.student_id}
          ledger={ledger}
          payIds={payIds}
          onClose={() => setShowPay(false)}
          onSuccess={() => { setShowPay(false); setPayIds([]); loadLedger(selected.student_id); }}
        />
      )}
    </div>
  );
};

// ─── Shared bits ───────────────────────────────────────────────────────────

const overlay = { position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:240, display:'flex', alignItems:'flex-end', justifyContent:'center' };
const panel = { background:'#FFF', width:'100%', maxWidth:520, borderTopLeftRadius:20, borderTopRightRadius:20, maxHeight:'94dvh', display:'flex', flexDirection:'column', paddingBottom:'env(safe-area-inset-bottom, 0)' };
const body = { overflowY:'auto', padding:16, flex:1 };

const Handle = () => (
  <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
    <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
  </div>
);

const Header = ({ title, sub, onClose }) => (
  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0',gap:8}}>
    <div style={{minWidth:0}}>
      <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>{title}</h2>
      {sub && <p style={{fontSize:11,color:'#888'}}>{sub}</p>}
    </div>
    <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888',flexShrink:0}}>
      <X size={20} />
    </button>
  </div>
);

const Footer = ({ children }) => (
  <div style={{display:'flex',gap:8,padding:12,borderTop:'1px solid #F0F0F0',background:'#FFF'}}>{children}</div>
);

const formLabel = { display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'#666', marginBottom:6 };

const FormInput = ({ label, value, onChange, type='text', placeholder }) => (
  <div style={{marginBottom:10}}>
    <label style={formLabel}>{label}</label>
    <input className="m-input" type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  </div>
);

const FormSelect = ({ label, value, onChange, options }) => (
  <div style={{marginBottom:10}}>
    <label style={formLabel}>{label}</label>
    <select className="m-input" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </div>
);

const NumberField = ({ label, value, onChange }) => (
  <div style={{marginBottom:10}}>
    <label style={formLabel}>{label}</label>
    <input
      className="m-input"
      type="number"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      min="0"
    />
  </div>
);

const chipBtn = (active, color = '#1A1A1A', bg = '#F0F0F0', border = '#E5E5E5') => ({
  padding:'6px 10px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer',
  background: active ? color : bg, color: active ? '#FFF' : color,
  border: `1px solid ${border}`,
  whiteSpace:'nowrap',
});

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

export default MobileFees;
