import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { toast } from 'sonner';
import {
  Search, CreditCard, FileText, AlertTriangle, Loader2, Mail,
  Settings, TrendingUp, ChevronDown, ChevronRight, CheckCircle2,
  Clock, XCircle, Download, Plus, Edit2, RefreshCw, BookOpen
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { RazorpayCheckout } from './RazorpayCheckout';

const FEE_COMPONENTS = [
  { key: 'registration_fee', label: 'Registration Fee', type: 'one_time', tip: 'One-time fee at time of inquiry/registration' },
  { key: 'admission_fee', label: 'Admission Fee', type: 'one_time', tip: 'One-time fee at time of admission (50% sibling discount applies)' },
  { key: 'caution_deposit', label: 'Caution Deposit', type: 'one_time', tip: 'Refundable security deposit' },
  { key: 'annual_charge', label: 'Annual Charge', type: 'yearly', tip: 'Charged once per academic year' },
  { key: 'activity_fee', label: 'Activity Fee', type: 'yearly', tip: 'Charged once per academic year' },
  { key: 'exam_fee', label: 'Exam Fee', type: 'yearly', tip: 'Charged once per academic year' },
  { key: 'lab_fee', label: 'Lab Fee', type: 'yearly', tip: 'For science/computer streams and classes 9–12' },
  { key: 'ai_robotics_fee', label: 'AI & Robotics Fee', type: 'yearly', tip: 'Yearly AI & Robotics fee (Class IX & X only)' },
  { key: 'monthly_tuition', label: 'Monthly Tuition', type: 'monthly', tip: '1st month collected at admission; 15% sibling discount applies' },
  { key: 'upgradation_fee', label: 'Upgradation Fee', type: 'one_time', tip: 'Charged when student is promoted to next class' },
  { key: 'late_fee', label: 'Late Fee (per month)', type: 'monthly', tip: 'Penalty applied after due date if enabled' },
];

const TYPE_COLORS = {
  one_time: 'bg-blue-50 text-blue-700 border-blue-200',
  yearly: 'bg-purple-50 text-purple-700 border-purple-200',
  monthly: 'bg-green-50 text-green-700 border-green-200',
};

const STATUS_COLORS = {
  paid: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border border-amber-200',
  overdue: 'bg-red-50 text-red-600 border border-red-200',
  waived: 'bg-gray-50 text-gray-500 border border-gray-200',
};

const CURRENT_YEAR = (() => {
  const now = new Date();
  return now.getMonth() >= 3 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;
})();

const ACADEMIC_YEARS = [CURRENT_YEAR,
  (() => { const [s] = CURRENT_YEAR.split('-'); return `${+s + 1}-${+s + 2}`; })(),
  (() => { const [s] = CURRENT_YEAR.split('-'); return `${+s - 1}-${+s}`; })(),
];

// ─── Small helpers ────────────────────────────────────────────────────────────

const fmt = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0 })}` : '—';

const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium capitalize ${STATUS_COLORS[status] || 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
    {status === 'paid' && <CheckCircle2 className="h-3 w-3" />}
    {status === 'overdue' && <AlertTriangle className="h-3 w-3" />}
    {status === 'pending' && <Clock className="h-3 w-3" />}
    {status}
  </span>
);

// ─── Main Component ───────────────────────────────────────────────────────────

const FeesPage = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const isParent = user?.role === 'parent';
  const isStudent = user?.role === 'student';
  const isAdmin = user?.role === 'admin' || user?.role === 'accountant';

  const [activeTab, setActiveTab] = useState(
    searchParams.get('tab') || (isParent || isStudent ? 'my-fees' : 'config')
  );
  const [loading, setLoading] = useState(true);

  // Fee component config state
  const [feeConfigs, setFeeConfigs] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);
  const [configForm, setConfigForm] = useState({});
  const [savingConfig, setSavingConfig] = useState(false);

  // Annual increase
  const [showIncreaseDialog, setShowIncreaseDialog] = useState(false);
  const [increasePercent, setIncreasePercent] = useState(10);
  const [applyingIncrease, setApplyingIncrease] = useState(false);

  // Student ledger / collect
  const [students, setStudents] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [studentLedger, setStudentLedger] = useState(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [myChildren, setMyChildren] = useState([]);

  // Payment dialog
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [payLedgerIds, setPayLedgerIds] = useState([]);
  const [payForm, setPayForm] = useState({ method: 'cash', transaction_id: '', remarks: '' });
  const [processingPayment, setProcessingPayment] = useState(false);

  // Admission fee payment dialog
  const [showAdmissionPayDialog, setShowAdmissionPayDialog] = useState(false);
  const [admissionPayForm, setAdmissionPayForm] = useState({ method: 'cash', transaction_id: '', remarks: '' });
  const [processingAdmissionPay, setProcessingAdmissionPay] = useState(false);

  // Due chart
  const [dueChart, setDueChart] = useState([]);
  const [dueSearch, setDueSearch] = useState('');

  // Concessions
  const [concessions, setConcessions] = useState([]);
  const [showConcessionDialog, setShowConcessionDialog] = useState(false);
  const [concessionForm, setConcessionForm] = useState({ student_id: '', concession_percent: '', reason: '' });
  const [applyingConcession, setApplyingConcession] = useState(false);

  // Reminders
  const [sendingReminders, setSendingReminders] = useState(false);

  // Refresh overdue
  const [refreshingOverdue, setRefreshingOverdue] = useState(false);

  // ── Fetch data ────────────────────────────────────────────────────────────

  const fetchConfigs = useCallback(async () => {
    try {
      const [cfgRes, clsRes] = await Promise.all([
        api.get('/fees/components', { params: { academic_year: selectedYear } }).catch(() => ({ data: [] })),
        api.get('/classes').catch(() => ({ data: [] })),
      ]);
      setFeeConfigs(cfgRes.data);
      setClasses(clsRes.data);
    } catch {}
  }, [selectedYear]);

  const fetchAdminData = useCallback(async () => {
    try {
      const [studRes, dueRes, concRes] = await Promise.all([
        api.get('/students', { params: { is_active: true, limit: 500 } }).catch(() => ({ data: [] })),
        api.get('/fees/due-chart').catch(() => ({ data: [] })),
        api.get('/fees/concessions').catch(() => ({ data: [] })),
      ]);
      setStudents(Array.isArray(studRes.data) ? studRes.data : []);
      setDueChart(Array.isArray(dueRes.data) ? dueRes.data : []);
      setConcessions(Array.isArray(concRes.data) ? concRes.data : []);
    } catch {}
  }, []);

  const fetchParentData = useCallback(async () => {
    try {
      const res = await api.get('/students');
      const list = Array.isArray(res.data) ? res.data : [];
      setMyChildren(list);
      // Only set default child once — use functional update to avoid stale closure
      setSelectedStudentId(prev => prev || list[0]?.student_id || '');
    } catch {}
  }, []);

  useEffect(() => {
    setLoading(true);
    const init = async () => {
      if (isParent || isStudent) {
        await fetchParentData();
      } else {
        await Promise.all([fetchConfigs(), fetchAdminData()]);
      }
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (isAdmin) fetchConfigs();
  }, [selectedYear]);

  useEffect(() => {
    if (!selectedStudentId) return;
    setPayLedgerIds([]);
    setStudentLedger(null);
    setLoadingLedger(true);
    const controller = new AbortController();
    api.get(`/fees/ledger/${selectedStudentId}`, { signal: controller.signal })
      .then(res => setStudentLedger(res.data))
      .catch(err => { if (!controller.signal.aborted) setStudentLedger(null); })
      .finally(() => { if (!controller.signal.aborted) setLoadingLedger(false); });
    return () => controller.abort();
  }, [selectedStudentId]);

  // ── Config form helpers ───────────────────────────────────────────────────

  const openConfigDialog = (existing = null, classDefault = '') => {
    if (existing) {
      setEditingConfig(existing);
      setConfigForm({ ...existing });
    } else {
      setEditingConfig(null);
      setConfigForm({
        class_name: classDefault,
        stream: '',
        academic_year: selectedYear,
        registration_fee: 0, admission_fee: 0, caution_deposit: 0,
        annual_charge: 0, activity_fee: 0, exam_fee: 0, lab_fee: 0,
        monthly_tuition: 0, upgradation_fee: 0,
        due_day: 10, late_fee: 0, late_fee_enabled: false,
        sibling_admission_discount_amount: 0,
        sibling_tuition_discount_amount: 0,
        notes: '',
      });
    }
    setShowConfigDialog(true);
  };

  const saveConfig = async () => {
    if (!configForm.class_name) { toast.error('Class is required'); return; }
    setSavingConfig(true);
    try {
      if (editingConfig?.config_id) {
        await api.put(`/fees/components/${editingConfig.config_id}`, configForm);
      } else {
        await api.post('/fees/components', configForm);
      }
      toast.success('Fee configuration saved');
      setShowConfigDialog(false);
      fetchConfigs();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save configuration');
    } finally { setSavingConfig(false); }
  };

  const applyAnnualIncrease = async () => {
    setApplyingIncrease(true);
    try {
      const res = await api.post('/fees/components/increase', {
        from_year: selectedYear,
        increase_percent: parseFloat(increasePercent),
      });
      toast.success(res.data.message);
      setShowIncreaseDialog(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to apply increase');
    } finally { setApplyingIncrease(false); }
  };

  // ── Payment helpers ───────────────────────────────────────────────────────

  const paySelected = async () => {
    if (!payLedgerIds.length) { toast.error('Select at least one entry to pay'); return; }
    setProcessingPayment(true);
    try {
      const res = await api.post('/fees/pay', {
        student_id: selectedStudentId,
        ledger_ids: payLedgerIds,
        payment_method: payForm.method,
        transaction_id: payForm.transaction_id || undefined,
        remarks: payForm.remarks || undefined,
      });
      toast.success(res.data.message);
      setShowPayDialog(false);
      setPayLedgerIds([]);
      const lr = await api.get(`/fees/ledger/${selectedStudentId}`);
      setStudentLedger(lr.data);
      fetchAdminData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Payment failed');
    } finally { setProcessingPayment(false); }
  };

  const payAdmissionFees = async () => {
    setProcessingAdmissionPay(true);
    try {
      const res = await api.post('/fees/admission-payment', {
        student_id: selectedStudentId,
        payment_method: admissionPayForm.method,
        transaction_id: admissionPayForm.transaction_id || undefined,
        remarks: admissionPayForm.remarks || 'Admission fee collection',
      });
      toast.success(res.data.message);
      setShowAdmissionPayDialog(false);
      const lr = await api.get(`/fees/ledger/${selectedStudentId}`);
      setStudentLedger(lr.data);
      fetchAdminData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Admission payment failed');
    } finally { setProcessingAdmissionPay(false); }
  };

  const downloadReceipt = async (paymentId) => {
    try {
      const res = await api.get(`/fees/receipt/${paymentId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt_${paymentId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download receipt');
    }
  };

  const selectedStudentIdRef = useRef(selectedStudentId);
  useEffect(() => { selectedStudentIdRef.current = selectedStudentId; }, [selectedStudentId]);

  const handleRazorpaySuccess = useCallback(async () => {
    const sid = selectedStudentIdRef.current;
    if (sid) {
      const lr = await api.get(`/fees/ledger/${sid}`).catch(() => null);
      if (lr) setStudentLedger(lr.data);
    }
    if (isAdmin) fetchAdminData();
    setPayLedgerIds([]);
  }, [isAdmin, fetchAdminData]);

  const applyConcession = async () => {
    if (!concessionForm.student_id || !concessionForm.concession_percent) {
      toast.error('Select a student and enter concession %');
      return;
    }
    setApplyingConcession(true);
    try {
      const res = await api.post('/fees/concession', {
        student_id: concessionForm.student_id,
        concession_percent: parseFloat(concessionForm.concession_percent),
        reason: concessionForm.reason || 'Scholarship/Concession',
      });
      toast.success(res.data.message);
      setShowConcessionDialog(false);
      setConcessionForm({ student_id: '', concession_percent: '', reason: '' });
      fetchAdminData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to apply concession');
    } finally { setApplyingConcession(false); }
  };

  const sendFeeReminders = async () => {
    setSendingReminders(true);
    try {
      const res = await api.post('/notifications/send-fee-reminders');
      toast.success(`Reminders sent to ${res.data.sent || 0} parent(s)`);
    } catch {
      toast.error('Failed to send reminders');
    } finally { setSendingReminders(false); }
  };

  const refreshOverdue = async () => {
    setRefreshingOverdue(true);
    try {
      const res = await api.post('/fees/refresh-overdue');
      toast.success(res.data.message);
      fetchAdminData();
    } catch {
      toast.error('Failed to refresh overdue');
    } finally { setRefreshingOverdue(false); }
  };

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-900 border-t-transparent" />
    </div>
  );

  const filteredDue = dueChart.filter(d =>
    d.name?.toLowerCase().includes(dueSearch.toLowerCase()) ||
    d.admission_number?.toLowerCase().includes(dueSearch.toLowerCase())
  );

  const displayStudents = isParent ? myChildren : (isStudent ? myChildren : students);

  return (
    <div data-testid="fees-page">
      {/* ── Header ── */}
      <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div className="page-header-inner">
          <div className="page-header-accent" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Fees Management</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isParent || isStudent
                ? 'View and pay fees — due dates, receipts, and history'
                : 'Component-based fee structure · Ledger · Due chart · Concessions'}
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshOverdue}
              disabled={refreshingOverdue}
              className="text-xs"
            >
              {refreshingOverdue ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1.5" />}
              Refresh Overdue
            </Button>
            <Button
              size="sm"
              onClick={sendFeeReminders}
              disabled={sendingReminders}
              className="bg-slate-900 text-white hover:bg-slate-800 text-xs"
            >
              {sendingReminders ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Mail className="h-3 w-3 mr-1.5" />}
              Send Reminders
            </Button>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6 rounded-xl h-10 bg-slate-100">
          {isAdmin && (
            <>
              <TabsTrigger value="config" className="rounded-xl text-xs uppercase tracking-wider font-semibold">
                Fee Config
              </TabsTrigger>
              <TabsTrigger value="collect" className="rounded-xl text-xs uppercase tracking-wider font-semibold">
                Collect
              </TabsTrigger>
              <TabsTrigger value="due" className="rounded-xl text-xs uppercase tracking-wider font-semibold">
                Due Chart
              </TabsTrigger>
              <TabsTrigger value="concessions" className="rounded-xl text-xs uppercase tracking-wider font-semibold">
                Concessions
              </TabsTrigger>
            </>
          )}
          <TabsTrigger value="my-fees" className="rounded-xl text-xs uppercase tracking-wider font-semibold">
            {isParent || isStudent ? 'My Fees' : 'Student View'}
          </TabsTrigger>
        </TabsList>

        {/* ════════════ FEE CONFIG TAB ════════════ */}
        <TabsContent value="config">
          <div className="flex flex-col gap-4">
            {/* Controls */}
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex gap-3 items-center">
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider">Academic Year</Label>
                  <Select value={selectedYear} onValueChange={setSelectedYear}>
                    <SelectTrigger className="mt-1 h-8 w-40 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACADEMIC_YEARS.map(y => (
                        <SelectItem key={y} value={y}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm"
                  className="text-xs"
                  onClick={() => setShowIncreaseDialog(true)}
                >
                  <TrendingUp className="h-3 w-3 mr-1.5" />
                  Apply Annual Increase
                </Button>
                <Button
                  size="sm"
                  className="bg-slate-900 hover:bg-slate-800 text-white text-xs"
                  onClick={() => openConfigDialog()}
                >
                  <Plus className="h-3 w-3 mr-1.5" />
                  Add Fee Config
                </Button>
              </div>
            </div>

            {/* Config table */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {feeConfigs.length === 0 ? (
                <div className="p-12 text-center text-slate-500">
                  <Settings className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">No fee configurations for {selectedYear}</p>
                  <p className="text-xs mt-1">Click "Add Fee Config" to set up fees for each class.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      {['Class', 'Stream', 'Registration', 'Admission', 'Caution', 'Annual', 'Activity', 'Exam', 'Lab', 'Monthly Tuition', 'Late Fee', 'Actions'].map(h => (
                        <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-500 whitespace-nowrap">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feeConfigs.map(cfg => (
                      <TableRow key={cfg.config_id} className="hover:bg-slate-50">
                        <TableCell className="font-semibold text-slate-900">{cfg.class_name}</TableCell>
                        <TableCell>
                          {cfg.stream ? (
                            <span className="text-xs capitalize px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded">{cfg.stream}</span>
                          ) : <span className="text-slate-500">—</span>}
                        </TableCell>
                        {['registration_fee', 'admission_fee', 'caution_deposit', 'annual_charge', 'activity_fee', 'exam_fee', 'lab_fee', 'monthly_tuition'].map(k => (
                          <TableCell key={k} className="text-sm">
                            {cfg[k] > 0 ? fmt(cfg[k]) : <span className="text-[#CCC]">—</span>}
                          </TableCell>
                        ))}
                        <TableCell className="text-sm">
                          {cfg.late_fee_enabled && cfg.late_fee > 0 ? (
                            <span className="text-red-600">{fmt(cfg.late_fee)}/mo</span>
                          ) : <span className="text-[#CCC]">Off</span>}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost" size="sm"
                            className="text-xs h-7 px-2"
                            onClick={() => openConfigDialog(cfg)}
                          >
                            <Edit2 className="h-3 w-3 mr-1" /> Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            {/* Sibling discount note */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
              <strong>Sibling Discount Policy:</strong> 50% off Admission Fee · 15% off Monthly Tuition.
              Configured per class in each fee entry. Auto-applied when a sibling is enrolled.
            </div>
          </div>
        </TabsContent>

        {/* ════════════ COLLECT TAB ════════════ */}
        <TabsContent value="collect">
          <div className="space-y-4">
            <div className="flex gap-4 items-end">
              <div className="flex-1 max-w-sm">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-900">Select Student</Label>
                <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose a student…" />
                  </SelectTrigger>
                  <SelectContent>
                    {students.map(s => (
                      <SelectItem key={s.student_id} value={s.student_id}>
                        {s.first_name} {s.last_name} ({s.admission_number || 'No Adm#'}) — {s.class_name}-{s.section}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {loadingLedger && (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-slate-900" />
              </div>
            )}

            {!loadingLedger && selectedStudentId && studentLedger && (
              <LedgerView
                ledger={studentLedger}
                isAdmin={isAdmin}
                studentId={selectedStudentId}
                payLedgerIds={payLedgerIds}
                setPayLedgerIds={setPayLedgerIds}
                onPaySelected={() => setShowPayDialog(true)}
                onPayAdmission={() => setShowAdmissionPayDialog(true)}
                onDownloadReceipt={downloadReceipt}
                onRazorpaySuccess={handleRazorpaySuccess}
              />
            )}
          </div>
        </TabsContent>

        {/* ════════════ DUE CHART TAB ════════════ */}
        <TabsContent value="due">
          <div className="space-y-4">
            <div className="flex gap-3 items-center">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" strokeWidth={1.5} />
                <Input
                  placeholder="Search by name or admission no."
                  className="pl-9 h-9 text-sm"
                  value={dueSearch}
                  onChange={e => setDueSearch(e.target.value)}
                />
              </div>
              <div className="text-sm text-slate-500">
                {filteredDue.length} students with dues
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    {['Admission No.', 'Name', 'Class', 'Total Due', 'Entries Pending', 'Overdue', 'Oldest Due', 'Status', 'Action'].map(h => (
                      <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDue.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-slate-500">
                        <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                        No pending dues found
                      </TableCell>
                    </TableRow>
                  ) : filteredDue.map(d => (
                    <TableRow key={d.student_id} className="hover:bg-slate-50">
                      <TableCell className="text-xs font-mono">{d.admission_number || '—'}</TableCell>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="text-sm">{d.class_name}-{d.section} {d.stream ? `(${d.stream})` : ''}</TableCell>
                      <TableCell className="font-bold text-red-600">{fmt(d.total_due)}</TableCell>
                      <TableCell>{d.entries_pending}</TableCell>
                      <TableCell>
                        {d.entries_overdue > 0 ? (
                          <span className="text-red-600 font-semibold">{d.entries_overdue}</span>
                        ) : '0'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">{d.oldest_due || '—'}</TableCell>
                      <TableCell><StatusBadge status={d.fee_status} /></TableCell>
                      <TableCell>
                        <Button
                          variant="ghost" size="sm" className="text-xs h-7 px-2"
                          onClick={() => {
                            setSelectedStudentId(d.student_id);
                            setActiveTab('collect');
                          }}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ════════════ CONCESSIONS TAB ════════════ */}
        <TabsContent value="concessions">
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button
                size="sm"
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs"
                onClick={() => setShowConcessionDialog(true)}
              >
                <Plus className="h-3 w-3 mr-1.5" />
                Apply Concession
              </Button>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    {['Student', 'Class', 'Adm. No.', 'Total Concession', 'Entries', 'Reason'].map(h => (
                      <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {concessions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-slate-500">No concessions found</TableCell>
                    </TableRow>
                  ) : concessions.map(c => (
                    <TableRow key={c.student_id}>
                      <TableCell className="font-medium">{c.student_name}</TableCell>
                      <TableCell>{c.class_name}-{c.section}</TableCell>
                      <TableCell className="text-xs font-mono">{c.admission_number}</TableCell>
                      <TableCell className="font-semibold text-green-700">{fmt(c.total_concession)}</TableCell>
                      <TableCell>{c.entries}</TableCell>
                      <TableCell className="text-sm text-slate-500">{c.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ════════════ MY FEES / STUDENT VIEW ════════════ */}
        <TabsContent value="my-fees">
          <div className="space-y-4">
            {(isParent || isStudent) && myChildren.length > 1 && (
              <div className="max-w-sm">
                <Label className="text-xs font-bold uppercase tracking-wider">Select Child</Label>
                <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {myChildren.map(c => (
                      <SelectItem key={c.student_id} value={c.student_id}>
                        {c.first_name} {c.last_name} — {c.class_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {/* Admin selecting student in "Student View" */}
            {isAdmin && (
              <div className="max-w-sm">
                <Label className="text-xs font-bold uppercase tracking-wider">Select Student</Label>
                <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose a student…" />
                  </SelectTrigger>
                  <SelectContent>
                    {students.map(s => (
                      <SelectItem key={s.student_id} value={s.student_id}>
                        {s.first_name} {s.last_name} ({s.admission_number || 'No Adm#'}) — {s.class_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {loadingLedger && (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-slate-900" />
              </div>
            )}

            {!loadingLedger && selectedStudentId && studentLedger && (
              <LedgerView
                ledger={studentLedger}
                isAdmin={isAdmin}
                studentId={selectedStudentId}
                payLedgerIds={payLedgerIds}
                setPayLedgerIds={setPayLedgerIds}
                onPaySelected={() => setShowPayDialog(true)}
                onPayAdmission={() => setShowAdmissionPayDialog(true)}
                onDownloadReceipt={downloadReceipt}
                onRazorpaySuccess={handleRazorpaySuccess}
                readOnly={isParent || isStudent}
              />
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ════════════ DIALOGS ════════════ */}

      {/* Fee Config Dialog */}
      <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingConfig ? 'Edit Fee Configuration' : 'Add Fee Configuration'}</DialogTitle>
            <DialogDescription>
              Set fee amounts for each component. Leave at 0 to exclude.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider">Class *</Label>
                <Select
                  value={configForm.class_name || ''}
                  onValueChange={v => setConfigForm(f => ({ ...f, class_name: v }))}
                  disabled={!!editingConfig}
                >
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue placeholder="Select class" />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map(c => (
                      <SelectItem key={c.class_id || c.name} value={c.name}>{c.display_name || c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider">Stream</Label>
                <Select
                  value={configForm.stream || 'none'}
                  onValueChange={v => setConfigForm(f => ({ ...f, stream: v === 'none' ? null : v }))}
                >
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (applies to all)</SelectItem>
                    <SelectItem value="science">Science</SelectItem>
                    <SelectItem value="arts">Arts</SelectItem>
                    <SelectItem value="commerce">Commerce</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider">Academic Year *</Label>
                <Select
                  value={configForm.academic_year || selectedYear}
                  onValueChange={v => setConfigForm(f => ({ ...f, academic_year: v }))}
                  disabled={!!editingConfig}
                >
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACADEMIC_YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                Fee Components
              </div>
              <div className="p-3 grid grid-cols-2 gap-3">
                {FEE_COMPONENTS.map(comp => (
                  <div key={comp.key}>
                    <Label className="text-xs font-semibold text-slate-900">{comp.label}</Label>
                    <div className="flex items-center mt-1 gap-1.5">
                      <span className="text-xs text-slate-500">₹</span>
                      <Input
                        type="number"
                        min={0}
                        className="h-8 text-sm"
                        value={configForm[comp.key] ?? 0}
                        onChange={e => setConfigForm(f => ({ ...f, [comp.key]: parseFloat(e.target.value) || 0 }))}
                      />
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${TYPE_COLORS[comp.type]}`}>
                        {comp.type.replace('_', '-')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider">Due Day</Label>
                <Input
                  type="number" min={1} max={28}
                  className="mt-1 h-8 text-sm"
                  value={configForm.due_day ?? 10}
                  onChange={e => setConfigForm(f => ({ ...f, due_day: parseInt(e.target.value) || 10 }))}
                />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider">Sibling — Admission Disc ₹</Label>
                <div className="flex items-center mt-1 gap-1.5">
                  <span className="text-xs text-slate-500">₹</span>
                  <Input
                    type="number" min={0}
                    className="mt-0 h-8 text-sm"
                    value={configForm.sibling_admission_discount_amount ?? 0}
                    onChange={e => setConfigForm(f => ({ ...f, sibling_admission_discount_amount: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider">Sibling — Tuition Disc ₹</Label>
                <div className="flex items-center mt-1 gap-1.5">
                  <span className="text-xs text-slate-500">₹</span>
                  <Input
                    type="number" min={0}
                    className="mt-0 h-8 text-sm"
                    value={configForm.sibling_tuition_discount_amount ?? 0}
                    onChange={e => setConfigForm(f => ({ ...f, sibling_tuition_discount_amount: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">Notes</Label>
              <Input
                className="mt-1 text-sm"
                value={configForm.notes || ''}
                onChange={e => setConfigForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfigDialog(false)}>Cancel</Button>
            <Button
              onClick={saveConfig}
              disabled={savingConfig}
              className="bg-slate-900 hover:bg-slate-800 text-white"
            >
              {savingConfig ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : null}
              Save Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Annual Increase Dialog */}
      <Dialog open={showIncreaseDialog} onOpenChange={setShowIncreaseDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Apply Annual Fee Increase</DialogTitle>
            <DialogDescription>
              This will create new fee configurations for the next academic year with the specified increase.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">From Year</Label>
              <Input value={selectedYear} disabled className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">Increase %</Label>
              <Input
                type="number" min={1} max={100}
                className="mt-1 h-9 text-sm"
                value={increasePercent}
                onChange={e => setIncreasePercent(e.target.value)}
              />
              <p className="text-xs text-slate-500 mt-1">Enter 10 for a 10% increase. Applies to all fee components.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowIncreaseDialog(false)}>Cancel</Button>
            <Button
              onClick={applyAnnualIncrease}
              disabled={applyingIncrease}
              className="bg-slate-900 hover:bg-slate-800 text-white"
            >
              {applyingIncrease ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <TrendingUp className="h-3 w-3 mr-2" />}
              Apply {increasePercent}% Increase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay Fee Dialog */}
      <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              {payLedgerIds.length} entry/entries selected
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-3">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">Payment Method</Label>
              <Select value={payForm.method} onValueChange={v => setPayForm(f => ({ ...f, method: v }))}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="online">Online / UPI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {payForm.method !== 'cash' && (
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider">Transaction ID / Ref No.</Label>
                <Input
                  className="mt-1 h-9 text-sm"
                  value={payForm.transaction_id}
                  onChange={e => setPayForm(f => ({ ...f, transaction_id: e.target.value }))}
                  placeholder="UTR / Cheque no."
                />
              </div>
            )}
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">Remarks</Label>
              <Input
                className="mt-1 h-9 text-sm"
                value={payForm.remarks}
                onChange={e => setPayForm(f => ({ ...f, remarks: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayDialog(false)}>Cancel</Button>
            <Button
              onClick={paySelected}
              disabled={processingPayment}
              className="bg-slate-900 hover:bg-slate-800 text-white"
            >
              {processingPayment ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <CreditCard className="h-3 w-3 mr-2" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admission Fee Payment Dialog */}
      <Dialog open={showAdmissionPayDialog} onOpenChange={setShowAdmissionPayDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Collect Admission Fees</DialogTitle>
            <DialogDescription>
              This will mark all one-time, yearly, and first-month tuition entries as paid.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-3">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">Payment Method</Label>
              <Select value={admissionPayForm.method} onValueChange={v => setAdmissionPayForm(f => ({ ...f, method: v }))}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="online">Online / UPI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {admissionPayForm.method !== 'cash' && (
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider">Transaction ID</Label>
                <Input
                  className="mt-1 h-9 text-sm"
                  value={admissionPayForm.transaction_id}
                  onChange={e => setAdmissionPayForm(f => ({ ...f, transaction_id: e.target.value }))}
                />
              </div>
            )}
            {studentLedger && (
              <div className="bg-slate-50 rounded-xl p-3 text-sm">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">Admission Time Fee</p>
                <p className="text-xl font-bold text-slate-900">
                  {fmt(
                    [...(studentLedger.ledger?.one_time || []), ...(studentLedger.ledger?.yearly || [])]
                      .filter(e => e.status === 'pending')
                      .reduce((s, e) => s + e.net_amount, 0)
                  )}
                </p>
                <p className="text-xs text-slate-500 mt-1">Includes registration, admission, caution deposit, yearly fees + 1st month tuition</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdmissionPayDialog(false)}>Cancel</Button>
            <Button
              onClick={payAdmissionFees}
              disabled={processingAdmissionPay}
              className="bg-slate-900 hover:bg-slate-800 text-white"
            >
              {processingAdmissionPay ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <CreditCard className="h-3 w-3 mr-2" />}
              Collect Admission Fee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Concession Dialog */}
      <Dialog open={showConcessionDialog} onOpenChange={setShowConcessionDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Apply Fee Concession</DialogTitle>
            <DialogDescription>Apply scholarship or concession to pending fee entries.</DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-3">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">Student</Label>
              <Select value={concessionForm.student_id} onValueChange={v => setConcessionForm(f => ({ ...f, student_id: v }))}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Choose a student" />
                </SelectTrigger>
                <SelectContent>
                  {students.map(s => (
                    <SelectItem key={s.student_id} value={s.student_id}>
                      {s.first_name} {s.last_name} — {s.class_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">Concession % (0–100)</Label>
              <Input
                type="number" min={0} max={100}
                className="mt-1 h-9 text-sm"
                value={concessionForm.concession_percent}
                onChange={e => setConcessionForm(f => ({ ...f, concession_percent: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">Reason</Label>
              <Input
                className="mt-1 h-9 text-sm"
                value={concessionForm.reason}
                onChange={e => setConcessionForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="e.g. RTE, Scholarship, Staff ward"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConcessionDialog(false)}>Cancel</Button>
            <Button
              onClick={applyConcession}
              disabled={applyingConcession}
              className="bg-slate-900 hover:bg-slate-800 text-white"
            >
              {applyingConcession ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : null}
              Apply Concession
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ─── Ledger View Component ────────────────────────────────────────────────────

const LedgerView = ({
  ledger, isAdmin, studentId, payLedgerIds, setPayLedgerIds,
  onPaySelected, onPayAdmission, onDownloadReceipt, onRazorpaySuccess, readOnly = false
}) => {
  const [expandedSections, setExpandedSections] = useState({ one_time: true, yearly: true, monthly: true });

  const toggleSection = (sec) => setExpandedSections(s => ({ ...s, [sec]: !s[sec] }));

  const { student, summary, ledger: grouped, payments } = ledger;

  const hasAdmissionPending = (
    (grouped.one_time || []).some(e => e.status === 'pending') ||
    (grouped.yearly || []).some(e => e.status === 'pending')
  );

  const toggleLedgerId = (id) => {
    setPayLedgerIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectedTotal = [...(grouped.one_time || []), ...(grouped.yearly || []), ...(grouped.monthly || [])]
    .filter(e => payLedgerIds.includes(e.ledger_id))
    .reduce((s, e) => s + e.net_amount, 0);

  return (
    <div className="space-y-4">
      {/* Student header card */}
      <Card className="rounded-2xl border-slate-200">
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{student.name}</h2>
              <p className="text-sm text-slate-500">
                {student.class_name}-{student.section}
                {student.stream && ` · ${student.stream}`}
                {student.admission_number && ` · Adm# ${student.admission_number}`}
                {` · ${student.academic_year}`}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-xs text-slate-500 uppercase tracking-wider">Total Pending</p>
                <p className="text-xl font-bold text-red-600">{fmt(summary.total_pending)}</p>
              </div>
              {summary.total_overdue > 0 && (
                <div className="text-right">
                  <p className="text-xs text-slate-500 uppercase tracking-wider">Overdue</p>
                  <p className="text-xl font-bold text-red-700">{fmt(summary.total_overdue)}</p>
                </div>
              )}
              <div className="text-right">
                <p className="text-xs text-slate-500 uppercase tracking-wider">Paid</p>
                <p className="text-xl font-bold text-green-600">{fmt(summary.total_paid)}</p>
              </div>
            </div>
          </div>

          {/* Summary chips */}
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="text-xs px-2 py-1 bg-slate-100 rounded text-slate-600">
              Gross: {fmt(summary.total_gross)}
            </span>
            {summary.total_concession > 0 && (
              <span className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded">
                Concession: -{fmt(summary.total_concession)}
              </span>
            )}
            <span className="text-xs px-2 py-1 bg-slate-100 rounded text-slate-600">
              Months paid: {summary.months_paid} / {summary.months_paid + summary.months_pending}
            </span>
            <StatusBadge status={student.fee_status} />
          </div>

          {/* Admin actions */}
          {isAdmin && !readOnly && (
            <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-100">
              {hasAdmissionPending && (
                <Button
                  size="sm"
                  className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-8"
                  onClick={onPayAdmission}
                >
                  <CreditCard className="h-3 w-3 mr-1.5" />
                  Collect Admission Fee
                </Button>
              )}
              {payLedgerIds.length > 0 && (
                <>
                  <Button
                    size="sm"
                    className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-8"
                    onClick={onPaySelected}
                  >
                    <CreditCard className="h-3 w-3 mr-1.5" />
                    Record Cash/Offline ({fmt(selectedTotal)})
                  </Button>
                  <RazorpayCheckout
                    studentId={studentId}
                    ledgerIds={payLedgerIds}
                    onSuccess={onRazorpaySuccess}
                    onCancel={() => {}}
                  >
                    <CreditCard className="h-3 w-3 mr-1.5" />
                    Pay Online ({fmt(selectedTotal)})
                  </RazorpayCheckout>
                </>
              )}
            </div>
          )}

          {/* Parent / Student: Pay Online */}
          {readOnly && summary.total_pending > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100">
              <p className="text-xs text-slate-500 mb-2">
                Select entries below and pay online instantly via Razorpay.
              </p>
              <div className="flex flex-wrap gap-2">
                {payLedgerIds.length > 0 ? (
                  <RazorpayCheckout
                    studentId={studentId}
                    ledgerIds={payLedgerIds}
                    onSuccess={onRazorpaySuccess}
                    onCancel={() => {}}
                  >
                    <CreditCard className="h-4 w-4 mr-1.5" />
                    Pay Selected {fmt(selectedTotal)} Online
                  </RazorpayCheckout>
                ) : (
                  <p className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-md border border-amber-200">
                    Select fee entries below to pay online
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ledger sections */}
      {[
        { key: 'one_time', label: 'One-Time Fees', desc: 'Registration · Admission · Caution Deposit' },
        { key: 'yearly', label: 'Yearly Fees', desc: 'Annual · Activity · Exam · Lab' },
        { key: 'monthly', label: 'Monthly Tuition', desc: '12 installments' },
      ].map(sec => {
        const entries = grouped[sec.key] || [];
        if (entries.length === 0) return null;
        const expanded = expandedSections[sec.key];
        const secTotal = entries.filter(e => e.status !== 'paid').reduce((s, e) => s + e.net_amount, 0);

        return (
          <div key={sec.key} className="border border-slate-200 rounded-2xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition"
              onClick={() => toggleSection(sec.key)}
            >
              <div className="flex items-center gap-2">
                {expanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                <span className="font-bold text-sm text-slate-900">{sec.label}</span>
                <span className="text-xs text-slate-500">— {sec.desc}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                {secTotal > 0 && <span className="text-red-600 font-semibold">Pending: {fmt(secTotal)}</span>}
                <span>{entries.length} entries</span>
              </div>
            </button>

            {expanded && (
              <Table>
                <TableHeader>
                  <TableRow className="bg-white border-b border-slate-100">
                    {(isAdmin || readOnly) && <TableHead className="w-8"></TableHead>}
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Description</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Gross</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Discount</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Late Fee</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Net Due</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Due Date</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Status</TableHead>
                    {!readOnly && <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Receipt</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(entry => (
                    <TableRow
                      key={entry.ledger_id}
                      className={`hover:bg-slate-50 ${entry.status === 'overdue' ? 'bg-red-50/40 border-l-2 border-red-400' : ''}`}
                    >
                      {(isAdmin || readOnly) && (
                        <TableCell>
                          {entry.status !== 'paid' && entry.status !== 'waived' && (
                            <input
                              type="checkbox"
                              checked={payLedgerIds.includes(entry.ledger_id)}
                              onChange={() => toggleLedgerId(entry.ledger_id)}
                              className="rounded cursor-pointer"
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-sm font-medium">
                        {entry.description}
                        {entry.concession_reason && (
                          <span className="block text-[10px] text-green-600">{entry.concession_reason}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{fmt(entry.gross_amount)}</TableCell>
                      <TableCell className="text-sm text-green-600">
                        {entry.concession_amount > 0 ? `-${fmt(entry.concession_amount)}` : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-red-600">
                        {entry.late_fee_applied > 0 ? `+${fmt(entry.late_fee_applied)}` : '—'}
                      </TableCell>
                      <TableCell className="font-bold text-sm">{fmt(entry.net_amount)}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {entry.due_date ? new Date(entry.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </TableCell>
                      <TableCell><StatusBadge status={entry.status} /></TableCell>
                      {!readOnly && (
                        <TableCell>
                          {entry.payment_id && (
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => onDownloadReceipt(entry.payment_id)}
                            >
                              <Download className="h-3 w-3 mr-1" />
                              PDF
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        );
      })}

      {/* Payment history */}
      {payments && payments.length > 0 && (
        <div className="border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 font-bold text-sm text-slate-900">
            Payment History
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-white border-b border-slate-100">
                {['Receipt No.', 'Date', 'Amount', 'Method', 'Txn ID', 'Receipt'].map(h => (
                  <TableHead key={h} className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map(p => (
                <TableRow key={p.payment_id} className="hover:bg-slate-50">
                  <TableCell className="text-xs font-mono font-semibold text-slate-900">{p.receipt_number}</TableCell>
                  <TableCell className="text-sm">{p.payment_date}</TableCell>
                  <TableCell className="font-bold text-green-700">{fmt(p.amount)}</TableCell>
                  <TableCell className="text-sm capitalize">{p.payment_method}</TableCell>
                  <TableCell className="text-xs text-slate-500">{p.transaction_id || '—'}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost" size="sm" className="h-7 px-2 text-xs"
                      onClick={() => onDownloadReceipt(p.payment_id)}
                    >
                      <Download className="h-3 w-3 mr-1" />
                      PDF
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default FeesPage;
