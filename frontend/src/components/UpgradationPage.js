import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { ArrowUpCircle, History, Search, CheckCircle2, AlertCircle, Loader2, Eye, CreditCard } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import api from '../lib/api';

const STREAMS = ['Science', 'Arts', 'Commerce'];
const CLASSES_WITH_STREAMS = ['Class 11', 'Class 12'];

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default function UpgradationPage() {
  const [tab, setTab] = useState('upgrade');
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
  const [duesLoading, setDuesLoading] = useState(false);

  // Collect pending fees dialog
  const [showCollectDialog, setShowCollectDialog] = useState(false);
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
  const [paying, setPaying] = useState(false);

  // View dialog state (history → eye icon)
  const [viewRow, setViewRow] = useState(null);

  // ── History tab state ──────────────────────────────────────────────────────
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyYear, setHistoryYear] = useState('');

  useEffect(() => {
    // Default academic year = current
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    setToAcademicYear(month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`);
    loadClasses();
  }, []);

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
      const res = await api.get('/students', { params: { search: search.trim(), limit: 20 } });
      setStudents(res.data.students ?? res.data ?? []);
    } catch (e) {
      if (!e._handled) toast.error('Search failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setSearching(false);
    }
  }

  function selectStudent(s) {
    setSelected(s);
    setStudents([]);
    setSearch(`${s.first_name} ${s.last_name} (${s.admission_number || s.student_id})`);
    setResult(null);

    // Show fee warning + fetch pending dues immediately
    if (s.fee_status === 'pending' || s.fee_status === 'overdue') {
      const yr = s.academic_year || 'current year';
      setFeeBlockMsg(`Fees for ${yr} are ${s.fee_status}.`);
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
      setPendingEntries([]);
    }

    // Auto-advance to the next academic year based on student's current year
    if (s.academic_year && /^\d{4}-\d{4}$/.test(s.academic_year)) {
      const startYear = parseInt(s.academic_year.split('-')[0], 10);
      setToAcademicYear(`${startYear + 1}-${startYear + 2}`);
    }
  }

  async function doUpgrade() {
    if (!selected || !toClass || !toSection) {
      toast.error('Select student, target class and section');
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
      const res = await api.post(`/students/${selected.student_id}/upgrade`, {
        to_class: toClass,
        to_section: toSection,
        to_stream: toStream || null,
        academic_year: toAcademicYear,
        notes,
      });
      toast.success(res.data.message || 'Student upgraded successfully');
      // If an upgradation fee is due, open the payment dialog immediately
      if (res.data.upgradation_fee > 0 && !res.data.upgradation_fee_paid) {
        setResult(res.data);
        setPayMethod('cash');
        setPayTxn('');
        setPayRemarks('');
        setShowPayDialog(true);
      }
      // Reset form for next upgrade
      setSelected(null);
      setSearch('');
      setToClass('');
      setToSection('');
      setToStream('');
      setNotes('');
      setFeeBlockMsg(null);
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

  async function payPendingFees() {
    if (!collectIds.length) { toast.error('Select at least one entry'); return; }
    setCollectPaying(true);
    try {
      const res = await api.post('/fees/pay', {
        student_id: selected.student_id,
        ledger_ids: collectIds,
        payment_method: collectMethod,
        transaction_id: collectTxn || undefined,
      });
      toast.success(res.data.message || 'Fees collected successfully');
      setShowCollectDialog(false);
      setCollectIds([]);
      setCollectTxn('');
      // Re-fetch student to update fee_status
      const sr = await api.get(`/students/${selected.student_id}`);
      const updatedStudent = sr.data;
      setSelected(updatedStudent);
      if (updatedStudent.fee_status === 'paid') {
        setFeeBlockMsg(null);
        toast.success('All fees cleared — you can now upgrade the student.');
      }
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Payment failed');
    } finally {
      setCollectPaying(false);
    }
  }

  async function payUpgradationFee() {
    if (!result) return;
    setPaying(true);
    try {
      const res = await api.post(`/students/${result.student_id}/upgrade/pay-fee`, {
        payment_method: payMethod,
        transaction_id: payTxn || null,
        remarks: payRemarks || 'Upgradation fee payment',
      });
      toast.success(res.data.message || 'Payment recorded');
      setShowPayDialog(false);
      setResult(prev => ({ ...prev, upgradation_fee_paid: true, receipt: res.data.receipt_number }));
      // Refresh history so the row's Fee Status flips from Pending/overdue to Paid
      loadHistory();
    } catch (e) {
      if (!e._handled) toast.error('Payment failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setPaying(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const params = {};
      if (historyYear) params.academic_year = historyYear;
      const res = await api.get('/upgradation/history', { params });
      const all = res.data || [];
      // Only show completed upgrades — fee paid or no fee charged
      setHistory(all.filter(r => r.upgradation_fee === 0 || r.upgradation_fee_paid === true));
    } catch (e) {
      if (!e._handled) toast.error('Failed to load history: ' + (e.response?.data?.detail || e.message));
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const sectionOptions = toClass
    ? (classes.find(c => c.name === toClass)?.sections || [])
    : [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
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

          {selected && selected.class_name !== '12th' && !feeBlockMsg && (
            <div className="border border-slate-200 rounded-2xl p-5 space-y-4">
              <h2 className="font-semibold text-base">Step 2 — Target Class & Academic Year</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>New Class</Label>
                  <Select value={toClass} onValueChange={v => { setToClass(v); setToSection(''); setToStream(''); }}>
                    <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                    <SelectContent>
                      {classes.filter(c => c.is_active).map(c => (
                        <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>New Section</Label>
                  <Select value={toSection} onValueChange={setToSection} disabled={!toClass}>
                    <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                    <SelectContent>
                      {sectionOptions.map(s => (
                        <SelectItem key={s.section_name} value={s.section_name}>
                          {s.section_name} (cap: {s.capacity || 40})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {CLASSES_WITH_STREAMS.includes(toClass) && (
                  <div className="space-y-1">
                    <Label>Stream <span className="text-red-500">*</span></Label>
                    <Select value={toStream} onValueChange={setToStream}>
                      <SelectTrigger><SelectValue placeholder="Select stream" /></SelectTrigger>
                      <SelectContent>
                        {STREAMS.map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Academic Year</Label>
                  <Input value={toAcademicYear} onChange={e => setToAcademicYear(e.target.value)} placeholder="e.g. 2025-2026" />
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
                {upgrading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Upgrading...</> : 'Confirm Upgrade'}
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
                    <th className="text-left px-4 py-2.5">From</th>
                    <th className="text-left px-4 py-2.5">To</th>
                    <th className="text-left px-4 py-2.5">Acad. Year</th>
                    <th className="text-right px-4 py-2.5">Upg. Fee</th>
                    <th className="text-center px-4 py-2.5">Fee Status</th>
                    <th className="text-left px-4 py-2.5">Date</th>
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
                      <td className="px-4 py-2.5">{r.from_class} – {r.from_section}{r.from_stream ? ` (${r.from_stream})` : ''}</td>
                      <td className="px-4 py-2.5">{r.to_class} – {r.to_section}{r.to_stream ? ` (${r.to_stream})` : ''}</td>
                      <td className="px-4 py-2.5">{r.academic_year}</td>
                      <td className="px-4 py-2.5 text-right">{r.upgradation_fee > 0 ? `₹${fmt(r.upgradation_fee)}` : '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        {r.upgradation_fee > 0
                          ? r.upgradation_fee_paid
                            ? <Badge className="bg-green-100 text-green-700">Paid</Badge>
                            : <Badge variant="destructive">Pending</Badge>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.created_at?.slice(0, 10) || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
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
                <Label>Payment Method</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['cash', 'upi', 'cheque', 'bank_transfer', 'card'].map(m => (
                      <SelectItem key={m} value={m}>{m.replace('_', ' ').toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {payMethod !== 'cash' && (
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
                  Total: ₹{fmt(pendingEntries.filter(e => collectIds.includes(e.ledger_id)).reduce((s, e) => s + e.net_amount, 0))}
                </p>
                <div className="space-y-1">
                  <Label>Payment Method</Label>
                  <Select value={collectMethod} onValueChange={setCollectMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['cash', 'upi', 'cheque', 'bank_transfer', 'card'].map(m => (
                        <SelectItem key={m} value={m}>{m.replace('_', ' ').toUpperCase()}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {collectMethod !== 'cash' && (
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
                  {viewRow.from_class} – {viewRow.from_section}{viewRow.from_stream ? ` (${viewRow.from_stream})` : ''}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">To</dt>
                <dd className="font-medium text-right">
                  {viewRow.to_class} – {viewRow.to_section}{viewRow.to_stream ? ` (${viewRow.to_stream})` : ''}
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
            <div className="flex justify-end pt-4">
              <Button variant="outline" onClick={() => setViewRow(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
