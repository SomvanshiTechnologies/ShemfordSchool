import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { ArrowUpCircle, History, Search, CheckCircle2, AlertCircle, Loader2, Eye, CreditCard, Check, X, Download } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { PAYMENT_METHODS_WITH_POS } from '../lib/paymentMethods';
import { useSession } from '../contexts/SessionContext';

const STREAMS = ['Science', 'Humanities'];
const CLASSES_WITH_STREAMS = ['Class 11', 'Class 12', '11th', '12th'];
const STREAM_SECTIONS = STREAMS.map(s => ({ section_name: s, capacity: 999 }));
const isStreamClass = (cn) => CLASSES_WITH_STREAMS.includes(cn) || /^(11|12)(th)?$/i.test((cn || '').replace(/^Class\s*/i, ''));

// Display "11th (Science)" for stream classes (the section is the stream);
// "5th – Blue" for colour-section classes.
const fmtClassSec = (cls, section, stream) => {
  if (!cls) return '—';
  if (isStreamClass(cls)) {
    const s = String(stream || section || '').trim();
    const pretty = s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
    return pretty ? `${cls} (${pretty})` : cls;
  }
  return `${cls}${section ? ` – ${section}` : ''}${stream ? ` (${stream})` : ''}`;
};

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default function UpgradationPage() {
  const { isAdmin } = useAuth();
  const { viewSession } = useSession();
  const [tab, setTab] = useState('upgrade');
  const [approvingId, setApprovingId] = useState(null);
  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const upgradingRef = React.useRef(false); // prevents double-submit before state re-renders

  // ── Upgrade tab state ──────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [classes, setClasses] = useState([]);
  const [toClass, setToClass] = useState('');
  const [toSection, setToSection] = useState('');
  const [toStream, setToStream] = useState('');
  const [toAcademicYear, setToAcademicYear] = useState('');
  const [notes, setNotes] = useState('');
  const [upgrading, setUpgrading] = useState(false);
  const [graduating, setGraduating] = useState(false);
  const [result, setResult] = useState(null);
  const [feeBlockMsg, setFeeBlockMsg] = useState(null);
  // True when the selected student had pending/overdue fees — even after the
  // dues are collected, their upgrade must go through admin approval (queued in
  // history) rather than upgrading immediately.
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [duesLoading, setDuesLoading] = useState(false);

  // Collect pending fees dialog
  const [showCollectDialog, setShowCollectDialog] = useState(false);
  const [collectSplitCash, setCollectSplitCash] = useState('');
  const [collectSplitOnline, setCollectSplitOnline] = useState('');
  const [collectPartial, setCollectPartial] = useState('');
  // Receipt preview shown right after a successful Collect Fee in either dialog
  const [receiptPreview, setReceiptPreview] = useState(null); // { url, paymentId, receiptNumber }
  const [pendingEntries, setPendingEntries] = useState([]);
  const [collectIds, setCollectIds] = useState([]);
  const [collectMethod, setCollectMethod] = useState('cash');
  const [collectTxn, setCollectTxn] = useState('');
  const [collectPaying, setCollectPaying] = useState(false);
  const [collectLoading, setCollectLoading] = useState(false);

  // Payment dialog state
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [payMethod, setPayMethod] = useState('cash');
  const [payTxn, setPayTxn] = useState('');
  const [payRemarks, setPayRemarks] = useState('');
  // Partial + split-payment additions to match Fees Management UX
  const [payAmount, setPayAmount] = useState('');
  const [paySplitCash, setPaySplitCash] = useState('');
  const [paySplitOnline, setPaySplitOnline] = useState('');
  const [paying, setPaying] = useState(false);

  // View dialog state (history → eye icon)
  const [viewRow, setViewRow] = useState(null);
  const [viewPayments, setViewPayments] = useState([]);
  const [viewPaymentsLoading, setViewPaymentsLoading] = useState(false);

  // ── History tab state ──────────────────────────────────────────────────────
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyYear, setHistoryYear] = useState('');

  useEffect(() => { loadClasses(); }, []);

  // Default the destination ("promote to") year to the year *after* the viewed
  // session — not the live clock — so promotions target the correct year for
  // whichever session is selected. (Overridden per-student on selection.)
  useEffect(() => {
    // Only seed the default before a student is picked — once a student is
    // selected, the target year is derived from THAT student's year (+1), so we
    // must not override it when the session finishes loading.
    if (selected) return;
    const m = /^(\d{4})-(\d{4})$/.exec(viewSession || '');
    if (m) {
      const start = parseInt(m[1], 10);
      setToAcademicYear(`${start + 1}-${start + 2}`);
    }
  }, [viewSession, selected]);

  async function loadClasses() {
    try {
      const res = await api.get('/classes');
      setClasses(res.data || []);
    } catch {
      // silently skip
    }
  }

  async function searchStudents() {
    if (!search.trim()) return;
    setSearching(true);
    try {
      // Scope to the session being viewed — a student only appears in their own
      // academic session (sent via the X-Academic-Year header). To promote a
      // given year's students, the admin switches to that session first.
      const res = await api.get('/students', { params: { search: search.trim(), limit: 20, name_only: true } });
      setStudents(res.data.students ?? res.data ?? []);
    } catch (e) {
      if (!e._handled) toast.error('Search failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setSearching(false);
    }
  }

  // Live search as the admin types (debounced 300ms). Skipped while a student
  // is already selected (the box then shows the picked student's name).
  useEffect(() => {
    if (selected) return;
    if (!search.trim()) { setStudents([]); return; }
    const t = setTimeout(() => { searchStudents(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, selected]);

  function selectStudent(s) {
    setSelected(s);
    setStudents([]);
    setSearch(`${s.first_name} ${s.last_name} (${s.admission_number || s.student_id})`);
    setResult(null);

    // Show fee warning + fetch pending dues immediately
    if (s.fee_status === 'pending' || s.fee_status === 'overdue') {
      const yr = s.academic_year || 'current year';
      setFeeBlockMsg(`Fees for ${yr} are ${s.fee_status}.`);
      setRequiresApproval(true);  // had dues → upgrade goes through approval
      setPendingEntries([]);
      setDuesLoading(true);
      api.get(`/fees/ledger/${s.student_id}`).then(res => {
        const ledger = res.data?.ledger || {};
        const all = [...(ledger.one_time || []), ...(ledger.yearly || []), ...(ledger.monthly || [])];
        const pending = all.filter(e => e.status === 'pending' || e.status === 'overdue');
        setPendingEntries(pending);
        setCollectIds(pending.map(e => e.ledger_id));
      }).catch(() => {}).finally(() => setDuesLoading(false));
    } else {
      setFeeBlockMsg(null);
      setRequiresApproval(false);  // clean account → direct upgrade
      setPendingEntries([]);
    }

    // Auto-advance to the next academic year based on student's current year
    if (s.academic_year && /^\d{4}-\d{4}$/.test(s.academic_year)) {
      const startYear = parseInt(s.academic_year.split('-')[0], 10);
      setToAcademicYear(`${startYear + 1}-${startYear + 2}`);
    }

    // Auto-pick the next class — use the active class list (sorted by sort_order)
    const active = (classes || []).filter(c => c.is_active);
    const idx = active.findIndex(c => c.name === s.class_name);
    if (idx >= 0 && idx + 1 < active.length) {
      const next = active[idx + 1];
      setToClass(next.name);
      setToSection('');
      setToStream('');
    } else {
      setToClass('');
    }
  }

  async function doUpgrade() {
    if (!selected || !toClass || !toSection) {
      toast.error('Select student, target class and section');
      return;
    }
    // For 11th/12th the section IS the stream — derive lowercase if not set.
    const effectiveStream = isStreamClass(toClass) ? (toStream || (toSection || '').toLowerCase()) : toStream;
    if (isStreamClass(toClass) && !effectiveStream) {
      toast.error(`Stream is required for ${toClass}`);
      return;
    }
    if (upgradingRef.current) return;
    upgradingRef.current = true;
    setUpgrading(true);
    try {
      const res = await api.post(`/students/${selected.student_id}/upgrade`, {
        to_class: toClass,
        to_section: toSection,
        to_stream: effectiveStream || null,
        academic_year: toAcademicYear,
        notes,
        // Students who had dues go through admin approval (queued in History);
        // clean accounts upgrade immediately (auto-approved).
        force_upgrade: requiresApproval,
      });
      toast.success(res.data.message || (res.data.auto_approved
        ? 'Student upgraded.'
        : 'Upgrade request sent to Upgradation History for approval.'));
      // Reset form for next upgrade
      setSelected(null);
      setSearch('');
      setToClass('');
      setToSection('');
      setToStream('');
      setNotes('');
      setFeeBlockMsg(null);
      setRequiresApproval(false);
      // Refresh history so the new record appears
      loadHistory();
    } catch (e) {
      if (!e._handled) {
        const detail = e.response?.data?.detail || '';
        const isFeeBlock = e.response?.status === 400 && detail.toLowerCase().includes('fees pending');
        if (isFeeBlock) {
          setFeeBlockMsg(detail);
        } else {
          toast.error(detail || e.message || 'Upgrade failed', { duration: 6000 });
        }
      }
    } finally {
      upgradingRef.current = false;
      setUpgrading(false);
    }
  }

  async function doGraduate() {
    if (!selected || graduating) return;
    setGraduating(true);
    try {
      const res = await api.post(`/students/${selected.student_id}/graduate`, { remarks: notes });
      toast.success(res.data.message);
      setResult({ graduated: true, message: res.data.message });
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Pass out failed', { duration: 6000 });
    } finally {
      setGraduating(false);
    }
  }

  async function openCollectDialog() {
    if (!selected) return;
    setCollectLoading(true);
    setCollectPartial('');
    setCollectSplitCash('');
    setCollectSplitOnline('');
    setShowCollectDialog(true);
    try {
      const res = await api.get(`/fees/ledger/${selected.student_id}`);
      const ledger = res.data?.ledger || {};
      const all = [...(ledger.one_time || []), ...(ledger.yearly || []), ...(ledger.monthly || [])];
      const entries = all.filter(e => e.status === 'pending' || e.status === 'overdue');
      setPendingEntries(entries);
      setCollectIds(entries.map(e => e.ledger_id));
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to load pending fees');
      setShowCollectDialog(false);
    } finally {
      setCollectLoading(false);
    }
  }

  // Fetch the receipt PDF and surface it in an inline preview modal —
  // called right after either Collect Fee flow succeeds.
  async function openReceiptPreview(paymentId, receiptNumber) {
    if (!paymentId) return;
    try {
      const res = await api.get(`/fees/receipt/${paymentId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      setReceiptPreview({ url, paymentId, receiptNumber });
    } catch {
      toast.error('Receipt generated but preview failed.');
    }
  }
  function closeReceiptPreview() {
    if (receiptPreview?.url) URL.revokeObjectURL(receiptPreview.url);
    setReceiptPreview(null);
  }

  async function payPendingFees() {
    if (!collectIds.length) { toast.error('Select at least one entry'); return; }
    const payload = {
      student_id: selected.student_id,
      ledger_ids: collectIds,
      payment_method: collectMethod,
      transaction_id: collectTxn || undefined,
    };
    // Partial payment only valid for a single selected entry.
    const partial = parseFloat(collectPartial);
    if (collectIds.length === 1 && collectPartial && partial > 0) {
      payload.amount = partial;
    } else if (collectPartial && collectIds.length !== 1) {
      toast.error('Partial payment supports exactly one selected fee.');
      return;
    }
    if (collectMethod === 'split') {
      const cash = parseFloat(collectSplitCash) || 0;
      const online = parseFloat(collectSplitOnline) || 0;
      if (cash <= 0 && online <= 0) { toast.error('Enter at least one split amount'); return; }
      payload.split_payments = { cash, online };
    }
    setCollectPaying(true);
    try {
      const res = await api.post('/fees/pay', payload);
      toast.success(res.data.message || 'Fees collected successfully');
      setShowCollectDialog(false);
      setCollectIds([]);
      setCollectTxn('');
      setCollectSplitCash('');
      setCollectSplitOnline('');
      setCollectPartial('');
      openReceiptPreview(res.data.payment?.payment_id, res.data.receipt_number);
      // Re-fetch student to update fee_status
      const sr = await api.get(`/students/${selected.student_id}`);
      const updatedStudent = sr.data;
      setSelected(updatedStudent);
      if (updatedStudent.fee_status === 'paid') {
        setFeeBlockMsg(null);
        // Dues cleared → if a target class & section are already chosen, queue
        // the upgrade for approval right away (matches the collect → history →
        // approve flow). Otherwise prompt to pick the target first.
        if (toClass && toSection) {
          toast.success('Fees cleared — sending to Upgradation History for approval.');
          doUpgrade();
        } else {
          toast.success(
            'All fees cleared. Pick the target class & section, then click "Send for Approval".',
            { duration: 6000 }
          );
        }
      }
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Payment failed');
    } finally {
      setCollectPaying(false);
    }
  }

  async function payUpgradationFee() {
    if (!result) return;
    const payload = {
      payment_method: payMethod,
      transaction_id: payTxn || null,
      remarks: payRemarks || 'Upgradation fee payment',
    };
    const partial = parseFloat(payAmount);
    if (payAmount && partial > 0) payload.amount = partial;
    if (payMethod === 'split') {
      const cash = parseFloat(paySplitCash) || 0;
      const online = parseFloat(paySplitOnline) || 0;
      if (cash <= 0 && online <= 0) { toast.error('Enter at least one split amount'); return; }
      payload.split_payments = { cash, online };
    }
    setPaying(true);
    try {
      const res = await api.post(`/students/${result.student_id}/upgrade/pay-fee`, payload);
      toast.success(res.data.message || 'Payment recorded');
      setShowPayDialog(false);
      setPayAmount(''); setPaySplitCash(''); setPaySplitOnline('');
      // Only flip the local "fee paid" flag when the backend reports full clearance
      const fullyPaid = !res.data.is_partial;
      setResult(prev => ({
        ...prev,
        upgradation_fee_paid: fullyPaid ? true : prev.upgradation_fee_paid,
        receipt: res.data.receipt_number,
      }));
      openReceiptPreview(res.data.payment?.payment_id, res.data.receipt_number);
      loadHistory();
    } catch (e) {
      if (!e._handled) toast.error('Payment failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setPaying(false);
    }
  }

  async function approveUpgrade(upgradationId) {
    if (approvingId) return;
    setApprovingId(upgradationId);
    try {
      const res = await api.post(`/upgradation/${upgradationId}/approve`);
      toast.success(res.data.message || 'Upgrade approved.');
      loadHistory();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to approve');
    } finally {
      setApprovingId(null);
    }
  }

  async function rejectUpgrade() {
    if (!rejectId) return;
    setApprovingId(rejectId);
    try {
      const res = await api.post(`/upgradation/${rejectId}/reject`, { reason: rejectReason });
      toast.success(res.data.message || 'Upgrade rejected.');
      setRejectId(null);
      setRejectReason('');
      loadHistory();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to reject');
    } finally {
      setApprovingId(null);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const params = {};
      // Only filter when the admin explicitly types a year. Upgrade records are
      // tagged with the TARGET year (what you promote INTO), so scoping to the
      // viewed (from) session would hide records you just created — e.g. a
      // 2025-2026 student queued for approval lives under 2026-2027.
      if (historyYear) params.academic_year = historyYear;
      const res = await api.get('/upgradation/history', { params });
      // Show every upgrade regardless of fee status; the Fee Status column will
      // reflect the current ledger state (Paid / Pending / Overdue).
      setHistory(res.data || []);
    } catch (e) {
      if (!e._handled) toast.error('Failed to load history: ' + (e.response?.data?.detail || e.message));
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, viewSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch all fee payments touching this upgradation's ledger entry so the
  // View Details dialog can show a per-payment timeline (partial payments
  // generate multiple receipts on the same upgradation_fee_ledger_id).
  useEffect(() => {
    if (!viewRow || !viewRow.student_id) { setViewPayments([]); return; }
    const ledgerId = viewRow.upgradation_fee_ledger_id;
    if (!ledgerId) { setViewPayments([]); return; }
    let active = true;
    setViewPaymentsLoading(true);
    api.get('/fees/payments', { params: { student_id: viewRow.student_id } })
      .then(res => {
        if (!active) return;
        const all = Array.isArray(res.data) ? res.data : [];
        const filtered = all.filter(p => (p.installment_ids || []).includes(ledgerId));
        filtered.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
        setViewPayments(filtered);
      })
      .catch(() => { if (active) setViewPayments([]); })
      .finally(() => { if (active) setViewPaymentsLoading(false); });
    return () => { active = false; };
  }, [viewRow]);

  const sectionOptions = toClass
    ? (isStreamClass(toClass) ? STREAM_SECTIONS : (classes.find(c => c.name === toClass)?.sections || []))
    : [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ArrowUpCircle className="h-7 w-7 text-orange-500" />
        <div>
          <h1 className="text-2xl font-bold">Class Upgradation</h1>
          <p className="text-sm text-muted-foreground">Promote students to new class / academic year</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b gap-1">
        {[
          { id: 'upgrade', label: 'Upgrade Student', icon: ArrowUpCircle },
          { id: 'history', label: 'Upgradation History', icon: History },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-orange-500 text-orange-600' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Upgrade Tab ──────────────────────────────────────────────────────── */}
      {tab === 'upgrade' && (
        <div className="space-y-6">
          {/* Student search */}
          <div className="border border-slate-200 rounded-2xl p-5 space-y-4">
            <h2 className="font-semibold text-base">Step 1 — Select Student</h2>

            <div className="flex gap-2">
              <Input
                placeholder="Search by name or admission number..."
                value={search}
                onChange={e => { setSearch(e.target.value); setSelected(null); }}
                onKeyDown={e => e.key === 'Enter' && searchStudents()}
                className="flex-1"
              />
              <Button onClick={searchStudents} disabled={searching} variant="outline">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {students.length > 0 && (
              <div className="border border-slate-200 rounded-xl divide-y max-h-48 overflow-y-auto">
                {students.map(s => (
                  <button
                    key={s.student_id}
                    onClick={() => selectStudent(s)}
                    className="w-full text-left px-4 py-2.5 hover:bg-muted text-sm flex items-center justify-between"
                  >
                    <div>
                      <span className="font-medium">{s.first_name} {s.last_name}</span>
                      <span className="text-muted-foreground ml-2">({s.admission_number || s.student_id})</span>
                    </div>
                    <Badge variant="outline">{s.class_name} – {s.section}</Badge>
                  </button>
                ))}
              </div>
            )}

            {selected && (
              <div className={`border rounded-xl p-3 text-sm ${selected.fee_status === 'overdue' || selected.fee_status === 'pending' ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200'}`}>
                <div className="font-semibold flex items-center gap-2">
                  {selected.first_name} {selected.last_name}
                  {(selected.fee_status === 'overdue' || selected.fee_status === 'pending') && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                      ⚠ {selected.fee_status === 'overdue' ? 'Fees Overdue' : 'Fees Pending'} — upgrade will be blocked
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground mt-0.5">
                  Current: {selected.class_name} – {selected.section}
                  {selected.stream ? ` (${selected.stream})` : ''}
                  &nbsp;|&nbsp;Adm# {selected.admission_number || '—'}
                  {selected.academic_year ? <>&nbsp;|&nbsp;Year: <span className="font-medium text-slate-700">{selected.academic_year}</span></> : ''}
                </div>
              </div>
            )}
          </div>

          {/* Graduate option for 12th class students */}
          {selected && selected.class_name === '12th' && !result && (
            <div className="border border-emerald-200 bg-emerald-50 rounded-2xl p-5 space-y-3">
              <h2 className="font-semibold text-base text-emerald-800">Step 2 — 12th Pass Out</h2>
              <p className="text-sm text-emerald-700">
                This student is in <strong>12th class</strong> — the final year. Mark them as <strong>Passed Out</strong> to deactivate the student record.
              </p>
              {(selected.fee_status === 'pending' || selected.fee_status === 'overdue') && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  ⚠ Student has {selected.fee_status} fees — pass out will be blocked until dues are cleared.
                </div>
              )}
              <div className="space-y-1">
                <Label>Remarks (optional)</Label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Passed Class 12 Board Exams 2027" />
              </div>
              <Button
                onClick={doGraduate}
                disabled={graduating}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {graduating ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Processing...</> : 'Mark as 12th Passed Out'}
              </Button>
            </div>
          )}

          {/* Target class — only for non-12th students */}
          {selected && selected.class_name !== '12th' && feeBlockMsg && (
            <div className="border border-red-200 bg-red-50 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-red-700">⚠ Cannot Upgrade — Fees Pending</p>
                <p className="text-xs text-red-500">{feeBlockMsg}</p>
              </div>

              {/* Pending dues table */}
              {duesLoading ? (
                <div className="flex items-center gap-2 text-sm text-red-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading pending dues...
                </div>
              ) : pendingEntries.length > 0 ? (
                <div className="rounded-xl border border-red-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-red-100">
                      <tr>
                        <th className="text-left px-3 py-2 text-red-700 font-medium">Fee</th>
                        <th className="text-left px-3 py-2 text-red-700 font-medium">Due Date</th>
                        <th className="text-left px-3 py-2 text-red-700 font-medium">Status</th>
                        <th className="text-right px-3 py-2 text-red-700 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-red-100">
                      {pendingEntries.map(e => (
                        <tr key={e.ledger_id}>
                          <td className="px-3 py-2 text-slate-700">{e.description || e.fee_component}</td>
                          <td className="px-3 py-2 text-slate-500">{e.due_date || '—'}</td>
                          <td className="px-3 py-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${e.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                              {e.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-slate-800">₹{fmt(e.net_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-red-50">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-sm font-semibold text-red-700">Total Pending</td>
                        <td className="px-3 py-2 text-right font-bold text-red-700">
                          ₹{fmt(pendingEntries.reduce((s, e) => s + e.net_amount, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : null}

              <Button
                onClick={openCollectDialog}
                className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-2"
              >
                <CreditCard className="h-4 w-4" /> Collect Fee
              </Button>
            </div>
          )}

          {selected && selected.class_name !== '12th' && (
            <div className="border border-slate-200 rounded-2xl p-5 space-y-4">
              <h2 className="font-semibold text-base">Step 2 — Target Class & Academic Year</h2>
              {feeBlockMsg && (
                <p className="text-xs text-amber-600">
                  Pick the target class &amp; section, then collect the fee above — the student will be sent to Upgradation History for approval.
                </p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>New Class</Label>
                  <Select value={toClass} onValueChange={v => { setToClass(v); setToSection(''); setToStream(''); }}>
                    <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const active = classes.filter(c => c.is_active);
                        const currentIdx = selected
                          ? active.findIndex(c => c.name === selected.class_name)
                          : -1;
                        // Only classes after the student's current class are valid targets.
                        // If we can't find the student's current class, fall through to showing all.
                        const eligible = currentIdx >= 0 ? active.slice(currentIdx + 1) : active;
                        return eligible.map(c => (
                          <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                        ));
                      })()}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>New Section</Label>
                  <Select
                    value={toSection}
                    onValueChange={v => {
                      setToSection(v);
                      if (isStreamClass(toClass)) setToStream(v.toLowerCase());
                    }}
                    disabled={!toClass}
                  >
                    <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                    <SelectContent>
                      {sectionOptions.map(s => (
                        <SelectItem key={s.section_name} value={s.section_name}>
                          {isStreamClass(toClass) ? s.section_name : `${s.section_name} (cap: ${s.capacity || 40})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Academic Year</Label>
                  <Input
                    value={toAcademicYear}
                    readOnly
                    disabled
                    placeholder="Auto-filled from student's current academic year"
                    className="bg-slate-50 cursor-not-allowed"
                  />
                  {selected?.academic_year && toAcademicYear && (
                    <p className="text-xs text-slate-500">
                      Upgrading from <span className="font-medium">{selected.academic_year}</span> → <span className="font-medium text-orange-600">{toAcademicYear}</span>
                      {selected.academic_year === toAcademicYear && (
                        <span className="ml-1 text-amber-600 font-medium">⚠ Same as current year</span>
                      )}
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <Label>Notes (optional)</Label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason for upgradation..." />
              </div>
              <Button
                onClick={doUpgrade}
                disabled={upgrading}
                className="bg-orange-500 hover:bg-orange-600 text-white"
              >
                {upgrading
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Processing...</>
                  : (requiresApproval ? 'Send for Approval' : 'Confirm Upgrade')}
              </Button>
            </div>
          )}

          {/* Result */}
          {result && result.graduated && (
            <div className="border rounded-2xl p-5 bg-emerald-50 border-emerald-200">
              <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                <CheckCircle2 className="h-5 w-5" />
                Student Passed Out (12th)
              </div>
              <p className="text-sm text-emerald-700 mt-2">{result.message}</p>
            </div>
          )}
          {/* Upgrade Successful box removed — toast notification is sufficient */}

        </div>
      )}

      {/* ── History Tab ──────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div className="space-y-4">
          <div className="flex gap-3 items-end">
            <div className="space-y-1">
              <Label>Filter by Academic Year</Label>
              <Input
                placeholder="e.g. 2025-2026"
                value={historyYear}
                onChange={e => setHistoryYear(e.target.value)}
                className="w-48"
              />
            </div>
            <Button variant="outline" onClick={loadHistory} disabled={historyLoading}>
              {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
            </Button>
          </div>

          {historyLoading && (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {!historyLoading && history.length === 0 && (
            <div className="text-center py-12 text-muted-foreground flex flex-col items-center gap-2">
              <AlertCircle className="h-6 w-6" />
              No upgradation records found.
            </div>
          )}

          {!historyLoading && history.length > 0 && (
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5">Student</th>
                    <th className="text-left px-4 py-2.5 min-w-[160px] whitespace-nowrap">From</th>
                    <th className="text-left px-4 py-2.5">To</th>
                    <th className="text-left px-4 py-2.5 min-w-[140px] whitespace-nowrap">Academic Year</th>
                    <th className="text-right px-4 py-2.5">Upg. Fee</th>
                    <th className="text-center px-4 py-2.5">Fee Status</th>
                    <th className="text-left px-4 py-2.5">Date</th>
                    <th className="text-center px-4 py-2.5">Status</th>
                    <th className="text-center px-4 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.map(r => (
                    <tr key={r.upgradation_id} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{r.student_name || r.student_id}</div>
                        <div className="text-xs text-muted-foreground">{r.admission_number}</div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{fmtClassSec(r.from_class, r.from_section, r.from_stream)}</td>
                      <td className="px-4 py-2.5">{fmtClassSec(r.to_class, r.to_section, r.to_stream)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{r.academic_year}</td>
                      <td className="px-4 py-2.5 text-right">{r.upgradation_fee > 0 ? `₹${fmt(r.upgradation_fee)}` : '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        {(r.status || 'pending_approval') === 'pending_approval' ? (
                          <span className="text-xs text-muted-foreground">— awaiting approval —</span>
                        ) : r.upgradation_fee > 0 ? (
                          r.upgradation_fee_status === 'paid' || r.upgradation_fee_paid
                            ? <Badge className="bg-green-100 text-green-700">Paid</Badge>
                            : r.upgradation_fee_status === 'overdue'
                              ? <Badge variant="destructive">Overdue</Badge>
                              : <Badge className="bg-amber-100 text-amber-700">Pending</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.created_at?.slice(0, 10) || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        {(() => {
                          // Only show "Approved" when the record explicitly has status="approved".
                          // Records without a status field (or status="pending_approval") are
                          // treated as pending until an admin marks them.
                          const st = r.status || 'pending_approval';
                          if (st === 'approved') return <Badge className="bg-green-100 text-green-700">Approved</Badge>;
                          if (st === 'rejected') return <Badge variant="destructive">Rejected</Badge>;
                          return <Badge className="bg-amber-100 text-amber-700">Pending Approval</Badge>;
                        })()}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {isAdmin && (r.status || 'pending_approval') === 'pending_approval' && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-green-600 hover:text-green-800 hover:bg-green-50"
                                onClick={() => approveUpgrade(r.upgradation_id)}
                                disabled={approvingId === r.upgradation_id}
                                title="Approve upgrade"
                              >
                                {approvingId === r.upgradation_id
                                  ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : <Check className="h-4 w-4" />}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600 hover:text-red-800 hover:bg-red-50"
                                onClick={() => { setRejectId(r.upgradation_id); setRejectReason(''); }}
                                disabled={approvingId === r.upgradation_id}
                                title="Reject upgrade"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {/* PDF download for any upgradation entry whose
                              fee has been paid (or partially paid — receipt
                              of the latest payment is stamped on the ledger). */}
                          {r.upgradation_fee_payment_id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openReceiptPreview(r.upgradation_fee_payment_id, r.upgradation_fee_receipt)}
                              title="View / download receipt"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setViewRow(r)}
                            data-testid={`view-${r.upgradation_id}`}
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Payment Dialog ───────────────────────────────────────────────────── */}
      {showPayDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-4 sm:p-6 w-full max-w-sm space-y-4 shadow-xl max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">Collect Upgradation Fee</h3>
            <p className="text-sm text-muted-foreground">
              Amount: <strong>₹{fmt(result?.upgradation_fee)}</strong>
            </p>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Amount to collect <span className="text-slate-400 font-normal">(leave blank to pay in full)</span></Label>
                <Input
                  type="number" min="0" step="0.01" max={result?.upgradation_fee}
                  placeholder={`Full: ₹${fmt(result?.upgradation_fee)}`}
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                />
                <p className="text-[10px] text-slate-400">Enter a smaller amount to record a partial payment.</p>
              </div>
              <div className="space-y-1">
                <Label>Payment Method</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS_WITH_POS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {payMethod === 'split' && (
                <div className="grid grid-cols-2 gap-2 p-3 rounded-xl border border-orange-200 bg-orange-50">
                  <div className="space-y-1">
                    <Label className="text-xs">Cash</Label>
                    <Input type="number" min={0} step="0.01" value={paySplitCash} onChange={e => setPaySplitCash(e.target.value)} placeholder="0" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Online</Label>
                    <Input type="number" min={0} step="0.01" value={paySplitOnline} onChange={e => setPaySplitOnline(e.target.value)} placeholder="0" />
                  </div>
                  <p className="col-span-2 text-[10px] text-slate-500">
                    Cash + Online must equal the amount being collected.
                  </p>
                </div>
              )}
              {payMethod !== 'cash' && payMethod !== 'split' && (
                <div className="space-y-1">
                  <Label>Transaction ID</Label>
                  <Input value={payTxn} onChange={e => setPayTxn(e.target.value)} placeholder="UTR / cheque no." />
                </div>
              )}
              <div className="space-y-1">
                <Label>Remarks</Label>
                <Input value={payRemarks} onChange={e => setPayRemarks(e.target.value)} placeholder="Optional note" />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowPayDialog(false)}>Cancel</Button>
              <Button onClick={payUpgradationFee} disabled={paying} className="bg-orange-500 hover:bg-orange-600 text-white">
                {paying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Confirm Payment
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Collect Pending Fees Dialog ──────────────────────────────────────── */}
      {showCollectDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-4 sm:p-6 w-full max-w-md space-y-4 shadow-xl max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">Collect Pending Fees</h3>
            <p className="text-sm text-muted-foreground">Student: <strong>{selected?.first_name} {selected?.last_name}</strong></p>
            {collectLoading ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /></div>
            ) : pendingEntries.length === 0 ? (
              <p className="text-sm text-green-600">No pending fees found.</p>
            ) : (
              <div className="space-y-3">
                <div className="max-h-48 overflow-y-auto space-y-1 border rounded-lg p-2">
                  {pendingEntries.map(e => (
                    <label key={e.ledger_id} className="flex items-center gap-3 text-sm cursor-pointer hover:bg-slate-50 rounded px-2 py-1">
                      <input
                        type="checkbox"
                        checked={collectIds.includes(e.ledger_id)}
                        onChange={ev => setCollectIds(prev => ev.target.checked ? [...prev, e.ledger_id] : prev.filter(id => id !== e.ledger_id))}
                      />
                      <span className="flex-1">{e.description || e.fee_component}</span>
                      <span className="font-medium">₹{fmt(e.net_amount)}</span>
                    </label>
                  ))}
                </div>
                <p className="text-sm font-medium text-right">
                  Total: ₹{fmt(pendingEntries.filter(e => collectIds.includes(e.ledger_id)).reduce((s, e) => s + (e.remaining_balance > 0 ? e.remaining_balance : e.net_amount), 0))}
                </p>
                {collectIds.length === 1 && (() => {
                  const entry = pendingEntries.find(e => e.ledger_id === collectIds[0]);
                  const remaining = Number(entry?.remaining_balance ?? entry?.net_amount ?? 0);
                  return (
                    <div className="space-y-1">
                      <Label>Amount to collect <span className="text-slate-400 font-normal">(blank = full)</span></Label>
                      <Input
                        type="number" min="0" step="0.01" max={remaining}
                        placeholder={`Full: ₹${fmt(remaining)}`}
                        value={collectPartial}
                        onChange={e => setCollectPartial(e.target.value)}
                      />
                      <p className="text-[10px] text-slate-400">Enter a smaller amount to record a partial payment.</p>
                    </div>
                  );
                })()}
                <div className="space-y-1">
                  <Label>Payment Method</Label>
                  <Select value={collectMethod} onValueChange={setCollectMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS_WITH_POS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {collectMethod === 'split' && (
                  <div className="grid grid-cols-2 gap-2 p-3 rounded-xl border border-orange-200 bg-orange-50">
                    <div className="space-y-1">
                      <Label className="text-xs">Cash</Label>
                      <Input type="number" min={0} step="0.01" value={collectSplitCash} onChange={e => setCollectSplitCash(e.target.value)} placeholder="0" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Online</Label>
                      <Input type="number" min={0} step="0.01" value={collectSplitOnline} onChange={e => setCollectSplitOnline(e.target.value)} placeholder="0" />
                    </div>
                    <p className="col-span-2 text-[10px] text-slate-500">
                      Cash + Online must equal the total being collected.
                    </p>
                  </div>
                )}
                {collectMethod !== 'cash' && collectMethod !== 'split' && (
                  <div className="space-y-1">
                    <Label>Transaction ID</Label>
                    <Input value={collectTxn} onChange={e => setCollectTxn(e.target.value)} placeholder="UTR / cheque no." />
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowCollectDialog(false)}>Cancel</Button>
              {!collectLoading && pendingEntries.length > 0 && (
                <Button onClick={payPendingFees} disabled={collectPaying || !collectIds.length} className="bg-orange-500 hover:bg-orange-600 text-white">
                  {collectPaying ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Processing...</> : 'Confirm Payment'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── View Details Dialog ─────────────────────────────────────────────── */}
      {viewRow && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setViewRow(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Upgradation Details</h3>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Student</dt>
                <dd className="font-medium text-right">{viewRow.student_name || viewRow.student_id}</dd>
              </div>
              {viewRow.admission_number && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Admission No.</dt>
                  <dd className="font-medium text-right">{viewRow.admission_number}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">From</dt>
                <dd className="font-medium text-right">
                  {fmtClassSec(viewRow.from_class, viewRow.from_section, viewRow.from_stream)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">To</dt>
                <dd className="font-medium text-right">
                  {fmtClassSec(viewRow.to_class, viewRow.to_section, viewRow.to_stream)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Academic Year</dt>
                <dd className="font-medium text-right">{viewRow.academic_year}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Upgradation Fee</dt>
                <dd className="font-medium text-right">
                  {viewRow.upgradation_fee > 0 ? `₹${fmt(viewRow.upgradation_fee)}` : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4 items-center">
                <dt className="text-muted-foreground">Fee Status</dt>
                <dd className="text-right">
                  {viewRow.upgradation_fee > 0
                    ? viewRow.upgradation_fee_paid
                      ? <Badge className="bg-green-100 text-green-700">Paid</Badge>
                      : <Badge variant="destructive">Pending</Badge>
                    : <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
              {viewRow.notes && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="font-medium text-right">{viewRow.notes}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Performed on</dt>
                <dd className="font-medium text-right">{viewRow.created_at?.slice(0, 10) || '—'}</dd>
              </div>
            </dl>

            {/* Payments timeline — useful for partial payments where each
                receipt has its own row + amount. */}
            {viewRow.upgradation_fee > 0 && (
              <div className="mt-5 pt-4 border-t">
                <p className="text-sm font-semibold mb-2">Payment History</p>
                {viewPaymentsLoading ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</p>
                ) : viewPayments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No payments recorded yet.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                    {viewPayments.map(p => (
                      <li key={p.payment_id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">
                            ₹{fmt(p.amount)} <span className="font-normal text-muted-foreground">· {(p.payment_method || 'cash').replace('_', ' ')}</span>
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {p.payment_date || p.created_at?.slice(0, 10)}
                            {p.receipt_number && <> · {p.receipt_number}</>}
                          </p>
                        </div>
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2 text-xs shrink-0"
                          onClick={() => openReceiptPreview(p.payment_id, p.receipt_number)}
                          title="Preview / download receipt"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-end pt-4">
              <Button variant="outline" onClick={() => setViewRow(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject Confirmation Dialog ──────────────────────────────────────── */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => !approvingId && setRejectId(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg">Reject Upgrade Request</h3>
            <p className="text-sm text-muted-foreground">
              The student will remain in their current class. This action cannot be undone.
            </p>
            <div className="space-y-1">
              <Label>Reason (optional)</Label>
              <Input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Fees still pending"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRejectId(null)} disabled={!!approvingId}>Cancel</Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={rejectUpgrade}
                disabled={!!approvingId}
              >
                {approvingId === rejectId && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Confirm Reject
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt preview shown right after a successful Collect Fee */}
      {receiptPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="font-semibold text-sm">Payment recorded</span>
                {receiptPreview.receiptNumber && (
                  <span className="text-xs font-mono text-muted-foreground ml-2">
                    Receipt: {receiptPreview.receiptNumber}
                  </span>
                )}
              </div>
              <button onClick={closeReceiptPreview} className="text-slate-400 hover:text-slate-900" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 min-h-[60vh] bg-slate-100">
              <iframe src={receiptPreview.url} title="Fee receipt" className="w-full h-full min-h-[60vh] border-0" />
            </div>
            <div className="flex justify-end gap-2 p-3 border-t">
              <Button variant="outline" size="sm" onClick={() => window.open(receiptPreview.url, '_blank')}>
                <Eye className="h-4 w-4 mr-2" /> Open in new tab
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                const a = document.createElement('a');
                a.href = receiptPreview.url;
                a.download = `receipt-${receiptPreview.receiptNumber || 'fee'}.pdf`;
                document.body.appendChild(a); a.click(); a.remove();
              }}>
                <Download className="h-4 w-4 mr-2" /> Download PDF
              </Button>
              <Button size="sm" onClick={closeReceiptPreview}>Done</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
