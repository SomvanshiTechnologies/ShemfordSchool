import React, { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import { clampISODate, todayISO } from '../../lib/dateBounds';
import { fetchPaymentMethods, PAYMENT_METHODS } from '../../lib/paymentMethods';
import { toast } from 'sonner';
import {
  X, ArrowRight, ArrowLeft, CheckCircle, AlertCircle, FileUp, RefreshCw, Loader2,
  CreditCard, User, BookOpen,
} from 'lucide-react';

const STEPS = [
  { id: 1, title: 'Details' },
  { id: 2, title: 'Class' },
  { id: 3, title: 'Documents' },
  { id: 4, title: 'Fee' },
  { id: 5, title: 'Done' },
];

const REQUIRED_DOCUMENTS = [
  { type: 'birth_certificate', name: 'Birth Certificate', mandatory: false },
  { type: 'aadhaar_card', name: 'Aadhaar Card', mandatory: false },
  { type: 'passport_photo', name: 'Passport Photo', mandatory: false },
  { type: 'previous_marksheet', name: 'Previous Marksheet', mandatory: false },
  { type: 'transfer_certificate', name: 'Transfer Certificate (TC)', mandatory: false },
  { type: 'caste_certificate', name: 'Caste Certificate', mandatory: false },
  { type: 'medical_certificate', name: 'Medical Certificate', mandatory: false },
];

const STREAMS_FOR_CLASS = ['11th', '12th'];
const STREAM_SECTIONS = [
  { section_name: 'Science', capacity: 999, student_count: 0 },
  { section_name: 'Humanities', capacity: 999, student_count: 0 },
];

const sheet = {
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:300, display:'flex', alignItems:'flex-end', justifyContent:'center' },
  panel: { background:'#FFF', width:'100%', maxWidth:520, borderTopLeftRadius:20, borderTopRightRadius:20, maxHeight:'94dvh', display:'flex', flexDirection:'column', paddingBottom:'env(safe-area-inset-bottom, 0)' },
  body: { overflowY:'auto', padding:16, flex:1 },
  field: { marginBottom:12 },
  label: { display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'#666', marginBottom:6 },
  err: { color:'#dc2626', fontSize:11, marginTop:4, display:'flex', alignItems:'center', gap:4 },
  footer: { display:'flex', gap:8, padding:12, borderTop:'1px solid #F0F0F0', background:'#FFF' },
};

