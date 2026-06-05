import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSession } from '../../contexts/SessionContext';
import api from '../../lib/api';
import { previewInTab, previewExcelHtml, downloadPdf } from '../../lib/preview';
import { clampISODate } from '../../lib/dateBounds';
import { toast } from 'sonner';
import {
  Download, FileText, Plus, RefreshCw, CheckCircle, CreditCard,
  Loader2, ChevronLeft, ChevronRight, Wallet, X, Users, TrendingUp, IndianRupee, Calendar,
} from 'lucide-react';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const STATUS = {
  draft:    { bg: '#fef9c3', color: '#854d0e', label: 'draft' },
  approved: { bg: '#dbeafe', color: '#1e40af', label: 'approved' },
  paid:     { bg: '#dcfce7', color: '#15803d', label: 'paid' },
};

// "Rs." prefix (not Rs.) — keeps parity with PDF payslips / Excel exports.
const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PAGE_SIZE = 20;
const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

const formLabel = {
  display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase',
  letterSpacing:'0.06em', color:'#666', marginBottom:6,
};

const Sheet = ({ title, onClose, children }) => {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:240,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
      <div onClick={(e) => e.stopPropagation()}
        style={{background:'#FFF',width:'100%',maxWidth:520,borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:'94dvh',display:'flex',flexDirection:'column',paddingBottom:'env(safe-area-inset-bottom, 0)'}}>
        <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
          <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0'}}>
          <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888'}}><X size={20} /></button>
        </div>
        <div style={{padding:16,overflowY:'auto',flex:1}}>{children}</div>
      </div>
    </div>
  );
};

const StatusBadge = ({ status }) => {
  const s = STATUS[status] || { bg: '#f1f5f9', color: '#475569', label: status };
  return <span style={{padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,background:s.bg,color:s.color,textTransform:'capitalize'}}>{s.label}</span>;
};

