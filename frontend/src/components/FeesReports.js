import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../lib/api';
import { getCached, setCached } from '../lib/pageCache';
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

// Use "Rs." rather than the ₹ glyph — Excel's HTML-as-xls reader falls back
// to Windows-1252 and renders the 3-byte UTF-8 ₹ as tofu in downloaded files.
const inr = (n) => (n == null || isNaN(n) ? '—' : `Rs. ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

// Display dates as DD-MM-YYYY. Backend stores YYYY-MM-DD strings.
const fmtDate = (s) => {
  if (!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s);
};

// Match the labels used in the Fees Type filter dropdown so column ↔ filter stay aligned
const FEE_TYPE_LABELS = { one_time: 'One Time', monthly: 'Monthly', yearly: 'Yearly' };
const fmtFeeType = (v) => FEE_TYPE_LABELS[v] || v || '—';

// Backend returns a comma-joined list of fee_type slugs (e.g. "monthly, one_time").
// Re-format each slug through the same label map and re-join for display.
const fmtFeeTypeList = (v) => {
  if (!v) return '—';
  const parts = String(v).split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '—';
  return parts.map((p) => FEE_TYPE_LABELS[p] || p).join(', ');
};

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

// Render a tabular HTML preview of the report rows in a new browser tab.
// Browsers can't natively preview XLSX, so we render an Excel-styled HTML page
// the user can view, copy from, or print/save as PDF themselves.
const escapeHtml = (v) => {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

const PREVIEW_SPLASH = `<!doctype html><html><head><meta charset="utf-8"><title>Loading report…</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#f8fafc;color:#475569}
.box{text-align:center}.spin{display:inline-block;width:28px;height:28px;border:3px solid #e2e8f0;border-top-color:#E88A1A;border-radius:50%;animation:r 0.8s linear infinite;margin-bottom:10px}
@keyframes r{to{transform:rotate(360deg)}}</style></head>
<body><div class="box"><div class="spin"></div><div>Preparing report…</div></div></body></html>`;

const openExcelPreview = (rows, columns, title) => {
  // 1. Open the tab synchronously so the browser doesn't block it as a pop-up
  //    and the user sees the new tab appear instantly.
  const w = window.open('', '_blank');
  if (!w) { toast.error('Pop-up blocked — allow pop-ups to view the report'); return; }
  w.document.write(PREVIEW_SPLASH); w.document.close();

  if (!rows || rows.length === 0) {
    w.document.body.innerHTML = '<div style="font-family:Arial;padding:40px;color:#64748b;text-align:center">No data to preview — load the report first.</div>';
    return;
  }
  const cols = columns || [];

  // 2. Defer the heavy HTML build/inject to the next tick so the splash actually
  //    paints (otherwise the synchronous string-build can hold the main thread).
  setTimeout(() => {
    const head = `<tr>${cols.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr>`;
    const body = rows.map(r =>
      `<tr>${cols.map(c => {
        const v = c.render ? c.render(r) : c.value(r);
        return `<td>${escapeHtml(v ?? '')}</td>`;
      }).join('')}</tr>`
    ).join('');
    const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const safeFile = String(title).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
      <style>
        body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:0;color:#0f172a;background:#f8fafc}
        .banner{background:#0F172A;color:#fff;padding:14px 24px;font-size:18px;font-weight:700;text-align:center}
        .subtitle{background:#E88A1A;color:#fff;padding:8px 24px;font-size:13px;font-weight:600;text-align:center}
        .toolbar{display:flex;gap:8px;justify-content:flex-end;padding:10px 24px;background:#fff;border-bottom:1px solid #e2e8f0;position:sticky;top:0;z-index:10}
        .toolbar button{font:600 12px 'Segoe UI',Arial,sans-serif;background:#0F172A;color:#fff;border:0;border-radius:6px;padding:8px 14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
        .toolbar button.alt{background:#E88A1A}
        .toolbar button:hover{opacity:.9}
        .meta{padding:6px 24px;font-size:11px;color:#64748b;text-align:right}
        .wrap{padding:0 24px 24px;overflow-x:auto}
        table{border-collapse:collapse;width:100%;background:#fff;font-size:12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
        th{background:#0F172A;color:#fff;padding:10px 8px;text-align:left;font-weight:600;border:1px solid #1e293b}
        td{padding:8px;border:1px solid #e2e8f0;white-space:nowrap}
        tr:nth-child(even) td{background:#f8fafc}
        @media print{.toolbar{display:none}.banner,.subtitle,.meta{background:#fff !important;color:#0f172a !important}}
      </style></head>
      <body>
        <div class="banner">Shemford Futuristic School</div>
        <div class="subtitle">${escapeHtml(title)}</div>
        <div class="toolbar">
          <button onclick="window.print()">🖨 Print</button>
          <button class="alt" id="dl-xls">⬇ Download Excel</button>
        </div>
        <script>
          document.getElementById('dl-xls').addEventListener('click', function () {
            var tbl = document.querySelector('table').outerHTML;
            var html = '<html><head><meta charset="utf-8"></head><body>' + tbl + '</body></html>';
            // Prepend a UTF-8 BOM so Excel decodes non-ASCII correctly (Excel
            // otherwise falls back to Windows-1252 when reading .xls HTML files).
            var blob = new Blob(['﻿', html], { type: 'application/vnd.ms-excel' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = '${safeFile}.xls';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 500);
          });
        </script>
        <div class="meta">Generated: ${escapeHtml(now)} &nbsp;·&nbsp; Total rows: ${rows.length}</div>
        <div class="wrap"><table>${head}${body}</table></div>
      </body></html>`;
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (_) { /* tab closed during build — ignore */ }
  }, 0);
};

