import React, { useState, useEffect, useMemo } from 'react';
import api from '../../lib/api';
import { getCached, setCached } from '../../lib/pageCache';
import { previewInTab, previewReportInTab } from '../../lib/preview';
import { fmtPaymentMethod } from '../../lib/paymentMethods';
import { toast } from 'sonner';
import {
  BarChart3, Download, FileText, Loader2, Clock, Calendar, CreditCard,
  GraduationCap,
} from 'lucide-react';

// ─── Shared ───────────────────────────────────────────────────────────────

const formLabel = {
  display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase',
  letterSpacing:'0.06em', color:'#666', marginBottom:6,
};

const TabBar = ({ tabs, active, onChange }) => (
  <div style={{display:'flex',gap:6,padding:4,background:'#F0F0F0',borderRadius:12,marginBottom:12,overflowX:'auto'}}>
    {tabs.map(t => (
      <button key={t.key} onClick={() => onChange(t.key)}
        style={{
          flex:1,minWidth:'fit-content',padding:'8px 12px',borderRadius:8,border:'none',
          background: active === t.key ? '#FFF' : 'transparent',
          color: active === t.key ? '#1A1A1A' : '#888',
          fontSize:12,fontWeight:700,cursor:'pointer',
          boxShadow: active === t.key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
          whiteSpace:'nowrap',
        }}
        data-testid={`m-reports-tab-${t.key}`}
      >
        {t.label}
      </button>
    ))}
  </div>
);

const today = () => new Date().toISOString().slice(0, 10);
const dateMonthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};

const inr = (n) => (n == null || isNaN(n) ? '—' : `Rs.${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const inrXls = (n) => (n == null || isNaN(n) ? '—' : `Rs. ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

const downloadReport = async (endpoint, params, kind = 'pdf') => {
  await previewInTab(
    () => api.get(endpoint, { params: { ...params, format: kind }, responseType: 'blob' }),
    { kind, errorMessage: 'Failed to load report' },
  );
};

const StatTile = ({ label, value, accent, dark }) => (
  <div style={{
    background: dark ? '#1A1A1A' : '#FFF',
    border: dark ? 'none' : '1px solid rgba(0,0,0,0.04)',
    padding:14,borderRadius:14,boxShadow:'0 1px 3px rgba(0,0,0,0.04)',
    ...(accent ? { borderLeft: `4px solid ${accent}` } : {}),
  }}>
    <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color: dark ? 'rgba(255,255,255,0.6)' : '#888'}}>{label}</p>
    <p style={{fontSize:18,fontWeight:800,marginTop:4,color: dark ? '#FFF' : '#1A1A1A'}}>{value}</p>
  </div>
);

const QuickFilter = ({ start, end, onChange, onClear }) => (
  <div className="m-chips" style={{marginBottom:10}}>
    <span style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:'#666',fontWeight:700,whiteSpace:'nowrap',paddingRight:4}}>
      <Clock size={12} /> Quick filter:
    </span>
    {[
      { label: 'Last 1M', months: 1 },
      { label: 'Last 3M', months: 3 },
      { label: 'Last 6M', months: 6 },
    ].map(f => (
      <button key={f.label}
        className="m-chip"
        onClick={() => onChange(dateMonthsAgo(f.months), today())}
        data-testid={`m-reports-qf-${f.months}m`}>
        {f.label}
      </button>
    ))}
    {(start || end) && (
      <button className="m-chip"
        style={{color:'#dc2626',borderColor:'#fecaca',background:'#fee2e2'}}
        onClick={onClear}>
        Clear
      </button>
    )}
  </div>
);

// ─── Main ─────────────────────────────────────────────────────────────────

