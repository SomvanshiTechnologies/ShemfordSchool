import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import { toast } from 'sonner';
import { CreditCard, Download, ChevronRight, Check, Loader2, AlertTriangle } from 'lucide-react';

const MobileFees = () => {
  const { user } = useAuth();
  const isParent = user?.role === 'parent';
  const isStudent = user?.role === 'student';
  const isAdminAcc = user?.role === 'admin' || user?.role === 'accountant';

  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [feeData, setFeeData] = useState(null);
  const [dueChart, setDueChart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [payMonths, setPayMonths] = useState(1);
  const [showPay, setShowPay] = useState(false);

  useEffect(() => {
    if (isParent || isStudent) {
      api.get('/students').then(r => {
        setChildren(r.data);
        if (r.data.length > 0) {
          setSelectedChild(r.data[0]);
          return api.get(`/fees/student/${r.data[0].student_id}`);
        }
      }).then(r => { if (r) setFeeData(r.data); }).finally(() => setLoading(false));
    } else {
      api.get('/fees/due-chart').then(r => setDueChart(r.data)).finally(() => setLoading(false));
    }
  }, [isParent, isStudent]);

  const loadFees = (studentId) => {
    setLoading(true);
    api.get(`/fees/student/${studentId}`).then(r => setFeeData(r.data)).finally(() => setLoading(false));
  };

  const payFees = async () => {
    if (!feeData) return;
    setPaying(true);
    const pending = feeData.installments.filter(i => i.status !== 'paid').slice(0, payMonths);
    const amount = pending.reduce((s, i) => s + i.total_due, 0);
    try {
      const res = await api.post('/fees/pay', {
        student_id: selectedChild.student_id,
        amount,
        payment_method: 'online',
        remarks: `Mobile payment — ${payMonths} month(s)`
      });
      toast.success(res.data.message);
      setShowPay(false);
      loadFees(selectedChild.student_id);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Payment failed');
    } finally { setPaying(false); }
  };

  if (loading) return (
    <div>
      <div className="m-header"><div><div className="m-skeleton" style={{width:100,height:24}} /></div></div>
      <div className="m-skeleton" style={{height:100,borderRadius:14,marginBottom:12}} />
      {[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:56,borderRadius:14,marginBottom:8}} />)}
    </div>
  );

  // ====== ADMIN DUE CHART VIEW ======
  if (isAdminAcc) {
    const totalDue = dueChart.reduce((s, x) => s + x.total_due, 0);
    return (
      <div data-testid="m-fees-admin">
        <div className="m-header"><div><h1>Fee Management</h1><p className="m-header-sub">{dueChart.length} students with dues</p></div></div>
        <div className="m-card-dark">
          <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#888'}}>Total Pending</p>
          <p style={{fontSize:28,fontWeight:800,color:'#FFF'}}>₹{totalDue.toLocaleString()}</p>
        </div>
        <div className="m-list">
          <div className="m-list-header"><span className="m-list-title">Due Chart</span></div>
          {dueChart.map(d => (
            <div key={d.student_id} className="m-list-item" onClick={() => { setSelectedChild({ student_id: d.student_id }); loadFees(d.student_id); }}>
              <div>
                <p style={{fontWeight:600,fontSize:13,color:'#1A1A1A'}}>{d.name}</p>
                <p style={{fontSize:11,color:'#888'}}>{d.class_name}-{d.section} | {d.months_pending} mo</p>
              </div>
              <div style={{textAlign:'right'}}>
                <p style={{fontWeight:700,fontSize:14,color:'#E88A1A'}}>₹{d.total_due.toLocaleString()}</p>
                {d.months_overdue > 0 && <span className="m-badge m-badge-orange">{d.months_overdue} overdue</span>}
              </div>
            </div>
          ))}
          {dueChart.length === 0 && <div className="m-empty"><Check size={32} color="#1A1A1A" /><p style={{marginTop:8}}>No pending dues</p></div>}
        </div>
      </div>
    );
  }

  // ====== PARENT/STUDENT VIEW ======
  const summary = feeData?.summary;
  const installments = feeData?.installments || [];
  const pending = installments.filter(i => i.status !== 'paid');

  return (
    <div data-testid="m-fees-parent">
      <div className="m-header"><div><h1>Fees</h1><p className="m-header-sub">{selectedChild?.first_name} {selectedChild?.last_name}</p></div></div>

      {/* Summary */}
      {summary && (
        <div className={summary.total_pending > 0 ? 'm-card-orange' : 'm-card-dark'}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(255,255,255,0.7)'}}>
                {summary.total_pending > 0 ? 'Amount Due' : 'All Paid'}
              </p>
              <p style={{fontSize:28,fontWeight:800,color:'#FFF',marginTop:4}}>
                {summary.total_pending > 0 ? `₹${summary.total_pending.toLocaleString()}` : '₹0'}
              </p>
              <p style={{fontSize:12,color:'rgba(255,255,255,0.7)',marginTop:2}}>
                {summary.months_paid}/{summary.months_total} months paid
              </p>
            </div>
            {isParent && summary.total_pending > 0 && (
              <button className="m-btn m-btn-dark m-btn-sm" style={{width:'auto'}} onClick={() => setShowPay(true)}>
                <CreditCard size={14} /> Pay Now
              </button>
            )}
          </div>
        </div>
      )}

      {/* Overdue warning */}
      {summary?.total_overdue > 0 && (
        <div className="m-card" style={{borderLeft:'3px solid #E88A1A',display:'flex',gap:10,alignItems:'center'}}>
          <AlertTriangle size={18} color="#E88A1A" />
          <div>
            <p style={{fontWeight:700,fontSize:13,color:'#1A1A1A'}}>Overdue</p>
            <p style={{fontSize:11,color:'#888'}}>₹{summary.total_overdue.toLocaleString()} overdue — late fees may apply</p>
          </div>
        </div>
      )}

      {/* Installments */}
      <p className="m-section">Monthly Breakdown</p>
      <div className="m-list">
        {installments.map(inst => (
          <div key={inst.installment_id} className="m-list-item">
            <div>
              <p style={{fontWeight:600,fontSize:13,color:'#1A1A1A'}}>{inst.month}</p>
              <p style={{fontSize:11,color:'#888'}}>Due: {inst.due_date}</p>
              {inst.concession_amount > 0 && <p style={{fontSize:10,color:'#E88A1A'}}>Concession: -₹{inst.concession_amount}</p>}
            </div>
            <div style={{textAlign:'right'}}>
              <p style={{fontWeight:700,fontSize:14,color:inst.status === 'paid' ? '#1A1A1A' : '#E88A1A'}}>₹{inst.total_due.toLocaleString()}</p>
              <span className={`m-badge ${inst.status === 'paid' ? 'm-badge-dark' : inst.status === 'overdue' ? 'm-badge-orange' : 'm-badge-muted'}`}>{inst.status}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Payment history */}
      {feeData?.payments?.length > 0 && (
        <>
          <p className="m-section">Payment History</p>
          <div className="m-list">
            {feeData.payments.map(p => (
              <div key={p.payment_id} className="m-list-item">
                <div>
                  <p style={{fontWeight:600,fontSize:13,color:'#1A1A1A'}}>{p.receipt_number}</p>
                  <p style={{fontSize:11,color:'#888'}}>{p.payment_date} | {p.payment_method}</p>
                </div>
                <p style={{fontWeight:700,fontSize:14,color:'#1A1A1A'}}>₹{p.amount.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Payment bottom sheet */}
      {showPay && (
        <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
          <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.5)'}} onClick={() => setShowPay(false)} />
          <div style={{position:'relative',background:'#FFF',borderRadius:'20px 20px 0 0',padding:'24px 20px',paddingBottom:'calc(24px + env(safe-area-inset-bottom))'}}>
            <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5',margin:'0 auto 20px'}} />
            <h3 style={{fontWeight:800,fontSize:18,color:'#1A1A1A',marginBottom:16}}>Pay Fees</h3>
            <p style={{fontSize:13,color:'#888',marginBottom:12}}>Select months to pay (oldest first)</p>
            <div className="m-chips" style={{marginBottom:16}}>
              {[1, 2, 3, pending.length].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map(n => (
                <button key={n} className={`m-chip ${payMonths === n ? 'active' : ''}`} onClick={() => setPayMonths(n)}>
                  {n} month{n > 1 ? 's' : ''}
                </button>
              ))}
            </div>
            <div className="m-card" style={{background:'#F5F5F5',marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between'}}>
                <span style={{fontSize:13,color:'#888'}}>Amount</span>
                <span style={{fontWeight:800,fontSize:18,color:'#1A1A1A'}}>₹{pending.slice(0, payMonths).reduce((s, i) => s + i.total_due, 0).toLocaleString()}</span>
              </div>
            </div>
            <button className="m-btn m-btn-primary" onClick={payFees} disabled={paying}>
              {paying ? <Loader2 size={18} className="animate-spin" /> : <CreditCard size={18} />}
              {paying ? 'Processing...' : 'Confirm Payment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileFees;
