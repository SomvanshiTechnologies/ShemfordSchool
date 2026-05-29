import React, { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { previewInTab, previewExcelHtml } from '../lib/preview';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';
import { clampISODate } from '../lib/dateBounds';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from './ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from './ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from './ui/table';
import { toast } from 'sonner';
import {
  Download, FileText, Plus, RefreshCw, CheckCircle, CreditCard,
  Loader2, ChevronLeft, ChevronRight, IndianRupee, Users, TrendingUp, Calendar,
} from 'lucide-react';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const STATUS_COLORS = {
  draft:    'bg-yellow-100 text-yellow-800 border-yellow-200',
  approved: 'bg-blue-100 text-blue-800 border-blue-200',
  paid:     'bg-green-100 text-green-800 border-green-200',
};

// "Rs." prefix (not ₹) — Helvetica in reportlab PDFs and Excel HTML downloads
// render ₹ as tofu boxes. Using a plain ASCII prefix keeps it consistent
// across the UI, PDF payslips, and Excel exports.
const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const currentYear  = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

// ─────────────────────────────────────────────────────────────────────────────
// Admin view — generate, approve, pay, export
// ─────────────────────────────────────────────────────────────────────────────
export const AdminPayrollView = ({ canManage = true }) => {
  const { sessionBounds, sessionToday } = useSession();
  const [records,      setRecords]      = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [page,         setPage]         = useState(1);
  const [totalPages,   setTotalPages]   = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const sentinelRef = React.useRef(null);
  const PAGE_SIZE = 30;
  const [month,        setMonth]        = useState(currentMonth);
  const [year,         setYear]         = useState(currentYear);
  const [generating,   setGenerating]   = useState(false);
  const [showGenDlg,   setShowGenDlg]   = useState(false);
  const [genLWP,       setGenLWP]       = useState('0');
  const [showPayDlg,   setShowPayDlg]   = useState(false);
  const [payRecord,    setPayRecord]    = useState(null);
  const [payDate,      setPayDate]      = useState('');
  const [payRef,       setPayRef]       = useState('');
  const [actionLoading,setActionLoading]= useState('');

  const monthYear = `${year}-${String(month).padStart(2, '0')}`;

  // Drive the month navigator from the selected session: default to the
  // session-aware "today" month and clamp navigation to the session's months
  // (e.g. 2025-2026 → Apr 2025 … Mar 2026). Switching session re-anchors here,
  // so payroll no longer shows the same month across every session.
  useEffect(() => {
    if (!sessionToday) return;
    const [y, m] = sessionToday.split('-').map(Number);
    if (y && m) { setYear(y); setMonth(m); }
  }, [sessionToday]);

  const startYM = sessionBounds.start ? sessionBounds.start.slice(0, 7) : '';
  const endYM   = sessionBounds.end ? sessionBounds.end.slice(0, 7) : '';
  const atStart = !!startYM && monthYear <= startYM;
  const atEnd   = !!endYM && monthYear >= endYM;
  const goPrev = () => { if (atStart) return; if (month === 1) { setMonth(12); setYear((y) => y - 1); } else setMonth((m) => m - 1); };
  const goNext = () => { if (atEnd) return; if (month === 12) { setMonth(1); setYear((y) => y + 1); } else setMonth((m) => m + 1); };

  const load = useCallback(async (pg = 1, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await api.get('/payroll', { params: { month_year: monthYear, page: pg, limit: PAGE_SIZE } });
      const arr = Array.isArray(res.data) ? res.data : (res.data.records || []);
      const total = parseInt(res.headers?.['x-total-count'] ?? arr.length);
      const pages = parseInt(res.headers?.['x-total-pages'] ?? 1);
      setRecords(prev => append ? [...prev, ...arr] : arr);
      setTotalRecords(total);
      setTotalPages(pages);
    } catch {
      if (!append) setRecords([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [monthYear]);

  useEffect(() => { setPage(1); setRecords([]); setTotalRecords(0); setTotalPages(1); load(1, false); }, [load]);

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingMore && !loading) {
        setPage(prev => {
          const next = prev + 1;
          if (next <= totalPages) { load(next, true); return next; }
          return prev;
        });
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadingMore, loading, totalPages, load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await api.post('/payroll/generate', {
        month, year, lwp_days: parseFloat(genLWP) || 0,
      });
      const d = res.data;
      toast.success(`Generated: ${d.generated?.length || 0} | Skipped: ${d.skipped?.length || 0} | Failed: ${d.failed?.length || 0}`);
      setShowGenDlg(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const approve = async (id) => {
    setActionLoading(id + '_approve');
    try {
      await api.post(`/payroll/${id}/approve`);
      toast.success('Payroll approved');
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to approve');
    } finally {
      setActionLoading('');
    }
  };

  const openPay = (rec) => {
    setPayRecord(rec);
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayRef('');
    setShowPayDlg(true);
  };

  const markPaid = async () => {
    if (!payRecord) return;
    setActionLoading(payRecord.payroll_id + '_pay');
    try {
      await api.post(`/payroll/${payRecord.payroll_id}/mark-paid`, {
        payment_date: payDate, payment_reference: payRef,
      });
      toast.success('Marked as paid');
      setShowPayDlg(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to mark paid');
    } finally {
      setActionLoading('');
    }
  };

  const downloadPayslip = (id, _empName) => previewInTab(
    () => api.get(`/payroll/${id}/payslip`, { responseType: 'blob' }),
    { kind: 'pdf', errorMessage: 'Failed to load payslip' },
  );

  // Excel: render an HTML preview in a new tab (matches Fees Reports UX).
  // Browser can't preview real XLSX, so we use HTML and offer Print + Download
  // Excel buttons inside the preview window.
  const exportExcel = () => previewExcelHtml(
    `Payroll ${MONTHS[month - 1]} ${year}`,
    [
      { label: 'Employee ID', get: r => r.employee_id },
      { label: 'Employee',    get: r => r.employee_name || r.employee_id },
      { label: 'Designation', get: r => r.designation || '' },
      { label: 'Gross (Rs.)', get: r => fmt(r.gross_salary) },
      { label: 'Deductions (Rs.)', get: r => fmt(r.total_deductions) },
      { label: 'Net Salary (Rs.)', get: r => fmt(r.net_salary) },
      { label: 'LWP Days',    get: r => r.lwp_days ?? 0 },
      { label: 'Status',      get: r => r.status },
    ],
    records,
  );

  const exportPDF = () => previewInTab(
    () => api.get('/payroll/export/pdf', { params: { month_year: monthYear }, responseType: 'blob' }),
    { kind: 'pdf', errorMessage: 'Failed to load PDF export' },
  );

  // Stats
  const totalNet   = records.reduce((s, r) => s + (r.net_salary || 0), 0);
  const totalGross = records.reduce((s, r) => s + (r.gross_salary || 0), 0);
  const paidCount  = records.filter(r => r.status === 'paid').length;

  return (
    <div className="space-y-6">

      {/* ── Month selector + actions ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button onClick={goPrev} disabled={atStart}
            className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="font-semibold text-slate-800 min-w-[140px] text-center">
            {MONTHS[month - 1]} {year}
          </span>
          <button onClick={goNext} disabled={atEnd}
            className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 sm:ml-auto w-full sm:w-auto">
          <Button variant="outline" size="sm" onClick={load} className="rounded-xl">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
          {/* Excel/PDF export hits an admin/accountant-only endpoint — hide for teachers */}
          {canManage && (
            <>
              <Button variant="outline" size="sm" onClick={exportExcel} disabled={!records.length} className="rounded-xl">
                <Download className="h-3.5 w-3.5 mr-1.5" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={exportPDF} disabled={!records.length} className="rounded-xl">
                <FileText className="h-3.5 w-3.5 mr-1.5" /> PDF
              </Button>
              <Button size="sm" onClick={() => setShowGenDlg(true)}
                className="bg-[#E88A1A] hover:bg-[#C97516] text-white rounded-xl">
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Generate Payroll
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Employees', value: records.length, icon: Users,       color: 'text-blue-600',   bg: 'bg-blue-50' },
          { label: 'Gross Payroll',   value: fmt(totalGross),icon: TrendingUp,   color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Net Payroll',     value: fmt(totalNet),  icon: IndianRupee,   color: 'text-green-600',  bg: 'bg-green-50' },
          { label: 'Paid',            value: `${paidCount} / ${records.length}`, icon: CheckCircle, color: 'text-orange-600', bg: 'bg-orange-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`h-10 w-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
                <Icon className={`h-5 w-5 ${color}`} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="font-bold text-slate-900 text-sm">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Table ── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-[#E88A1A]" />
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
              <IndianRupee className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm">No payroll generated for {MONTHS[month-1]} {year}</p>
              {canManage && (
                <Button size="sm" onClick={() => setShowGenDlg(true)}
                  className="mt-4 bg-[#E88A1A] hover:bg-[#C97516] text-white rounded-xl">
                  Generate Now
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Employee</TableHead>
                  {/* Mobile keeps Employee + Net Salary + Status + Actions; the rest collapse */}
                  <TableHead className="hidden md:table-cell">Designation</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Gross</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net Salary</TableHead>
                  <TableHead className="hidden md:table-cell">LWP Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map(r => (
                  <TableRow key={r.payroll_id} className="hover:bg-slate-50/50">
                    <TableCell>
                      <div>
                        <p className="font-medium text-slate-900 text-sm">
                          {r.employee_name || r.employee_id}
                        </p>
                        <p className="text-xs text-slate-400">{r.employee_id}</p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-slate-600">{r.designation || '—'}</TableCell>
                    <TableCell className="hidden md:table-cell text-right text-sm">{fmt(r.gross_salary)}</TableCell>
                    <TableCell className="hidden md:table-cell text-right text-sm text-red-600">-{fmt(r.total_deductions)}</TableCell>
                    <TableCell className="text-right text-sm font-semibold text-green-700">{fmt(r.net_salary)}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm">{r.lwp_days ?? 0}</TableCell>
                    <TableCell>
                      <Badge className={`text-xs border ${STATUS_COLORS[r.status] || 'bg-slate-100 text-slate-600'} rounded-lg`}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs rounded-lg"
                          onClick={() => downloadPayslip(r.payroll_id, r.employee_name || r.employee_id)}>
                          <Download className="h-3 w-3" />
                        </Button>
                        {canManage && r.status === 'draft' && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs rounded-lg text-blue-600"
                            onClick={() => approve(r.payroll_id)}
                            disabled={actionLoading === r.payroll_id + '_approve'}>
                            {actionLoading === r.payroll_id + '_approve'
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <CheckCircle className="h-3 w-3" />}
                          </Button>
                        )}
                        {canManage && r.status === 'approved' && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs rounded-lg text-green-600"
                            onClick={() => openPay(r)}
                            disabled={actionLoading === r.payroll_id + '_pay'}>
                            <CreditCard className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex items-center justify-center py-4 gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading more...
            </div>
          )}
          {!loading && !loadingMore && records.length > 0 && page >= totalPages && totalRecords > 0 && (
            <p className="text-center text-xs text-slate-400 py-3">{totalRecords} record{totalRecords !== 1 ? 's' : ''} total</p>
          )}
        </CardContent>
      </Card>

      {/* ── Generate dialog ── */}
      <Dialog open={showGenDlg} onOpenChange={setShowGenDlg}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Generate Payroll — {MONTHS[month-1]} {year}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-500">
              Generates salary records for all active employees. Existing records are skipped unless overwrite is enabled.
            </p>
            <div className="space-y-1.5">
              <Label>Default LWP Days (applies to all employees)</Label>
              <Input type="number" min="0" max="31" value={genLWP}
                onChange={e => setGenLWP(e.target.value)} className="rounded-xl" />
              <p className="text-xs text-slate-400">Leave Without Pay days. Individual overrides can be set after generation.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenDlg(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={generate} disabled={generating}
              className="bg-[#E88A1A] hover:bg-[#C97516] text-white rounded-xl">
              {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</> : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Mark paid dialog ── */}
      <Dialog open={showPayDlg} onOpenChange={setShowPayDlg}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Mark as Paid — {payRecord?.employee_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-green-50 rounded-xl p-3 text-sm">
              <p className="text-slate-500">Net Amount</p>
              <p className="text-2xl font-bold text-green-700">{fmt(payRecord?.net_salary)}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Payment Date</Label>
              <Input type="date" min={sessionBounds.start || undefined} max={sessionToday || undefined} value={payDate} onChange={e => setPayDate(clampISODate(e.target.value, { min: sessionBounds.start, max: sessionToday }))} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Reference / UTR (optional)</Label>
              <Input placeholder="e.g. NEFT UTR number" value={payRef}
                onChange={e => setPayRef(e.target.value)} className="rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayDlg(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={markPaid} disabled={!payDate || !!actionLoading}
              className="bg-green-600 hover:bg-green-700 text-white rounded-xl">
              {actionLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Employee / Teacher view — my payslips, Form 16, yearly statement
// ─────────────────────────────────────────────────────────────────────────────
const EmployeePayrollView = () => {
  const [records,  setRecords]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [year,     setYear]     = useState(currentYear);
  const [empId,    setEmpId]    = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const empRes = await api.get('/employees/me');
        const emp = empRes.data;
        if (emp?.employee_id) {
          setEmpId(emp.employee_id);
          const prRes = await api.get(`/payroll/employee/${emp.employee_id}`, { params: { year } });
          setRecords(prRes.data || []);
        }
      } catch (e) {
        if (e.response?.status !== 404) {
          toast.error('Failed to load payroll data');
        }
        setRecords([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [year]);

  const downloadPayslip = (id, _month) => previewInTab(
    () => api.get(`/payroll/${id}/payslip`, { responseType: 'blob' }),
    { kind: 'pdf', errorMessage: 'Failed to load payslip' },
  );

  const downloadYearly = () => {
    if (!empId) return;
    return previewInTab(
      () => api.get(`/payroll/employee/${empId}/yearly-statement/${year}`, { responseType: 'blob' }),
      { kind: 'pdf', errorMessage: 'No yearly statement available yet' },
    );
  };

  const downloadForm16 = () => {
    if (!empId) return;
    const fyYear = currentMonth >= 4 ? currentYear : currentYear - 1;
    return previewInTab(
      () => api.get(`/payroll/employee/${empId}/form16/${fyYear}`, { responseType: 'blob' }),
      { kind: 'pdf', errorMessage: 'Form 16 not available — ensure all months are paid for the financial year' },
    );
  };

  const totalNet = records.reduce((s, r) => s + (r.net_salary || 0), 0);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-6 w-6 animate-spin text-[#E88A1A]" />
    </div>
  );

  if (!empId) return (
    <div className="flex flex-col items-center justify-center h-64 text-slate-400">
      <IndianRupee className="h-10 w-10 mb-2 opacity-30" />
      <p className="text-sm">No employee record linked to your account.</p>
      <p className="text-xs mt-1">Contact admin to link your employee profile.</p>
    </div>
  );

  return (
    <div className="space-y-6">

      {/* ── Year selector + downloads ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setYear(y => y - 1)}
            className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="font-semibold text-slate-800 min-w-[60px] text-center">{year}</span>
          <button onClick={() => setYear(y => Math.min(y + 1, currentYear))}
            className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={downloadYearly} className="rounded-xl">
            <Download className="h-3.5 w-3.5 mr-1.5" /> Yearly Statement
          </Button>
          <Button size="sm" onClick={downloadForm16}
            className="bg-[#E88A1A] hover:bg-[#C97516] text-white rounded-xl">
            <FileText className="h-3.5 w-3.5 mr-1.5" /> Form 16
          </Button>
        </div>
      </div>

      {/* ── Summary card ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-green-50 flex items-center justify-center">
              <IndianRupee className="h-5 w-5 text-green-600" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Earned ({year})</p>
              <p className="font-bold text-slate-900">{fmt(totalNet)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Calendar className="h-5 w-5 text-blue-600" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-xs text-slate-500">Months Processed</p>
              <p className="font-bold text-slate-900">{records.length} / 12</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-orange-50 flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-orange-600" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-xs text-slate-500">Paid Months</p>
              <p className="font-bold text-slate-900">{records.filter(r => r.status === 'paid').length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Monthly breakdown ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Monthly Payslips — {year}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {records.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400">
              <p className="text-sm">No payroll records for {year}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">LWP Deduction</TableHead>
                  <TableHead className="text-right">Net Salary</TableHead>
                  <TableHead>LWP Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Payslip</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map(r => (
                  <TableRow key={r.payroll_id} className="hover:bg-slate-50/50">
                    <TableCell className="font-medium">{MONTHS[r.month - 1]}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(r.gross_salary)}</TableCell>
                    <TableCell className="text-right text-sm text-red-600">
                      {r.lwp_deduction > 0 ? `-${fmt(r.lwp_deduction)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-green-700">{fmt(r.net_salary)}</TableCell>
                    <TableCell className="text-sm">{r.lwp_days ?? 0}</TableCell>
                    <TableCell>
                      <Badge className={`text-xs border ${STATUS_COLORS[r.status] || ''} rounded-lg`}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-7 px-2 rounded-lg"
                        onClick={() => downloadPayslip(r.payroll_id, r.month)}
                        title="Download Payslip PDF">
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Root component — switches view based on role
// ─────────────────────────────────────────────────────────────────────────────
const PayrollPage = () => {
  const { user } = useAuth();
  const isAdmin    = user?.role === 'admin' || user?.role === 'accountant';
  const isTeacher  = user?.role === 'teacher';
  const canManage  = isAdmin; // teachers get view-only

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payroll</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {canManage ? 'Manage employee salaries, approvals and disbursements' : 'View salary records and download payslips'}
          </p>
        </div>
      </div>
      {(isAdmin || isTeacher) ? <AdminPayrollView canManage={canManage} /> : <EmployeePayrollView />}
    </div>
  );
};

export default PayrollPage;
