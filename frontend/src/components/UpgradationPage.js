import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { ArrowUpCircle, History, Search, CheckCircle2, AlertCircle, Loader2, Eye } from 'lucide-react';
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
  const [result, setResult] = useState(null);

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
      const res = await api.get('/students', { params: { search: search.trim() } });
      setStudents(res.data || []);
    } catch (e) {
      toast.error('Search failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setSearching(false);
    }
  }

  function selectStudent(s) {
    setSelected(s);
    setStudents([]);
    setSearch(`${s.first_name} ${s.last_name} (${s.admission_number || s.student_id})`);
    setResult(null);
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
    setUpgrading(true);
    try {
      const res = await api.post(`/students/${selected.student_id}/upgrade`, {
        to_class: toClass,
        to_section: toSection,
        to_stream: toStream || null,
        academic_year: toAcademicYear,
        notes,
      });
      setResult(res.data);
      toast.success(res.data.message || 'Student upgraded successfully');
    } catch (e) {
      toast.error('Upgrade failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setUpgrading(false);
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
      toast.error('Payment failed: ' + (e.response?.data?.detail || e.message));
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
      setHistory(res.data || []);
    } catch (e) {
      toast.error('Failed to load history: ' + (e.response?.data?.detail || e.message));
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
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-sm">
                <div className="font-semibold">{selected.first_name} {selected.last_name}</div>
                <div className="text-muted-foreground">
                  Current: {selected.class_name} – {selected.section}
                  {selected.stream ? ` (${selected.stream})` : ''}
                  &nbsp;|&nbsp;Adm# {selected.admission_number || '—'}
                </div>
              </div>
            )}
          </div>

          {/* Target class */}
          {selected && (
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
                </div>
              </div>
              <div className="space-y-1">
                <Label>Notes (optional)</Label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason for upgradation..." />
              </div>
              <Button onClick={doUpgrade} disabled={upgrading} className="bg-orange-500 hover:bg-orange-600 text-white">
                {upgrading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Upgrading...</> : 'Confirm Upgrade'}
              </Button>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="border rounded-2xl p-5 space-y-4 bg-green-50 border-green-200">
              <div className="flex items-center gap-2 text-green-700 font-semibold">
                <CheckCircle2 className="h-5 w-5" />
                Upgrade Successful
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">New Class:</div>
                <div className="font-medium">{result.new_class} – {result.new_section}{result.new_stream ? ` (${result.new_stream})` : ''}</div>
                <div className="text-muted-foreground">Ledger Entries Created:</div>
                <div className="font-medium">{result.ledger_entries_created}</div>
                {result.upgradation_fee > 0 && (
                  <>
                    <div className="text-muted-foreground">Upgradation Fee:</div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">₹{fmt(result.upgradation_fee)}</span>
                      {result.upgradation_fee_paid
                        ? <Badge className="bg-green-100 text-green-700">Paid — {result.receipt}</Badge>
                        : <Badge variant="destructive">Pending</Badge>
                      }
                    </div>
                  </>
                )}
              </div>
              {result.upgradation_fee > 0 && !result.upgradation_fee_paid && (
                <Button size="sm" onClick={() => setShowPayDialog(true)} className="bg-orange-500 hover:bg-orange-600 text-white">
                  Collect Upgradation Fee
                </Button>
              )}
            </div>
          )}
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
                          {r.upgradation_fee > 0 && !r.upgradation_fee_paid && (
                            <Button
                              size="sm"
                              className="bg-orange-500 hover:bg-orange-600 text-white"
                              onClick={() => {
                                setResult({
                                  student_id: r.student_id,
                                  upgradation_fee: r.upgradation_fee,
                                  upgradation_fee_paid: false,
                                });
                                setPayMethod('cash');
                                setPayTxn('');
                                setPayRemarks('');
                                setShowPayDialog(true);
                              }}
                              data-testid={`collect-${r.upgradation_id}`}
                            >
                              Collect Fee
                            </Button>
                          )}
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl">
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
