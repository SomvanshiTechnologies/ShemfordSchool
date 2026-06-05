import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import { useSession } from '../contexts/SessionContext';
import SessionDatePicker from './SessionDatePicker';
import { previewReportInTab } from '../lib/preview';
import { fmtPaymentMethod } from '../lib/paymentMethods';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { toast } from 'sonner';
import { BarChart3, TrendingUp, Download, CreditCard, GraduationCap, Calendar, FileText, Loader2, Clock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';

const ReportsPage = () => {
  const { viewSession } = useSession();
  const [activeTab, setActiveTab] = useState('financial');
  const [loading, setLoading] = useState(false);
  const [financialReport, setFinancialReport] = useState(null);
  const [academicReport, setAcademicReport] = useState(null);
  const [classes, setClasses] = useState([]);
  
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [attClass, setAttClass] = useState('');
  const [attDate, setAttDate] = useState('');
  const [attStartDate, setAttStartDate] = useState('');
  const [attEndDate, setAttEndDate] = useState('');
  const [attendanceReport, setAttendanceReport] = useState(null);

  // Helper: get date string N months ago
  const dateMonthsAgo = (n) => {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    return d.toISOString().slice(0, 10);
  };
  const today = () => new Date().toISOString().slice(0, 10);

  const applyQuickFilter = (months, setStart, setEnd) => {
    setStart(dateMonthsAgo(months));
    setEnd(today());
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  const fetchClasses = async () => {
    try {
      const response = await api.get('/classes');
      setClasses(response.data);
    } catch (error) {
      console.error('Failed to fetch classes');
    }
  };

  // Render Excel as an HTML preview from in-memory report data (browsers can't
  // preview real XLSX). PDF still uses downloadReport because browsers preview
  // PDFs in-tab.
  const inr = (n) => (n == null || isNaN(n) ? '—' : `Rs. ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

  const previewFinancialExcel = () => {
    if (!financialReport) { toast.error('Generate the report first'); return; }
    const fr = financialReport;
    const summaryRows = [
      { k: 'Total Collection', v: inr(fr.total_collection) },
      { k: 'Total Pending',    v: inr(fr.total_pending) },
      { k: 'Transactions',     v: fr.transaction_count ?? 0 },
      { k: 'Collection Rate',  v: (fr.total_collection + fr.total_pending > 0)
                                    ? `${((fr.total_collection / (fr.total_collection + fr.total_pending)) * 100).toFixed(1)}%`
                                    : '—' },
    ];
    const pmRows = Object.entries(fr.by_payment_method || {}).map(([k, v]) => ({ k: fmtPaymentMethod(k), v: inr(v) }));
    const mRows  = Object.entries(fr.by_month || {}).map(([k, v]) => ({ k, v: inr(v) }));
    previewReportInTab('Financial Report', [
      { title: 'Summary',          columns: [{ label: 'Metric', get: r => r.k }, { label: 'Value', get: r => r.v }], rows: summaryRows },
      { title: 'By Payment Method',columns: [{ label: 'Method', get: r => r.k }, { label: 'Amount', get: r => r.v }], rows: pmRows },
      { title: 'Monthly Trend',    columns: [{ label: 'Month',  get: r => r.k }, { label: 'Amount', get: r => r.v }], rows: mRows },
    ]);
  };

  const previewAcademicExcel = () => {
    if (!academicReport) { toast.error('Generate the report first'); return; }
    const ar = academicReport;
    const studentRows = ar.students || [];
    const subjectRows = Object.entries(ar.subject_averages || {}).map(([k, v]) => ({ k, v }));
    previewReportInTab(`Academic Report — ${ar.class_name || ''}`, [
      { title: 'Subject Averages',
        columns: [{ label: 'Subject', get: r => r.k }, { label: 'Average', get: r => Number(r.v).toFixed(2) }],
        rows: subjectRows,
      },
      { title: 'Students',
        columns: [
          { label: 'Roll',    get: r => r.roll_number },
          { label: 'Name',    get: r => r.name },
          { label: 'Total',   get: r => r.total },
          { label: 'Average', get: r => Number(r.average ?? 0).toFixed(2) },
          { label: 'Grade',   get: r => r.grade || '—' },
        ],
        rows: studentRows,
      },
    ]);
  };

  const previewAttendanceExcel = () => {
    if (!attendanceReport) { toast.error('Generate the report first'); return; }
    const ar = attendanceReport;
    const rows = ar.records || [];
    previewReportInTab('Attendance Report', [
      { title: ar.summary ? `Summary — ${ar.summary.present_count ?? 0} present / ${ar.summary.total ?? rows.length} total` : null,
        columns: [
          { label: 'Date',    get: r => r.date },
          { label: 'Class',   get: r => r.class_name + (r.section ? ` ${r.section}` : '') },
          { label: 'Student', get: r => r.student_name },
          { label: 'Roll',    get: r => r.roll_number },
          { label: 'Status',  get: r => r.status },
        ],
        rows,
      },
    ]);
  };

  const downloadReport = async (endpoint, params, _filename) => {
    // Open the tab IMMEDIATELY with a spinner so the user sees instant feedback
    // and pop-up blockers don't kick in. Once the blob arrives, swap the tab to
    // the file URL — the browser previews PDFs in-tab and triggers a native
    // save dialog for XLSX (matching the Fees Reports UX).
    const splash = `<!doctype html><html><head><meta charset="utf-8"><title>Loading report…</title>
      <style>body{font-family:Segoe UI,Arial,sans-serif;margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#f8fafc;color:#475569}
      .box{text-align:center}.spin{display:inline-block;width:28px;height:28px;border:3px solid #e2e8f0;border-top-color:#E88A1A;border-radius:50%;animation:r .8s linear infinite;margin-bottom:10px}
      @keyframes r{to{transform:rotate(360deg)}}</style></head>
      <body><div class="box"><div class="spin"></div><div>Preparing report…</div></div></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('Pop-up blocked — allow pop-ups to view the report'); return; }
    w.document.write(splash);
    w.document.close();
    try {
      const res = await api.get(endpoint, { params, responseType: 'blob' });
      const mime = params?.format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const url = URL.createObjectURL(new Blob([res.data], { type: mime }));
      try { w.location.replace(url); } catch (_) { /* tab closed */ }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      try {
        w.document.body.innerHTML = '<div style="font-family:Arial;padding:40px;color:#dc2626;text-align:center">Failed to load report.</div>';
      } catch (_) { /* tab closed */ }
      toast.error('Failed to load report');
    }
  };

  const fetchFinancialReport = async () => {
    setLoading(true);
    try {
      const params = {};
      if (viewSession) params.academic_year = viewSession;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const response = await api.get('/reports/financial', { params });
      setFinancialReport(response.data);
    } catch (error) {
      if (!error?._handled) toast.error('Failed to fetch financial report');
    } finally {
      setLoading(false);
    }
  };

  const fetchAcademicReport = async () => {
    if (!selectedClass) {
      toast.error('Please select a class');
      return;
    }
    setLoading(true);
    try {
      const params = { class_name: selectedClass };
      if (selectedSection) params.section = selectedSection;
      if (viewSession) params.academic_year = viewSession;

      const response = await api.get('/reports/academic', { params });
      setAcademicReport(response.data);
    } catch (error) {
      if (!error?._handled) toast.error('Failed to fetch academic report');
    } finally {
      setLoading(false);
    }
  };

  const fetchAttendanceReport = async () => {
    setLoading(true);
    try {
      const params = {};
      if (attClass) params.class_name = attClass;
      if (attDate) {
        params.date = attDate;
      } else {
        if (attStartDate) params.start_date = attStartDate;
        if (attEndDate) params.end_date = attEndDate;
      }
      const response = await api.get('/reports/attendance', { params });
      setAttendanceReport(response.data);
    } catch (error) {
      if (!error?._handled) toast.error('Failed to fetch attendance report');
    } finally {
      setLoading(false);
    }
  };

  const COLORS = ['#E88A1A', '#1A1A1A', '#A3A3A3', '#E5E5E5'];

  const selectedClassSections = classes.find(c => c.name === selectedClass)?.sections || [];

  // Prepare chart data
  const paymentMethodData = financialReport?.by_payment_method
    ? Object.entries(financialReport.by_payment_method).map(([key, value]) => ({ name: fmtPaymentMethod(key), value }))
    : [];

  const monthlyData = financialReport?.by_month
    ? Object.entries(financialReport.by_month).map(([month, amount]) => ({ month, amount }))
    : [];

  return (
    <div data-testid="reports-page">
      <div className="page-header flex justify-between items-start mb-8">
        <div className="page-header-inner">
          <div className="page-header-accent" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Reports</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Financial, academic and attendance analytics</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6 rounded-xl h-10 bg-slate-100">
          <TabsTrigger value="financial" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="financial-tab">Financial</TabsTrigger>
          <TabsTrigger value="academic" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="academic-tab">Academic</TabsTrigger>
          <TabsTrigger value="attendance" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="attendance-tab">Attendance</TabsTrigger>
        </TabsList>

        {/* Financial Reports */}
        <TabsContent value="financial">
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex flex-col gap-3">
                {/* Quick filter buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Clock className="h-4 w-4 text-slate-500" />
                  <span className="text-xs text-slate-500 font-medium">Quick filter:</span>
                  {[['1M', 1], ['3M', 3], ['6M', 6]].map(([label, months]) => (
                    <button key={label} onClick={() => applyQuickFilter(months, setStartDate, setEndDate)}
                      className="px-3 py-1 rounded-xl text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-colors">
                      Last {label}
                    </button>
                  ))}
                  {(startDate || endDate) && (
                    <button onClick={() => { setStartDate(''); setEndDate(''); }}
                      className="px-3 py-1 rounded-xl text-xs font-semibold border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                      Clear
                    </button>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <SessionDatePicker value={startDate} onChange={setStartDate} data-testid="start-date" />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <SessionDatePicker value={endDate} onChange={setEndDate} data-testid="end-date" />
                  </div>
                  <Button onClick={fetchFinancialReport} disabled={loading} data-testid="generate-financial-btn">
                    {loading ? 'Loading...' : 'Generate Report'}
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => downloadReport('/reports/financial/export', { format: 'pdf', ...(viewSession && { academic_year: viewSession }), ...(startDate && { start_date: startDate }), ...(endDate && { end_date: endDate }) }, 'financial-report.pdf')} data-testid="export-financial-pdf">
                      <Download className="h-4 w-4 mr-1" /> PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={previewFinancialExcel} data-testid="export-financial-excel">
                      <FileText className="h-4 w-4 mr-1" /> Excel
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {financialReport && financialReport.transaction_count === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500">
              <CreditCard className="h-12 w-12 mb-4 text-slate-300" />
              <p className="text-sm font-medium">No transactions found for the selected period</p>
              <p className="text-xs mt-1">Try adjusting the date range or clear filters</p>
            </div>
          )}
          {financialReport && financialReport.transaction_count > 0 && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="bg-slate-900 p-6 rounded-2xl">
                  <p className="stat-label">Total Collection</p>
                  <p className="text-3xl font-bold text-white tracking-tight">Rs.{financialReport.total_collection?.toLocaleString()}</p>
                </div>
                <div className="bg-white border border-slate-200 border-l-4 border-l-[#E88A1A] p-6 rounded-2xl">
                  <p className="stat-label">Total Pending</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">Rs.{financialReport.total_pending?.toLocaleString()}</p>
                </div>
                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="stat-label">Transactions</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{financialReport.transaction_count}</p>
                </div>
                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="stat-label">Collection Rate</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">
                    {financialReport.total_collection + financialReport.total_pending > 0
                      ? Math.round((financialReport.total_collection / (financialReport.total_collection + financialReport.total_pending)) * 100)
                      : 0}%
                  </p>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-4">By Payment Method</p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={paymentMethodData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            fill="#8884d8"
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {paymentMethodData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value) => `Rs.${value.toLocaleString()}`} contentStyle={{ background: '#1A1A1A', border: 'none', borderRadius: '2px', color: '#fff', fontSize: '12px' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-4">Monthly Trend</p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={monthlyData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F5" />
                          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#888' }} />
                          <YAxis tick={{ fontSize: 11, fill: '#888' }} />
                          <Tooltip formatter={(value) => `Rs.${value.toLocaleString()}`} contentStyle={{ background: '#1A1A1A', border: 'none', borderRadius: '2px', color: '#fff', fontSize: '12px' }} />
                          <Bar dataKey="amount" fill="#E88A1A" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Academic Reports */}
        <TabsContent value="academic">
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="space-y-2">
                  <Label>Class</Label>
                  <Select value={selectedClass} onValueChange={(v) => { setSelectedClass(v); setSelectedSection(''); }}>
                    <SelectTrigger className="w-[150px]" data-testid="report-class">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {classes.map((cls) => (
                        <SelectItem key={cls.name} value={cls.name}>{cls.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Section</Label>
                  <Select value={selectedSection || "all"} onValueChange={(v) => setSelectedSection(v === "all" ? "" : v)} disabled={!selectedClass}>
                    <SelectTrigger className="w-[150px]" data-testid="report-section">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sections</SelectItem>
                      {selectedClassSections.map((sec) => (
                        <SelectItem key={sec.section_name || sec} value={sec.section_name || sec}>{sec.section_name || sec}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={fetchAcademicReport} disabled={loading} data-testid="generate-academic-btn">
                  {loading ? 'Loading...' : 'Generate Report'}
                </Button>
                {selectedClass && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => downloadReport('/reports/academic/export', { format: 'pdf', class_name: selectedClass, ...(selectedSection && { section: selectedSection }), ...(viewSession && { academic_year: viewSession }) }, 'academic-report.pdf')} data-testid="export-academic-pdf">
                      <Download className="h-4 w-4 mr-1" /> PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={previewAcademicExcel} data-testid="export-academic-excel">
                      <FileText className="h-4 w-4 mr-1" /> Excel
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {academicReport && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="stat-label">Students Evaluated</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{academicReport.student_count}</p>
                </div>
                <div className="bg-slate-900 p-6 rounded-2xl">
                  <p className="stat-label">Class Average</p>
                  <p className="text-3xl font-bold text-white tracking-tight">{academicReport.class_average}%</p>
                </div>
                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="stat-label">Academic Year</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{academicReport.academic_year}</p>
                </div>
              </div>

              {Object.keys(academicReport.student_results || {}).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Student Performance</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Student ID</TableHead>
                          <TableHead>Total Obtained</TableHead>
                          <TableHead>Total Max</TableHead>
                          <TableHead>Percentage</TableHead>
                          <TableHead>Grade</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(academicReport.student_results).map(([studentId, data]) => (
                          <TableRow key={studentId}>
                            <TableCell className="font-medium">{studentId}</TableCell>
                            <TableCell>{data.total_obtained}</TableCell>
                            <TableCell>{data.total_max}</TableCell>
                            <TableCell>{data.percentage}%</TableCell>
                            <TableCell>
                              <span className={`text-xs uppercase font-bold tracking-wider px-2 py-0.5 border ${
                                data.grade?.startsWith('A') ? 'text-slate-900 border-slate-900' :
                                'text-slate-900 border-slate-200'
                              }`}>
                                {data.grade}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* Attendance Reports */}
        <TabsContent value="attendance">
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex flex-col gap-3">
                {/* Quick filter buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Clock className="h-4 w-4 text-slate-500" />
                  <span className="text-xs text-slate-500 font-medium">Quick filter:</span>
                  {[['1M', 1], ['3M', 3], ['6M', 6]].map(([label, months]) => (
                    <button key={label} onClick={() => { applyQuickFilter(months, setAttStartDate, setAttEndDate); setAttDate(''); }}
                      className="px-3 py-1 rounded-xl text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-colors">
                      Last {label}
                    </button>
                  ))}
                  {(attStartDate || attEndDate || attDate) && (
                    <button onClick={() => { setAttStartDate(''); setAttEndDate(''); setAttDate(''); }}
                      className="px-3 py-1 rounded-xl text-xs font-semibold border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                      Clear
                    </button>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
                  <div className="space-y-2">
                    <Label>Class</Label>
                    <Select value={attClass || "all"} onValueChange={(v) => setAttClass(v === "all" ? "" : v)}>
                      <SelectTrigger className="w-[150px]" data-testid="att-class">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Classes</SelectItem>
                        {classes.map((cls) => (
                          <SelectItem key={cls.name} value={cls.name}>{cls.display_name || cls.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Single Date</Label>
                    <SessionDatePicker value={attDate} onChange={(v) => { setAttDate(v); if (v) { setAttStartDate(''); setAttEndDate(''); }}} data-testid="att-date" />
                  </div>
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <SessionDatePicker value={attStartDate} onChange={(v) => { setAttStartDate(v); setAttDate(''); }} data-testid="att-start-date" />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <SessionDatePicker value={attEndDate} onChange={(v) => { setAttEndDate(v); setAttDate(''); }} data-testid="att-end-date" />
                  </div>
                  <Button onClick={fetchAttendanceReport} disabled={loading} data-testid="generate-attendance-btn">
                    {loading ? 'Loading...' : 'Generate Report'}
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => downloadReport('/reports/attendance/export', { format: 'pdf', ...(attClass && { class_name: attClass }), ...(attDate && { date: attDate }), ...(attStartDate && { start_date: attStartDate }), ...(attEndDate && { end_date: attEndDate }) }, 'attendance-report.pdf')} data-testid="export-attendance-pdf">
                      <Download className="h-4 w-4 mr-1" /> PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={previewAttendanceExcel} data-testid="export-attendance-excel"
                    >
                      <FileText className="h-4 w-4 mr-1" /> Excel
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {attendanceReport && (
            attendanceReport.total_records === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <Calendar className="h-12 w-12 mb-4 text-slate-300" />
                <p className="text-sm font-medium">No attendance records found</p>
                <p className="text-xs mt-1">Try adjusting the date range or class filter</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                    <p className="stat-label">Total Records</p>
                    <p className="text-3xl font-bold text-slate-900 tracking-tight">{attendanceReport.total_records}</p>
                  </div>
                  <div className="bg-slate-900 p-6 rounded-2xl">
                    <p className="stat-label">Present</p>
                    <p className="text-3xl font-bold text-white tracking-tight">{attendanceReport.present}</p>
                  </div>
                  <div className="bg-white border border-slate-200 border-l-4 border-l-[#E88A1A] p-6 rounded-2xl">
                    <p className="stat-label">Absent</p>
                    <p className="text-3xl font-bold text-slate-900 tracking-tight">{attendanceReport.absent}</p>
                  </div>
                  <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                    <p className="stat-label">Attendance %</p>
                    <p className="text-3xl font-bold text-slate-900 tracking-tight">{attendanceReport.percentage}%</p>
                  </div>
                </div>
              </div>
            )
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ReportsPage;
