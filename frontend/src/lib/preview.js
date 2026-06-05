// Shared "open file in preview tab" helper.
// Every PDF/Excel button in the app should use this so the user gets a preview
// window with browser print/save controls instead of an auto-download.
//
// PDF → browser's built-in PDF viewer renders inline (with Print + Save buttons).
// XLSX → browser surfaces its native save dialog (no inline preview is possible
// for spreadsheets without a heavy in-browser viewer).

import { toast } from 'sonner';

const SPLASH = `<!doctype html><html><head><meta charset="utf-8"><title>Loading…</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#f8fafc;color:#475569}
.box{text-align:center}.spin{display:inline-block;width:28px;height:28px;border:3px solid #e2e8f0;border-top-color:#E88A1A;border-radius:50%;animation:r .8s linear infinite;margin-bottom:10px}
@keyframes r{to{transform:rotate(360deg)}}</style></head>
<body><div class="box"><div class="spin"></div><div>Preparing report…</div></div></body></html>`;

const MIME = {
  pdf:   'application/pdf',
  xlsx:  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls:   'application/vnd.ms-excel',
  csv:   'text/csv',
};

/**
 * Open a file blob in a new browser tab.
 *
 * @param {() => Promise<Blob | ArrayBuffer | {data: ArrayBuffer}>} fetcher
 *        Async function that returns the blob/array buffer. Typically wraps
 *        `api.get(url, { responseType: 'blob' })`.
 * @param {object} [opts]
 * @param {string} [opts.kind='pdf']        - File kind for MIME detection.
 * @param {string} [opts.errorMessage]      - Toast text on failure.
 */