const MobileStudentOnboarding = ({ classes, onClose, onCompleted }) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [onbId, setOnbId] = useState(null);

  const [data, setData] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    date_of_birth: '', gender: 'male', address: '',
    parent_name: '', parent_phone: '', parent_email: '',
    mother_name: '', mother_phone: '', mother_email: '',
    is_sibling: false, sibling_student_id: '',
  });
  const [classData, setClassData] = useState({ class_name: '', section: '', stream: '' });
  const [feeData, setFeeData] = useState(null);
  const [docs, setDocs] = useState({});
  const [docLoading, setDocLoading] = useState({});
  const [skipDocs, setSkipDocs] = useState(false);
  const [payment, setPayment] = useState({ method: 'cash', transaction_id: '', remarks: '', amount: '', split_cash: '', split_online: '' });
  // Payment methods are admin-configurable in the DB (same source as Fees).
  const [payMethods, setPayMethods] = useState(PAYMENT_METHODS);
  useEffect(() => { fetchPaymentMethods({ withPos: false }).then(setPayMethods).catch(() => {}); }, []);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [result, setResult] = useState(null);

  const docInputRef = useRef({});

  const getSections = (cn) => {
    if (STREAMS_FOR_CLASS.includes(cn)) return STREAM_SECTIONS;
    return classes.find(c => c.name === cn)?.sections || [];
  };

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const doStep1 = async () => {
    const err = {};
    const isTenDigits = (v) => /^\d{10}$/.test((v || '').trim());
    if (!data.first_name?.trim()) err.first_name = 'First Name is required';
    if (!data.last_name?.trim()) err.last_name = 'Last Name is required';
    if (!data.gender) err.gender = 'Gender is required';
    if (!data.date_of_birth) err.date_of_birth = 'Date of Birth is required';
    // Email is OPTIONAL — students log in with their admission number + the
    // password generated against it, so an email isn't required (matches desktop).
    if (!data.phone?.trim()) err.phone = 'Phone is required';
    else if (!isTenDigits(data.phone)) err.phone = 'Phone must be exactly 10 digits';
    if (!data.address?.trim()) err.address = 'Address is required';
    // Parent / mother contact numbers are optional, but when provided must be 10 digits.
    if (data.parent_phone?.trim() && !isTenDigits(data.parent_phone)) err.parent_phone = 'Contact number must be 10 digits';
    if (data.mother_phone?.trim() && !isTenDigits(data.mother_phone)) err.mother_phone = 'Mother contact must be 10 digits';
    setErrors(err);
    if (Object.keys(err).length > 0) { toast.error('Please fill required fields'); return; }
    setLoading(true);
    try {
      const payload = { ...data };
      ['email','parent_email','phone','date_of_birth','address','sibling_student_id'].forEach(k => { if (!payload[k]) delete payload[k]; });
      const res = await api.post('/onboarding/start', payload);
      setOnbId(res.data.onboarding_id);
      setErrors({});
      setStep(2);
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (detail?.validation_errors) { setErrors(detail.validation_errors); toast.error('Please fix the highlighted fields'); }
      else toast.error(detail || 'Failed to start onboarding');
    } finally { setLoading(false); }
  };

  const doStep2 = async () => {
    if (!classData.class_name || !classData.section) { toast.error('Please select class and section'); return; }
    // For 11th/12th the section IS the stream — derive lowercase value.
    const needsStream = STREAMS_FOR_CLASS.includes(classData.class_name);
    const effectiveStream = needsStream ? (classData.section || '').toLowerCase() : classData.stream;
    setLoading(true);
    try {
      const res = await api.put(`/onboarding/${onbId}/class`, {
        class_name: classData.class_name,
        section: classData.section,
        stream: effectiveStream || undefined,
      });
      setFeeData(res.data);
      setStep(3);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to set class'); }
    finally { setLoading(false); }
  };

  const uploadDoc = async (docType, docName, file) => {
    setDocLoading(p => ({ ...p, [docType]: true }));
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await api.post('/upload', fd);
      const { file_url, file_name } = up.data;
      await api.post(`/onboarding/${onbId}/documents`, { document_type: docType, document_name: docName, file_url, file_name });
      setDocs(p => ({ ...p, [docType]: { file_name, file_url, uploaded: true } }));
      toast.success(`${docName} uploaded`);
    } catch (e) { toast.error(e.response?.data?.detail || `Failed to upload ${docName}`); }
    finally { setDocLoading(p => ({ ...p, [docType]: false })); }
  };

  const triggerUpload = (docType) => {
    if (!docInputRef.current[docType]) {
      const i = document.createElement('input');
      i.type = 'file';
      i.accept = '.pdf,.jpg,.jpeg,.png';
      i.onchange = (e) => {
        const f = e.target.files?.[0];
        if (f) {
          const doc = REQUIRED_DOCUMENTS.find(d => d.type === docType);
          uploadDoc(docType, doc?.name || docType, f);
        }
        i.value = '';
      };
      docInputRef.current[docType] = i;
    }
    docInputRef.current[docType].click();
  };

  const doComplete = async () => {
    setLoading(true);
    try {
      const res = await api.post(`/onboarding/${onbId}/complete`, { admin_override: skipDocs });
      const admission = res.data;
      let receipt_number = null;
      if (admission.admission_time_fee > 0 || (feeData?.fee_breakdown?.length || 0) > 0) {
        setPaymentLoading(true);
        try {
          const payPayload = {
            student_id: admission.student_id,
            payment_method: payment.method,
            transaction_id: payment.transaction_id || undefined,
            remarks: payment.remarks || 'Collected at admission',
          };
          const admTotal = feeData?.admission_time_fee || 0;
          let collectAmt = parseFloat(payment.amount);
          if (payment.method === 'split') {
            const cash = parseFloat(payment.split_cash) || 0;
            const online = parseFloat(payment.split_online) || 0;
            payPayload.split_payments = { cash, online };
            collectAmt = cash + online; // split defines the amount collected
          }
          if (collectAmt > 0 && (!admTotal || collectAmt < admTotal)) payPayload.amount = collectAmt;
          const pr = await api.post('/fees/admission-payment', payPayload);
          receipt_number = pr.data.receipt_number;
          toast.success(`Payment recorded — Receipt: ${receipt_number}`);
        } catch {
          toast.error('Admission done, but payment recording failed. Record it from Fees.');
        } finally { setPaymentLoading(false); }
      }
      setResult({ ...admission, receipt_number });
      setStep(5);
      onCompleted && onCompleted();
      toast.success(`Admission successful — ${admission.admission_number}`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to complete admission'); }
    finally { setLoading(false); }
  };

  return (
    <div onClick={onClose} style={sheet.overlay} data-testid="m-onboarding">
      <div onClick={(e) => e.stopPropagation()} style={sheet.panel}>
        <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
          <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0'}}>
          <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>New Admission</h2>
          <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888'}}>
            <X size={20} />
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator step={step} steps={STEPS} />

        <div style={sheet.body}>
          {/* Step 1 */}
          {step === 1 && (
            <>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:12}}><User size={14} color="#888" /><span style={{fontSize:13,fontWeight:700,color:'#1A1A1A'}}>Student Details</span></div>
              <Input label="First Name" required value={data.first_name} onChange={(e) => { setData({...data, first_name: e.target.value}); setErrors(p => ({...p, first_name:''})); }} error={errors.first_name} />
              <Input label="Last Name" required value={data.last_name} onChange={(e) => { setData({...data, last_name: e.target.value}); setErrors(p => ({...p, last_name:''})); }} error={errors.last_name} />
              <div style={sheet.field}>
                <label style={sheet.label}>Gender <span style={{color:'#dc2626'}}>*</span></label>
                <select className="m-input" value={data.gender} onChange={(e) => setData({...data, gender: e.target.value})}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
                {errors.gender && <div style={sheet.err}><AlertCircle size={12} />{errors.gender}</div>}
              </div>
              <Input label="Date of Birth" required type="date" max={todayISO()} value={data.date_of_birth} onChange={(e) => { setData({...data, date_of_birth: clampISODate(e.target.value, { max: todayISO() })}); setErrors(p => ({...p, date_of_birth:''})); }} error={errors.date_of_birth} />
              <Input label="Email" type="email" value={data.email} onChange={(e) => { setData({...data, email: e.target.value}); setErrors(p => ({...p, email:''})); }} error={errors.email} />
              <Input label="Phone" required inputMode="numeric" maxLength={10} value={data.phone} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); setData({...data, phone: v}); setErrors(p => ({...p, phone:''})); }} error={errors.phone} />
              <Input label="Address" required value={data.address} onChange={(e) => { setData({...data, address: e.target.value}); setErrors(p => ({...p, address:''})); }} error={errors.address} />

              <div style={{borderTop:'1px solid #F0F0F0',paddingTop:12,marginTop:8}}>
                <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',marginBottom:10}}>Father / Guardian</p>
                <Input label="Name" value={data.parent_name} onChange={(e) => setData({...data, parent_name: e.target.value})} />
                <Input label="Phone" inputMode="numeric" maxLength={10} value={data.parent_phone} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); setData({...data, parent_phone: v}); setErrors(p => ({...p, parent_phone:''})); }} error={errors.parent_phone} />
                <Input label="Email" type="email" value={data.parent_email} onChange={(e) => setData({...data, parent_email: e.target.value})} />
              </div>
              <div style={{borderTop:'1px solid #F0F0F0',paddingTop:12,marginTop:8}}>
                <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',marginBottom:10}}>Mother</p>
                <Input label="Name" value={data.mother_name} onChange={(e) => setData({...data, mother_name: e.target.value})} />
                <Input label="Phone" inputMode="numeric" maxLength={10} value={data.mother_phone} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); setData({...data, mother_phone: v}); setErrors(p => ({...p, mother_phone:''})); }} error={errors.mother_phone} />
                <Input label="Email" type="email" value={data.mother_email} onChange={(e) => setData({...data, mother_email: e.target.value})} />
              </div>
            </>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:12}}><BookOpen size={14} color="#888" /><span style={{fontSize:13,fontWeight:700,color:'#1A1A1A'}}>Class & Stream</span></div>
              <div style={sheet.field}>
                <label style={sheet.label}>Class <span style={{color:'#dc2626'}}>*</span></label>
                <select className="m-input" value={classData.class_name} onChange={(e) => setClassData({class_name: e.target.value, section: '', stream: ''})}>
                  <option value="">Select class</option>
                  {classes.map(c => <option key={c.name} value={c.name}>{c.display_name || `Class ${c.name}`}</option>)}
                </select>
              </div>
              <div style={sheet.field}>
                <label style={sheet.label}>Section <span style={{color:'#dc2626'}}>*</span></label>
                <select className="m-input" value={classData.section} onChange={(e) => setClassData(p => ({...p, section: e.target.value}))} disabled={!classData.class_name}>
                  <option value="">Select section</option>
                  {getSections(classData.class_name).map(s => (
                    <option key={s.section_name} value={s.section_name}>
                      {STREAMS_FOR_CLASS.includes(classData.class_name)
                        ? s.section_name
                        : `Section ${s.section_name} (${s.student_count || 0}/${s.capacity})`}
                    </option>
                  ))}
                </select>
              </div>
              <label style={{display:'flex',alignItems:'flex-start',gap:8,padding:12,background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:12,cursor:'pointer'}}>
                <input type="checkbox" checked={data.is_sibling} onChange={(e) => setData({...data, is_sibling: e.target.checked})} style={{marginTop:2}} />
                <div>
                  <p style={{fontSize:12,fontWeight:600,color:'#1e3a8a'}}>This student has a sibling already enrolled</p>
                  <p style={{fontSize:11,color:'#3b82f6',marginTop:2}}>Sibling discount applied to Admission Fee & Monthly Tuition</p>
                </div>
              </label>
              {data.is_sibling && (
                <div style={{marginTop:8}}>
                  <Input label="Sibling Student ID (optional)" value={data.sibling_student_id} onChange={(e) => setData({...data, sibling_student_id: e.target.value})} placeholder="STU... — blank to auto-detect" />
                </div>
              )}
              {classData.class_name && classData.section && (() => {
                const sec = getSections(classData.class_name).find(s => s.section_name === classData.section);
                if (!sec) return null;
                const pct = sec.capacity > 0 ? Math.min(100, ((sec.student_count || 0) / sec.capacity) * 100) : 0;
                return (
                  <div style={{marginTop:8,padding:12,background:'#F8F8F8',borderRadius:12}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                      <span style={{fontSize:12,fontWeight:600}}>Seat Availability</span>
                      <span style={{fontSize:12,color:'#666'}}>{sec.student_count || 0} / {sec.capacity}</span>
                    </div>
                    <div style={{height:6,background:'#E5E5E5',borderRadius:3,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${pct}%`,background: pct >= 100 ? '#dc2626' : '#1A1A1A'}} />
                    </div>
                    {pct >= 100 && <p style={{fontSize:11,color:'#d97706',marginTop:6}}>This section is full!</p>}
                  </div>
                );
              })()}
            </>
          )}

          {/* Step 3: Documents */}
          {step === 3 && (
            <>
              {skipDocs ? (
                <div style={{display:'flex',gap:8,background:'#fffbeb',border:'1px solid #fde68a',padding:12,borderRadius:12,marginBottom:12}}>
                  <AlertCircle size={16} color="#d97706" style={{flexShrink:0,marginTop:2}} />
                  <div>
                    <p style={{fontSize:13,fontWeight:700,color:'#92400e'}}>Documents skipped</p>
                    <p style={{fontSize:11,color:'#b45309',marginTop:2}}>Admission will proceed with admin override.</p>
                    <button style={{fontSize:11,color:'#b45309',textDecoration:'underline',marginTop:4,background:'none',border:'none',padding:0,cursor:'pointer'}} onClick={() => setSkipDocs(false)}>Upload documents now instead</button>
                  </div>
                </div>
              ) : (
                <p style={{fontSize:12,color:'#666',marginBottom:12}}>Upload admission documents. Mandatory documents are required, or skip all now and upload later.</p>
              )}
              <div>
                {REQUIRED_DOCUMENTS.map(doc => {
                  const up = docs[doc.type];
                  const dl = docLoading[doc.type];
                  return (
                    <div key={doc.type} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:10,marginBottom:8,borderRadius:12,background: up ? '#f0fdf4' : '#F8F8F8',border: up ? '1px solid #bbf7d0' : '1px solid #E5E5E5'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0,flex:1}}>
                        {up ? <CheckCircle size={14} color="#16a34a" /> : <div style={{width:12,height:12,borderRadius:6,border: `2px solid ${doc.mandatory ? '#1A1A1A' : '#D1D5DB'}`}} />}
                        <div style={{minWidth:0}}>
                          <p style={{fontSize:12,fontWeight:600,color:'#1A1A1A'}}>
                            {doc.name}
                            {doc.mandatory && <span style={{fontSize:9,color:'#dc2626',fontWeight:800,marginLeft:4,textTransform:'uppercase'}}>Required</span>}
                          </p>
                          {up && <p style={{fontSize:10,color:'#16a34a',wordBreak:'break-word'}}>{up.file_name}</p>}
                        </div>
                      </div>
                      <button onClick={() => triggerUpload(doc.type)} disabled={dl} style={{display:'flex',alignItems:'center',gap:4,padding:'6px 10px',borderRadius:8,background: up ? '#FFF' : '#1A1A1A',color: up ? '#1A1A1A' : '#FFF',border: up ? '1px solid #E5E5E5' : 'none',fontSize:11,fontWeight:700,cursor:'pointer'}}>
                        {dl ? <Loader2 size={12} className="animate-spin" /> : up ? <RefreshCw size={12} /> : <FileUp size={12} />}
                        {up ? 'Replace' : 'Upload'}
                      </button>
                    </div>
                  );
                })}
              </div>
              <p style={{fontSize:10,color:'#888',marginTop:8}}>Accepted: PDF, JPG, PNG · Max 5 MB</p>
            </>
          )}

          {/* Step 4: Fee Preview */}
          {step === 4 && feeData && (
            <>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
                <div style={{background:'#F8F8F8',padding:10,borderRadius:12}}>
                  <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888'}}>Student</p>
                  <p style={{fontSize:13,fontWeight:700,marginTop:2}}>{feeData.first_name} {feeData.last_name}</p>
                </div>
                <div style={{background:'#F8F8F8',padding:10,borderRadius:12}}>
                  <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888'}}>Class</p>
                  <p style={{fontSize:13,fontWeight:700,marginTop:2}}>{feeData.class_name}-{feeData.section}{feeData.stream ? ` (${feeData.stream})` : ''}</p>
                </div>
              </div>

              <div style={{border:'1px solid #E5E5E5',borderRadius:14,overflow:'hidden',marginBottom:12}}>
                <div style={{padding:'8px 12px',background:'#F8F8F8',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#666'}}>Admission Time Fee Breakdown</div>
                {feeData.fee_breakdown?.length > 0 ? (
                  <div>
                    {feeData.fee_breakdown.map((fee, idx) => (
                      <div key={idx} style={{padding:10,borderBottom:'1px solid #F5F5F5'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
                          <span style={{fontSize:12,color:'#1A1A1A'}}>{fee.label}</span>
                          <span style={{fontSize:13,fontWeight:700}}>₹{(fee.net_amount||0).toLocaleString()}</span>
                        </div>
                        {fee.discount_amount > 0 && (
                          <div style={{fontSize:10,color:'#16a34a',marginTop:2}}>
                            Gross ₹{(fee.gross_amount||0).toLocaleString()} · Discount -₹{fee.discount_amount.toLocaleString()}
                            {fee.sibling_discount_amount > 0 && ` (Sibling -₹${fee.sibling_discount_amount.toLocaleString()})`}
                          </div>
                        )}
                      </div>
                    ))}
                    <div style={{padding:12,background:'#F8F8F8',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontSize:12,fontWeight:800}}>Total Due at Admission</span>
                      <span style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>₹{(feeData.admission_time_fee||0).toLocaleString()}</span>
                    </div>
                  </div>
                ) : (
                  <p style={{padding:14,fontSize:12,color:'#888'}}>No fee configuration found. Admission can still proceed; fees can be added later.</p>
                )}
              </div>

              {feeData.total_annual_fee > 0 && (
                <p style={{fontSize:11,color:'#888',textAlign:'right',marginBottom:12}}>Total annual: ₹{(feeData.total_annual_fee||0).toLocaleString()}</p>
              )}

              {feeData.fee_breakdown?.length > 0 && (
                <div style={{border:'1px solid #E5E5E5',borderRadius:14,overflow:'hidden',marginBottom:12}}>
                  <div style={{padding:'10px 12px',background:'#1A1A1A',color:'#FFF',display:'flex',alignItems:'center',gap:6}}>
                    <CreditCard size={14} />
                    <span style={{fontSize:11,fontWeight:800,textTransform:'uppercase',letterSpacing:'0.06em'}}>
                      Collect ₹{(feeData.admission_time_fee||0).toLocaleString()}
                    </span>
                  </div>
                  <div style={{padding:12}}>
                    <div style={sheet.field}>
                      <label style={sheet.label}>Payment Method <span style={{color:'#dc2626'}}>*</span></label>
                      <select className="m-input" value={payment.method} onChange={(e) => setPayment(p => ({...p, method: e.target.value}))}>
                        {payMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                    {payment.method === 'split' && (
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                        <Input label="Cash Amount" type="number" value={payment.split_cash} onChange={(e) => setPayment(p => ({...p, split_cash: e.target.value}))} placeholder="0" />
                        <Input label="Online Amount" type="number" value={payment.split_online} onChange={(e) => setPayment(p => ({...p, split_online: e.target.value}))} placeholder="0" />
                      </div>
                    )}
                    {payment.method !== 'cash' && payment.method !== 'split' && (
                      <Input
                        label={payment.method === 'cheque' ? 'Cheque Number' : 'Transaction / UTR Number'}
                        value={payment.transaction_id}
                        onChange={(e) => setPayment(p => ({...p, transaction_id: e.target.value}))}
                        placeholder={payment.method === 'cheque' ? 'e.g. 123456' : 'e.g. UTR / Ref'}
                      />
                    )}
                    <Input
                      label="Amount to collect (blank = full)"
                      type="number"
                      readOnly={payment.method === 'split'}
                      value={payment.method === 'split'
                        ? String(((parseFloat(payment.split_cash) || 0) + (parseFloat(payment.split_online) || 0)) || '')
                        : payment.amount}
                      onChange={(e) => setPayment(p => ({...p, amount: e.target.value}))}
                      placeholder={`Full: ₹${(feeData.admission_time_fee||0).toLocaleString()}`}
                    />
                    <Input label="Remarks (optional)" value={payment.remarks} onChange={(e) => setPayment(p => ({...p, remarks: e.target.value}))} placeholder="e.g. Received from father" />
                    <p style={{fontSize:11,color:'#666',background:'#F8F8F8',padding:'8px 10px',borderRadius:8}}>Leave amount blank to collect the full fee, or enter a smaller amount for a partial payment. A receipt is generated after admission is confirmed.</p>
                  </div>
                </div>
              )}
              {skipDocs && (
                <div style={{display:'flex',gap:6,padding:'8px 10px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10}}>
                  <AlertCircle size={12} color="#d97706" />
                  <span style={{fontSize:11,color:'#92400e'}}>Documents skipped — admin override will be applied.</span>
                </div>
              )}
            </>
          )}

          {/* Step 5: Success */}
          {step === 5 && result && (
            <div style={{textAlign:'center'}}>
              <div style={{width:60,height:60,borderRadius:30,background:'#dcfce7',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 12px'}}>
                <CheckCircle size={30} color="#16a34a" />
              </div>
              <h3 style={{fontSize:18,fontWeight:800,color:'#1A1A1A'}}>Admission Successful!</h3>
              <div style={{textAlign:'left',marginTop:14,background:'#F8F8F8',padding:14,borderRadius:14}}>
                <Row label="Admission Number" value={result.admission_number} mono />
                <Row label="Academic Year" value={result.academic_year} />
                <Row label="Ledger Entries" value={result.ledger_entries_created} />
                {result.parent_account && (
                  <>
                    <div style={{borderTop:'1px solid #E5E5E5',margin:'10px 0',paddingTop:10}}>
                      <p style={{fontSize:13,fontWeight:800,color:'#1A1A1A',marginBottom:8}}>Parent Login (new account)</p>
                    </div>
                    <Row label="Email" value={result.parent_account.email} />
                    <Row label="Password" value={result.parent_account.temp_password} mono />
                    <p style={{fontSize:11,color:'#888',marginTop:6}}>Share these credentials securely. Parent must change password on first login.</p>
                  </>
                )}
                {result.receipt_number && <Row label="Payment Receipt" value={result.receipt_number} mono accent="#15803d" />}
              </div>
            </div>
          )}
        </div>

        {/* Footer / nav */}
        <div style={sheet.footer}>
          {step === 1 && (
            <>
              <button onClick={onClose} style={btn('outline')}>Cancel</button>
              <button onClick={doStep1} disabled={loading} style={btn('dark')}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : null} Next <ArrowRight size={14} />
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} style={btn('outline')}><ArrowLeft size={14} /> Back</button>
              <button onClick={doStep2} disabled={loading} style={btn('dark')}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : null} Next <ArrowRight size={14} />
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <button onClick={() => setStep(2)} style={btn('outline')}><ArrowLeft size={14} /> Back</button>
              {!skipDocs && (
                <button onClick={() => { setSkipDocs(true); setStep(4); }} style={{...btn('outline'), color:'#b45309', borderColor:'#fde68a'}}>
                  Skip Docs
                </button>
              )}
              <button onClick={() => setStep(4)} style={btn('dark')}>Continue <ArrowRight size={14} /></button>
            </>
          )}
          {step === 4 && (
            <>
              <button onClick={() => setStep(3)} style={btn('outline')}><ArrowLeft size={14} /> Back</button>
              <button onClick={doComplete} disabled={loading || paymentLoading} style={btn('dark')}>
                {(loading || paymentLoading) ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                {paymentLoading ? 'Recording…' : loading ? 'Completing…' : 'Complete'}
              </button>
            </>
          )}
          {step === 5 && (
            <button onClick={onClose} style={{...btn('dark'), flex:1}}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
};

const StepIndicator = ({ step, steps }) => {
  const idx = steps.findIndex(s => s.id === step);
  const total = steps.length;
  const pct = ((idx + 1) / total) * 100;
  const current = steps[idx] || steps[0];
  return (
    <div style={{padding:'14px 16px 10px',borderBottom:'1px solid #F5F5F5'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
          <div style={{width:28,height:28,borderRadius:14,background:'#1A1A1A',color:'#FFF',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,flexShrink:0}}>
            {step}
          </div>
          <div style={{minWidth:0}}>
            <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888'}}>Step {step} of {total}</p>
            <p style={{fontSize:14,fontWeight:800,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{current.title}</p>
          </div>
        </div>
        <span style={{fontSize:11,fontWeight:700,color:'#888',flexShrink:0}}>{Math.round(pct)}%</span>
      </div>
      <div style={{height:4,background:'#F0F0F0',borderRadius:2,overflow:'hidden'}}>
        <div style={{height:'100%',width:`${pct}%`,background:'#1A1A1A',transition:'width 0.2s'}} />
      </div>
    </div>
  );
};

const btn = (variant) => ({
  flex:1,
  display:'flex', alignItems:'center', justifyContent:'center', gap:6,
  padding:'12px 14px',
  borderRadius:12,
  fontSize:13, fontWeight:700,
  cursor:'pointer',
  border: variant === 'outline' ? '1.5px solid #E5E5E5' : 'none',
  background: variant === 'dark' ? '#1A1A1A' : '#FFF',
  color: variant === 'dark' ? '#FFF' : '#1A1A1A',
});

const Input = ({ label, value, onChange, error, type='text', placeholder, required, inputMode, maxLength, max, min, readOnly }) => (
  <div style={sheet.field}>
    <label style={sheet.label}>{label}{required && <span style={{color:'#dc2626',marginLeft:4}}>*</span>}</label>
    <input
      type={type}
      value={value || ''}
      onChange={onChange}
      placeholder={placeholder}
      inputMode={inputMode}
      maxLength={maxLength}
      max={max}
      min={min}
      readOnly={readOnly}
      className="m-input"
      style={error ? { borderColor:'#dc2626' } : (readOnly ? { background:'#F8F8F8', color:'#666' } : undefined)}
    />
    {error && <div style={sheet.err}><AlertCircle size={12} />{error}</div>}
  </div>
);

const Row = ({ label, value, mono, accent }) => (
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'4px 0'}}>
    <span style={{fontSize:12,color:'#666'}}>{label}</span>
    <span style={{fontSize:13,fontWeight:700,color: accent || '#1A1A1A', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined}}>{value}</span>
  </div>
);

export default MobileStudentOnboarding;
