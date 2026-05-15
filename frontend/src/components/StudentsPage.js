import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import { getCached, setCached } from '../lib/pageCache';

const TopProgressBar = ({ active }) =>
  active ? (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px] overflow-hidden" style={{ background: '#fde8c8' }}>
      <div className="h-full w-2/5" style={{ background: '#E88A1A', animation: 'topbar-slide 1.4s ease-in-out infinite' }} />
    </div>
  ) : null;
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
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
import { Plus, Search, Upload, Eye, Edit, GraduationCap, Filter, FileUp, Download, CheckCircle, XCircle, ArrowRight, ArrowLeft, CreditCard, User, BookOpen, KeyRound, RefreshCw, Copy, EyeOff, Loader2, UserX, UserCheck, AlertCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const ONBOARDING_STEPS = [
  { id: 1, title: 'Student Details', icon: User },
  { id: 2, title: 'Class & Stream', icon: BookOpen },
  { id: 3, title: 'Documents', icon: FileUp },
  { id: 4, title: 'Fee Preview', icon: CreditCard },
  { id: 5, title: 'Confirm', icon: CheckCircle },
];

const REQUIRED_DOCUMENTS = [
  { type: 'birth_certificate', name: 'Birth Certificate', mandatory: true },
  { type: 'aadhaar_card', name: 'Aadhaar Card', mandatory: true },
  { type: 'passport_photo', name: 'Passport Photo', mandatory: true },
  { type: 'previous_marksheet', name: 'Previous Class Marksheet', mandatory: false },
  { type: 'transfer_certificate', name: 'Transfer Certificate (TC)', mandatory: false },
  { type: 'caste_certificate', name: 'Caste Certificate', mandatory: false },
  { type: 'medical_certificate', name: 'Medical Fitness Certificate', mandatory: false },
];

// Classes that require stream selection — must match backend CLASSES_WITH_STREAMS exactly
const STREAMS_FOR_CLASS = ['11th', '12th'];

const StudentsPage = () => {
  const { user, isAdmin, isAccountant } = useAuth();
  const [searchParams] = useSearchParams();
  const [students, setStudents] = useState([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const PAGE_SIZE = 50;
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const searchDebounce = useRef(null);
  const [filterClass, setFilterClass] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [filterStatus, setFilterStatus] = useState('active'); // active | inactive | all
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivateLoading, setDeactivateLoading] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // CSV Import wizard state
  const [csvStep, setCsvStep] = useState(1); // 1=configure, 2=preview, 3=result
  const [csvClass, setCsvClass] = useState('');
  const [csvSection, setCsvSection] = useState('');
  const [csvStream, setCsvStream] = useState('');
  const [csvFile, setCsvFile] = useState(null);
  const [csvPreview, setCsvPreview] = useState(null);   // response from /csv-preview
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportResult, setCsvImportResult] = useState(null);
  const [csvPreviewing, setCsvPreviewing] = useState(false);
  const [csvErrorFilter, setCsvErrorFilter] = useState('all'); // 'all'|'valid'|'invalid'
  const csvFileRef = useRef(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [editData, setEditData] = useState({});
  const [pwInput, setPwInput] = useState('');
  const [pwResult, setPwResult] = useState(null);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwVisible, setPwVisible] = useState(false);
  const [currentPw, setCurrentPw] = useState(null);
  const [currentPwVisible, setCurrentPwVisible] = useState(false);
  const [parentPw, setParentPw] = useState(null);
  const [parentPwVisible, setParentPwVisible] = useState(false);
  
  // Onboarding wizard state
  const [onbStep, setOnbStep] = useState(1);
  const [onbId, setOnbId] = useState(null);
  const [onbData, setOnbData] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    date_of_birth: '', gender: 'male', address: '',
    parent_name: '', parent_phone: '', parent_email: '',
    mother_name: '', mother_phone: '',
    is_sibling: false, sibling_student_id: '',
  });
  const [onbClassData, setOnbClassData] = useState({ class_name: '', section: '', stream: '' });
  const [onbFeeData, setOnbFeeData] = useState(null);
  const [onbDocuments, setOnbDocuments] = useState({}); // { doc_type: { file_name, file_url } }
  const [onbDocLoading, setOnbDocLoading] = useState({});
  const [onbResult, setOnbResult] = useState(null);
  const [onbLoading, setOnbLoading] = useState(false);
  const [onbErrors, setOnbErrors] = useState({});
  const [onbSkipDocs, setOnbSkipDocs] = useState(false);
  const [onbPayment, setOnbPayment] = useState({ method: 'cash', transaction_id: '', remarks: '' });
  const [onbPaymentLoading, setOnbPaymentLoading] = useState(false);

  const fetchStudents = useCallback(async (pg = page, search = searchTerm) => {
    const cacheKey = `students:${filterClass}:${filterSection}:${filterStatus}:${pg}:${search}`;
    const cached = getCached(cacheKey);

    if (cached) {
      setStudents(cached.students);
      setTotalStudents(cached.total);
      setTotalPages(cached.pages);
      setLoading(false);
    }
    // Always show top bar for any fetch — never blank the list
    setRefreshing(true);

    try {
      const params = { page: pg, limit: PAGE_SIZE };
      if (filterClass) params.class_name = filterClass;
      if (filterSection) params.section = filterSection;
      if (filterStatus) params.status = filterStatus;
      if (search.trim()) params.search = search.trim();
      const { data } = await api.get('/students', { params });
      const result = { students: data.students ?? data, total: data.total ?? data.length, pages: data.pages ?? 1 };
      setCached(cacheKey, result);
      setStudents(result.students);
      setTotalStudents(result.total);
      setTotalPages(result.pages);
    } catch { if (!cached) toast.error('Failed to fetch students'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [filterClass, filterSection, filterStatus]);

  useEffect(() => { setPage(1); fetchStudents(1, searchTerm); fetchClasses(); }, [filterClass, filterSection, filterStatus]);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchTerm(val);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => { setPage(1); fetchStudents(1, val); }, 400);
  };

  const handlePageChange = (newPage) => { setPage(newPage); fetchStudents(newPage, searchTerm); };

  const fetchClasses = async () => {
    try {
      const response = await api.get('/classes');
      setClasses(response.data);
    } catch {}
  };

  // ===== ONBOARDING WIZARD =====
  const resetOnboarding = () => {
    setOnbStep(1);
    setOnbId(null);
    setOnbData({
      first_name: '', last_name: '', email: '', phone: '',
      date_of_birth: '', gender: 'male', address: '',
      parent_name: '', parent_phone: '', parent_email: '',
      mother_name: '', mother_phone: '',
      is_sibling: false, sibling_student_id: '',
    });
    setOnbClassData({ class_name: '', section: '', stream: '' });
    setOnbFeeData(null);
    setOnbDocuments({});
    setOnbDocLoading({});
    setOnbResult(null);
    setOnbErrors({});
    setOnbSkipDocs(false);
    setOnbPayment({ method: 'cash', transaction_id: '', remarks: '' });
    setOnbPaymentLoading(false);
    setShowOnboarding(false);
  };

  const handleOnbStep1 = async () => {
    // Validate all required fields client-side
    const errors = {};
    if (!onbData.first_name?.trim()) errors.first_name = 'First Name is required';
    if (!onbData.last_name?.trim()) errors.last_name = 'Last Name is required';
    if (!onbData.gender) errors.gender = 'Gender is required';
    if (!onbData.date_of_birth) errors.date_of_birth = 'Date of Birth is required';
    if (!onbData.parent_name?.trim()) errors.parent_name = 'Father / Guardian Name is required';
    if (!onbData.parent_phone?.trim()) errors.parent_phone = 'Contact Number is required';
    if (!onbData.mother_name?.trim()) errors.mother_name = 'Mother Name is required';
    if (!onbData.mother_phone?.trim()) errors.mother_phone = 'Mother Contact Number is required';
    setOnbErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error('Please fill in all required fields');
      return;
    }
    setOnbLoading(true);
    try {
      const payload = { ...onbData };
      // Strip empty strings from optional fields — Pydantic EmailStr rejects ""
      ['email', 'parent_email', 'phone', 'date_of_birth', 'address', 'sibling_student_id'].forEach(k => {
        if (!payload[k]) delete payload[k];
      });
      const res = await api.post('/onboarding/start', payload);
      setOnbId(res.data.onboarding_id);
      setOnbErrors({});
      setOnbStep(2);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (detail?.validation_errors) {
        setOnbErrors(detail.validation_errors);
        toast.error('Please fix the highlighted fields');
      } else {
        toast.error(detail || 'Failed to start onboarding');
      }
    } finally { setOnbLoading(false); }
  };

  const handleOnbStep2 = async () => {
    if (!onbClassData.class_name || !onbClassData.section) {
      toast.error('Please select class and section');
      return;
    }
    const needsStream = STREAMS_FOR_CLASS.includes(onbClassData.class_name);
    if (needsStream && !onbClassData.stream) {
      toast.error('Please select a stream (Science or Humanities) for Class 11th / 12th');
      return;
    }
    setOnbLoading(true);
    try {
      const res = await api.put(`/onboarding/${onbId}/class`, {
        class_name: onbClassData.class_name,
        section: onbClassData.section,
        stream: onbClassData.stream || undefined,
      });
      setOnbFeeData(res.data);
      setOnbStep(3);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to set class');
    } finally { setOnbLoading(false); }
  };

  const handleOnbDocUpload = async (docType, docName, file) => {
    setOnbDocLoading(prev => ({ ...prev, [docType]: true }));
    try {
      // Step 1: upload the file to get a stored URL
      const fd = new FormData();
      fd.append('file', file);
      const uploadRes = await api.post('/upload', fd);
      const { file_url, file_name } = uploadRes.data;

      // Step 2: register the document against this onboarding application
      await api.post(`/onboarding/${onbId}/documents`, {
        document_type: docType,
        document_name: docName,
        file_url,
        file_name,
      });
      setOnbDocuments(prev => ({ ...prev, [docType]: { file_name, file_url, uploaded: true } }));
      toast.success(`${docName} uploaded`);
    } catch (err) {
      toast.error(err.response?.data?.detail || `Failed to upload ${docName}`);
    } finally {
      setOnbDocLoading(prev => ({ ...prev, [docType]: false }));
    }
  };

  const docFileInputRefs = useRef({});
  const triggerDocUpload = (docType) => {
    if (!docFileInputRefs.current[docType]) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.jpg,.jpeg,.png';
      input.onchange = (e) => {
        const file = e.target.files?.[0];
        if (file) {
          const doc = REQUIRED_DOCUMENTS.find(d => d.type === docType);
          handleOnbDocUpload(docType, doc?.name || docType, file);
        }
        input.value = '';
      };
      docFileInputRefs.current[docType] = input;
    }
    docFileInputRefs.current[docType].click();
  };

  const handleOnbComplete = async () => {
    setOnbLoading(true);
    try {
      // 1. Complete the onboarding → creates student + ledger entries
      const res = await api.post(`/onboarding/${onbId}/complete`, { admin_override: onbSkipDocs });
      const admissionResult = res.data;

      // 2. Record the admission fee payment immediately (if fee breakdown exists)
      let receiptNumber = null;
      if (admissionResult.admission_time_fee > 0 || onbFeeData?.fee_breakdown?.length > 0) {
        setOnbPaymentLoading(true);
        try {
          const payRes = await api.post('/fees/admission-payment', {
            student_id: admissionResult.student_id,
            payment_method: onbPayment.method,
            transaction_id: onbPayment.transaction_id || undefined,
            remarks: onbPayment.remarks || 'Collected at admission',
          });
          receiptNumber = payRes.data.receipt_number;
          toast.success(`Payment recorded — Receipt: ${receiptNumber}`);
        } catch (payErr) {
          // Non-fatal: admission succeeded but payment recording failed
          toast.error('Admission done, but payment recording failed. Record it from the Fees tab.');
        } finally { setOnbPaymentLoading(false); }
      }

      setOnbResult({ ...admissionResult, receipt_number: receiptNumber });
      setOnbStep(5);
      fetchStudents(page, searchTerm);
      toast.success(`Student admitted! Admission No: ${admissionResult.admission_number}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to complete admission');
    } finally { setOnbLoading(false); }
  };

  // ===== DEACTIVATE / REACTIVATE =====
  const handleDeactivateStudent = async () => {
    if (!deactivateTarget) return;
    setDeactivateLoading(true);
    try {
      await api.delete(`/students/${deactivateTarget.student_id}`);
      toast.success(`${deactivateTarget.first_name} ${deactivateTarget.last_name} deactivated`);
      setShowDeactivateDialog(false);
      setDeactivateTarget(null);
      fetchStudents(page, searchTerm);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to deactivate student');
    } finally { setDeactivateLoading(false); }
  };

  const handleReactivateStudent = async (student) => {
    try {
      await api.put(`/students/${student.student_id}/reactivate`);
      toast.success(`${student.first_name} ${student.last_name} reactivated`);
      fetchStudents(page, searchTerm);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to reactivate student');
    }
  };

  // ===== EDIT STUDENT =====
  const handleEditStudent = (student) => {
    setSelectedStudent(student);
    setEditData({
      phone: student.phone || '',
      email: student.email || '',
      address: student.address || '',
      parent_name: student.parent_name || '',
      parent_phone: student.parent_phone || '',
      parent_email: student.parent_email || '',
      class_name: student.class_name || '',
      section: student.section || '',
      stream: student.stream || '',
      roll_number: student.roll_number || '',
      blood_group: student.blood_group || '',
      emergency_contact: student.emergency_contact || '',
    });
    setShowEditDialog(true);
  };

  const handleResetPassword = async (generate = false) => {
    setPwLoading(true);
    try {
      const body = generate ? {} : { password: pwInput };
      const res = await api.post(`/students/${selectedStudent.student_id}/reset-password`, body);
      setPwResult(res.data);
      setCurrentPw(res.data.password);
      setCurrentPwVisible(true);
      setPwInput('');
      setPwVisible(true);
      toast.success('Password updated successfully');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to reset password');
    } finally {
      setPwLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    try {
      await api.put(`/students/${selectedStudent.student_id}`, editData);
      toast.success('Student updated successfully');
      setShowEditDialog(false);
      fetchStudents(page, searchTerm);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update student');
    }
  };

  // ===== CSV UPLOAD =====
  const handleCSVUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.name.endsWith('.csv')) { toast.error('Please upload a CSV file'); return; }
    setUploading(true);
    setUploadResult(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const response = await api.post('/students/upload-csv', fd);
      setUploadResult(response.data);
      if (response.data.success > 0) { toast.success(`Added ${response.data.success} students`); fetchStudents(page, searchTerm); }
      if (response.data.failed > 0) toast.warning(`${response.data.failed} failed`);
    } catch (err) { toast.error(err.response?.data?.detail || 'Upload failed'); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const downloadSampleCSV = () => {
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
    const sample = [
      'SHM/2025/TEST01,1,Ananya,,Sharma,female,2012-06-15,2025-04-01',
      '9876543210,ananya@email.com',
      'Rajesh Sharma,9876543211,Business',
      'Priya Sharma,9876543212,Homemaker',
      ',,,,,,',
      '123 MG Road,123 MG Road',
      '123456789012,LOC001',
      'ACC001,SBI,SBIN0001234',
      'General,Hindu,Sharma,No,Delhi Public School,Transfer student',
    ].join(',');
    const csvContent = `${headers}\n${sample}`;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob);
    a.download = 'students_import_template.csv';
    a.click();
  };

  const resetCsvWizard = () => {
    setCsvStep(1);
    setCsvClass('');
    setCsvSection('');
    setCsvStream('');
    setCsvFile(null);
    setCsvPreview(null);
    setCsvImportResult(null);
    setCsvErrorFilter('all');
    if (csvFileRef.current) csvFileRef.current.value = '';
  };

  const handleCsvPreview = async () => {
    if (!csvClass || !csvSection) { toast.error('Please select class and section'); return; }
    const needsStream = STREAMS_FOR_CLASS.includes(csvClass);
    if (needsStream && !csvStream) { toast.error('Please select a stream for Class 11th/12th'); return; }
    if (!csvFile) { toast.error('Please select a CSV file'); return; }
    setCsvPreviewing(true);
    try {
      const fd = new FormData();
      fd.append('file', csvFile);
      fd.append('class_name', csvClass);
      fd.append('section', csvSection);
      if (csvStream) fd.append('stream', csvStream);
      const res = await api.post('/students/csv-preview', fd);
      setCsvPreview(res.data);
      setCsvStep(2);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to parse CSV');
    } finally {
      setCsvPreviewing(false);
    }
  };

  const handleCsvImport = async () => {
    if (!csvPreview) return;
    const validRows = csvPreview.rows.filter(r => r.status === 'valid');
    if (validRows.length === 0) { toast.error('No valid rows to import'); return; }
    setCsvImporting(true);
    try {
      const res = await api.post('/students/csv-import', {
        class_name: csvPreview.class_name,
        section:    csvPreview.section,
        stream:     csvPreview.stream,
        rows:       csvPreview.rows,
      });
      setCsvImportResult(res.data);
      setCsvStep(3);
      if (res.data.success > 0) { fetchStudents(page, searchTerm); toast.success(`${res.data.success} students imported`); }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Import failed');
    } finally {
      setCsvImporting(false);
    }
  };

  // Server handles filtering/search — students is already the current page
  const filteredStudents = students;

  const getStatusBadge = (status) => {
    const map = {
      paid: <Badge className="bg-slate-100 text-slate-900 border border-slate-200">Paid</Badge>,
      overdue: <Badge variant="destructive">Overdue</Badge>,
      partial: <Badge className="bg-slate-100 text-slate-500 border border-slate-200">Partial</Badge>,
    };
    return map[status] || <Badge className="bg-amber-50 text-amber-700 border border-amber-200">Pending</Badge>;
  };

  const getSections = (className) => {
    const cls = classes.find(c => c.name === className);
    return cls?.sections || [];
  };

  return (
    <div data-testid="students-page">
      <TopProgressBar active={refreshing} />
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Students</h1>
          <p className="text-muted-foreground">Manage student admissions and records</p>
        </div>
        {(isAdmin || isAccountant) && (
          <div className="flex gap-2 flex-wrap">
            {/* ── CSV Import Wizard (admin only) ───────────────────────────── */}
            {isAdmin && (
            <Dialog open={showUploadDialog} onOpenChange={(open) => { setShowUploadDialog(open); if (!open) resetCsvWizard(); }}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="bulk-upload-btn"><Upload className="h-4 w-4 mr-2" />Bulk Import</Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">

                {/* ── Step indicator ─────────────────────────────────────── */}
                <DialogHeader>
                  <DialogTitle>Bulk Import Students</DialogTitle>
                  <DialogDescription>
                    <span className="flex items-center gap-2 mt-1">
                      {['Configure', 'Preview & Validate', 'Import Result'].map((label, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${csvStep === i + 1 ? 'bg-slate-900 text-white' : csvStep > i + 1 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                          <span className={`text-xs ${csvStep === i + 1 ? 'text-slate-900 font-medium' : 'text-slate-500'}`}>{label}</span>
                          {i < 2 && <span className="text-slate-200 mx-1">›</span>}
                        </span>
                      ))}
                    </span>
                  </DialogDescription>
                </DialogHeader>

                {/* ── STEP 1: Configure ──────────────────────────────────── */}
                {csvStep === 1 && (
                  <div className="space-y-5 py-2">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <Label>Class <span className="text-red-500">*</span></Label>
                        <Select value={csvClass} onValueChange={v => { setCsvClass(v); setCsvSection(''); setCsvStream(''); }}>
                          <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                          <SelectContent>{classes.map(c => <SelectItem key={c.class_id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Section <span className="text-red-500">*</span></Label>
                        <Select value={csvSection} onValueChange={setCsvSection} disabled={!csvClass}>
                          <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                          <SelectContent>
                            {getSections(csvClass).map(s => <SelectItem key={s.section_name} value={s.section_name}>{s.section_name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      {STREAMS_FOR_CLASS.includes(csvClass) && (
                        <div className="space-y-1.5">
                          <Label>Stream <span className="text-red-500">*</span></Label>
                          <Select value={csvStream} onValueChange={setCsvStream}>
                            <SelectTrigger><SelectValue placeholder="Select stream" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="science">Science</SelectItem>
                              <SelectItem value="humanities">Humanities</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label>CSV File <span className="text-red-500">*</span></Label>
                      <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center">
                        <FileUp className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                        <input type="file" accept=".csv" ref={csvFileRef} className="hidden"
                          onChange={e => setCsvFile(e.target.files?.[0] || null)} />
                        {csvFile
                          ? <p className="text-sm font-medium text-slate-900">{csvFile.name} <button onClick={() => { setCsvFile(null); csvFileRef.current.value=''; }} className="text-slate-500 ml-2 text-xs">✕ Remove</button></p>
                          : <Button variant="outline" className="text-xs" onClick={() => csvFileRef.current?.click()}>Choose CSV File</Button>}
                      </div>
                    </div>

                    {/* Column reference */}
                    <div className="bg-slate-50 rounded-xl p-4 text-xs text-slate-600 space-y-1">
                      <p className="font-semibold text-slate-900 mb-2">Supported CSV Columns</p>
                      <div className="grid grid-cols-2 gap-x-8 gap-y-0.5">
                        <span><span className="font-medium text-slate-900">Required:</span> first_name, gender</span>
                        <span><span className="font-medium">Parent:</span> father_name or guardian_name</span>
                        <span><span className="font-medium">Core:</span> last_name, middlename, date_of_birth</span>
                        <span><span className="font-medium">Contact:</span> mobile_no, email</span>
                        <span><span className="font-medium">Family:</span> father_phone, mother_name, mother_phone</span>
                        <span><span className="font-medium">Optional:</span> admission_no, roll_no (auto if blank)</span>
                        <span><span className="font-medium">Address:</span> current_address, permanent_address</span>
                        <span><span className="font-medium">Other:</span> category, religion, caste, rte, note</span>
                        <span><span className="font-medium">Identity:</span> national_identification_no</span>
                        <span><span className="font-medium">Bank:</span> bank_account_no, bank_name, ifsc_code</span>
                      </div>
                    </div>

                    <DialogFooter className="gap-2">
                      <Button variant="ghost" className="text-xs" onClick={downloadSampleCSV}><Download className="h-3.5 w-3.5 mr-1.5" />Download Template</Button>
                      <Button onClick={handleCsvPreview} disabled={csvPreviewing || !csvClass || !csvSection || !csvFile} className="bg-slate-900 text-white hover:bg-slate-800">
                        {csvPreviewing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Validating...</> : <>Validate CSV <ArrowRight className="h-4 w-4 ml-2" /></>}
                      </Button>
                    </DialogFooter>
                  </div>
                )}

                {/* ── STEP 2: Preview & Validate ─────────────────────────── */}
                {csvStep === 2 && csvPreview && (
                  <div className="space-y-4 py-2">
                    {/* Summary bar */}
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: 'Total Rows',  value: csvPreview.total,   color: 'text-slate-900' },
                        { label: 'Valid',        value: csvPreview.valid,   color: 'text-emerald-600' },
                        { label: 'Invalid',      value: csvPreview.invalid, color: 'text-red-500' },
                        { label: 'Target',       value: `${csvPreview.class_name} › ${csvPreview.section}${csvPreview.stream ? ' › '+csvPreview.stream : ''}`, color: 'text-slate-900' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-slate-50 rounded-xl p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">{label}</p>
                          <p className={`text-xl font-bold ${color}`}>{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Filter tabs */}
                    <div className="flex gap-2">
                      {[['all', 'All'], ['valid', 'Valid Only'], ['invalid', 'Errors Only']].map(([val, label]) => (
                        <button key={val} onClick={() => setCsvErrorFilter(val)}
                          className={`px-3 py-1 rounded-xl text-xs font-medium border transition-colors ${csvErrorFilter === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-900'}`}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Row preview table */}
                    <div className="border border-slate-200 rounded-2xl overflow-auto max-h-80">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Row</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Name</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Gender</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">DOB</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Father / Guardian</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Phone</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Adm No</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Roll No</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvPreview.rows
                            .filter(r => csvErrorFilter === 'all' || (csvErrorFilter === 'valid' ? r.status === 'valid' : r.status === 'invalid'))
                            .map(r => (
                              <tr key={r.row_number} className={`border-t border-slate-100 ${r.status === 'invalid' ? 'bg-red-50' : 'hover:bg-slate-50'}`}>
                                <td className="px-3 py-2 font-mono text-slate-500">{r.row_number}</td>
                                <td className="px-3 py-2 font-medium text-slate-900">{r.preview?.name || '—'}</td>
                                <td className="px-3 py-2 text-slate-600 capitalize">{r.preview?.gender || '—'}</td>
                                <td className="px-3 py-2 text-slate-600">{r.preview?.dob || '—'}</td>
                                <td className="px-3 py-2 text-slate-600">{r.preview?.father || '—'}</td>
                                <td className="px-3 py-2 text-slate-600">{r.preview?.phone || '—'}</td>
                                <td className="px-3 py-2 font-mono text-slate-600">{r.preview?.adm_no || '—'}</td>
                                <td className="px-3 py-2 font-mono text-slate-600">{r.preview?.roll_no || '—'}</td>
                                <td className="px-3 py-2">
                                  {r.status === 'valid'
                                    ? <span className="inline-flex items-center gap-1 text-emerald-600 font-medium"><CheckCircle className="h-3 w-3" />Valid</span>
                                    : (
                                      <div>
                                        <span className="inline-flex items-center gap-1 text-red-500 font-medium"><XCircle className="h-3 w-3" />Invalid</span>
                                        <ul className="mt-1 space-y-0.5">
                                          {r.errors.map((e, i) => <li key={i} className="text-red-400">• {e}</li>)}
                                        </ul>
                                      </div>
                                    )}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>

                    {csvPreview.invalid > 0 && (
                      <p className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        <span className="font-semibold text-amber-700">{csvPreview.invalid} invalid rows will be skipped.</span> Only the {csvPreview.valid} valid rows will be imported.
                      </p>
                    )}

                    <DialogFooter className="gap-2">
                      <Button variant="outline" onClick={() => setCsvStep(1)}><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
                      <Button onClick={handleCsvImport} disabled={csvImporting || csvPreview.valid === 0} className="bg-slate-900 text-white hover:bg-slate-800">
                        {csvImporting
                          ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing...</>
                          : <>Import {csvPreview.valid} Student{csvPreview.valid !== 1 ? 's' : ''}</>}
                      </Button>
                    </DialogFooter>
                  </div>
                )}

                {/* ── STEP 3: Import Result ──────────────────────────────── */}
                {csvStep === 3 && csvImportResult && (
                  <div className="space-y-4 py-2">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
                        <CheckCircle className="h-6 w-6 text-emerald-600 mx-auto mb-1" />
                        <p className="text-2xl font-bold text-emerald-700">{csvImportResult.success}</p>
                        <p className="text-xs text-emerald-600 font-medium">Imported</p>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
                        <p className="text-2xl font-bold text-slate-500">{csvImportResult.skipped || 0}</p>
                        <p className="text-xs text-slate-500 font-medium">Skipped (invalid)</p>
                      </div>
                      <div className={`${csvImportResult.failed > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'} border rounded-2xl p-4 text-center`}>
                        <p className={`text-2xl font-bold ${csvImportResult.failed > 0 ? 'text-red-600' : 'text-slate-500'}`}>{csvImportResult.failed}</p>
                        <p className={`text-xs font-medium ${csvImportResult.failed > 0 ? 'text-red-500' : 'text-slate-500'}`}>Failed at Insert</p>
                      </div>
                    </div>

                    {csvImportResult.admission_numbers?.length > 0 && (
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-xs font-semibold text-slate-900 mb-2">Generated Admission Numbers</p>
                        <div className="flex flex-wrap gap-1.5">
                          {csvImportResult.admission_numbers.map(no => (
                            <span key={no} className="font-mono text-[10px] bg-white border border-slate-200 px-2 py-0.5 rounded">{no}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {csvImportResult.errors?.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                        <p className="text-xs font-semibold text-red-700 mb-2">Insert Errors</p>
                        {csvImportResult.errors.map((e, i) => (
                          <p key={i} className="text-xs text-red-500">Row {e.row}: {e.error}</p>
                        ))}
                      </div>
                    )}

                    <DialogFooter>
                      <Button className="bg-slate-900 text-white hover:bg-slate-800" onClick={() => { setShowUploadDialog(false); resetCsvWizard(); }}>Done</Button>
                    </DialogFooter>
                  </div>
                )}

              </DialogContent>
            </Dialog>
            )}
            {/* ── End CSV Import Wizard ──────────────────────────────────── */}

            <Button data-testid="onboard-student-btn" onClick={() => { resetOnboarding(); setShowOnboarding(true); }}>
              <Plus className="h-4 w-4 mr-2" />New Admission
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by name or admission number..." className="pl-10" value={searchTerm} onChange={handleSearchChange} data-testid="search-students" />
            </div>
            <Select value={filterClass || "all"} onValueChange={(v) => { setFilterClass(v === "all" ? "" : v); setFilterSection(''); }}>
              <SelectTrigger className="w-[150px]" data-testid="filter-class"><Filter className="h-4 w-4 mr-2" /><SelectValue placeholder="All Classes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {classes.map((cls) => <SelectItem key={cls.name} value={cls.name}>Class {cls.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterSection || "all"} onValueChange={(v) => setFilterSection(v === "all" ? "" : v)} disabled={!filterClass}>
              <SelectTrigger className="w-[150px]" data-testid="filter-section"><SelectValue placeholder="All Sections" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sections</SelectItem>
                {getSections(filterClass).map((sec) => <SelectItem key={sec.section_name} value={sec.section_name}>Section {sec.section_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]" data-testid="filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active Only</SelectItem>
                <SelectItem value="inactive">Inactive Only</SelectItem>
                <SelectItem value="all">All Students</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Students Table */}
      <Card>
        <CardContent className="p-0">
          {loading && filteredStudents.length === 0 ? (
            <div className="divide-y divide-slate-100">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 w-40 bg-slate-200 rounded animate-pulse" />
                    <div className="h-3 w-32 bg-slate-200 rounded animate-pulse" />
                  </div>
                  <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
                  <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
                  <div className="h-5 w-16 bg-slate-200 rounded-full animate-pulse" />
                  <div className="h-5 w-14 bg-slate-200 rounded-full animate-pulse" />
                  <div className="h-8 w-20 bg-slate-200 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <GraduationCap className="h-12 w-12 mb-4" /><p>No students found</p>
              {(isAdmin || isAccountant) && <Button variant="link" onClick={() => { resetOnboarding(); setShowOnboarding(true); }}>Start new admission</Button>}
            </div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Admission No.</TableHead><TableHead>Name</TableHead><TableHead>Class</TableHead><TableHead>Academic Year</TableHead><TableHead>Parent</TableHead><TableHead>Fee Status</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredStudents.map((student) => (
                  <TableRow key={student.student_id} data-testid={`student-row-${student.student_id}`} className={!student.is_active ? 'opacity-60 bg-slate-50' : ''}>
                    <TableCell className="font-mono text-sm">{student.admission_number}</TableCell>
                    <TableCell>
                      <p className="font-medium text-foreground">{student.first_name} {student.last_name}</p>
                      <p className="text-sm text-muted-foreground">{student.email || ''}</p>
                    </TableCell>
                    <TableCell>Class {student.class_name} - {student.section}</TableCell>
                    <TableCell className="text-sm text-slate-600">{student.academic_year || '—'}</TableCell>
                    <TableCell>
                      <p className="text-sm text-foreground">{student.parent_name || '-'}</p>
                      <p className="text-xs text-muted-foreground">{student.parent_phone || ''}</p>
                    </TableCell>
                    <TableCell>{getStatusBadge(student.fee_status)}</TableCell>
                    <TableCell>
                      {student.is_active
                        ? <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200">Active</Badge>
                        : <Badge className="bg-red-50 text-red-700 border border-red-200">Inactive</Badge>
                      }
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={async () => { setSelectedStudent(student); setPwResult(null); setPwInput(''); setPwVisible(false); setCurrentPw(null); setCurrentPwVisible(false); setParentPw(null); setParentPwVisible(false); setShowViewDialog(true); try { const [r1, r2] = await Promise.allSettled([api.get(`/students/${student.student_id}/password`), api.get(`/students/${student.student_id}/parent-password`)]); if (r1.status === 'fulfilled') setCurrentPw(r1.value.data.password); if (r2.status === 'fulfilled') setParentPw(r2.value.data.password); } catch {} }} data-testid={`view-${student.student_id}`}><Eye className="h-4 w-4" /></Button>
                      {isAdmin && student.is_active && <Button variant="ghost" size="sm" onClick={() => handleEditStudent(student)} data-testid={`edit-${student.student_id}`}><Edit className="h-4 w-4" /></Button>}
                      {isAdmin && student.is_active && (
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => { setDeactivateTarget(student); setShowDeactivateDialog(true); }} data-testid={`deactivate-${student.student_id}`} title="Deactivate Student"><UserX className="h-4 w-4" /></Button>
                      )}
                      {isAdmin && !student.is_active && (
                        <Button variant="ghost" size="sm" className="text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50" onClick={() => handleReactivateStudent(student)} data-testid={`reactivate-${student.student_id}`} title="Reactivate Student"><UserCheck className="h-4 w-4" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
          <span>{totalStudents} students — page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handlePageChange(page - 1)} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => handlePageChange(page + 1)} disabled={page === totalPages}>Next</Button>
          </div>
        </div>
      )}

      {/* ===== DEACTIVATION CONFIRMATION ===== */}
      <Dialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              Deactivate Student
            </DialogTitle>
            <DialogDescription>
              This will deactivate <strong>{deactivateTarget?.first_name} {deactivateTarget?.last_name}</strong>.
              The student will lose access to the app but all records (fees, attendance, marks) will be preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              <ul className="list-disc list-inside space-y-1">
                <li>Student will be excluded from active attendance lists</li>
                <li>Student cannot log in or access the app</li>
                <li>Past fees, attendance and marks are preserved</li>
                <li>You can reactivate the student at any time</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDeactivateDialog(false); setDeactivateTarget(null); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeactivateStudent} disabled={deactivateLoading}>
              {deactivateLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserX className="h-4 w-4 mr-2" />}
              Deactivate Student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== ONBOARDING WIZARD ===== */}
      <Dialog open={showOnboarding} onOpenChange={(v) => { if (!v) resetOnboarding(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Student Admission</DialogTitle>
            <DialogDescription>Complete all steps to onboard a new student</DialogDescription>
          </DialogHeader>
          {/* Step Indicator */}
          <div className="flex items-center gap-2 mb-4">
            {ONBOARDING_STEPS.map((step, idx) => (
              <React.Fragment key={step.id}>
                <div className={`flex items-center gap-1.5 text-xs font-medium ${onbStep >= step.id ? 'text-slate-900' : 'text-slate-500'}`}>
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs ${onbStep > step.id ? 'bg-slate-900 text-white' : onbStep === step.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {onbStep > step.id ? <CheckCircle className="h-4 w-4" /> : step.id}
                  </div>
                  <span className="hidden sm:inline">{step.title}</span>
                </div>
                {idx < ONBOARDING_STEPS.length - 1 && <div className={`flex-1 h-0.5 ${onbStep > step.id ? 'bg-slate-900' : 'bg-slate-200'}`} />}
              </React.Fragment>
            ))}
          </div>

          {/* Step 1: Student Details */}
          {onbStep === 1 && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>First Name <span className="text-red-500">*</span></Label>
                  <Input value={onbData.first_name} onChange={(e) => { setOnbData({...onbData, first_name: e.target.value}); setOnbErrors(p => ({...p, first_name: ''})); }} className={onbErrors.first_name ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-first-name" />
                  {onbErrors.first_name && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.first_name}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Last Name <span className="text-red-500">*</span></Label>
                  <Input value={onbData.last_name} onChange={(e) => { setOnbData({...onbData, last_name: e.target.value}); setOnbErrors(p => ({...p, last_name: ''})); }} className={onbErrors.last_name ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-last-name" />
                  {onbErrors.last_name && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.last_name}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Gender <span className="text-red-500">*</span></Label>
                  <Select value={onbData.gender} onValueChange={(v) => { setOnbData({...onbData, gender: v}); setOnbErrors(p => ({...p, gender: ''})); }}>
                    <SelectTrigger className={onbErrors.gender ? 'border-red-500' : ''} data-testid="onb-gender"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
                  </Select>
                  {onbErrors.gender && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.gender}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Date of Birth <span className="text-red-500">*</span></Label>
                  <Input type="date" value={onbData.date_of_birth} onChange={(e) => { setOnbData({...onbData, date_of_birth: e.target.value}); setOnbErrors(p => ({...p, date_of_birth: ''})); }} className={onbErrors.date_of_birth ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-dob" />
                  {onbData.date_of_birth && (() => {
                    const dob = new Date(onbData.date_of_birth);
                    const today = new Date();
                    let years = today.getFullYear() - dob.getFullYear();
                    let months = today.getMonth() - dob.getMonth();
                    let days = today.getDate() - dob.getDate();
                    if (days < 0) { months--; days += new Date(today.getFullYear(), today.getMonth(), 0).getDate(); }
                    if (months < 0) { years--; months += 12; }
                    const isValid = dob <= today && dob.getFullYear() >= 1900;
                    if (!isValid) return null;
                    const label = years > 0
                      ? `${years} yr${years !== 1 ? 's' : ''}${months > 0 ? ` ${months} mo` : ''}`
                      : months > 0 ? `${months} mo ${days} days` : `${days} days`;
                    return (
                      <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-1">
                        <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full font-medium">
                          Age: {label}
                        </span>
                      </p>
                    );
                  })()}
                  {onbErrors.date_of_birth && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.date_of_birth}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><Label>Email</Label><Input type="email" value={onbData.email} onChange={(e) => setOnbData({...onbData, email: e.target.value})} data-testid="onb-email" /></div>
                <div className="space-y-1"><Label>Phone</Label><Input value={onbData.phone} onChange={(e) => setOnbData({...onbData, phone: e.target.value})} data-testid="onb-phone" /></div>
              </div>
              <div className="space-y-1"><Label>Address</Label><Input value={onbData.address} onChange={(e) => setOnbData({...onbData, address: e.target.value})} data-testid="onb-address" /></div>
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3 text-foreground">Parent / Guardian Details</h4>
                <div className="grid gap-4">
                  <div className="space-y-1">
                    <Label>Father / Guardian Name <span className="text-red-500">*</span></Label>
                    <Input value={onbData.parent_name} onChange={(e) => { setOnbData({...onbData, parent_name: e.target.value}); setOnbErrors(p => ({...p, parent_name: ''})); }} className={onbErrors.parent_name ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-parent-name" />
                    {onbErrors.parent_name && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.parent_name}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label>Contact Number <span className="text-red-500">*</span></Label>
                      <Input value={onbData.parent_phone} onChange={(e) => { setOnbData({...onbData, parent_phone: e.target.value}); setOnbErrors(p => ({...p, parent_phone: ''})); }} className={onbErrors.parent_phone ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-parent-phone" />
                      {onbErrors.parent_phone && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.parent_phone}</p>}
                    </div>
                    <div className="space-y-1"><Label>Parent Email</Label><Input type="email" value={onbData.parent_email} onChange={(e) => setOnbData({...onbData, parent_email: e.target.value})} data-testid="onb-parent-email" /></div>
                  </div>
                </div>
              </div>
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3 text-foreground">Mother Details</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Mother Name <span className="text-red-500">*</span></Label>
                    <Input value={onbData.mother_name} onChange={(e) => { setOnbData({...onbData, mother_name: e.target.value}); setOnbErrors(p => ({...p, mother_name: ''})); }} className={onbErrors.mother_name ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-mother-name" />
                    {onbErrors.mother_name && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.mother_name}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label>Mother Contact Number <span className="text-red-500">*</span></Label>
                    <Input value={onbData.mother_phone} onChange={(e) => { setOnbData({...onbData, mother_phone: e.target.value}); setOnbErrors(p => ({...p, mother_phone: ''})); }} className={onbErrors.mother_phone ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-mother-phone" />
                    {onbErrors.mother_phone && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.mother_phone}</p>}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={resetOnboarding}>Cancel</Button>
                <Button onClick={handleOnbStep1} disabled={onbLoading} data-testid="onb-next-1">Next <ArrowRight className="h-4 w-4 ml-1" /></Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 2: Class, Section & Stream */}
          {onbStep === 2 && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Class *</Label>
                  <Select value={onbClassData.class_name} onValueChange={(v) => setOnbClassData({...onbClassData, class_name: v, section: '', stream: ''})}>
                    <SelectTrigger data-testid="onb-class"><SelectValue placeholder="Select class" /></SelectTrigger>
                    <SelectContent>{classes.map(c => <SelectItem key={c.name} value={c.name}>{c.display_name || `Class ${c.name}`}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Section *</Label>
                  <Select value={onbClassData.section} onValueChange={(v) => setOnbClassData({...onbClassData, section: v})} disabled={!onbClassData.class_name}>
                    <SelectTrigger data-testid="onb-section"><SelectValue placeholder="Select section" /></SelectTrigger>
                    <SelectContent>
                      {getSections(onbClassData.class_name).map(s => (
                        <SelectItem key={s.section_name} value={s.section_name}>
                          Section {s.section_name} ({s.student_count || 0}/{s.capacity})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* Stream — only for Class 11th and 12th */}
              {STREAMS_FOR_CLASS.includes(onbClassData.class_name) && (
                <div className="space-y-2">
                  <Label>Stream *</Label>
                  <Select value={onbClassData.stream} onValueChange={(v) => setOnbClassData({...onbClassData, stream: v})}>
                    <SelectTrigger data-testid="onb-stream"><SelectValue placeholder="Select stream" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="science">Science</SelectItem>
                      <SelectItem value="humanities">Humanities</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* Sibling */}
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-200">
                <input
                  type="checkbox"
                  id="is_sibling"
                  checked={onbData.is_sibling}
                  onChange={e => setOnbData({...onbData, is_sibling: e.target.checked})}
                  className="rounded"
                />
                <div>
                  <label htmlFor="is_sibling" className="text-sm font-medium text-blue-900 cursor-pointer">
                    This student has a sibling already enrolled
                  </label>
                  <p className="text-xs text-blue-700 mt-0.5">Sibling discount applied to Admission Fee & Monthly Tuition</p>
                </div>
              </div>
              {onbData.is_sibling && (
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider">Sibling Student ID (optional)</Label>
                  <Input
                    placeholder="STU202501XXXX — leave blank to auto-detect by parent email"
                    value={onbData.sibling_student_id}
                    onChange={e => setOnbData({...onbData, sibling_student_id: e.target.value})}
                  />
                </div>
              )}
              {/* Seat availability */}
              {onbClassData.class_name && onbClassData.section && (() => {
                const sec = getSections(onbClassData.class_name).find(s => s.section_name === onbClassData.section);
                if (!sec) return null;
                const pct = sec.capacity > 0 ? ((sec.student_count || 0) / sec.capacity) * 100 : 0;
                return (
                  <Card className="bg-muted/50">
                    <CardContent className="p-4">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm font-medium">Seat Availability</span>
                        <span className="text-sm text-muted-foreground">{sec.student_count || 0} / {sec.capacity}</span>
                      </div>
                      <Progress value={pct} className="h-2" />
                      {pct >= 100 && <p className="text-xs text-amber-600 mt-1">This section is full!</p>}
                    </CardContent>
                  </Card>
                );
              })()}
              <DialogFooter>
                <Button variant="outline" onClick={() => setOnbStep(1)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
                <Button onClick={handleOnbStep2} disabled={onbLoading} data-testid="onb-next-2">
                  {onbLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                  Next <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 3: Documents */}
          {onbStep === 3 && (
            <div className="grid gap-4">
              {onbSkipDocs ? (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Documents skipped</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      You can upload them later from the student's edit panel. Admission will proceed with admin override.
                    </p>
                    <button className="text-xs text-amber-700 underline mt-1" onClick={() => setOnbSkipDocs(false)}>
                      Upload documents now instead
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Upload admission documents. Mandatory documents are required — or skip all now and upload later via the student edit panel.
                </p>
              )}
              <div className="space-y-3">
                {REQUIRED_DOCUMENTS.map(doc => {
                  const uploaded = onbDocuments[doc.type];
                  const loading = onbDocLoading[doc.type];
                  return (
                    <div
                      key={doc.type}
                      className={`flex items-center justify-between p-3 rounded-xl border ${
                        uploaded ? 'bg-green-50 border-green-200' : doc.mandatory ? 'bg-slate-50 border-slate-200' : 'bg-slate-50 border-slate-100'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {uploaded ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <div className={`h-4 w-4 rounded-full border-2 ${doc.mandatory ? 'border-slate-900' : 'border-gray-300'}`} />
                        )}
                        <div>
                          <span className="text-sm font-medium">{doc.name}</span>
                          {doc.mandatory && <span className="ml-1 text-[10px] text-red-500 font-bold uppercase">Required</span>}
                          {uploaded && (
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-green-600">✓ {uploaded.file_name}</span>
                              {uploaded.file_url && (
                                <a href={uploaded.file_url} target="_blank" rel="noreferrer" className="text-xs text-slate-600 underline">View</a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <Button
                        variant={uploaded ? "outline" : "default"}
                        size="sm"
                        className={`text-xs h-7 ${!uploaded ? 'bg-slate-900 hover:bg-slate-800 text-white' : ''}`}
                        disabled={loading}
                        onClick={() => triggerDocUpload(doc.type)}
                      >
                        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : uploaded ? <RefreshCw className="h-3 w-3 mr-1" /> : <FileUp className="h-3 w-3 mr-1" />}
                        {uploaded ? 'Replace' : 'Upload'}
                      </Button>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500">
                Accepted formats: PDF, JPG, PNG · Max size: 5 MB per file
              </p>
              <DialogFooter className="flex-wrap gap-2">
                <Button variant="outline" onClick={() => setOnbStep(2)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
                {!onbSkipDocs && (
                  <Button
                    variant="outline"
                    className="text-amber-700 border-amber-300 hover:bg-amber-50"
                    onClick={() => { setOnbSkipDocs(true); setOnbStep(4); }}
                  >
                    Skip Documents for Now <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
                <Button onClick={() => setOnbStep(4)} data-testid="onb-next-3">
                  Continue to Payment <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 4: Fee Preview */}
          {onbStep === 4 && onbFeeData && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">Student</p>
                  <p className="font-semibold">{onbFeeData.first_name} {onbFeeData.last_name}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">Class</p>
                  <p className="font-semibold">
                    {onbFeeData.class_name}-{onbFeeData.section}
                    {onbFeeData.stream && ` (${onbFeeData.stream})`}
                  </p>
                </div>
              </div>

              {/* Fee breakdown table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Admission Time Fee Breakdown
                </div>
                {onbFeeData.fee_breakdown?.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">Description</th>
                        <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">Gross</th>
                        <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">Discount</th>
                        <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {onbFeeData.fee_breakdown.map((fee, idx) => (
                        <tr key={idx} className="border-b border-slate-50">
                          <td className="px-3 py-2">
                            {fee.label}
                            {fee.sibling_discount_amount > 0 && (
                              <span className="ml-1 text-[10px] text-blue-600 font-semibold">
                                (Sibling -₹{fee.sibling_discount_amount.toLocaleString()})
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">₹{(fee.gross_amount||0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right text-green-600">
                            {fee.discount_amount > 0 ? `-₹${fee.discount_amount.toLocaleString()}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">₹{(fee.net_amount||0).toLocaleString()}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-bold">
                        <td className="px-3 py-2" colSpan={3}>Total Due at Admission</td>
                        <td className="px-3 py-2 text-right text-slate-900 text-lg">
                          ₹{(onbFeeData.admission_time_fee||0).toLocaleString()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <p className="px-3 py-4 text-sm text-slate-500">
                    No fee configuration found for this class/year. You can still complete admission — fees can be added later.
                  </p>
                )}
              </div>

              {onbFeeData.total_annual_fee > 0 && (
                <div className="text-xs text-slate-500 text-right">
                  Total annual obligation: ₹{(onbFeeData.total_annual_fee||0).toLocaleString()}
                  {' '}(one-time + yearly + 12 months tuition)
                </div>
              )}

              {/* Payment collection — required before admission completes */}
              {onbFeeData.fee_breakdown?.length > 0 && (
                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="px-3 py-2 bg-slate-900 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    <CreditCard className="h-3.5 w-3.5" />
                    Collect Admission Payment — ₹{(onbFeeData.admission_time_fee||0).toLocaleString()}
                  </div>
                  <div className="p-4 space-y-3">
                    <div>
                      <Label className="text-xs font-bold uppercase tracking-wider">Payment Method *</Label>
                      <Select value={onbPayment.method} onValueChange={v => setOnbPayment(p => ({ ...p, method: v }))}>
                        <SelectTrigger className="mt-1 h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="cheque">Cheque</SelectItem>
                          <SelectItem value="bank_transfer">Bank Transfer / NEFT</SelectItem>
                          <SelectItem value="online">Online / UPI</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {onbPayment.method !== 'cash' && (
                      <div>
                        <Label className="text-xs font-bold uppercase tracking-wider">
                          {onbPayment.method === 'cheque' ? 'Cheque Number' : 'Transaction / UTR Number'}
                        </Label>
                        <Input
                          className="mt-1 h-9 text-sm font-mono"
                          placeholder={onbPayment.method === 'cheque' ? 'e.g. 123456' : 'e.g. UTR / Ref No.'}
                          value={onbPayment.transaction_id}
                          onChange={e => setOnbPayment(p => ({ ...p, transaction_id: e.target.value }))}
                        />
                      </div>
                    )}
                    <div>
                      <Label className="text-xs font-bold uppercase tracking-wider">Remarks (optional)</Label>
                      <Input
                        className="mt-1 h-9 text-sm"
                        placeholder="e.g. Received from father"
                        value={onbPayment.remarks}
                        onChange={e => setOnbPayment(p => ({ ...p, remarks: e.target.value }))}
                      />
                    </div>
                    <p className="text-xs text-slate-500 bg-slate-50 px-3 py-2 rounded-lg">
                      A receipt will be generated automatically after admission is confirmed.
                    </p>
                  </div>
                </div>
              )}

              {onbSkipDocs && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Documents skipped — admin override will be applied. Upload them later from the student edit panel.
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setOnbStep(3)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
                <Button
                  onClick={handleOnbComplete}
                  disabled={onbLoading || onbPaymentLoading}
                  className="bg-slate-900 hover:bg-slate-800 text-white"
                  data-testid="onb-complete"
                >
                  {(onbLoading || onbPaymentLoading)
                    ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    : <CheckCircle className="h-4 w-4 mr-1" />
                  }
                  {onbPaymentLoading ? 'Recording Payment…' : onbLoading ? 'Completing Admission…' : 'Complete Admission & Collect Payment'}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 5: Success */}
          {onbStep === 5 && onbResult && (
            <div className="text-center space-y-4">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">Admission Successful!</h3>
              <Card className="text-left">
                <CardContent className="p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Admission Number</span>
                    <span className="font-mono font-bold text-slate-900 text-base">{onbResult.admission_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Academic Year</span>
                    <span className="font-medium">{onbResult.academic_year}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ledger Entries Created</span>
                    <span className="font-medium">{onbResult.ledger_entries_created}</span>
                  </div>
                  {onbResult.parent_account && (
                    <>
                      <div className="border-t pt-3 mt-2">
                        <p className="font-bold text-slate-900 mb-2">Parent Login Credentials (New Account)</p>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Email</span>
                        <span>{onbResult.parent_account.email}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Temporary Password</span>
                        <span className="font-mono bg-slate-100 text-slate-900 px-2 py-0.5 rounded">
                          {onbResult.parent_account.temp_password}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Share these credentials securely with the parent. They must change the password on first login.
                      </p>
                    </>
                  )}
                  {onbResult.receipt_number && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Payment Receipt</span>
                      <span className="font-mono font-bold text-emerald-700">{onbResult.receipt_number}</span>
                    </div>
                  )}
                  {onbSkipDocs && (
                    <div className="border-t pt-3 mt-2 bg-amber-50 -mx-4 px-4 py-2 rounded-b-xl">
                      <p className="text-xs text-amber-800 font-semibold">
                        📎 Documents were skipped. Upload them by clicking Edit on the student record.
                      </p>
                    </div>
                  )}
                  {!onbSkipDocs && !onbResult.receipt_number && (
                    <div className="border-t pt-3 mt-2 bg-slate-50 -mx-4 px-4 py-2 rounded-b-xl">
                      <p className="text-xs text-slate-700 font-semibold">
                        Collect payment from Fees → Collect tab using Admission No. {onbResult.admission_number}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
              <DialogFooter className="justify-center">
                <Button onClick={resetOnboarding} className="bg-slate-900 text-white hover:bg-slate-800">Done</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== VIEW STUDENT DIALOG ===== */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Student Details</DialogTitle></DialogHeader>
          {selectedStudent && (
            <div className="grid gap-4">
              <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center"><GraduationCap className="h-8 w-8 text-slate-500" /></div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground">{selectedStudent.first_name} {selectedStudent.last_name}</h3>
                  <p className="text-muted-foreground">Admission No: {selectedStudent.admission_number}</p>
                </div>
                {getStatusBadge(selectedStudent.fee_status)}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><Label className="text-muted-foreground">Class</Label><p className="font-medium text-foreground">Class {selectedStudent.class_name} - {selectedStudent.section}{selectedStudent.stream ? ` (${selectedStudent.stream})` : ''}</p></div>
                <div><Label className="text-muted-foreground">Academic Year</Label><p className="font-medium text-foreground">{selectedStudent.academic_year || '-'}</p></div>
                <div><Label className="text-muted-foreground">Roll Number</Label><p className="font-medium text-foreground">{selectedStudent.roll_number || '-'}</p></div>
                <div><Label className="text-muted-foreground">Gender</Label><p className="font-medium text-foreground capitalize">{selectedStudent.gender}</p></div>
                <div><Label className="text-muted-foreground">Date of Birth</Label><p className="font-medium text-foreground">{selectedStudent.date_of_birth || '-'}</p></div>
                <div><Label className="text-muted-foreground">Email</Label><p className="font-medium text-foreground">{selectedStudent.email || '-'}</p></div>
                {isAdmin && (
                  <div>
                    <Label className="text-muted-foreground">Password</Label>
                    <div className="flex items-center gap-1 mt-0.5">
                      <p className="font-medium text-foreground font-mono">
                        {currentPw == null ? '—' : currentPwVisible ? currentPw : '••••••••••'}
                      </p>
                      {currentPw && (
                        <>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setCurrentPwVisible(v => !v)}>
                            {currentPwVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { navigator.clipboard.writeText(currentPw); toast.success('Copied'); }}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
                <div><Label className="text-muted-foreground">Phone</Label><p className="font-medium text-foreground">{selectedStudent.phone || '-'}</p></div>
                <div className="col-span-2"><Label className="text-muted-foreground">Address</Label><p className="font-medium text-foreground">{selectedStudent.address || '-'}</p></div>
              </div>
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3 text-foreground">Parent / Guardian</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><Label className="text-muted-foreground">Name</Label><p className="font-medium text-foreground">{selectedStudent.parent_name || '-'}</p></div>
                  <div><Label className="text-muted-foreground">Phone</Label><p className="font-medium text-foreground">{selectedStudent.parent_phone || '-'}</p></div>
                  <div><Label className="text-muted-foreground">Email</Label><p className="font-medium text-foreground">{selectedStudent.parent_email || '-'}</p></div>
                  {isAdmin && (
                    <div>
                      <Label className="text-muted-foreground">Password</Label>
                      <div className="flex items-center gap-1 mt-0.5">
                        <p className="font-medium text-foreground font-mono">
                          {parentPw == null ? '—' : parentPwVisible ? parentPw : '••••••••••'}
                        </p>
                        {parentPw && (
                          <>
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setParentPwVisible(v => !v)}>
                              {parentPwVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { navigator.clipboard.writeText(parentPw); toast.success('Copied'); }}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {isAdmin && (
                <div className="border-t pt-4">
                  <h4 className="font-medium mb-3 text-foreground flex items-center gap-2"><KeyRound className="h-4 w-4" />Password Management</h4>
                  {pwResult && (
                    <div className="mb-3 p-3 rounded-lg bg-green-50 border border-green-200 text-sm">
                      <p className="text-green-700 font-medium mb-1">Password updated successfully</p>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">New password:</span>
                        <code className="font-mono font-bold text-foreground bg-white px-2 py-0.5 rounded border">
                          {pwVisible ? pwResult.password : '••••••••••'}
                        </code>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPwVisible(v => !v)}>
                          {pwVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { navigator.clipboard.writeText(pwResult.password); toast.success('Copied'); }}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter new password (min 6 chars)"
                      value={pwInput}
                      onChange={e => setPwInput(e.target.value)}
                      type="text"
                      className="flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={() => handleResetPassword(false)} disabled={pwLoading || pwInput.length < 6}>
                      Set
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleResetPassword(true)} disabled={pwLoading} className="flex items-center gap-1">
                      <RefreshCw className="h-3 w-3" /> Generate
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== EDIT STUDENT DIALOG ===== */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Student</DialogTitle>
            <DialogDescription>Admission number and historical records cannot be changed</DialogDescription>
          </DialogHeader>
          {selectedStudent && (
            <div className="grid gap-4 py-2">
              <div className="p-3 bg-muted rounded-lg text-sm">
                <span className="text-muted-foreground">Admission No: </span>
                <span className="font-mono font-bold text-foreground">{selectedStudent.admission_number}</span>
                <span className="text-muted-foreground ml-4">Name: </span>
                <span className="font-medium text-foreground">{selectedStudent.first_name} {selectedStudent.last_name}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Class</Label>
                  <Select value={editData.class_name} onValueChange={(v) => setEditData({...editData, class_name: v, section: ''})}>
                    <SelectTrigger data-testid="edit-class"><SelectValue /></SelectTrigger>
                    <SelectContent>{classes.map(c => <SelectItem key={c.name} value={c.name}>{c.display_name || `Class ${c.name}`}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Section</Label>
                  <Select value={editData.section} onValueChange={(v) => setEditData({...editData, section: v})}>
                    <SelectTrigger data-testid="edit-section"><SelectValue /></SelectTrigger>
                    <SelectContent>{getSections(editData.class_name).map(s => <SelectItem key={s.section_name} value={s.section_name}>Section {s.section_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Email</Label><Input value={editData.email} onChange={(e) => setEditData({...editData, email: e.target.value})} data-testid="edit-email" /></div>
                <div className="space-y-2"><Label>Phone</Label><Input value={editData.phone} onChange={(e) => setEditData({...editData, phone: e.target.value})} data-testid="edit-phone" /></div>
              </div>
              <div className="space-y-2"><Label>Address</Label><Input value={editData.address} onChange={(e) => setEditData({...editData, address: e.target.value})} data-testid="edit-address" /></div>
              <div className="space-y-2"><Label>Roll Number</Label><Input value={editData.roll_number} onChange={(e) => setEditData({...editData, roll_number: e.target.value})} data-testid="edit-roll" /></div>
              {/* (#9) Stream selector — only for Class 11th / 12th */}
              {STREAMS_FOR_CLASS.includes(editData.class_name) && (
                <div className="space-y-2">
                  <Label>Stream</Label>
                  <Select value={editData.stream} onValueChange={(v) => setEditData({...editData, stream: v})}>
                    <SelectTrigger data-testid="edit-stream"><SelectValue placeholder="Select stream" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="science">Science</SelectItem>
                      <SelectItem value="humanities">Humanities</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* (#30) Blood group and emergency contact */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Blood Group</Label><Input value={editData.blood_group} onChange={(e) => setEditData({...editData, blood_group: e.target.value})} placeholder="e.g. A+" data-testid="edit-blood-group" /></div>
                <div className="space-y-2"><Label>Emergency Contact</Label><Input value={editData.emergency_contact} onChange={(e) => setEditData({...editData, emergency_contact: e.target.value})} placeholder="Phone number" data-testid="edit-emergency-contact" /></div>
              </div>
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3 text-foreground">Parent / Guardian</h4>
                <div className="grid gap-4">
                  <div className="space-y-2"><Label>Parent Name</Label><Input value={editData.parent_name} onChange={(e) => setEditData({...editData, parent_name: e.target.value})} data-testid="edit-parent-name" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>Parent Phone</Label><Input value={editData.parent_phone} onChange={(e) => setEditData({...editData, parent_phone: e.target.value})} data-testid="edit-parent-phone" /></div>
                    <div className="space-y-2"><Label>Parent Email</Label><Input value={editData.parent_email} onChange={(e) => setEditData({...editData, parent_email: e.target.value})} data-testid="edit-parent-email" /></div>
                  </div>
                </div>
              </div>
              {/* Documents section */}
              <div className="border-t pt-4">
                <h4 className="font-medium mb-1 text-foreground flex items-center gap-2">
                  <FileUp className="h-4 w-4" /> Documents
                </h4>
                <p className="text-xs text-slate-500 mb-3">Upload or replace admission documents for this student.</p>
                <div className="space-y-2">
                  {REQUIRED_DOCUMENTS.map(doc => (
                    <div key={doc.type} className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 bg-slate-50">
                      <div className="flex items-center gap-2 text-sm">
                        {doc.mandatory
                          ? <span className="text-[10px] font-bold text-red-500 uppercase">Req</span>
                          : <span className="text-[10px] font-bold text-slate-400 uppercase">Opt</span>
                        }
                        {doc.name}
                      </div>
                      <Button
                        variant="outline" size="sm" className="text-xs h-7"
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.accept = '.pdf,.jpg,.jpeg,.png';
                          input.onchange = async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              const fd = new FormData();
                              fd.append('file', file);
                              const uploadRes = await api.post('/upload', fd);
                              const { file_url, file_name } = uploadRes.data;
                              const docFd = new FormData();
                              docFd.append('document_type', doc.type);
                              docFd.append('document_name', doc.name);
                              docFd.append('file_url', file_url);
                              docFd.append('file_name', file_name);
                              await api.post(`/students/${selectedStudent.student_id}/documents`, docFd);
                              toast.success(`${doc.name} uploaded`);
                            } catch { toast.error(`Failed to upload ${doc.name}`); }
                          };
                          input.click();
                        }}
                      >
                        <FileUp className="h-3 w-3 mr-1" /> Upload
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
                <Button onClick={handleSaveEdit} data-testid="save-edit-btn">Save Changes</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StudentsPage;