const _esc = (v) => {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

/**
 * Render an Excel-styled HTML preview in a new tab.
 * Browsers can't natively preview XLSX, so this gives the user a viewable
 * table with print + download-Excel toolbar buttons.
 *
 * @param {string} title
 * @param {{ label: string, get: (row: any) => any }[]} columns
 * @param {any[]} rows
 */
export function previewExcelHtml(title, columns, rows) {
  if (!rows || rows.length === 0) {
    toast.error('No data to preview — load the data first.');
    return;
  }
  const cols = columns || [];

  const w = window.open('', '_blank');
  if (!w) { toast.error('Pop-up blocked — allow pop-ups to view the report'); return; }
  w.document.write(SPLASH); w.document.close();

  setTimeout(() => {
    const safeFile = String(title).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const head = `<tr>${cols.map(c => `<th>${_esc(c.label)}</th>`).join('')}</tr>`;
    const body = rows.map(r =>
      `<tr>${cols.map(c => `<td>${_esc(c.get(r) ?? '')}</td>`).join('')}</tr>`
    ).join('');
    const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${_esc(title)}</title>
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
        <div class="subtitle">${_esc(title)}</div>
        <div class="toolbar">
          <button onclick="window.print()">&#128424; Print</button>
          <button class="alt" id="dl-xls">&#8595; Download Excel</button>
        </div>
        <script>
          document.getElementById('dl-xls').addEventListener('click', function () {
            var tbl = document.querySelector('table').outerHTML;
            var html = '<html><head><meta charset="utf-8"></head><body>' + tbl + '</body></html>';
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
        <div class="meta">Generated: ${_esc(now)} &nbsp;&middot;&nbsp; Total rows: ${rows.length}</div>
        <div class="wrap"><table>${head}${body}</table></div>
      </body></html>`;
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (_) { /* tab closed */ }
  }, 0);
}

/**
 * Open an HTML preview in a new tab built from one or more sections.
 * Each section has a title, columns, and rows. Includes Print + Download
 * (as .xls HTML) toolbar buttons.
 *
 * @param {string} title — top-level report title (e.g. "Financial Report")
 * @param {{ title?: string, columns: { label: string, get: (r:any) => any }[], rows: any[] }[]} sections
 */
export function previewReportInTab(title, sections) {
  const cleanSections = (sections || []).filter(s => s && (s.rows?.length > 0 || s.columns?.length > 0));
  if (!cleanSections.length) {
    toast.error('No data to preview — load the report first.');
    return;
  }

  const w = window.open('', '_blank');
  if (!w) { toast.error('Pop-up blocked — allow pop-ups to view the report'); return; }
  w.document.write(SPLASH); w.document.close();

  setTimeout(() => {
    const safeFile = String(title).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

    const sectionHtml = cleanSections.map(sec => {
      const head = `<tr>${(sec.columns || []).map(c => `<th>${_esc(c.label)}</th>`).join('')}</tr>`;
      const body = (sec.rows || []).map(r =>
        `<tr>${(sec.columns || []).map(c => `<td>${_esc(c.get(r) ?? '')}</td>`).join('')}</tr>`
      ).join('');
      const heading = sec.title ? `<h3 class="sec-title">${_esc(sec.title)}</h3>` : '';
      return `${heading}<div class="wrap"><table>${head}${body}</table></div>`;
    }).join('');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${_esc(title)}</title>
      <style>
        body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:0;color:#0f172a;background:#f8fafc}
        .banner{background:#0F172A;color:#fff;padding:14px 24px;font-size:18px;font-weight:700;text-align:center}
        .subtitle{background:#E88A1A;color:#fff;padding:8px 24px;font-size:13px;font-weight:600;text-align:center}
        .toolbar{display:flex;gap:8px;justify-content:flex-end;padding:10px 24px;background:#fff;border-bottom:1px solid #e2e8f0;position:sticky;top:0;z-index:10}
        .toolbar button{font:600 12px 'Segoe UI',Arial,sans-serif;background:#0F172A;color:#fff;border:0;border-radius:6px;padding:8px 14px;cursor:pointer}
        .toolbar button.alt{background:#E88A1A}
        .toolbar button:hover{opacity:.9}
        .meta{padding:6px 24px;font-size:11px;color:#64748b;text-align:right}
        .sec-title{margin:18px 24px 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#475569}
        .wrap{padding:0 24px 8px;overflow-x:auto}
        table{border-collapse:collapse;width:100%;background:#fff;font-size:12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
        th{background:#0F172A;color:#fff;padding:10px 8px;text-align:left;font-weight:600;border:1px solid #1e293b}
        td{padding:8px;border:1px solid #e2e8f0;white-space:nowrap}
        tr:nth-child(even) td{background:#f8fafc}
        @media print{.toolbar{display:none}.banner,.subtitle,.meta{background:#fff !important;color:#0f172a !important}}
      </style></head>
      <body>
        <div class="banner">Shemford Futuristic School</div>
        <div class="subtitle">${_esc(title)}</div>
        <div class="toolbar">
          <button onclick="window.print()">&#128424; Print</button>
          <button class="alt" id="dl-xls">&#8595; Download Excel</button>
        </div>
        <script>
          document.getElementById('dl-xls').addEventListener('click', function () {
            var tables = Array.prototype.map.call(document.querySelectorAll('table'), function (t) { return t.outerHTML; }).join('<br/>');
            var html = '<html><head><meta charset="utf-8"></head><body>' + tables + '</body></html>';
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
        <div class="meta">Generated: ${_esc(now)}</div>
        ${sectionHtml}
      </body></html>`;
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (_) { /* tab closed */ }
  }, 0);
}

/**
 * Download a PDF directly via blob→anchor without opening a popup window.
 * Bypasses popup blockers entirely — works on first click every time.
 *
 * @param {() => Promise} fetcher  - async function returning axios response with blob data
 * @param {string} filename        - suggested filename (e.g. "payslip-jan-2026.pdf")
 * @param {string} [errorMessage]  - toast text on failure
 */
export async function downloadPdf(fetcher, filename, errorMessage) {
  try {
    const result = await fetcher();
    const raw = result?.data ?? result;
    const blob = raw instanceof Blob ? raw : new Blob([raw], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'document.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    const { toast } = await import('sonner');
    toast.error(errorMessage || err?.response?.data?.detail || 'Failed to download PDF');
  }
}

export async function previewInTab(fetcher, opts = {}) {
  const kind = (opts.kind || 'pdf').toLowerCase();
  const mime = MIME[kind] || MIME.pdf;

  // Open the tab synchronously so popup blockers stay quiet.
  const w = window.open('', '_blank');
  if (!w) { toast.error('Pop-up blocked — allow pop-ups to view the report'); return; }
  w.document.write(SPLASH);
  w.document.close();

  try {
    const result = await fetcher();
    // Accept axios responses ({data}), raw Blob, or ArrayBuffer.
    const raw = result?.data ?? result;
    const blob = raw instanceof Blob ? raw : new Blob([raw], { type: mime });
    const url = URL.createObjectURL(blob);
    try { w.location.replace(url); } catch (_) { /* tab closed */ }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    try {
      w.document.body.innerHTML = `<div style="font-family:Arial;padding:40px;color:#dc2626;text-align:center">${
        opts.errorMessage || 'Failed to load the report.'
      }</div>`;
    } catch (_) { /* tab closed */ }
    toast.error(opts.errorMessage || err?.response?.data?.detail || 'Failed to load the report');
  }
}