const MobileReports = () => {
  const [tab, setTab] = useState('financial');
  const [classes, setClasses] = useState(getCached('classes') || []);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/classes');
        const arr = Array.isArray(r.data) ? r.data : [];
        setClasses(arr);
        setCached('classes', arr);
      } catch {}
    })();
  }, []);

  return (
    <div data-testid="m-reports" style={{minWidth:0}}>
      <div className="m-header">
        <div style={{flex:1,minWidth:0}}>
          <h1>Reports</h1>
          <p className="m-header-sub">Financial · Academic · Attendance</p>
        </div>
      </div>

      <TabBar
        tabs={[
          { key: 'financial', label: 'Financial' },
          { key: 'academic', label: 'Academic' },
          { key: 'attendance', label: 'Attendance' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'financial' && <FinancialTab />}
      {tab === 'academic' && <AcademicTab classes={classes} />}
      {tab === 'attendance' && <AttendanceTab classes={classes} />}
    </div>
  );
};

export default MobileReports;

// ─── Financial Tab ────────────────────────────────────────────────────────

const FinancialTab = () => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const params = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const r = await api.get('/reports/financial', { params });
      setReport(r.data);
      if (r.data?.transaction_count === 0) toast.info('No transactions for the selected period');
    } catch (e) { if (!e?._handled) toast.error('Failed to fetch financial report'); }
    finally { setLoading(false); }
  };

  const exportPDF = () => downloadReport('/reports/financial/export', {
    ...(startDate && { start_date: startDate }),
    ...(endDate && { end_date: endDate }),
  }, 'pdf');

  const exportExcel = () => {
    if (!report) { toast.error('Generate the report first'); return; }
    const summaryRows = [
      { k: 'Total Collection', v: inrXls(report.total_collection) },
      { k: 'Total Pending',    v: inrXls(report.total_pending) },
      { k: 'Transactions',     v: report.transaction_count ?? 0 },
      { k: 'Collection Rate',  v: (report.total_collection + report.total_pending > 0)
            ? `${((report.total_collection / (report.total_collection + report.total_pending)) * 100).toFixed(1)}%`
            : '—' },
    ];
    const pmRows = Object.entries(report.by_payment_method || {}).map(([k, v]) => ({ k: fmtPaymentMethod(k), v: inrXls(v) }));
    const mRows  = Object.entries(report.by_month || {}).map(([k, v]) => ({ k, v: inrXls(v) }));
    previewReportInTab('Financial Report', [
      { title: 'Summary',          columns: [{ label: 'Metric', get: r => r.k }, { label: 'Value', get: r => r.v }], rows: summaryRows },
      { title: 'By Payment Method',columns: [{ label: 'Method', get: r => r.k }, { label: 'Amount', get: r => r.v }], rows: pmRows },
      { title: 'Monthly Trend',    columns: [{ label: 'Month',  get: r => r.k }, { label: 'Amount', get: r => r.v }], rows: mRows },
    ]);
  };

  const pmEntries = useMemo(() => Object.entries(report?.by_payment_method || {}), [report]);
  const monthEntries = useMemo(() => Object.entries(report?.by_month || {}), [report]);
  const collectionRate = useMemo(() => {
    if (!report) return 0;
    const sum = (report.total_collection || 0) + (report.total_pending || 0);
    return sum > 0 ? Math.round(((report.total_collection || 0) / sum) * 100) : 0;
  }, [report]);

  return (
    <>
      <QuickFilter
        start={startDate}
        end={endDate}
        onChange={(s, e) => { setStartDate(s); setEndDate(e); }}
        onClear={() => { setStartDate(''); setEndDate(''); }}
      />

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
        <div>
          <label style={formLabel}>Start Date</label>
          <input type="date" lang="en-IN" className="m-input" value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
            style={{cursor:'pointer'}} />
        </div>
        <div>
          <label style={formLabel}>End Date</label>
          <input type="date" lang="en-IN" className="m-input" value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
            style={{cursor:'pointer'}} />
        </div>
      </div>

      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
        <button onClick={generate} disabled={loading} className="m-btn m-btn-primary m-btn-sm" style={{flex:1,minWidth:140}}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />} Generate
        </button>
        {report && (
          <>
            <button onClick={exportPDF} className="m-btn m-btn-outline m-btn-sm" style={{flex:1,minWidth:80}}>
              <Download size={14} /> PDF
            </button>
            <button onClick={exportExcel} className="m-btn m-btn-outline m-btn-sm" style={{flex:1,minWidth:80}}>
              <FileText size={14} /> Excel
            </button>
          </>
        )}
      </div>

      {report && report.transaction_count === 0 && (
        <div className="m-empty"><CreditCard className="m-empty-icon" /><p>No transactions for this period</p></div>
      )}

      {report && report.transaction_count > 0 && (
        <>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
            <StatTile label="Collection" value={inr(report.total_collection)} dark />
            <StatTile label="Pending" value={inr(report.total_pending)} accent="#E88A1A" />
            <StatTile label="Transactions" value={report.transaction_count} />
            <StatTile label="Collection Rate" value={`${collectionRate}%`} />
          </div>

          {pmEntries.length > 0 && (
            <>
              <p className="m-section">By Payment Method</p>
              <div className="m-list" style={{marginBottom:12}}>
                {pmEntries.map(([k, v]) => (
                  <div key={k} className="m-list-item">
                    <span style={{fontSize:13,fontWeight:600,color:'#1A1A1A'}}>{fmtPaymentMethod(k)}</span>
                    <span style={{fontSize:13,fontWeight:800,color:'#1A1A1A'}}>{inr(v)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {monthEntries.length > 0 && (
            <>
              <p className="m-section">Monthly Trend</p>
              <div className="m-list">
                {monthEntries.map(([k, v]) => (
                  <div key={k} className="m-list-item">
                    <span style={{fontSize:13,fontWeight:600,color:'#1A1A1A'}}>{k}</span>
                    <span style={{fontSize:13,fontWeight:800,color:'#1A1A1A'}}>{inr(v)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
};

// ─── Academic Tab ─────────────────────────────────────────────────────────

const AcademicTab = ({ classes }) => {
  const [selClass, setSelClass] = useState('');
  const [selSection, setSelSection] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const sections = useMemo(() => {
    if (!selClass) return [];
    return classes.find(c => c.name === selClass)?.sections || [];
  }, [classes, selClass]);

  const generate = async () => {
    if (!selClass) { toast.error('Select a class'); return; }
    setLoading(true);
    try {
      const params = { class_name: selClass };
      if (selSection) params.section = selSection;
      const r = await api.get('/reports/academic', { params });
      setReport(r.data);
    } catch (e) { if (!e?._handled) toast.error('Failed to fetch academic report'); }
    finally { setLoading(false); }
  };

  const exportPDF = () => downloadReport('/reports/academic/export', {
    class_name: selClass,
    ...(selSection && { section: selSection }),
  }, 'pdf');

  const exportExcel = () => {
    if (!report) { toast.error('Generate the report first'); return; }
    const studentRows = Object.entries(report.student_results || {}).map(([studentId, data]) => ({
      studentId, total: data.total_obtained, max: data.total_max, pct: data.percentage, grade: data.grade,
    }));
    previewReportInTab(`Academic Report — ${report.class_name || selClass}`, [
      { title: 'Students',
        columns: [
          { label: 'Student ID', get: r => r.studentId },
          { label: 'Total',      get: r => r.total },
          { label: 'Max',        get: r => r.max },
          { label: '%',          get: r => `${r.pct}%` },
          { label: 'Grade',      get: r => r.grade || '—' },
        ],
        rows: studentRows,
      },
    ]);
  };

  return (
    <>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
        <div>
          <label style={formLabel}>Class</label>
          <select className="m-input" value={selClass}
            onChange={(e) => { setSelClass(e.target.value); setSelSection(''); }}>
            <option value="">Select</option>
            {classes.map(c => <option key={c.name} value={c.name}>{c.display_name || (c.name.startsWith('Class ') ? c.name : `Class ${c.name}`)}</option>)}
          </select>
        </div>
        <div>
          <label style={formLabel}>Section</label>
          <select className="m-input" value={selSection} onChange={(e) => setSelSection(e.target.value)} disabled={!selClass}>
            <option value="">All Sections</option>
            {sections.map(s => {
              const name = typeof s === 'string' ? s : s.section_name;
              return <option key={name} value={name}>{name}</option>;
            })}
          </select>
        </div>
      </div>

      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
        <button onClick={generate} disabled={loading} className="m-btn m-btn-primary m-btn-sm" style={{flex:1,minWidth:140}}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />} Generate
        </button>
        {report && (
          <>
            <button onClick={exportPDF} className="m-btn m-btn-outline m-btn-sm" style={{flex:1,minWidth:80}}>
              <Download size={14} /> PDF
            </button>
            <button onClick={exportExcel} className="m-btn m-btn-outline m-btn-sm" style={{flex:1,minWidth:80}}>
              <FileText size={14} /> Excel
            </button>
          </>
        )}
      </div>

      {!report ? (
        <div className="m-empty"><GraduationCap className="m-empty-icon" /><p>Pick a class and generate</p></div>
      ) : (
        <>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
            <StatTile label="Students" value={report.student_count || 0} />
            <StatTile label="Avg" value={`${report.class_average || 0}%`} dark />
            <StatTile label="Year" value={report.academic_year || '—'} />
          </div>

          {Object.keys(report.student_results || {}).length > 0 && (
            <>
              <p className="m-section">Student Performance</p>
              <div className="m-list">
                {Object.entries(report.student_results).map(([studentId, data]) => (
                  <div key={studentId} className="m-list-item" style={{gap:8}}>
                    <div style={{minWidth:0,flex:1}}>
                      <p style={{fontSize:12,fontWeight:700,color:'#1A1A1A',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{studentId}</p>
                      <p style={{fontSize:10,color:'#888'}}>{data.total_obtained}/{data.total_max}</p>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                      <span style={{fontSize:13,fontWeight:800,color:'#1A1A1A'}}>{data.percentage}%</span>
                      {data.grade && (
                        <span style={{padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,background:'#F1F5F9',color:'#1A1A1A'}}>{data.grade}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
};

// ─── Attendance Tab ───────────────────────────────────────────────────────

const AttendanceTab = ({ classes }) => {
  const [attClass, setAttClass] = useState('');
  const [attDate, setAttDate] = useState('');
  const [attStart, setAttStart] = useState('');
  const [attEnd, setAttEnd] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const params = {};
      if (attClass) params.class_name = attClass;
      if (attDate) params.date = attDate;
      else {
        if (attStart) params.start_date = attStart;
        if (attEnd) params.end_date = attEnd;
      }
      const r = await api.get('/reports/attendance', { params });
      setReport(r.data);
      if (!r.data?.total_records) toast.info('No attendance records for the selected filter');
    } catch (e) { if (!e?._handled) toast.error('Failed to fetch attendance report'); }
    finally { setLoading(false); }
  };

  const exportPDF = () => downloadReport('/reports/attendance/export', {
    ...(attClass && { class_name: attClass }),
    ...(attDate && { date: attDate }),
    ...(attStart && { start_date: attStart }),
    ...(attEnd && { end_date: attEnd }),
  }, 'pdf');

  const exportExcel = () => {
    if (!report) { toast.error('Generate the report first'); return; }
    const rows = report.records || [];
    previewReportInTab('Attendance Report', [
      { title: report.summary ? `Summary — ${report.summary.present_count ?? 0} present / ${report.summary.total ?? rows.length} total` : null,
        columns: [
          { label: 'Date',    get: r => r.date },
          { label: 'Class',   get: r => r.class_name + (r.section ? ` ${r.section}` : '') },
          { label: 'Student', get: r => r.student_name || r.entity_id },
          { label: 'Roll',    get: r => r.roll_number },
          { label: 'Status',  get: r => r.status },
        ],
        rows,
      },
    ]);
  };

  return (
    <>
      <QuickFilter
        start={attStart}
        end={attEnd}
        onChange={(s, e) => { setAttStart(s); setAttEnd(e); setAttDate(''); }}
        onClear={() => { setAttStart(''); setAttEnd(''); setAttDate(''); }}
      />

      <div style={{marginBottom:10}}>
        <label style={formLabel}>Class</label>
        <select className="m-input" value={attClass} onChange={(e) => setAttClass(e.target.value)}>
          <option value="">All Classes</option>
          {classes.map(c => <option key={c.name} value={c.name}>{c.display_name || (c.name.startsWith('Class ') ? c.name : `Class ${c.name}`)}</option>)}
        </select>
      </div>

      <div style={{marginBottom:10}}>
        <label style={formLabel}>Single Date (or use range below)</label>
        <input type="date" className="m-input" value={attDate}
          onChange={(e) => { setAttDate(e.target.value); if (e.target.value) { setAttStart(''); setAttEnd(''); } }}
          onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
          style={{cursor:'pointer'}} />
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
        <div>
          <label style={formLabel}>Start Date</label>
          <input type="date" lang="en-IN" className="m-input" value={attStart}
            onChange={(e) => { setAttStart(e.target.value); setAttDate(''); }}
            onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
            style={{cursor:'pointer'}} />
        </div>
        <div>
          <label style={formLabel}>End Date</label>
          <input type="date" lang="en-IN" className="m-input" value={attEnd}
            onChange={(e) => { setAttEnd(e.target.value); setAttDate(''); }}
            onClick={(e) => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }}
            style={{cursor:'pointer'}} />
        </div>
      </div>

      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
        <button onClick={generate} disabled={loading} className="m-btn m-btn-primary m-btn-sm" style={{flex:1,minWidth:140}}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />} Generate
        </button>
        {report && (
          <>
            <button onClick={exportPDF} className="m-btn m-btn-outline m-btn-sm" style={{flex:1,minWidth:80}}>
              <Download size={14} /> PDF
            </button>
            <button onClick={exportExcel} className="m-btn m-btn-outline m-btn-sm" style={{flex:1,minWidth:80}}>
              <FileText size={14} /> Excel
            </button>
          </>
        )}
      </div>

      {report && report.total_records === 0 && (
        <div className="m-empty"><Calendar className="m-empty-icon" /><p>No attendance records for this filter</p></div>
      )}

      {report && report.total_records > 0 && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <StatTile label="Total" value={report.total_records || 0} />
          <StatTile label="Present" value={report.present || 0} dark />
          <StatTile label="Absent" value={report.absent || 0} accent="#E88A1A" />
          <StatTile label="Attendance %" value={`${report.percentage || 0}%`} />
        </div>
      )}
    </>
  );
};