const ExportBar = ({ apiPath, params, filename, rows, columns, title }) => {
  const [busy, setBusy] = useState(false);
  // PDF: open a tab IMMEDIATELY with a splash, fetch the blob, then swap the
  // tab to the blob URL. The user sees the new tab appear instantly even
  // though the backend takes a moment to render the PDF.
  const openPdf = async () => {
    const w = window.open('', '_blank');
    if (!w) { toast.error('Pop-up blocked — allow pop-ups to view the report'); return; }
    w.document.write(PREVIEW_SPLASH); w.document.close();
    setBusy(true);
    try {
      const res = await api.get(`${apiPath}/pdf`, { params, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      try { w.location.replace(url); } catch (_) { /* tab closed */ }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      try { w.document.body.innerHTML = `<div style="font-family:Arial;padding:40px;color:#dc2626;text-align:center">Failed to load PDF.</div>`; } catch (_) {}
      toast.error(err.response?.data?.detail || 'Failed to open PDF');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-1 ml-auto">
      <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" title="Open Excel preview"
        disabled={busy} onClick={() => openExcelPreview(rows || [], columns || [], title || 'Report')}>
        <FileSpreadsheet className="h-3.5 w-3.5" />
        <span className="text-xs">Excel</span>
      </Button>
      <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" title="Open PDF preview"
        disabled={busy} onClick={openPdf}>
        {busy
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <FileText className="h-3.5 w-3.5" />}
        <span className="text-xs">PDF</span>
      </Button>
    </div>
  );
};


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
    const params = {
      duration: f.duration,
      ...(f.duration === 'custom' && { start_date: f.start_date, end_date: f.end_date }),
      ...(f.class_name && { class_name: f.class_name }),
      ...(f.section && { section: f.section }),
      ...(f.fee_type && { fee_type: f.fee_type }),
      ...(f.payment_method && { payment_method: f.payment_method }),
    };
    const cacheKey = 'fees-collection:' + JSON.stringify(params);

    // SWR-style: show cached data instantly, refresh in background
    const cached = getCached(cacheKey);
    if (cached) {
      setRows(cached);
      setSearched(true);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const res = await api.get('/fees/reports/collection', { params });
      const data = Array.isArray(res.data) ? res.data : [];
      setRows(data);
      setSearched(true);
      setCached(cacheKey, data);
    } catch (err) {
      if (!cached) toast.error(err.response?.data?.detail || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  const fetchData = useCallback(() => runFetch(filters), [filters]);
  // Clear Filters → reset to defaults AND show the default (all-time) view
  const clearAndFetch = () => { setFilters(COLLECTION_DEFAULTS); runFetch(COLLECTION_DEFAULTS); };

  // Auto-load with default filters on mount — instant if cached, otherwise fetches
  useEffect(() => { runFetch(COLLECTION_DEFAULTS); /* eslint-disable-next-line */ }, []);

  // Build the param object the way the backend expects — used for both fetching
  // and for the Excel/PDF export URLs.
  const exportParams = useMemo(() => ({
    duration: filters.duration,
    ...(filters.duration === 'custom' && { start_date: filters.start_date, end_date: filters.end_date }),
    ...(filters.class_name && { class_name: filters.class_name }),
    ...(filters.section && { section: filters.section }),
    ...(filters.fee_type && { fee_type: filters.fee_type }),
    ...(filters.payment_method && { payment_method: filters.payment_method }),
  }), [filters]);

  const columns = useMemo(() => [
    { key: 'admission',       label: 'Admission No',     value: (r) => r.admission_number },
    { key: 'name',            label: 'Student Name',     value: (r) => r.student_name },
    { key: 'mobile',          label: 'Mobile Number',    value: (r) => r.mobile },
    { key: 'class',           label: 'Class (Section)',  value: (r) => r.class_section },
    { key: 'fee_types',       label: 'Fees Type',        value: (r) => fmtFeeTypeList(r.fee_types) },
    { key: 'due_date',        label: 'Due Date',         value: (r) => fmtDate(r.due_date), render: (r) => fmtDate(r.due_date) },
    { key: 'last',            label: 'Last Payment',     value: (r) => fmtDate(r.last_payment_date), render: (r) => fmtDate(r.last_payment_date) },
    { key: 'total_collected', label: 'Total Paid (Rs.)',   value: (r) => r.total_collected, render: (r) => inr(r.total_collected) },
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
            <ExportBar apiPath="/fees/reports/collection" params={exportParams} filename="fees-collection-report" rows={filtered} columns={columns} title="Fees Collection Report" />
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
                  <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">Select filters and click <span className="font-semibold">Search</span> to load the report.</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={columns.length} className="text-center py-8">
                    <div className="text-pink-500">No data available in table</div>
                    <div className="text-xs text-muted-foreground mt-2">
                      No data available.
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
    const params = {};
    if (f.class_name) params.class_name = f.class_name;
    if (f.section) params.section = f.section;
    if (f.fee_type) params.fee_type = f.fee_type;
    if (f.as_of_date) params.as_of_date = f.as_of_date;
    const cacheKey = 'fees-due:' + JSON.stringify(params);

    // SWR-style: show cached data instantly, refresh in background
    const cached = getCached(cacheKey);
    if (cached) {
      setRows(cached);
      setSearched(true);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const res = await api.get('/fees/reports/due', { params });
      const data = Array.isArray(res.data) ? res.data : [];
      setRows(data);
      setSearched(true);
      setCached(cacheKey, data);
    } catch (err) {
      if (!cached) toast.error(err.response?.data?.detail || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };
  const fetchData = useCallback(() => runFetch(filters), [filters]);
  const clearAndFetch = () => { setFilters(DUE_DEFAULTS); runFetch(DUE_DEFAULTS); };

  // Auto-load with default filters on mount
  useEffect(() => { runFetch(DUE_DEFAULTS); /* eslint-disable-next-line */ }, []);

  const exportParams = useMemo(() => {
    const p = {};
    if (filters.class_name) p.class_name = filters.class_name;
    if (filters.section) p.section = filters.section;
    if (filters.fee_type) p.fee_type = filters.fee_type;
    if (filters.as_of_date) p.as_of_date = filters.as_of_date;
    return p;
  }, [filters]);

  const columns = useMemo(() => [
    { key: 'admission', label: 'Admission No',    value: (r) => r.admission_number },
    { key: 'name',      label: 'Student Name',    value: (r) => r.student_name },
    { key: 'mobile',    label: 'Mobile Number',   value: (r) => r.mobile },
    { key: 'class',     label: 'Class (Section)', value: (r) => r.class_section },
    { key: 'fee_types', label: 'Fees Type',       value: (r) => fmtFeeTypeList(r.fee_types) },
    { key: 'oldest',    label: 'Oldest Due',      value: (r) => fmtDate(r.oldest_due), render: (r) => fmtDate(r.oldest_due) },
    { key: 'amount',    label: 'Amount (Rs.)',      value: (r) => r.amount,  render: (r) => inr(r.amount) },
    { key: 'paid',      label: 'Paid (Rs.)',        value: (r) => r.paid,    render: (r) => inr(r.paid) },
    { key: 'balance',   label: 'Balance (Rs.)',     value: (r) => r.balance, render: (r) => inr(r.balance) },
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
            <ExportBar apiPath="/fees/reports/due" params={exportParams} filename="due-fees-report" rows={filtered} columns={columns} title="Due Fees Report" />
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
                  <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">Select filters and click <span className="font-semibold">Search</span> to load the report.</TableCell></TableRow>
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
