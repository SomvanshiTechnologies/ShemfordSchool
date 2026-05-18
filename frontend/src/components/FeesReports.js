import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../lib/api';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from './ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from './ui/table';
import { Search, Loader2, FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';

// ─── Small helpers ───────────────────────────────────────────────────────────

const inr = (n) => (n == null || isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

// Display dates as DD/MM/YYYY. Backend stores YYYY-MM-DD strings.
const fmtDate = (s) => {
  if (!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s);
};

// Match the labels used in the Fees Type filter dropdown so column ↔ filter stay aligned
const FEE_TYPE_LABELS = { one_time: 'One Time', monthly: 'Monthly', yearly: 'Yearly' };
const fmtFeeType = (v) => FEE_TYPE_LABELS[v] || v || '—';

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const downloadBlob = (content, mime, filename) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
};

const exportExcel = (rows, columns, filename, title) => {
  // HTML-table-as-Excel — Excel/LibreOffice opens this fine
  const css = 'table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px;font-family:Arial}';
  const head = `<tr>${columns.map((c) => `<th>${c.label}</th>`).join('')}</tr>`;
  const body = rows.map((r) => `<tr>${columns.map((c) => `<td>${c.value(r) ?? ''}</td>`).join('')}</tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><h3>${title}</h3><table>${head}${body}</table></body></html>`;
  downloadBlob(html, 'application/vnd.ms-excel', `${filename}.xls`);
};

const exportPDF = (rows, columns, title) => {
  // Browser print dialog → user picks "Save as PDF" as destination
  const head = `<tr>${columns.map((c) => `<th>${c.label}</th>`).join('')}</tr>`;
  const body = rows.map((r) => `<tr>${columns.map((c) => `<td>${c.value(r) ?? ''}</td>`).join('')}</tr>`).join('');
  const html = `<!doctype html><html><head><title>${title}</title>
    <style>@page{size:A4 landscape;margin:12mm}
    body{font-family:Arial;padding:0;color:#111}h2{margin:0 0 12px}
    table{border-collapse:collapse;width:100%;font-size:11px}
    th,td{border:1px solid #999;padding:4px 6px;text-align:left}
    th{background:#f3f4f6}</style></head>
    <body><h2>${title}</h2><table>${head}${body}</table>
    <script>window.onload=()=>{setTimeout(()=>window.print(),200)}</script>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast.error('Pop-up blocked — allow pop-ups to download PDF'); return; }
  w.document.write(html); w.document.close();
};

const ExportBar = ({ rows, columns, title, filename }) => (
  <div className="flex items-center gap-1 ml-auto">
    <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" title="Download Excel"
      onClick={() => exportExcel(rows, columns, filename, title)}>
      <FileSpreadsheet className="h-3.5 w-3.5" /><span className="text-xs">Excel</span>
    </Button>
    <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" title="Download PDF"
      onClick={() => exportPDF(rows, columns, title)}>
      <FileText className="h-3.5 w-3.5" /><span className="text-xs">PDF</span>
    </Button>
  </div>
);

// ─── Shared filter helpers ───────────────────────────────────────────────────

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

// Fee buckets used by StudentLedgerEntry.fee_type
const FEE_TYPES = [
  { value: 'one_time', label: 'One Time' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

// Payment methods recorded on FeePayment.payment_method
const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'online', label: 'Online' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'split', label: 'Split (Cash + Online)' },
];

// ─── Collection Report ───────────────────────────────────────────────────────

const COLLECTION_DEFAULTS = {
  duration: 'all_time', start_date: '', end_date: '',
  class_name: '', section: '', fee_type: '', payment_method: '',
};

// Convert "2026-04" → "April 2026"; "2025-26" → "2025-26"
const fmtPeriod = (s, rollup) => {
  if (!s) return '—';
  if (rollup === 'yearly') return s;
  const m = String(s).match(/^(\d{4})-(\d{2})$/);
  if (!m) return s;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
};

const CollectionReport = ({ classes, sections }) => {
  const [filters, setFilters] = useState(COLLECTION_DEFAULTS);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searched, setSearched] = useState(false);

  const runFetch = async (f) => {
    setLoading(true);
    try {
      const params = {
        duration: f.duration,
        ...(f.duration === 'custom' && { start_date: f.start_date, end_date: f.end_date }),
        ...(f.class_name && { class_name: f.class_name }),
        ...(f.section && { section: f.section }),
        ...(f.fee_type && { fee_type: f.fee_type }),
        ...(f.payment_method && { payment_method: f.payment_method }),
      };
      const res = await api.get('/fees/reports/collection', { params });
      setRows(Array.isArray(res.data) ? res.data : []);
      setSearched(true);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  const fetchData = useCallback(() => runFetch(filters), [filters]);
  const clearAndFetch = () => { setFilters(COLLECTION_DEFAULTS); runFetch(COLLECTION_DEFAULTS); };

  // Auto-load with default filters on mount so the report isn't empty by default
  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, []);

  const columns = useMemo(() => [
    { key: 'admission',       label: 'Admission No',     value: (r) => r.admission_number },
    { key: 'name',            label: 'Student Name',     value: (r) => r.student_name },
    { key: 'mobile',          label: 'Mobile Number',    value: (r) => r.mobile },
    { key: 'guardian',        label: 'Guardian Name',    value: (r) => r.guardian },
    { key: 'class',           label: 'Class (Section)',  value: (r) => r.class_section },
    { key: 'payments_count',  label: '# Payments',       value: (r) => r.payments_count },
    { key: 'last',            label: 'Last Payment',     value: (r) => fmtDate(r.last_payment_date), render: (r) => fmtDate(r.last_payment_date) },
    { key: 'total_collected', label: 'Total Paid (₹)',   value: (r) => r.total_collected, render: (r) => inr(r.total_collected) },
  ], []);

  const filtered = useMemo(() => {
    if (!searchTerm) return rows;
    const s = searchTerm.toLowerCase();
    return rows.filter((r) =>
      Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(s))
    );
  }, [rows, searchTerm]);

  const totalCount = filtered.length;
  const totalPaid = useMemo(() => filtered.reduce((s, r) => s + (r.total_collected || 0), 0), [filtered]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold">Select Criteria</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider">Search Duration <span className="text-red-500">*</span></Label>
              <Select value={filters.duration} onValueChange={(v) => setFilters((f) => ({ ...f, duration: v }))}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{DURATIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider">Class</Label>
              <Select value={filters.class_name || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, class_name: v === 'all' ? '' : v }))}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Classes</SelectItem>{classes.map((c) => <SelectItem key={c.name || c} value={c.name || c}>Class {c.name || c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider">Section</Label>
              <Select value={filters.section || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, section: v === 'all' ? '' : v }))}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Sections</SelectItem>{sections.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider">Fees Type</Label>
              <Select value={filters.fee_type || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, fee_type: v === 'all' ? '' : v }))}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {FEE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider">Payment Method</Label>
              <Select value={filters.payment_method || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, payment_method: v === 'all' ? '' : v }))}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Methods</SelectItem>
                  {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {filters.duration === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] font-bold uppercase tracking-wider">Start Date</Label>
                <Input type="date" className="h-9 mt-1" value={filters.start_date} onChange={(e) => setFilters((f) => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div>
                <Label className="text-[10px] font-bold uppercase tracking-wider">End Date</Label>
                <Input type="date" className="h-9 mt-1" value={filters.end_date} onChange={(e) => setFilters((f) => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={clearAndFetch} disabled={loading} className="h-9">
              Clear Filters
            </Button>
            <Button type="button" onClick={fetchData} disabled={loading} className="h-9">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Search bar — own row, between filter card and report */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9 h-9 text-sm" placeholder="Search in results…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>

      {/* Report */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-sm font-semibold">Fees Collection Report</h3>
            {searched && totalCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {totalCount} students · <strong className="text-green-700">{inr(totalPaid)}</strong> collected
              </span>
            )}
            <ExportBar rows={filtered} columns={columns} title="Fees Collection Report" filename="fees-collection-report" />
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => <TableHead key={c.label} className="text-[10px] uppercase tracking-wider">{c.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={columns.length} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
                ) : !searched ? (
                  <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={columns.length} className="text-center py-8">
                    <div className="text-pink-500">No data available in table</div>
                    <div className="text-xs text-muted-foreground mt-2">
                      No paid fee entries match the selected filters. Try widening the duration or clearing Class / Section / Fees Type / Payment Method.
                    </div>
                  </TableCell></TableRow>
                ) : filtered.map((r, i) => (
                  <TableRow key={`${r.payment_id}-${i}`}>
                    {columns.map((c) => <TableCell key={c.label} className="text-sm">{c.render ? c.render(r) : c.value(r)}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Due Fees Report ─────────────────────────────────────────────────────────

const DUE_DEFAULTS = { class_name: '', section: '', fee_type: '', as_of_date: '' };

const DueReport = ({ classes, sections }) => {
  const [filters, setFilters] = useState(DUE_DEFAULTS);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searched, setSearched] = useState(false);

  const runFetch = async (f) => {
    setLoading(true);
    try {
      const params = {};
      if (f.class_name) params.class_name = f.class_name;
      if (f.section) params.section = f.section;
      if (f.fee_type) params.fee_type = f.fee_type;
      if (f.as_of_date) params.as_of_date = f.as_of_date;
      const res = await api.get('/fees/reports/due', { params });
      setRows(Array.isArray(res.data) ? res.data : []);
      setSearched(true);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };
  const fetchData = useCallback(() => runFetch(filters), [filters]);
  const clearAndFetch = () => { setFilters(DUE_DEFAULTS); runFetch(DUE_DEFAULTS); };

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, []);

  const columns = useMemo(() => [
    { key: 'admission', label: 'Admission No',    value: (r) => r.admission_number },
    { key: 'name',      label: 'Student Name',    value: (r) => r.student_name },
    { key: 'mobile',    label: 'Mobile Number',   value: (r) => r.mobile },
    { key: 'guardian',  label: 'Guardian Name',   value: (r) => r.guardian },
    { key: 'class',     label: 'Class (Section)', value: (r) => r.class_section },
    { key: 'pending',   label: '# Pending',       value: (r) => r.entries_pending },
    { key: 'oldest',    label: 'Oldest Due',      value: (r) => fmtDate(r.oldest_due), render: (r) => fmtDate(r.oldest_due) },
    { key: 'amount',    label: 'Amount (₹)',      value: (r) => r.amount,  render: (r) => inr(r.amount) },
    { key: 'paid',      label: 'Paid (₹)',        value: (r) => r.paid,    render: (r) => inr(r.paid) },
    { key: 'balance',   label: 'Balance (₹)',     value: (r) => r.balance, render: (r) => inr(r.balance) },
  ], []);

  const filtered = useMemo(() => {
    if (!searchTerm) return rows;
    const s = searchTerm.toLowerCase();
    return rows.filter((r) =>
      Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(s))
    );
  }, [rows, searchTerm]);

  const totalBalance = useMemo(() => filtered.reduce((sum, r) => sum + (r.balance || 0), 0), [filtered]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold">Select Criteria</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider">Class</Label>
              <Select value={filters.class_name || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, class_name: v === 'all' ? '' : v }))}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Classes</SelectItem>{classes.map((c) => <SelectItem key={c.name || c} value={c.name || c}>Class {c.name || c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider">Section</Label>
              <Select value={filters.section || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, section: v === 'all' ? '' : v }))}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Sections</SelectItem>{sections.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider">Fees Type</Label>
              <Select value={filters.fee_type || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, fee_type: v === 'all' ? '' : v }))}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {FEE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider">As of Date</Label>
              <Input type="date" className="h-9 mt-1" value={filters.as_of_date} onChange={(e) => setFilters((f) => ({ ...f, as_of_date: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={clearAndFetch} disabled={loading} className="h-9">
              Clear Filters
            </Button>
            <Button type="button" onClick={fetchData} disabled={loading} className="h-9">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Search bar — own row, between filter card and report */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9 h-9 text-sm" placeholder="Search in results…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-sm font-semibold">Due Fees Report</h3>
            {searched && filtered.length > 0 && (
              <span className="text-xs text-muted-foreground">Total balance: <strong className="text-red-600">{inr(totalBalance)}</strong></span>
            )}
            <ExportBar rows={filtered} columns={columns} title="Due Fees Report" filename="due-fees-report" />
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => <TableHead key={c.label} className="text-[10px] uppercase tracking-wider">{c.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={columns.length} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
                ) : !searched ? (
                  <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={columns.length} className="text-center text-pink-500 py-8">No data available in table</TableCell></TableRow>
                ) : filtered.map((r, i) => (
                  <TableRow key={`${r.admission_number}-${r.fee_type}-${i}`}>
                    {columns.map((c) => <TableCell key={c.label} className="text-sm">{c.render ? c.render(r) : c.value(r)}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Main entry ──────────────────────────────────────────────────────────────

const FeesReports = () => {
  const [active, setActive] = useState('collection');
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const classesRes = await api.get('/classes').catch(() => ({ data: [] }));
        if (cancelled) return;
        const cls = Array.isArray(classesRes.data) ? classesRes.data : [];
        setClasses(cls);
        // Streams (Humanities, Science…) sometimes leak into sections — filter them out
        const streamSet = new Set();
        cls.forEach((c) => (c.streams || []).forEach((st) => streamSet.add(String(st).toLowerCase())));
        ['science', 'humanities', 'commerce', 'arts'].forEach((s) => streamSet.add(s));
        const rawSecs = cls.flatMap((c) => c.sections || []);
        const secs = Array.from(new Set(
          rawSecs
            .map((s) => (typeof s === 'string' ? s : s?.section_name))
            .filter(Boolean)
            .filter((s) => !streamSet.has(String(s).toLowerCase()))
        )).sort();
        setSections(secs.length ? secs : ['A', 'B', 'C', 'D']);
      } catch { /* pickers fall back to empty */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActive('collection')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${active === 'collection' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
        >
          Fees Collection
        </button>
        <button
          onClick={() => setActive('due')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${active === 'due' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
        >
          Due Fees
        </button>
      </div>
      {active === 'collection'
        ? <CollectionReport classes={classes} sections={sections} />
        : <DueReport classes={classes} sections={sections} />}
    </div>
  );
};

export default FeesReports;
