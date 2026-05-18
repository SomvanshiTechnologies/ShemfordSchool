import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { getCached, setCached } from '../lib/pageCache';

const TopProgressBar = ({ active }) =>
  active ? (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px] overflow-hidden" style={{ background: '#fde8c8' }}>
      <div className="h-full w-2/5" style={{ background: '#E88A1A', animation: 'topbar-slide 1.4s ease-in-out infinite' }} />
    </div>
  ) : null;
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
  Clock, XCircle, Download, Plus, Edit2, RefreshCw, BookOpen,
  Smartphone, Wifi, WifiOff, X
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { RazorpayCheckout } from './RazorpayCheckout';
import FeesReports from './FeesReports';

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

// Date helpers: backend uses YYYY-MM-DD, UI collects/displays DD-MM-YYYY
const isoToDDMMYYYY = (iso) => {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
const ddmmyyyyToIso = (str) => {
  if (!str) return '';
  const m = String(str).trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  if (Number.isNaN(d.getTime()) || d.getDate() !== +dd || d.getMonth() + 1 !== +mm) return '';
  return `${yyyy}-${mm}-${dd}`;
};
const todayDDMMYYYY = () => isoToDDMMYYYY(new Date().toISOString().slice(0, 10));

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
    searchParams.get('tab') || (isParent || isStudent ? 'my-fees' : 'collect')
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
  const [payForm, setPayForm] = useState({ method: 'cash', transaction_id: '', remarks: '', payment_date: todayDDMMYYYY(), split_cash: '', split_online: '' });
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

  // Student search bar (Collect tab)
  const [studentSearch, setStudentSearch] = useState('');
  const [studentSearchResults, setStudentSearchResults] = useState([]);
  const [searchingStudents, setSearchingStudents] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchDebounceRef = useRef(null);
  const searchInputRef = useRef(null);

  // POS terminal payment
  const [showPosDialog, setShowPosDialog] = useState(false);
  const [posForm, setPosForm] = useState({ device_id: '', mode: 'ALL' });
  const [posOrderId, setPosOrderId] = useState(null);
  const [posStatus, setPosStatus] = useState('idle'); // idle|polling|success|failed|cancelled
  const [posReceipt, setPosReceipt] = useState(null);
  const [posPaymentId, setPosPaymentId] = useState(null);
  const [posMessage, setPosMessage] = useState('');
  const posPollingRef = useRef(null);

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
    // SWR: show cached immediately if present
    const cached = getCached('fees:admin-data');
    if (cached) {
      setStudents(cached.students);
      setDueChart(cached.due);
      setConcessions(cached.concessions);
      setLoading(false);
    }
    setRefreshing(true);
    try {
      const [studRes, dueRes, concRes] = await Promise.all([
        api.get('/students', { params: { is_active: true, limit: 500 } }).catch(() => ({ data: [] })),
        api.get('/fees/due-chart').catch(() => ({ data: [] })),
        api.get('/fees/concessions').catch(() => ({ data: [] })),
      ]);
      const studArr = studRes.data.students ?? (Array.isArray(studRes.data) ? studRes.data : []);
      const dueArr = Array.isArray(dueRes.data) ? dueRes.data : [];
      const concArr = Array.isArray(concRes.data) ? concRes.data : [];
      setStudents(studArr);
      setDueChart(dueArr);
      setConcessions(concArr);
      setCached('fees:admin-data', { students: studArr, due: dueArr, concessions: concArr });
    } catch {}
    finally { setRefreshing(false); }
  }, []);

  const fetchParentData = useCallback(async () => {
    try {
      const res = await api.get('/students');
      // For role=student the backend returns {students: [...], total, page, pages};
      // for role=parent it returns a flat array. Handle both shapes.
      const list = res.data?.students ?? (Array.isArray(res.data) ? res.data : []);
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
    const isoPaymentDate = payForm.payment_date ? ddmmyyyyToIso(payForm.payment_date) : '';
    if (payForm.payment_date && !isoPaymentDate) {
      toast.error('Payment date must be in DD-MM-YYYY format');
      return;
    }
    if (isoPaymentDate && isoPaymentDate > new Date().toISOString().slice(0, 10)) {
      toast.error('Payment date cannot be in the future');
      return;
    }
    setProcessingPayment(true);
    try {
      const payload = {
        student_id: selectedStudentId,
        ledger_ids: payLedgerIds,
        payment_method: payForm.method,
        transaction_id: payForm.transaction_id || undefined,
        remarks: payForm.remarks || undefined,
        payment_date: isoPaymentDate || undefined,
      };
      if (payForm.method === 'split') {
        const cash = parseFloat(payForm.split_cash) || 0;
        const online = parseFloat(payForm.split_online) || 0;
        if (cash <= 0 && online <= 0) { toast.error('Enter at least one split amount'); setProcessingPayment(false); return; }
        payload.payment_method = 'split';
        payload.split_payments = { cash, online };
      }
      const res = await api.post('/fees/pay', payload);
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
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('Failed to load receipt');
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

  // ── Student search helpers ────────────────────────────────────────────────

  const handleStudentSearch = (value) => {
    setStudentSearch(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!value.trim()) {
      setStudentSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setSearchingStudents(true);
      try {
        const res = await api.get('/fees/search-students', { params: { q: value } });
        setStudentSearchResults(res.data || []);
        setShowSearchDropdown(true);
      } catch {
        setStudentSearchResults([]);
      } finally {
        setSearchingStudents(false);
      }
    }, 400);
  };

  const selectSearchResult = (student) => {
    setSelectedStudentId(student.student_id);
    setStudentSearch(`${student.name} (${student.admission_number || student.roll_number || student.student_id})`);
    setShowSearchDropdown(false);
    setStudentSearchResults([]);
  };

  const clearStudentSearch = () => {
    setStudentSearch('');
    setStudentSearchResults([]);
    setShowSearchDropdown(false);
    setSelectedStudentId('');
    if (searchInputRef.current) searchInputRef.current.focus();
  };

  // ── POS payment helpers ───────────────────────────────────────────────────

  const stopPosPolling = () => {
    if (posPollingRef.current) {
      clearInterval(posPollingRef.current);
      posPollingRef.current = null;
    }
  };

  const initiatePosPayment = async () => {
    if (!payLedgerIds.length) { toast.error('Select at least one fee entry'); return; }
    if (!posForm.device_id.trim()) { toast.error('Enter POS device ID'); return; }

    // Calculate total due for selected ledger entries
    const allEntries = [
      ...(studentLedger?.ledger?.one_time || []),
      ...(studentLedger?.ledger?.yearly || []),
      ...(studentLedger?.ledger?.monthly || []),
    ];
    const selected = allEntries.filter(e => payLedgerIds.includes(e.ledger_id));
    const totalRupees = selected.reduce((s, e) => s + (Number(e.remaining_balance || e.net_amount) || 0), 0);
    const totalPaise = Math.round(totalRupees * 100);

    // Save device_id to localStorage for next time
    localStorage.setItem('pos_device_id', posForm.device_id);

    setPosStatus('polling');
    setPosMessage('Sending payment request to POS terminal...');
    setPosReceipt(null);
    setPosPaymentId(null);

    try {
      const res = await api.post('/payments/pos/initiate', {
        student_id: selectedStudentId,
        ledger_ids: payLedgerIds,
        amount_paise: totalPaise,
        device_id: posForm.device_id,
        mode: posForm.mode,
      });
      const orderId = res.data.pos_order_id;
      setPosOrderId(orderId);
      setPosMessage('Waiting for payment on POS terminal...');

      // Poll every 3 seconds, timeout after 90 seconds
      let elapsed = 0;
      posPollingRef.current = setInterval(async () => {
        elapsed += 3;
        if (elapsed >= 90) {
          stopPosPolling();
          setPosStatus('failed');
          setPosMessage('Payment timed out. Please retry or cancel.');
          return;
        }
        try {
          const statusRes = await api.post('/payments/pos/status', { pos_order_id: orderId });
          const s = statusRes.data.status;
          if (s === 'SUCCESS') {
            stopPosPolling();
            setPosStatus('success');
            setPosReceipt(statusRes.data.receipt_number);
            setPosPaymentId(statusRes.data.fee_payment_id);
            setPosMessage(`Payment successful! Receipt: ${statusRes.data.receipt_number}`);
            toast.success(`POS payment successful — ${statusRes.data.receipt_number}`);
            // Refresh ledger
            const lr = await api.get(`/fees/ledger/${selectedStudentId}`).catch(() => null);
            if (lr) setStudentLedger(lr.data);
            if (isAdmin) fetchAdminData();
            setPayLedgerIds([]);
          } else if (s === 'FAILED' || s === 'CANCELLED') {
            stopPosPolling();
            setPosStatus('failed');
            setPosMessage(statusRes.data.message || 'Payment failed on POS device.');
          }
        } catch { /* ignore transient network errors during polling */ }
      }, 3000);
    } catch (e) {
      setPosStatus('failed');
      setPosMessage(e.response?.data?.detail || 'Failed to send payment to POS device.');
      stopPosPolling();
    }
  };

  const cancelPosPayment = async () => {
    stopPosPolling();
    if (posOrderId) {
      try {
        await api.post('/payments/pos/cancel', { pos_order_id: posOrderId, reason: 'Cancelled by operator' });
      } catch { /* best-effort */ }
    }
    setPosStatus('cancelled');
    setPosMessage('POS payment cancelled.');
  };

  const openPosDialog = () => {
    const savedDevice = localStorage.getItem('pos_device_id') || '';
    setPosForm(f => ({ ...f, device_id: savedDevice }));
    setPosOrderId(null);
    setPosStatus('idle');
    setPosReceipt(null);
    setPosMessage('');
    setShowPosDialog(true);
  };

  // ── Loading state ─────────────────────────────────────────────────────────

  // Only show spinner on first load with no cached data
  if (loading && students.length === 0 && myChildren.length === 0 && dueChart.length === 0) return (
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
      <TopProgressBar active={refreshing} />
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
              <TabsTrigger value="reports" className="rounded-xl text-xs uppercase tracking-wider font-semibold">
                Reports
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
            {/* Student search bar */}
            <div className="flex gap-4 items-start">
              <div className="flex-1 max-w-md relative">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-900">Search Student</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" strokeWidth={1.5} />
                  <input
                    ref={searchInputRef}
                    type="text"
                    className="w-full pl-9 pr-9 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                    placeholder="Search by name, roll number, or admission number…"
                    value={studentSearch}
                    onChange={e => handleStudentSearch(e.target.value)}
                    onFocus={() => studentSearchResults.length > 0 && setShowSearchDropdown(true)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') setShowSearchDropdown(false);
                    }}
                    autoComplete="off"
                  />
                  {(searchingStudents) && (
                    <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-slate-400" />
                  )}
                  {(!searchingStudents && studentSearch) && (
                    <button
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700"
                      onClick={clearStudentSearch}
                      tabIndex={-1}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {/* Results dropdown */}
                {showSearchDropdown && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                    {studentSearchResults.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-slate-500">No students found</div>
                    ) : studentSearchResults.map(s => (
                      <button
                        key={s.student_id}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 focus:bg-slate-50 focus:outline-none"
                        onClick={() => selectSearchResult(s)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-semibold text-sm text-slate-900">{s.name}</span>
                            <span className="ml-2 text-xs text-slate-500">{s.class_name}-{s.section}{s.stream ? ` (${s.stream})` : ''}</span>
                          </div>
                          <div className="text-right text-xs text-slate-500">
                            <div>Adm: {s.admission_number || '—'}</div>
                            <div>Roll: {s.roll_number || '—'}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Default list — students with pending/overdue fees */}
            {!selectedStudentId && !loadingLedger && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Students with Pending Fees ({dueChart.length})
                </p>
                {dueChart.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                    <CheckCircle2 className="h-4 w-4 shrink-0" /> All fees collected — no pending dues.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-4 gap-4 px-4 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <span>Student</span><span>Admission No.</span><span>Class</span><span className="text-right">Pending</span>
                    </div>
                    {dueChart.slice(0, 50).map(s => (
                      <button
                        key={s.student_id}
                        onClick={() => selectSearchResult({ student_id: s.student_id, name: s.name, admission_number: s.admission_number, class_name: s.class_name, section: s.section, stream: s.stream })}
                        className="w-full text-left grid grid-cols-4 gap-4 px-4 py-3 hover:bg-orange-50 border-b border-slate-100 last:border-0 items-center transition-colors"
                      >
                        <p className="text-sm font-semibold text-slate-900 truncate">{s.name}</p>
                        <p className="text-sm text-slate-600 font-mono">{s.admission_number || '—'}</p>
                        <p className="text-sm text-slate-600">{s.class_name}-{s.section}{s.stream ? ` (${s.stream})` : ''}</p>
                        <div className="text-right">
                          <p className="text-sm font-bold text-red-600">₹{Number(s.total_due || 0).toLocaleString('en-IN')}</p>
                          {s.entries_overdue > 0 && <p className="text-[10px] text-red-400">{s.entries_overdue} overdue</p>}
                        </div>
                      </button>
                    ))}
                    {dueChart.length > 50 && (
                      <div className="px-4 py-2 text-xs text-slate-400 text-center bg-slate-50">
                        Showing 50 of {dueChart.length} — use search to find others
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {loadingLedger && (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-slate-900" />
              </div>
            )}

            {!loadingLedger && selectedStudentId && studentLedger && (
              <>
                <button
                  onClick={clearStudentSearch}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition mb-1"
                >
                  ← Back to all students
                </button>
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
              </>
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
                        <div className="flex gap-1">
                          <Button
                            variant="ghost" size="sm" className="text-xs h-7 px-2"
                            onClick={() => {
                              setSelectedStudentId(d.student_id);
                              setStudentSearch('');
                              setActiveTab('collect');
                            }}
                          >
                            View
                          </Button>
                          <Button
                            size="sm" className="text-xs h-7 px-2 bg-slate-900 hover:bg-slate-800 text-white"
                            onClick={() => {
                              setSelectedStudentId(d.student_id);
                              setStudentSearch('');
                              setActiveTab('collect');
                            }}
                          >
                            <CreditCard className="h-3 w-3 mr-1" />
                            Collect
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ════════════ REPORTS (Collection / Due) ════════════ */}
        {isAdmin && (
          <TabsContent value="reports">
            <FeesReports />
          </TabsContent>
        )}


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
            {/* Admin / Accountant: search bar (same as Collect tab) */}
            {isAdmin && (
              <div className="max-w-md relative">
                <Label className="text-xs font-bold uppercase tracking-wider">Search Student</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" strokeWidth={1.5} />
                  <input
                    type="text"
                    className="w-full pl-9 pr-9 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                    placeholder="Search by name, roll number, or admission number…"
                    value={studentSearch}
                    onChange={e => handleStudentSearch(e.target.value)}
                    onFocus={() => studentSearchResults.length > 0 && setShowSearchDropdown(true)}
                    onKeyDown={e => { if (e.key === 'Escape') setShowSearchDropdown(false); }}
                    autoComplete="off"
                  />
                  {searchingStudents && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-slate-400" />}
                  {(!searchingStudents && studentSearch) && (
                    <button className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700" onClick={clearStudentSearch} tabIndex={-1}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {showSearchDropdown && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                    {studentSearchResults.length === 0
                      ? <div className="px-4 py-3 text-sm text-slate-500">No students found</div>
                      : studentSearchResults.map(s => (
                        <button key={s.student_id} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 focus:bg-slate-50 focus:outline-none" onClick={() => selectSearchResult(s)}>
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-semibold text-sm text-slate-900">{s.name}</span>
                              <span className="ml-2 text-xs text-slate-500">{s.class_name}-{s.section}{s.stream ? ` (${s.stream})` : ''}</span>
                            </div>
                            <div className="text-right text-xs text-slate-500">
                              <div>Adm: {s.admission_number || '—'}</div>
                              <div>Roll: {s.roll_number || '—'}</div>
                            </div>
                          </div>
                        </button>
                      ))
                    }
                  </div>
                )}
              </div>
            )}

            {/* Admin: show pending students list by default */}
            {isAdmin && !selectedStudentId && !loadingLedger && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Students with Pending Fees ({dueChart.length})
                </p>
                {dueChart.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                    <CheckCircle2 className="h-4 w-4 shrink-0" /> All fees collected — no pending dues.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-4 gap-4 px-4 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <span>Student</span><span>Admission No.</span><span>Class</span><span className="text-right">Pending</span>
                    </div>
                    {dueChart.slice(0, 50).map(s => (
                      <button
                        key={s.student_id}
                        onClick={() => selectSearchResult({ student_id: s.student_id, name: s.name, admission_number: s.admission_number, class_name: s.class_name, section: s.section, stream: s.stream })}
                        className="w-full text-left grid grid-cols-4 gap-4 px-4 py-3 hover:bg-orange-50 border-b border-slate-100 last:border-0 items-center transition-colors"
                      >
                        <p className="text-sm font-semibold text-slate-900 truncate">{s.name}</p>
                        <p className="text-sm text-slate-600 font-mono">{s.admission_number || '—'}</p>
                        <p className="text-sm text-slate-600">{s.class_name}-{s.section}{s.stream ? ` (${s.stream})` : ''}</p>
                        <div className="text-right">
                          <p className="text-sm font-bold text-red-600">₹{Number(s.total_due || 0).toLocaleString('en-IN')}</p>
                          {s.entries_overdue > 0 && <p className="text-[10px] text-red-400">{s.entries_overdue} overdue</p>}
                        </div>
                      </button>
                    ))}
                    {dueChart.length > 50 && (
                      <div className="px-4 py-2 text-xs text-slate-400 text-center bg-slate-50">
                        Showing 50 of {dueChart.length} — use search to find others
                      </div>
                    )}
                  </div>
                )}
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
              <Label className="text-xs font-bold uppercase tracking-wider">Payment Date</Label>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="DD-MM-YYYY"
                pattern="\d{2}-\d{2}-\d{4}"
                maxLength={10}
                className="mt-1 h-9 text-sm"
                value={payForm.payment_date}
                onChange={e => {
                  let v = e.target.value.replace(/[^\d-]/g, '').slice(0, 10);
                  // Auto-insert dashes after DD and MM
                  if (v.length > 2 && v[2] !== '-') v = v.slice(0, 2) + '-' + v.slice(2);
                  if (v.length > 5 && v[5] !== '-') v = v.slice(0, 5) + '-' + v.slice(5);
                  setPayForm(f => ({ ...f, payment_date: v }));
                }}
              />
              <p className="text-[10px] text-slate-400 mt-1">Format: DD-MM-YYYY. For back-dated payments (e.g. fees collected earlier)</p>
            </div>
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
                  <SelectItem value="split">Split (Cash + Online)</SelectItem>
                  <SelectItem value="pos_terminal">POS Terminal (Ezetap)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {payForm.method === 'split' && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl border border-orange-200 bg-orange-50">
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider">Cash Amount</Label>
                  <Input type="number" min={0} step="0.01" className="mt-1 h-9 text-sm" value={payForm.split_cash} onChange={e => setPayForm(f => ({ ...f, split_cash: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider">Online Amount</Label>
                  <Input type="number" min={0} step="0.01" className="mt-1 h-9 text-sm" value={payForm.split_online} onChange={e => setPayForm(f => ({ ...f, split_online: e.target.value }))} placeholder="0" />
                </div>
                <p className="col-span-2 text-[10px] text-slate-500">
                  Cash + Online must equal the total amount.
                </p>
              </div>
            )}
            {payForm.method === 'pos_terminal' ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-700">
                <p className="font-medium flex items-center gap-2"><Smartphone className="h-4 w-4" /> POS Terminal Payment</p>
                <p className="text-xs text-slate-500 mt-1">Click "Send to POS" below to open the POS terminal dialog.</p>
              </div>
            ) : (
              payForm.method !== 'cash' && (
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider">Transaction ID / Ref No.</Label>
                  <Input
                    className="mt-1 h-9 text-sm"
                    value={payForm.transaction_id}
                    onChange={e => setPayForm(f => ({ ...f, transaction_id: e.target.value }))}
                    placeholder="UTR / Cheque no."
                  />
                </div>
              )
            )}
            {payForm.method !== 'pos_terminal' && (
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider">Remarks</Label>
                <Input
                  className="mt-1 h-9 text-sm"
                  value={payForm.remarks}
                  onChange={e => setPayForm(f => ({ ...f, remarks: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayDialog(false)}>Cancel</Button>
            {payForm.method === 'pos_terminal' ? (
              <Button
                onClick={() => { setShowPayDialog(false); openPosDialog(); }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Smartphone className="h-3 w-3 mr-2" />
                Send to POS
              </Button>
            ) : (
              <Button
                onClick={paySelected}
                disabled={processingPayment}
                className="bg-slate-900 hover:bg-slate-800 text-white"
              >
                {processingPayment ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <CreditCard className="h-3 w-3 mr-2" />}
                Record Payment
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* POS Terminal Dialog */}
      <Dialog open={showPosDialog} onOpenChange={v => { if (!v) stopPosPolling(); setShowPosDialog(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-indigo-600" />
              POS Terminal Payment
            </DialogTitle>
            <DialogDescription>
              Sends payment request to your Ezetap card/UPI terminal.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-4">
            {posStatus === 'idle' && (
              <>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider">Device ID *</Label>
                  <Input
                    className="mt-1 h-9 text-sm font-mono"
                    value={posForm.device_id}
                    onChange={e => setPosForm(f => ({ ...f, device_id: e.target.value }))}
                    placeholder="e.g. 10200000001"
                  />
                  <p className="text-xs text-slate-500 mt-1">Printed on the back of the Ezetap device.</p>
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider">Payment Mode</Label>
                  <Select value={posForm.mode} onValueChange={v => setPosForm(f => ({ ...f, mode: v }))}>
                    <SelectTrigger className="mt-1 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All modes</SelectItem>
                      <SelectItem value="CARD">Card only</SelectItem>
                      <SelectItem value="UPI">UPI only</SelectItem>
                      <SelectItem value="BHARATQR">BharatQR</SelectItem>
                      <SelectItem value="CASH">Cash (via POS)</SelectItem>
                      <SelectItem value="CHEQUE">Cheque (via POS)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {posStatus === 'polling' && (
              <div className="flex flex-col items-center py-4 gap-4">
                <div className="relative">
                  <Wifi className="h-12 w-12 text-indigo-500" />
                  <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin text-indigo-600" />
                </div>
                <p className="text-sm font-medium text-slate-700 text-center">{posMessage}</p>
                <div className="flex gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded-full text-indigo-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                    Checking every 3 seconds…
                  </span>
                </div>
              </div>
            )}

            {posStatus === 'success' && (
              <div className="flex flex-col items-center py-4 gap-3">
                <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                <p className="text-sm font-semibold text-emerald-700">{posMessage}</p>
                {posReceipt && (
                  <p className="text-xs text-slate-500">Receipt: <strong>{posReceipt}</strong></p>
                )}
                {posPaymentId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={() => downloadReceipt(posPaymentId)}
                  >
                    <Download className="h-3 w-3 mr-1.5" />
                    Download Receipt
                  </Button>
                )}
              </div>
            )}

            {(posStatus === 'failed' || posStatus === 'cancelled') && (
              <div className="flex flex-col items-center py-4 gap-3">
                <WifiOff className="h-12 w-12 text-red-400" />
                <p className="text-sm font-medium text-red-600 text-center">{posMessage}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            {posStatus === 'idle' && (
              <>
                <Button variant="outline" onClick={() => setShowPosDialog(false)}>Cancel</Button>
                <Button onClick={initiatePosPayment} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  <Smartphone className="h-3 w-3 mr-2" />
                  Send to POS
                </Button>
              </>
            )}
            {posStatus === 'polling' && (
              <Button variant="destructive" onClick={cancelPosPayment}>
                <XCircle className="h-3 w-3 mr-2" />
                Cancel Transaction
              </Button>
            )}
            {(posStatus === 'success' || posStatus === 'failed' || posStatus === 'cancelled') && (
              <Button onClick={() => { stopPosPolling(); setShowPosDialog(false); }}>
                Close
              </Button>
            )}
            {(posStatus === 'failed') && (
              <Button variant="outline" onClick={() => { setPosStatus('idle'); setPosOrderId(null); }}>
                Retry
              </Button>
            )}
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

    </div>
  );
};

// ─── Fee Type Dropdown (Monthly / Yearly) ────────────────────────────────────

const FeeTypeDropdown = ({ label, entries, payLedgerIds, setPayLedgerIds }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (!entries.length) return null;

  const selectedIds = entries.map(e => e.ledger_id);
  const selectedCount = entries.filter(e => payLedgerIds.includes(e.ledger_id)).length;
  const selectedTotal = entries
    .filter(e => payLedgerIds.includes(e.ledger_id))
    .reduce((s, e) => s + (e.remaining_balance > 0 ? e.remaining_balance : e.net_amount), 0);
  const allSelected = selectedCount === entries.length;
  const hasOverdue = entries.some(e => e.status === 'overdue');

  const toggleAll = () => {
    if (allSelected) setPayLedgerIds(prev => prev.filter(id => !selectedIds.includes(id)));
    else setPayLedgerIds(prev => [...new Set([...prev, ...selectedIds])]);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`text-xs px-2.5 py-1 rounded-lg font-medium transition border flex items-center gap-1.5 ${
          selectedCount > 0
            ? 'bg-orange-100 border-orange-300 text-orange-700'
            : hasOverdue
              ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
              : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-600'
        }`}
      >
        {label} {selectedCount > 0 ? `(${selectedCount} selected — ${fmt(selectedTotal)})` : `(${entries.length})`}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg w-72 overflow-hidden">
          <label className="flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 cursor-pointer hover:bg-slate-50 bg-slate-50">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded cursor-pointer shrink-0" />
            <span className="text-xs font-bold text-slate-600">Select all</span>
            <span className="ml-auto text-xs text-slate-400">{entries.length} item{entries.length !== 1 ? 's' : ''}</span>
          </label>
          <div className="max-h-56 overflow-y-auto">
          {entries.map(e => {
            const isSel = payLedgerIds.includes(e.ledger_id);
            const entryLabel = e.description || e.month || e.ledger_id;
            const amount = e.remaining_balance > 0 ? e.remaining_balance : e.net_amount;
            return (
              <label key={e.ledger_id} className={`flex items-center gap-3 px-3 py-2.5 border-b border-slate-50 last:border-0 cursor-pointer hover:bg-orange-50 ${isSel ? 'bg-orange-50/50' : ''}`}>
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={() => setPayLedgerIds(prev => isSel ? prev.filter(id => id !== e.ledger_id) : [...prev, e.ledger_id])}
                  className="rounded cursor-pointer shrink-0"
                />
                <span className={`flex-1 text-xs font-medium truncate ${e.status === 'overdue' ? 'text-red-600' : 'text-slate-700'}`}>
                  {entryLabel}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {e.status === 'overdue' && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">overdue</span>}
                  <span className="text-xs font-semibold text-slate-900">₹{fmt(amount)}</span>
                </div>
              </label>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Ledger View Component ────────────────────────────────────────────────────

const LedgerView = ({
  ledger, isAdmin, studentId, payLedgerIds, setPayLedgerIds,
  onPaySelected, onPayAdmission, onDownloadReceipt, onRazorpaySuccess, readOnly = false
}) => {
  const [expandedSections, setExpandedSections] = useState({ one_time: true, yearly: true, monthly: true });
  const [showMonthlyDropdown, setShowMonthlyDropdown] = useState(false);
  const monthlyDropdownRef = React.useRef(null);

  const toggleSection = (sec) => setExpandedSections(s => ({ ...s, [sec]: !s[sec] }));

  // Close monthly dropdown on outside click
  React.useEffect(() => {
    const handler = (e) => { if (monthlyDropdownRef.current && !monthlyDropdownRef.current.contains(e.target)) setShowMonthlyDropdown(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { student, summary, ledger: grouped, payments } = ledger;

  const allEntries = [
    ...(grouped.one_time || []),
    ...(grouped.yearly  || []),
    ...(grouped.monthly || []),
  ];

  const payableEntries   = allEntries.filter(e => ['pending', 'overdue', 'partially_paid'].includes(e.status));
  const overdueEntries   = allEntries.filter(e => e.status === 'overdue');

  const hasAdmissionPending = (
    (grouped.one_time || []).some(e => e.status === 'pending') ||
    (grouped.yearly   || []).some(e => e.status === 'pending')
  );

  const toggleLedgerId = (id) =>
    setPayLedgerIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const selectAll     = () => setPayLedgerIds(payableEntries.map(e => e.ledger_id));
  const selectOverdue = () => setPayLedgerIds(overdueEntries.map(e => e.ledger_id));
  const clearAll      = () => setPayLedgerIds([]);

  const selectedTotal = allEntries
    .filter(e => payLedgerIds.includes(e.ledger_id))
    .reduce((s, e) => s + (e.remaining_balance > 0 ? e.remaining_balance : e.net_amount), 0);

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

          {/* ── Admin / Accountant: Collect Payment ───────────────────────── */}
          {isAdmin && !readOnly && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              {payableEntries.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Quick select:</span>
                      <button onClick={selectAll} className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition">
                        All due ({payableEntries.length})
                      </button>
                      <FeeTypeDropdown label="One-Time" entries={(grouped.one_time || []).filter(e => ['pending','overdue','partially_paid'].includes(e.status))} payLedgerIds={payLedgerIds} setPayLedgerIds={setPayLedgerIds} />
                      <FeeTypeDropdown label="Yearly"   entries={(grouped.yearly   || []).filter(e => ['pending','overdue','partially_paid'].includes(e.status))} payLedgerIds={payLedgerIds} setPayLedgerIds={setPayLedgerIds} />
                      <FeeTypeDropdown label="Monthly"  entries={(grouped.monthly  || []).filter(e => ['pending','overdue','partially_paid'].includes(e.status))} payLedgerIds={payLedgerIds} setPayLedgerIds={setPayLedgerIds} />
                      {overdueEntries.length > 0 && (
                        <button onClick={selectOverdue} className="text-xs px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-medium transition border border-red-200">
                          Overdue only ({overdueEntries.length})
                        </button>
                      )}
                      {payLedgerIds.length > 0 && (
                        <button onClick={clearAll} className="text-xs px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-400 font-medium transition">Clear</button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hasAdmissionPending && (
                        <Button size="sm" variant="outline" className="text-xs h-9 border-slate-300" onClick={onPayAdmission}>
                          <CreditCard className="h-3 w-3 mr-1.5" />Collect Admission Fee
                        </Button>
                      )}
                      <Button
                        size="sm"
                        className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 disabled:opacity-50"
                        onClick={onPaySelected}
                        disabled={payLedgerIds.length === 0}
                      >
                        <CreditCard className="h-3 w-3 mr-1.5" />
                        Collect Payment{payLedgerIds.length > 0 ? ` — ${fmt(selectedTotal)}` : ''}
                      </Button>
                    </div>
                  </div>
                  {payLedgerIds.length === 0 && (
                    <p className="text-xs text-slate-400 italic mt-1.5">Select entries above or use the Collect button on individual rows</p>
                  )}
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" /> All fees paid
                </span>
              )}
            </div>
          )}

          {/* ── Parent / Student: Pay Online ──────────────────────────────── */}
          {readOnly && (
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
              {payableEntries.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Select to pay:</span>
                    <button onClick={selectAll} className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition">
                      All due ({payableEntries.length})
                    </button>
                    <FeeTypeDropdown label="One-Time" entries={(grouped.one_time || []).filter(e => ['pending','overdue','partially_paid'].includes(e.status))} payLedgerIds={payLedgerIds} setPayLedgerIds={setPayLedgerIds} />
                    <FeeTypeDropdown label="Yearly"   entries={(grouped.yearly   || []).filter(e => ['pending','overdue','partially_paid'].includes(e.status))} payLedgerIds={payLedgerIds} setPayLedgerIds={setPayLedgerIds} />
                    <MonthlyDropdown monthlyDue={(grouped.monthly || []).filter(e => ['pending','overdue','partially_paid'].includes(e.status))} payLedgerIds={payLedgerIds} setPayLedgerIds={setPayLedgerIds} />
                    {payLedgerIds.length > 0 && (
                      <button onClick={clearAll} className="text-xs text-slate-400 underline ml-1">Clear</button>
                    )}
                  </div>
                  {payLedgerIds.length > 0 ? (
                    <RazorpayCheckout studentId={studentId} ledgerIds={payLedgerIds} onSuccess={onRazorpaySuccess} onCancel={() => {}}>
                      <CreditCard className="h-4 w-4 mr-2" />
                      Pay {fmt(selectedTotal)} Online
                    </RazorpayCheckout>
                  ) : (
                    <p className="text-xs text-slate-400 italic">Use the Pay button on individual rows or select multiple to pay together</p>
                  )}
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" /> No pending fees — you're all clear!
                </span>
              )}
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
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Description</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Gross</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Discount</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Late Fee</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Net Due</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Due Date</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Status</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(entry => (
                    <TableRow
                      key={entry.ledger_id}
                      className={`hover:bg-slate-50 ${entry.status === 'overdue' ? 'bg-red-50/40 border-l-2 border-red-400' : ''}`}
                    >
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
                      <TableCell>
                        {entry.status === 'paid' || entry.status === 'waived' ? (
                          entry.payment_id && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                              onClick={() => onDownloadReceipt(entry.payment_id)}>
                              <Download className="h-3 w-3 mr-1" />PDF
                            </Button>
                          )
                        ) : readOnly ? (
                          <RazorpayCheckout studentId={studentId} ledgerIds={[entry.ledger_id]} onSuccess={onRazorpaySuccess} onCancel={() => {}}>
                            <CreditCard className="h-3 w-3 mr-1" />Pay
                          </RazorpayCheckout>
                        ) : (
                          <Button size="sm"
                            className="h-7 px-2.5 text-xs bg-orange-500 hover:bg-orange-600 text-white"
                            onClick={() => { setPayLedgerIds([entry.ledger_id]); onPaySelected && onPaySelected(); }}
                          >
                            <CreditCard className="h-3 w-3 mr-1" />Collect
                          </Button>
                        )}
                      </TableCell>
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
                  <TableCell className="text-sm">{isoToDDMMYYYY(p.payment_date) || p.payment_date}</TableCell>
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