const StatCard = ({ label, value, Icon, color, bg }) => (
  <div style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:12,display:'flex',alignItems:'center',gap:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
    <div style={{width:36,height:36,borderRadius:10,background:bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
      <Icon size={18} color={color} strokeWidth={1.5} />
    </div>
    <div style={{minWidth:0}}>
      <p style={{fontSize:10,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label}</p>
      <p style={{fontSize:13,fontWeight:800,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{value}</p>
    </div>
  </div>
);

// ─── Admin / Teacher view ───────────────────────────────────────────────────

const AdminPayrollView = ({ canManage }) => {
  const { sessionBounds, sessionToday } = useSession();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const [page, setPage] = useState(1);

  const [showGen, setShowGen] = useState(false);
  const [genLWP, setGenLWP] = useState('0');
  const [generating, setGenerating] = useState(false);

  const [payRecord, setPayRecord] = useState(null);
  const [payDate, setPayDate] = useState('');
  const [payRef, setPayRef] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [editRecord, setEditRecord] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  const monthYear = `${year}-${String(month).padStart(2, '0')}`;

  useEffect(() => {
    if (!sessionToday) return;
    const [y, m] = sessionToday.split('-').map(Number);
    if (y && m) { setYear(y); setMonth(m); }
  }, [sessionToday]);

  const startYM = sessionBounds.start ? sessionBounds.start.slice(0, 7) : '';
  const endYM = sessionBounds.end ? sessionBounds.end.slice(0, 7) : '';
  const atStart = !!startYM && monthYear <= startYM;
  const atEnd = !!endYM && monthYear >= endYM;
  const goPrev = () => { if (atStart) return; if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const goNext = () => { if (atEnd) return; if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  // Load ALL records for the month (so stats are accurate) and paginate the
  // list client-side below. The backend caps `limit` at 200, so page through
  // server-side and accumulate.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const limit = 200;
      let pg = 1, pages = 1, all = [];
      do {
        const res = await api.get('/payroll', { params: { month_year: monthYear, page: pg, limit } });
        const arr = Array.isArray(res.data) ? res.data : (res.data.records || []);
        all = all.concat(arr);
        pages = parseInt(res.headers?.['x-total-pages'] ?? 1, 10) || 1;
        pg += 1;
      } while (pg <= pages && pg <= 25); // safety cap (5000 records)
      setRecords(all);
    } catch { setRecords([]); }
    finally { setLoading(false); }
  }, [monthYear]);

  useEffect(() => { setPage(1); load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await api.post('/payroll/generate', { month, year, lwp_days: parseFloat(genLWP) || 0 });
      const d = res.data;
      toast.success(`Generated: ${d.generated?.length || 0} | Skipped: ${d.skipped?.length || 0} | Failed: ${d.failed?.length || 0}`);
      setShowGen(false);
      load();
    } catch (e) { if (!e._handled) toast.error(e.response?.data?.detail || 'Generation failed'); }
    finally { setGenerating(false); }
  };

  const approve = async (rec) => {
    const missing = [];
    if (!rec.bank_account_number) missing.push('Bank Account Number');
    if (!rec.bank_ifsc) missing.push('IFSC Code');
    if (missing.length) {
      toast.error(`Cannot approve: missing ${missing.join(', ')}. Update employee bank details and regenerate.`);
      return;
    }
    setActionLoading(rec.payroll_id + '_approve');
    try {
      await api.post(`/payroll/${rec.payroll_id}/approve`);
      toast.success('Payroll approved');
      load();
    } catch (e) { if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to approve'); }
    finally { setActionLoading(''); }
  };

  const openPay = (rec) => {
    setPayRecord(rec);
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayRef('');
  };

  const markPaid = async () => {
    if (!payRecord) return;
    setActionLoading(payRecord.payroll_id + '_pay');
    try {
      await api.post(`/payroll/${payRecord.payroll_id}/mark-paid`, { payment_date: payDate, payment_reference: payRef });
      toast.success('Marked as paid');
      setPayRecord(null);
      load();
    } catch (e) { if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to mark paid'); }
    finally { setActionLoading(''); }
  };

  const openEdit = (rec) => {
    setEditRecord(rec);
    setEditForm({
      lwp_days: String(rec.lwp_days ?? 0),
      pf_deduction: String(rec.pf_deduction ?? 0),
      esi_deduction: String(rec.esi_deduction ?? 0),
      tds_deduction: String(rec.tds_deduction ?? 0),
      other_deductions: String(rec.other_deductions ?? 0),
      deduction_remarks: rec.deduction_remarks ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editRecord) return;
    setSavingEdit(true);
    try {
      await api.put(`/payroll/${editRecord.payroll_id}`, {
        lwp_days: parseFloat(editForm.lwp_days) || 0,
        pf_deduction: parseFloat(editForm.pf_deduction) || 0,
        esi_deduction: parseFloat(editForm.esi_deduction) || 0,
        tds_deduction: parseFloat(editForm.tds_deduction) || 0,
        other_deductions: parseFloat(editForm.other_deductions) || 0,
        deduction_remarks: editForm.deduction_remarks || undefined,
      });
      toast.success('Deductions updated');
      setEditRecord(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to update'); }
    finally { setSavingEdit(false); }
  };

  const downloadPayslip = (id, empName) => downloadPdf(
    () => api.get(`/payroll/${id}/payslip`, { responseType: 'blob' }),
    `payslip-${empName || id}.pdf`,
    'Failed to download payslip',
  );

  const exportExcel = () => previewExcelHtml(
    `Payroll ${MONTHS[month - 1]} ${year}`,
    [
      { label: 'Employee ID', get: r => r.employee_id },
      { label: 'Employee', get: r => r.employee_name || r.employee_id },
      { label: 'Designation', get: r => r.designation || '' },
      { label: 'Gross (Rs.)', get: r => fmt(r.gross_salary) },
      { label: 'Deductions (Rs.)', get: r => fmt(r.total_deductions) },
      { label: 'Net Salary (Rs.)', get: r => fmt(r.net_salary) },
      { label: 'LWP Days', get: r => r.lwp_days ?? 0 },
      { label: 'Status', get: r => r.status },
    ],
    records,
  );

  const exportPDF = () => previewInTab(
    () => api.get('/payroll/export/pdf', { params: { month_year: monthYear }, responseType: 'blob' }),
    { kind: 'pdf', errorMessage: 'Failed to load PDF export' },
  );

  const totalNet = records.reduce((s, r) => s + (r.net_salary || 0), 0);
  const totalGross = records.reduce((s, r) => s + (r.gross_salary || 0), 0);
  const paidCount = records.filter(r => r.status === 'paid').length;
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const pageRows = records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      {/* Month navigator + actions */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:12,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={goPrev} disabled={atStart} style={{width:32,height:32,borderRadius:8,border:'1px solid #E5E5E5',background:'#FFF',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',opacity:atStart?0.4:1}}><ChevronLeft size={16} /></button>
          <span style={{fontWeight:700,fontSize:14,color:'#1A1A1A',minWidth:120,textAlign:'center'}}>{MONTHS[month - 1]} {year}</span>
          <button onClick={goNext} disabled={atEnd} style={{width:32,height:32,borderRadius:8,border:'1px solid #E5E5E5',background:'#FFF',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',opacity:atEnd?0.4:1}}><ChevronRight size={16} /></button>
        </div>
        <button onClick={load} className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}}><RefreshCw size={14} /> Refresh</button>
      </div>

      {canManage && (
        <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
          <button onClick={() => setShowGen(true)} className="m-btn m-btn-primary m-btn-sm" style={{width:'auto'}}><Plus size={14} /> Generate</button>
          <button onClick={exportExcel} disabled={!records.length} className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}}><Download size={14} /> Excel</button>
          <button onClick={exportPDF} disabled={!records.length} className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}}><FileText size={14} /> PDF</button>
        </div>
      )}

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
        <StatCard label="Employees" value={records.length} Icon={Users} color="#2563eb" bg="#eff6ff" />
        <StatCard label="Gross Payroll" value={fmt(totalGross)} Icon={TrendingUp} color="#7c3aed" bg="#faf5ff" />
        <StatCard label="Net Payroll" value={fmt(totalNet)} Icon={IndianRupee} color="#16a34a" bg="#f0fdf4" />
        <StatCard label="Paid" value={`${paidCount} / ${records.length}`} Icon={CheckCircle} color="#ea580c" bg="#fff7ed" />
      </div>

      {/* List */}
      {loading ? (
        [1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:96,borderRadius:14,marginBottom:8}} />)
      ) : records.length === 0 ? (
        <div className="m-empty">
          <IndianRupee className="m-empty-icon" />
          <p>No payroll for {MONTHS[month - 1]} {year}</p>
          {canManage && <button onClick={() => setShowGen(true)} className="m-btn m-btn-primary" style={{marginTop:12,width:'auto'}}>Generate Now</button>}
        </div>
      ) : (
        <>
          {pageRows.map(r => (
            <div key={r.payroll_id} style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:12,marginBottom:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
                <div style={{minWidth:0,flex:1}}>
                  <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.employee_name || r.employee_id}</p>
                  <p style={{fontSize:10,color:'#888'}}>{r.employee_id}{r.designation ? ` · ${r.designation}` : ''}</p>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:8}}>
                <div>
                  <p style={{fontSize:10,color:'#888'}}>Net Salary</p>
                  <p style={{fontSize:15,fontWeight:800,color:'#15803d'}}>{fmt(r.net_salary)}</p>
                  <p style={{fontSize:10,color:'#aaa'}}>Gross {fmt(r.gross_salary)} · LWP {r.lwp_days ?? 0}d</p>
                </div>
                <div style={{display:'flex',gap:6,flexShrink:0}}>
                  <button onClick={() => downloadPayslip(r.payroll_id, r.employee_name || r.employee_id)} title="Payslip"
                    style={{display:'flex',alignItems:'center',gap:4,padding:'8px 10px',borderRadius:8,background:'#FFF',border:'1px solid #E5E5E5',fontSize:11,fontWeight:700,color:'#1A1A1A',cursor:'pointer'}}>
                    <Download size={14} />
                  </button>
                  {canManage && r.status === 'draft' && (
                    <>
                      <button onClick={() => openEdit(r)} title="Edit deductions"
                        style={{display:'flex',alignItems:'center',gap:4,padding:'8px 10px',borderRadius:8,background:'#FFF',border:'1px solid #E5E5E5',fontSize:11,fontWeight:700,color:'#1A1A1A',cursor:'pointer'}}>
                        <FileText size={14} />
                      </button>
                      <button onClick={() => approve(r)} disabled={actionLoading === r.payroll_id + '_approve'}
                        style={{display:'flex',alignItems:'center',gap:4,padding:'8px 10px',borderRadius:8,background:'#dbeafe',border:'1px solid #bfdbfe',fontSize:11,fontWeight:700,color:'#1e40af',cursor:'pointer'}}>
                        {actionLoading === r.payroll_id + '_approve' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Approve
                      </button>
                    </>
                  )}
                  {canManage && r.status === 'approved' && (
                    <button onClick={() => openPay(r)}
                      style={{display:'flex',alignItems:'center',gap:4,padding:'8px 10px',borderRadius:8,background:'#dcfce7',border:'1px solid #bbf7d0',fontSize:11,fontWeight:700,color:'#15803d',cursor:'pointer'}}>
                      <CreditCard size={14} /> Pay
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {totalPages > 1 && (
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:8,marginBottom:8}}>
              <span style={{fontSize:11,color:'#888'}}>Page {page} of {totalPages} · {records.length} total</span>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <button className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}} disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
                <button className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}} disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
              </div>
            </div>
          )}
        </>
      )}

      {showGen && (
        <Sheet title={`Generate — ${MONTHS[month - 1]} ${year}`} onClose={() => !generating && setShowGen(false)}>
          <p style={{fontSize:13,color:'#666',marginBottom:12}}>Generates salary records for all active employees. Existing records are skipped.</p>
          <label style={formLabel}>Default LWP Days</label>
          <input className="m-input" type="number" min="0" max="31" value={genLWP} onChange={(e) => setGenLWP(e.target.value)} />
          <p style={{fontSize:11,color:'#888',marginTop:6}}>Leave Without Pay days applied to all employees; override individually after generation.</p>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button onClick={() => setShowGen(false)} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
            <button onClick={generate} disabled={generating} className="m-btn m-btn-primary" style={{flex:1}}>
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Generate
            </button>
          </div>
        </Sheet>
      )}

      {payRecord && (
        <Sheet title={`Mark as Paid`} onClose={() => !actionLoading && setPayRecord(null)}>
          <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:12,padding:12,marginBottom:12}}>
            <p style={{fontSize:12,color:'#666'}}>{payRecord.employee_name || payRecord.employee_id} · Net</p>
            <p style={{fontSize:20,fontWeight:800,color:'#15803d'}}>{fmt(payRecord.net_salary)}</p>
          </div>
          <div style={{marginBottom:10}}>
            <label style={formLabel}>Payment Date</label>
            <input className="m-input" type="date" lang="en-IN" min={sessionBounds.start || undefined} max={sessionToday || undefined}
              value={payDate} onChange={(e) => setPayDate(clampISODate(e.target.value, { min: sessionBounds.start, max: sessionToday }))} />
          </div>
          <div style={{marginBottom:12}}>
            <label style={formLabel}>Payment Reference / UTR (optional)</label>
            <input className="m-input" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="e.g. NEFT UTR number" />
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={() => setPayRecord(null)} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
            <button onClick={markPaid} disabled={!payDate || !!actionLoading} className="m-btn" style={{flex:1,background:'#16a34a',color:'#FFF'}}>
              {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />} Confirm
            </button>
          </div>
        </Sheet>
      )}

      {editRecord && (
        <Sheet title={`Edit Deductions — ${editRecord.employee_name}`} onClose={() => !savingEdit && setEditRecord(null)}>
          <p style={{fontSize:11,color:'#888',marginBottom:10}}>Gross: {fmt(editRecord.gross_salary)}</p>
          {[
            { key: 'lwp_days', label: 'LWP Days', hint: 'Leave Without Pay days' },
            { key: 'pf_deduction', label: 'PF (Rs.)', hint: 'Auto: 12% of salary ≤ Rs.15,000' },
            { key: 'esi_deduction', label: 'ESI (Rs.)', hint: 'Auto: 0.75% if gross ≤ Rs.21,000' },
            { key: 'tds_deduction', label: 'TDS (Rs.)', hint: 'Enter manually per month' },
            { key: 'other_deductions', label: 'Other Deductions (Rs.)', hint: '' },
          ].map(({ key, label, hint }) => (
            <div key={key} style={{marginBottom:10}}>
              <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#666',marginBottom:2}}>{label}</label>
              {hint && <p style={{fontSize:10,color:'#aaa',marginBottom:4}}>{hint}</p>}
              <input className="m-input" type="number" min={0} step="0.01"
                value={editForm[key] ?? ''} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
          <div style={{marginBottom:14}}>
            <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#666',marginBottom:4}}>Remarks (optional)</label>
            <input className="m-input" value={editForm.deduction_remarks ?? ''} onChange={e => setEditForm(f => ({ ...f, deduction_remarks: e.target.value }))} />
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={() => setEditRecord(null)} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
            <button onClick={saveEdit} disabled={savingEdit} className="m-btn" style={{flex:1,background:'#1A1A1A',color:'#FFF'}}>
              {savingEdit ? <Loader2 size={14} className="animate-spin" /> : null} Save
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
};

// ─── Employee / Teacher self view ────────────────────────────────────────────

const EmployeePayrollView = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(currentYear);
  const [empId, setEmpId] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const empRes = await api.get('/employees/me');
        const emp = empRes.data;
        if (emp?.employee_id) {
          if (active) setEmpId(emp.employee_id);
          const prRes = await api.get(`/payroll/employee/${emp.employee_id}`, { params: { year } });
          if (active) setRecords(prRes.data || []);
        }
      } catch (e) {
        if (active) setRecords([]);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [year]);

  const downloadPayslip = (id, month) => downloadPdf(
    () => api.get(`/payroll/${id}/payslip`, { responseType: 'blob' }),
    `payslip-${MONTHS[month - 1] || id}.pdf`,
    'Failed to download payslip',
  );
  const downloadYearly = () => empId && previewInTab(
    () => api.get(`/payroll/employee/${empId}/yearly-statement/${year}`, { responseType: 'blob' }),
    { kind: 'pdf', errorMessage: 'No yearly statement available yet' },
  );
  const downloadForm16 = () => {
    if (!empId) return;
    const fyYear = currentMonth >= 4 ? currentYear : currentYear - 1;
    return previewInTab(
      () => api.get(`/payroll/employee/${empId}/form16/${fyYear}`, { responseType: 'blob' }),
      { kind: 'pdf', errorMessage: 'Form 16 not available — ensure all months are paid for the financial year' },
    );
  };

  const totalNet = records.reduce((s, r) => s + (r.net_salary || 0), 0);

  if (loading) return [1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:80,borderRadius:14,marginBottom:8}} />);
  if (!empId) return (
    <div className="m-empty">
      <IndianRupee className="m-empty-icon" />
      <p>No employee record linked to your account.</p>
    </div>
  );

  return (
    <>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:12}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={() => setYear(y => y - 1)} style={{width:32,height:32,borderRadius:8,border:'1px solid #E5E5E5',background:'#FFF',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}><ChevronLeft size={16} /></button>
          <span style={{fontWeight:700,fontSize:14,color:'#1A1A1A',minWidth:56,textAlign:'center'}}>{year}</span>
          <button onClick={() => setYear(y => Math.min(y + 1, currentYear))} style={{width:32,height:32,borderRadius:8,border:'1px solid #E5E5E5',background:'#FFF',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}><ChevronRight size={16} /></button>
        </div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={downloadYearly} className="m-btn m-btn-outline m-btn-sm" style={{width:'auto'}}><Download size={14} /> Statement</button>
          <button onClick={downloadForm16} className="m-btn m-btn-primary m-btn-sm" style={{width:'auto'}}><FileText size={14} /> Form 16</button>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
        <StatCard label={`Total Earned (${year})`} value={fmt(totalNet)} Icon={IndianRupee} color="#16a34a" bg="#f0fdf4" />
        <StatCard label="Months Processed" value={`${records.length} / 12`} Icon={Calendar} color="#2563eb" bg="#eff6ff" />
      </div>

      {records.length === 0 ? (
        <div className="m-empty"><p>No payroll records for {year}</p></div>
      ) : (
        records.map(r => (
          <div key={r.payroll_id} style={{background:'#FFF',border:'1px solid rgba(0,0,0,0.04)',borderRadius:14,padding:12,marginBottom:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}>
              <div style={{minWidth:0,flex:1}}>
                <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A'}}>{MONTHS[r.month - 1]}</p>
                <p style={{fontSize:10,color:'#aaa'}}>Gross {fmt(r.gross_salary)}{r.lwp_deduction > 0 ? ` · LWP -${fmt(r.lwp_deduction)}` : ''}</p>
              </div>
              <div style={{textAlign:'right',flexShrink:0,display:'flex',alignItems:'center',gap:8}}>
                <div>
                  <p style={{fontSize:14,fontWeight:800,color:'#15803d'}}>{fmt(r.net_salary)}</p>
                  <StatusBadge status={r.status} />
                </div>
                <button onClick={() => downloadPayslip(r.payroll_id, r.month)} title="Payslip"
                  style={{display:'flex',alignItems:'center',padding:'8px',borderRadius:8,background:'#FFF',border:'1px solid #E5E5E5',color:'#1A1A1A',cursor:'pointer'}}>
                  <Download size={14} />
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────

const MobilePayroll = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'accountant';
  const isTeacher = user?.role === 'teacher';
  const canManage = isAdmin;

  return (
    <div data-testid="m-payroll" style={{minWidth:0}}>
      <div className="m-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:6}}><Wallet size={22} color="#E88A1A" /> Payroll</h1>
          <p className="m-header-sub">{canManage ? 'Generate, approve & disburse salaries' : 'View payslips & download Form 16'}</p>
        </div>
      </div>

      {(isAdmin || isTeacher) ? <AdminPayrollView canManage={canManage} /> : <EmployeePayrollView />}
    </div>
  );
};

export default MobilePayroll;
