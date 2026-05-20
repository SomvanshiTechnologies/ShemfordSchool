import React, { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';
import { X, ArrowRight, ArrowLeft, Loader2, Upload, Download, CheckCircle, AlertCircle, FileUp } from 'lucide-react';

const STREAMS_FOR_CLASS = ['11th', '12th'];

const STEPS = [
  { id: 1, title: 'Configure' },
  { id: 2, title: 'Preview' },
  { id: 3, title: 'Result' },
];

const sheet = {
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:300, display:'flex', alignItems:'flex-end', justifyContent:'center' },
  panel: { background:'#FFF', width:'100%', maxWidth:520, borderTopLeftRadius:20, borderTopRightRadius:20, maxHeight:'94dvh', display:'flex', flexDirection:'column', paddingBottom:'env(safe-area-inset-bottom, 0)' },
  body: { overflowY:'auto', padding:16, flex:1 },
  field: { marginBottom:12 },
  label: { display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'#666', marginBottom:6 },
  footer: { display:'flex', gap:8, padding:12, borderTop:'1px solid #F0F0F0', background:'#FFF' },
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

const MobileStudentCsvImport = ({ classes, onClose, onCompleted }) => {
  const [step, setStep] = useState(1);
  const [className, setClassName] = useState('');
  const [section, setSection] = useState('');
  const [stream, setStream] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [errorFilter, setErrorFilter] = useState('all');
  const fileRef = useRef(null);

  const getSections = (cn) => (classes.find(c => c.name === cn)?.sections || []);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const downloadSample = () => {
    const headers = [
      'admission_no','roll_no','first_name','middlename','last_name','gender','date_of_birth','admission_date',
      'mobile_no','email',
      'father_name','father_phone','father_occupation',
      'mother_name','mother_phone','mother_occupation',
      'guardian_is','guardian_name','guardian_relation','guardian_email','guardian_phone','guardian_occupation','guardian_address',
      'current_address','permanent_address',
      'national_identification_no','local_identification_no',
      'bank_account_no','bank_name','ifsc_code',
      'category','religion','caste','rte','previous_school','note',
    ].join(',');
    const blob = new Blob([headers + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob);
    a.download = 'students_import_template.csv';
    a.click();
  };

  const doPreview = async () => {
    if (!className || !section) { toast.error('Please select class and section'); return; }
    const needsStream = STREAMS_FOR_CLASS.includes(className);
    if (needsStream && !stream) { toast.error('Please select stream for Class 11th/12th'); return; }
    if (!file) { toast.error('Please select a CSV file'); return; }
    setPreviewing(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('class_name', className);
      fd.append('section', section);
      if (stream) fd.append('stream', stream);
      const res = await api.post('/students/csv-preview', fd);
      setPreview(res.data);
      setStep(2);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to parse CSV');
    } finally { setPreviewing(false); }
  };

  const doImport = async () => {
    if (!preview) return;
    const validRows = preview.rows.filter(r => r.status === 'valid');
    if (validRows.length === 0) { toast.error('No valid rows to import'); return; }
    setImporting(true);
    try {
      const res = await api.post('/students/csv-import', {
        class_name: preview.class_name,
        section: preview.section,
        stream: preview.stream,
        rows: preview.rows,
      });
      setImportResult(res.data);
      setStep(3);
      if (res.data.success > 0) { onCompleted && onCompleted(); toast.success(`${res.data.success} students imported`); }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Import failed');
    } finally { setImporting(false); }
  };

  const filteredRows = preview ? (
    errorFilter === 'all' ? preview.rows :
    errorFilter === 'valid' ? preview.rows.filter(r => r.status === 'valid') :
    preview.rows.filter(r => r.status !== 'valid')
  ) : [];

  return (
    <div onClick={onClose} style={sheet.overlay} data-testid="m-csv-import">
      <div onClick={(e) => e.stopPropagation()} style={sheet.panel}>
        <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
          <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0'}}>
          <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>Bulk Import Students</h2>
          <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888'}}>
            <X size={20} />
          </button>
        </div>

        <StepIndicator step={step} steps={STEPS} />

        <div style={sheet.body}>
          {/* Step 1 */}
          {step === 1 && (
            <>
              <div style={sheet.field}>
                <label style={sheet.label}>Class <span style={{color:'#dc2626'}}>*</span></label>
                <select className="m-input" value={className} onChange={(e) => { setClassName(e.target.value); setSection(''); setStream(''); }}>
                  <option value="">Select class</option>
                  {classes.map(c => <option key={c.class_id || c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div style={sheet.field}>
                <label style={sheet.label}>Section <span style={{color:'#dc2626'}}>*</span></label>
                <select className="m-input" value={section} onChange={(e) => setSection(e.target.value)} disabled={!className}>
                  <option value="">Select section</option>
                  {getSections(className).map(s => <option key={s.section_name} value={s.section_name}>{s.section_name}</option>)}
                </select>
              </div>
              {STREAMS_FOR_CLASS.includes(className) && (
                <div style={sheet.field}>
                  <label style={sheet.label}>Stream <span style={{color:'#dc2626'}}>*</span></label>
                  <select className="m-input" value={stream} onChange={(e) => setStream(e.target.value)}>
                    <option value="">Select stream</option>
                    <option value="science">Science</option>
                    <option value="humanities">Humanities</option>
                  </select>
                </div>
              )}

              <div style={sheet.field}>
                <label style={sheet.label}>CSV File <span style={{color:'#dc2626'}}>*</span></label>
                <input ref={fileRef} type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="m-input" style={{padding:8}} />
                {file && <p style={{fontSize:11,color:'#666',marginTop:4}}>{file.name} · {(file.size/1024).toFixed(1)} KB</p>}
              </div>

              <button onClick={downloadSample} style={{display:'flex',alignItems:'center',gap:6,padding:'10px 12px',borderRadius:10,background:'#F8F8F8',border:'1px solid #E5E5E5',fontSize:12,fontWeight:600,color:'#1A1A1A',cursor:'pointer'}}>
                <Download size={14} /> Download CSV template
              </button>
            </>
          )}

          {/* Step 2: Preview */}
          {step === 2 && preview && (
            <>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
                <Tile label="Total Rows" value={preview.total_rows} />
                <Tile label="Valid" value={preview.valid_rows} color="#16a34a" />
                <Tile label="Invalid" value={preview.invalid_rows} color="#dc2626" />
              </div>

              <div style={{display:'flex',gap:6,marginBottom:10}}>
                {['all','valid','invalid'].map(f => (
                  <button key={f} onClick={() => setErrorFilter(f)}
                    style={{padding:'6px 10px',borderRadius:8,fontSize:11,fontWeight:700,cursor:'pointer',textTransform:'capitalize',
                      background: errorFilter === f ? '#1A1A1A' : '#FFF',
                      color: errorFilter === f ? '#FFF' : '#666',
                      border: errorFilter === f ? '1px solid #1A1A1A' : '1px solid #E5E5E5'}}>{f}</button>
                ))}
              </div>

              <div style={{border:'1px solid #E5E5E5',borderRadius:12,overflow:'hidden'}}>
                {filteredRows.length === 0 && (
                  <p style={{padding:14,fontSize:12,color:'#888',textAlign:'center'}}>No rows in this filter</p>
                )}
                {filteredRows.map((row, idx) => (
                  <div key={idx} style={{padding:10,borderBottom: idx < filteredRows.length - 1 ? '1px solid #F5F5F5' : 'none',background: row.status === 'valid' ? '#FFF' : '#fef2f2'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                      {row.status === 'valid' ? <CheckCircle size={12} color="#16a34a" /> : <AlertCircle size={12} color="#dc2626" />}
                      <span style={{fontSize:12,fontWeight:700,color:'#1A1A1A'}}>
                        {row.first_name || row.data?.first_name} {row.last_name || row.data?.last_name}
                      </span>
                      <span style={{fontSize:10,color:'#888'}}>Row {row.row_number || idx + 1}</span>
                    </div>
                    {row.errors && row.errors.length > 0 && (
                      <ul style={{margin:0,paddingLeft:18}}>
                        {row.errors.map((err, i) => <li key={i} style={{fontSize:11,color:'#dc2626'}}>{err}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Step 3: Result */}
          {step === 3 && importResult && (
            <>
              <div style={{textAlign:'center',marginBottom:14}}>
                <div style={{width:60,height:60,borderRadius:30,background:'#dcfce7',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 12px'}}>
                  <CheckCircle size={30} color="#16a34a" />
                </div>
                <h3 style={{fontSize:18,fontWeight:800,color:'#1A1A1A'}}>Import Complete</h3>
              </div>
              <div style={{background:'#F8F8F8',padding:14,borderRadius:14}}>
                <Row label="Successfully imported" value={importResult.success} accent="#15803d" />
                <Row label="Failed" value={importResult.failed} accent={importResult.failed ? '#dc2626' : '#1A1A1A'} />
                {importResult.errors && importResult.errors.length > 0 && (
                  <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid #E5E5E5'}}>
                    <p style={{fontSize:12,fontWeight:700,color:'#1A1A1A',marginBottom:6}}>Errors:</p>
                    <ul style={{margin:0,paddingLeft:18}}>
                      {importResult.errors.slice(0, 20).map((err, i) => (
                        <li key={i} style={{fontSize:11,color:'#dc2626'}}>{typeof err === 'string' ? err : JSON.stringify(err)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div style={sheet.footer}>
          {step === 1 && (
            <>
              <button onClick={onClose} style={btn('outline')}>Cancel</button>
              <button onClick={doPreview} disabled={previewing} style={btn('dark')}>
                {previewing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Preview
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} style={btn('outline')}><ArrowLeft size={14} /> Back</button>
              <button onClick={doImport} disabled={importing || preview?.valid_rows === 0} style={btn('dark')}>
                {importing ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />} Import {preview?.valid_rows || 0}
              </button>
            </>
          )}
          {step === 3 && (
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

const Tile = ({ label, value, color }) => (
  <div style={{background:'#F8F8F8',padding:10,borderRadius:10,textAlign:'center'}}>
    <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888'}}>{label}</p>
    <p style={{fontSize:20,fontWeight:800,marginTop:2,color: color || '#1A1A1A'}}>{value || 0}</p>
  </div>
);

const Row = ({ label, value, accent }) => (
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'4px 0'}}>
    <span style={{fontSize:12,color:'#666'}}>{label}</span>
    <span style={{fontSize:14,fontWeight:800,color: accent || '#1A1A1A'}}>{value}</span>
  </div>
);

export default MobileStudentCsvImport;
