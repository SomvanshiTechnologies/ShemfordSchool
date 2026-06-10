import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import { getCached, setCached } from '../lib/pageCache';
import { copyText } from '../lib/clipboard';
import { useSession } from '../contexts/SessionContext';
import { PAYMENT_METHODS, fetchPaymentMethods } from '../lib/paymentMethods';
import { clampISODate, todayISO } from '../lib/dateBounds';

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
import { Checkbox } from './ui/checkbox';
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
import { Plus, Search, Upload, Eye, Edit, GraduationCap, Filter, FileUp, Download, CheckCircle, XCircle, ArrowRight, ArrowLeft, CreditCard, User, BookOpen, KeyRound, RefreshCw, Copy, EyeOff, Loader2, UserX, UserCheck, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
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
  { type: 'birth_certificate',    name: 'Birth Certificate',              mandatory: false, accepts: 'PDF, JPG, PNG' },
  { type: 'aadhaar_card',         name: 'Aadhaar Card',                   mandatory: false, accepts: 'PDF, JPG, PNG' },
  { type: 'passport_photo',       name: 'Passport Photo',                 mandatory: false, accepts: 'JPG, PNG'      },
  { type: 'previous_marksheet',   name: 'Previous Class Marksheet',       mandatory: false, accepts: 'PDF, JPG, PNG' },
  { type: 'transfer_certificate', name: 'Transfer Certificate (TC)',      mandatory: false, accepts: 'PDF, JPG, PNG' },
  { type: 'caste_certificate',    name: 'Caste Certificate',              mandatory: false, accepts: 'PDF, JPG, PNG' },
  { type: 'medical_certificate',  name: 'Medical Fitness Certificate',    mandatory: false, accepts: 'PDF, JPG, PNG' },
];

// Classes that require stream selection — must match backend CLASSES_WITH_STREAMS exactly
const STREAMS_FOR_CLASS = ['11th', '12th'];
// For 11th/12th the section IS the stream — we override the section options
// to Science / Humanities instead of using the colour-named sections from
// the class_structures collection.
const STREAM_SECTIONS = [
  { section_name: 'Science', capacity: 999, student_count: 0 },
  { section_name: 'Humanities', capacity: 999, student_count: 0 },
];

const StudentsPage = () => {
  const { user, isAdmin, isAccountant } = useAuth();
  const { viewSession } = useSession();
  const [searchParams] = useSearchParams();
  const [students, setStudents] = useState([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const PAGE_SIZE = 20;
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
  
  // Onboarding wizard state
  const [onbStep, setOnbStep] = useState(1);
  const [onbId, setOnbId] = useState(null);
  const [onbData, setOnbData] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    date_of_birth: '', gender: 'male', address: '',
    parent_name: '', parent_phone: '', parent_email: '',
    mother_name: '', mother_phone: '', mother_email: '',
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
  const [onbPayment, setOnbPayment] = useState({ method: 'cash', transaction_id: '', remarks: '', split_cash: '', split_online: '', partial_amount: '' });
  const [onbPaymentLoading, setOnbPaymentLoading] = useState(false);
  // Payment methods come from the DB (admin-configurable); the static list is the
  // fallback. POS terminal is excluded here — its hardware flow isn't wired into
  // onboarding — but Split is included alongside Cash / Cheque / Bank / Online.
  const [onbPaymentMethods, setOnbPaymentMethods] = useState(PAYMENT_METHODS);
  useEffect(() => { fetchPaymentMethods({ withPos: false }).then(setOnbPaymentMethods); }, []);
  const [receiptPreview, setReceiptPreview] = useState(null); // { url, paymentId, receiptNumber }

  const fetchStudents = useCallback(async (pg = 1, search = searchTerm) => {
    const cacheKey = `students:${viewSession}:${filterClass}:${filterSection}:${filterStatus}:${pg}:${search}`;
    const cached = getCached(cacheKey);

    // Show the cached page instantly (no empty flash when paging), then always
    // revalidate against the DB so what's displayed reflects the latest data.
    if (cached) {
      setStudents(cached.students);
      setTotalStudents(cached.total);
      setTotalPages(cached.pages);
      setLoading(false);
    }
    setRefreshing(true);

    try {
      const params = { page: pg, limit: PAGE_SIZE, sort_by: 'last_upgraded' };
      if (filterClass) params.class_name = filterClass;
      if (filterSection) params.section = filterSection;
      if (filterStatus) params.status = filterStatus;
      if (search.trim()) params.search = search.trim();
      if (viewSession) params.academic_year = viewSession;
      const res = await api.get('/students', { params });
      const arr = Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.students) ? res.data.students : []);
      const total = parseInt(res.headers?.['x-total-count'] ?? res.data?.total ?? arr.length);
      const pages = parseInt(res.headers?.['x-total-pages'] ?? res.data?.pages ?? 1);
      const result = { students: arr, total, pages };
      setCached(cacheKey, result);
      setStudents(result.students);
      setTotalStudents(result.total);
      setTotalPages(result.pages);
    } catch (e) { if (!cached && !e?._handled) toast.error('Failed to fetch students'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [filterClass, filterSection, filterStatus, viewSession]);

  // Jump to a specific page (classic pagination). Revalidates from the DB and
  // scrolls back to the top of the list so the new page starts in view.
  const goToPage = useCallback((pg) => {
    if (pg < 1 || pg > totalPages || pg === page) return;
    setPage(pg);
    fetchStudents(pg, searchTerm);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [totalPages, page, searchTerm, fetchStudents]);

  useEffect(() => { setPage(1); fetchStudents(1, searchTerm); fetchClasses(); }, [filterClass, filterSection, filterStatus, viewSession]);

  // Header quick-search redirects here with ?focus=<student_id> — fetch
  // that student directly and open the view dialog so admin lands on the
  // record they were looking for, not just the (filtered) list page.
  useEffect(() => {
    const focusId = searchParams.get('focus');
    if (!focusId) return;
    let cancelled = false;
    (async () => {
      try {
        const [r0] = await Promise.allSettled([api.get(`/students/${focusId}`)]);
        if (cancelled) return;
        if (r0.status === 'fulfilled') {
          setSelectedStudent(r0.value.data);
          setPwResult(null); setPwInput(''); setPwVisible(false);
          setShowViewDialog(true);
        }
      } catch { /* student deleted / not accessible — silent */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchTerm(val);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => { setPage(1); fetchStudents(1, val); }, 400);
  };

  const fetchClasses = async () => {
    try {
      const response = await api.get('/classes');
      setClasses(Array.isArray(response.data) ? response.data : []);
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
      mother_name: '', mother_phone: '', mother_email: '',
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
    const isTenDigits = (v) => /^\d{10}$/.test((v || '').trim());
    const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());
    if (!onbData.first_name?.trim()) errors.first_name = 'First Name is required';
    if (!onbData.last_name?.trim()) errors.last_name = 'Last Name is required';
    if (!onbData.gender) errors.gender = 'Gender is required';
    if (!onbData.date_of_birth) errors.date_of_birth = 'Date of Birth is required';
    // Email is optional but must be valid format when provided.
    if (onbData.email?.trim() && !isValidEmail(onbData.email)) errors.email = 'Please enter a valid email address.';
    if (!onbData.phone?.trim()) errors.phone = 'Phone is required';
    else if (!isTenDigits(onbData.phone)) errors.phone = 'Phone must be exactly 10 digits';
    if (!onbData.address?.trim()) errors.address = 'Address is required';
    // Parent / mother contact numbers are optional, but when provided must be 10 digits.
    if (onbData.parent_phone?.trim() && !isTenDigits(onbData.parent_phone)) errors.parent_phone = 'Contact number must be 10 digits';
    if (onbData.mother_phone?.trim() && !isTenDigits(onbData.mother_phone)) errors.mother_phone = 'Mother contact must be 10 digits';
    if (onbData.parent_email?.trim() && !isValidEmail(onbData.parent_email)) errors.parent_email = 'Please enter a valid email address.';
    if (onbData.mother_email?.trim() && !isValidEmail(onbData.mother_email)) errors.mother_email = 'Please enter a valid email address.';
    // Parent / guardian details are optional — admins can fill them in later
    setOnbErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error('Please fill in all required fields');
      return;
    }
    setOnbLoading(true);
    try {
      const payload = { ...onbData };
      // Strip empty strings from optional fields — Pydantic EmailStr rejects ""
      ['email', 'parent_email', 'mother_email', 'phone', 'date_of_birth', 'address', 'sibling_student_id'].forEach(k => {
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
    // For 11th/12th the section IS the stream — derive lowercase stream
    // from the selected section (Science → science, Humanities → humanities).
    const needsStream = STREAMS_FOR_CLASS.includes(onbClassData.class_name);
    const derivedStream = needsStream ? (onbClassData.section || '').toLowerCase() : undefined;
    setOnbLoading(true);
    try {
      const res = await api.put(`/onboarding/${onbId}/class`, {
        class_name: onbClassData.class_name,
        section: onbClassData.section,
        stream: derivedStream,
      });
      setOnbFeeData(res.data);
      setOnbStep(3);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to set class');
    } finally { setOnbLoading(false); }
  };

  const handleOnbDocUpload = async (docType, docName, file) => {
    if (file.size > 5 * 1024 * 1024) { toast.error('File too large. Maximum size is 5 MB.'); return; }
    const isPhoto = docType === 'passport_photo';
    if (isPhoto) {
      if (!['image/jpeg','image/png'].includes(file.type) && !/(\.jpe?g|\.png)$/i.test(file.name)) {
        toast.error('Passport photo must be a JPG or PNG image.'); return;
      }
    } else {
      if (!['application/pdf','image/jpeg','image/png'].includes(file.type) && !/(\.pdf|\.jpe?g|\.png)$/i.test(file.name)) {
        toast.error('Document must be a PDF, JPG, or PNG file.'); return;
      }
    }
    setOnbDocLoading(prev => ({ ...prev, [docType]: true }));
    try {
      // Step 1: upload the file to get a stored URL
      const fd = new FormData();
      fd.append('file', file);
      const uploadRes = await api.post(`/upload?doc_type=${docType}`, fd);
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
      input.accept = docType === 'passport_photo' ? '.jpg,.jpeg,.png' : '.pdf,.jpg,.jpeg,.png';
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
      let admissionPaymentId = null;
      if (admissionResult.admission_time_fee > 0 || onbFeeData?.fee_breakdown?.length > 0) {
        setOnbPaymentLoading(true);
        try {
          const totalDue = onbFeeData?.admission_time_fee || 0;
          const payPayload = {
            student_id: admissionResult.student_id,
            payment_method: onbPayment.method,
            transaction_id: onbPayment.transaction_id || undefined,
            remarks: onbPayment.remarks || 'Collected at admission',
          };
          // Partial collection — any positive amount below the total due.
          const partial = parseFloat(onbPayment.partial_amount);
          if (onbPayment.partial_amount && partial > 0 && partial < totalDue) {
            payPayload.amount = partial;
          }
          // Split — cash + online must equal the amount being collected.
          if (onbPayment.method === 'split') {
            const cash = parseFloat(onbPayment.split_cash) || 0;
            const online = parseFloat(onbPayment.split_online) || 0;
            if (cash <= 0 && online <= 0) {
              toast.error('Enter at least one split amount');
              setOnbPaymentLoading(false);
              return;
            }
            payPayload.split_payments = { cash, online };
            // Keep the collected amount in sync with the split total.
            if (!payPayload.amount && (cash + online) < totalDue) payPayload.amount = cash + online;
          }
          const payRes = await api.post('/fees/admission-payment', payPayload);
          receiptNumber = payRes.data.receipt_number;
          admissionPaymentId = payRes.data.payment?.payment_id || payRes.data.payment_id;
          toast.success(payRes.data.message || `Payment recorded — Receipt: ${receiptNumber}`);
        } catch (payErr) {
          // Non-fatal: admission succeeded but payment recording failed
          toast.error('Admission done, but payment recording failed. Record it from the Fees tab.');
        } finally { setOnbPaymentLoading(false); }
      }

      setOnbResult({ ...admissionResult, receipt_number: receiptNumber, admission_payment_id: admissionPaymentId });
      setOnbStep(5);
      if (admissionPaymentId) openReceiptPreview(admissionPaymentId, receiptNumber);
      fetchStudents(page, searchTerm);
      toast.success(`Student admitted! Admission No: ${admissionResult.admission_number}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to complete admission');
    } finally { setOnbLoading(false); }
  };

  const handleToggleWebLogin = async (studentId, currentEnabled) => {
    const newVal = !currentEnabled;
    try {
      await api.patch(`/students/${studentId}/web-login`, { web_login_enabled: newVal });
      setStudents(prev => prev.map(s => s.student_id === studentId ? { ...s, web_login_enabled: newVal } : s));
      toast.success(newVal ? 'Login enabled' : 'Login restricted to app only');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update');
    }
  };

  const handleToggleAllWebLogin = async (enableAll) => {
    try {
      await api.patch('/students/web-login/bulk', { web_login_enabled: enableAll });
      setStudents(prev => prev.map(s => ({ ...s, web_login_enabled: enableAll })));
      toast.success(enableAll ? 'Login enabled for all students' : 'Login restricted to app for all students');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update');
    }
  };

  const openReceiptPreview = async (paymentId, receiptNumber) => {
    if (!paymentId) return;
    try {
      const res = await api.get(`/fees/receipt/${paymentId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      setReceiptPreview({ url, paymentId, receiptNumber });
    } catch {
      toast.error('Receipt generated but preview failed.');
    }
  };
  const closeReceiptPreview = () => {
    if (receiptPreview?.url) URL.revokeObjectURL(receiptPreview.url);
    setReceiptPreview(null);
  };
  const downloadReceipt = async (paymentId) => {
    if (!paymentId) return;
    try {
      const res = await api.get(`/fees/receipt/${paymentId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('Failed to open receipt');
    }
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
  const handleEditStudent = async (student) => {
    setSelectedStudent(student);
    // Pre-fill with list data immediately for fast UI
    const initial = {
      phone: student.phone || '',
      email: student.email || '',
      address: student.address || '',
      parent_name: student.parent_name || '',
      parent_phone: student.parent_phone || '',
      parent_email: student.parent_email || '',
      father_name: student.father_name || '',
      father_phone: student.father_phone || '',
      father_occupation: student.father_occupation || '',
      mother_name: student.mother_name || '',
      mother_phone: student.mother_phone || '',
      mother_occupation: student.mother_occupation || '',
      class_name: student.class_name || '',
      section: student.section || '',
      stream: student.stream || '',
      roll_number: student.roll_number || '',
      blood_group: student.blood_group || '',
      emergency_contact: student.emergency_contact || '',
      admission_number: student.admission_number || '',
    };
    setEditData(initial);
    setShowEditDialog(true);
    // Fetch full record to get all fields not in the list projection
    try {
      const { data: full } = await api.get(`/students/${student.student_id}`);
      setSelectedStudent(full);
      setEditData(prev => ({
        ...prev,
        phone: full.phone ?? prev.phone,
        email: full.email ?? prev.email,
        roll_number: full.roll_number ?? prev.roll_number,
        father_name: full.father_name || prev.father_name || prev.parent_name,
        father_phone: full.father_phone || prev.father_phone || prev.parent_phone,
        father_occupation: full.father_occupation || prev.father_occupation,
        mother_name: full.mother_name || prev.mother_name,
        mother_phone: full.mother_phone || prev.mother_phone,
        mother_occupation: full.mother_occupation || prev.mother_occupation,
        parent_email: full.parent_email || prev.parent_email,
        address: full.address || prev.address,
        blood_group: full.blood_group || prev.blood_group,
        emergency_contact: full.emergency_contact || prev.emergency_contact,
      }));
    } catch {}
  };

  const handleResetPassword = async (generate = false) => {
    setPwLoading(true);
    try {
      const body = generate ? {} : { password: pwInput };
      const res = await api.post(`/students/${selectedStudent.student_id}/reset-password`, body);
      setPwResult(res.data);
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
    const tenDigits = (v) => /^\d{10}$/.test((v || '').trim());
    if (!editData.phone?.trim()) { toast.error('Phone is required'); return; }
    if (!tenDigits(editData.phone)) { toast.error('Phone must be exactly 10 digits'); return; }
    if (!editData.address?.trim()) { toast.error('Address is required'); return; }
    // Contact numbers are optional, but must be 10 digits when provided.
    for (const [field, label] of [['father_phone', 'Father phone'], ['mother_phone', 'Mother phone'], ['emergency_contact', 'Emergency contact']]) {
      if (editData[field]?.trim() && !tenDigits(editData[field])) { toast.error(`${label} must be 10 digits`); return; }
    }
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
    // For 11th/12th, section IS the stream — derive lowercase value.
    const needsStream = STREAMS_FOR_CLASS.includes(csvClass);
    const effectiveStream = needsStream ? (csvSection || '').toLowerCase() : csvStream;
    if (!csvFile) { toast.error('Please select a CSV file'); return; }
    setCsvPreviewing(true);
    try {
      const fd = new FormData();
      fd.append('file', csvFile);
      fd.append('class_name', csvClass);
      fd.append('section', csvSection);
      if (effectiveStream) fd.append('stream', effectiveStream);
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
  const filteredStudents = Array.isArray(students) ? students : [];

  const getStatusBadge = (status) => {
    const map = {
      paid: <Badge className="bg-slate-100 text-slate-900 border border-slate-200">Paid</Badge>,
      overdue: <Badge variant="destructive">Overdue</Badge>,
      partial: <Badge className="bg-slate-100 text-slate-500 border border-slate-200">Partial</Badge>,
    };
    return map[status] || <Badge className="bg-amber-50 text-amber-700 border border-amber-200">Pending</Badge>;
  };

  const getSections = (className) => {
    if (STREAMS_FOR_CLASS.includes(className)) return STREAM_SECTIONS;
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
                      {/* For 11th/12th the section selector above already
                          shows Science/Humanities — no separate stream field. */}
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
            <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-[52px] text-center">
                  {(() => {
                    const active = filteredStudents.filter(s => s.is_active !== false);
                    const allEnabled = active.length > 0 && active.every(s => s.web_login_enabled === true);
                    const noneEnabled = active.length > 0 && active.every(s => s.web_login_enabled !== true);
                    return (
                      <div className="flex justify-center">
                        <Checkbox
                          checked={allEnabled ? true : noneEnabled ? false : 'indeterminate'}
                          onCheckedChange={() => handleToggleAllWebLogin(!allEnabled)}
                          title={allEnabled ? 'Disable portal login for all' : 'Enable portal login for all'}
                          className="data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500 data-[state=indeterminate]:bg-orange-300 data-[state=indeterminate]:border-orange-300"
                        />
                      </div>
                    );
                  })()}
                </TableHead><TableHead>Admission No.</TableHead><TableHead>Name</TableHead><TableHead>Class</TableHead><TableHead className="hidden lg:table-cell">Academic Year</TableHead><TableHead className="hidden lg:table-cell">Parent</TableHead><TableHead>Fee Status</TableHead><TableHead>Status</TableHead><TableHead className="sticky right-0 bg-white text-right z-10 shadow-[-4px_0_6px_-1px_rgba(0,0,0,0.06)]">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredStudents.map((student) => (
                  <TableRow key={student.student_id} data-testid={`student-row-${student.student_id}`} className={!student.is_active ? 'opacity-60 bg-slate-50' : ''}>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <Checkbox
                          checked={student.web_login_enabled === true}
                          onCheckedChange={() => handleToggleWebLogin(student.student_id, student.web_login_enabled === true)}
                          title={student.web_login_enabled === true ? 'Portal login enabled — uncheck to restrict to app only' : 'App only — check to enable portal login'}
                          disabled={!student.is_active}
                          className="data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm select-none" onCopy={e => e.preventDefault()} onContextMenu={e => e.preventDefault()}>{student.admission_number}</TableCell>
                    <TableCell>
                      <span className="font-medium text-foreground flex items-center gap-2">
                        {student.first_name} {student.last_name}
                        {student.is_sibling && (
                          <Badge className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] px-1.5 py-0" title="Sibling discount applied">Sibling</Badge>
                        )}
                      </span>
                      <p className="text-sm text-muted-foreground">{student.email || ''}</p>
                    </TableCell>
                    <TableCell>Class {student.class_name} - {student.section}</TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-slate-600">{student.academic_year || '—'}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {!student.father_name && !student.mother_name && !student.parent_name ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <div className="text-sm leading-tight space-y-1">
                          {(student.father_name || student.parent_name) && (
                            <div>
                              <p className="font-semibold text-foreground">{student.father_name || student.parent_name}</p>
                              {(student.father_phone || student.parent_phone) && (
                                <p className="text-xs text-muted-foreground">{student.father_phone || student.parent_phone}</p>
                              )}
                            </div>
                          )}
                          {student.mother_name && (
                            <div>
                              <p className="font-semibold text-foreground">{student.mother_name}</p>
                              {student.mother_phone && (
                                <p className="text-xs text-muted-foreground">{student.mother_phone}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(student.fee_status)}</TableCell>
                    <TableCell>
                      {student.is_active
                        ? <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200">Active</Badge>
                        : <Badge className="bg-red-50 text-red-700 border border-red-200">Inactive</Badge>
                      }
                    </TableCell>
                    <TableCell className="sticky right-0 bg-white text-right shadow-[-4px_0_6px_-1px_rgba(0,0,0,0.06)]">
                      <Button variant="ghost" size="sm" onClick={async () => { setSelectedStudent(student); setPwResult(null); setPwInput(''); setPwVisible(false); setShowViewDialog(true); try { const r0 = await api.get(`/students/${student.student_id}`); setSelectedStudent(r0.data); } catch {} }} data-testid={`view-${student.student_id}`}><Eye className="h-4 w-4" /></Button>
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {!loading && totalStudents > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-4">
          <p className="text-xs text-slate-500">
            Showing <span className="font-medium text-slate-700">{(page - 1) * PAGE_SIZE + 1}</span>–
            <span className="font-medium text-slate-700">{Math.min(page * PAGE_SIZE, totalStudents)}</span> of{' '}
            <span className="font-medium text-slate-700">{totalStudents}</span> students
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-8 px-2" disabled={page <= 1 || refreshing}
                onClick={() => goToPage(page - 1)} data-testid="students-prev-page">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {(() => {
                // Windowed page numbers: first, last, and up to 2 around current.
                const set = new Set([1, totalPages, page, page - 1, page + 1]);
                const nums = [...set].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
                const out = [];
                let prev = 0;
                for (const n of nums) {
                  if (n - prev > 1) out.push(<span key={`gap-${n}`} className="px-1 text-slate-400">…</span>);
                  out.push(
                    <Button key={n} variant={n === page ? 'default' : 'outline'} size="sm"
                      className="h-8 min-w-8 px-2" disabled={refreshing && n !== page}
                      onClick={() => goToPage(n)} data-testid={`students-page-${n}`}>
                      {n}
                    </Button>
                  );
                  prev = n;
                }
                return out;
              })()}
              <Button variant="outline" size="sm" className="h-8 px-2" disabled={page >= totalPages || refreshing}
                onClick={() => goToPage(page + 1)} data-testid="students-next-page">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
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
                  <Input value={onbData.first_name} onChange={(e) => { const v = e.target.value.replace(/[^a-zA-Z\s\-'.]/g, ''); setOnbData({...onbData, first_name: v}); setOnbErrors(p => ({...p, first_name: ''})); }} className={onbErrors.first_name ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-first-name" />
                  {onbErrors.first_name && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.first_name}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Last Name <span className="text-red-500">*</span></Label>
                  <Input value={onbData.last_name} onChange={(e) => { const v = e.target.value.replace(/[^a-zA-Z\s\-'.]/g, ''); setOnbData({...onbData, last_name: v}); setOnbErrors(p => ({...p, last_name: ''})); }} className={onbErrors.last_name ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-last-name" />
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
                  <Input type="date" lang="en-IN" max={todayISO()} value={onbData.date_of_birth} onChange={(e) => { setOnbData({...onbData, date_of_birth: clampISODate(e.target.value, { max: todayISO() })}); setOnbErrors(p => ({...p, date_of_birth: ''})); }} className={onbErrors.date_of_birth ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-dob" />
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
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input type="email" value={onbData.email} onChange={(e) => { setOnbData({...onbData, email: e.target.value}); setOnbErrors(p => ({...p, email: ''})); }} className={onbErrors.email ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-email" />
                  {onbErrors.email && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.email}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Phone <span className="text-red-500">*</span></Label>
                  <Input value={onbData.phone} inputMode="numeric" maxLength={10} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); setOnbData({...onbData, phone: v}); setOnbErrors(p => ({...p, phone: ''})); }} className={onbErrors.phone ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-phone" />
                  {onbErrors.phone && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.phone}</p>}
                </div>
              </div>
              <div className="space-y-1"><Label>Address <span className="text-red-500">*</span></Label><Input value={onbData.address} onChange={(e) => { setOnbData({...onbData, address: e.target.value}); setOnbErrors(p => ({...p, address: ''})); }} className={onbErrors.address ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-address" /></div>
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3 text-foreground">Parent / Guardian Details</h4>
                <div className="grid gap-4">
                  <div className="space-y-1">
                    <Label>Father / Guardian Name</Label>
                    <Input value={onbData.parent_name} onChange={(e) => { const v = e.target.value.replace(/[^a-zA-Z\s\-'.]/g, ''); setOnbData({...onbData, parent_name: v}); setOnbErrors(p => ({...p, parent_name: ''})); }} className={onbErrors.parent_name ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-parent-name" />
                    {onbErrors.parent_name && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.parent_name}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label>Contact Number</Label>
                      <Input value={onbData.parent_phone} inputMode="numeric" maxLength={10} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); setOnbData({...onbData, parent_phone: v}); setOnbErrors(p => ({...p, parent_phone: ''})); }} className={onbErrors.parent_phone ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-parent-phone" />
                      {onbErrors.parent_phone && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.parent_phone}</p>}
                    </div>
                    <div className="space-y-1">
                      <Label>Parent Email</Label>
                      <Input type="email" value={onbData.parent_email} onChange={(e) => { setOnbData({...onbData, parent_email: e.target.value}); setOnbErrors(p => ({...p, parent_email: ''})); }} className={onbErrors.parent_email ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-parent-email" />
                      {onbErrors.parent_email && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.parent_email}</p>}
                    </div>
                  </div>
                </div>
              </div>
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3 text-foreground">Mother Details</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Mother Name</Label>
                    <Input value={onbData.mother_name} onChange={(e) => { const v = e.target.value.replace(/[^a-zA-Z\s\-'.]/g, ''); setOnbData({...onbData, mother_name: v}); setOnbErrors(p => ({...p, mother_name: ''})); }} className={onbErrors.mother_name ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-mother-name" />
                    {onbErrors.mother_name && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.mother_name}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label>Mother Contact Number</Label>
                    <Input value={onbData.mother_phone} inputMode="numeric" maxLength={10} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); setOnbData({...onbData, mother_phone: v}); setOnbErrors(p => ({...p, mother_phone: ''})); }} className={onbErrors.mother_phone ? 'border-red-500 focus-visible:ring-red-400' : ''} data-testid="onb-mother-phone" />
                    {onbErrors.mother_phone && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.mother_phone}</p>}
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label>Mother Email</Label>
                    <Input
                      type="email"
                      value={onbData.mother_email}
                      onChange={(e) => { setOnbData({ ...onbData, mother_email: e.target.value }); setOnbErrors(p => ({...p, mother_email: ''})); }}
                      className={onbErrors.mother_email ? 'border-red-500 focus-visible:ring-red-400' : ''}
                      data-testid="onb-mother-email"
                    />
                    {onbErrors.mother_email && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{onbErrors.mother_email}</p>}
                  </div>
                </div>
              </div>
              {/* Sibling — applies the sibling discount (from Fee Config) to
                  Admission Fee & Monthly Tuition on ledger creation. */}
              <div className="border-t pt-4">
                <label className="flex items-start gap-2 cursor-pointer rounded-xl border border-blue-200 bg-blue-50 p-3">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={onbData.is_sibling}
                    onChange={(e) => setOnbData({ ...onbData, is_sibling: e.target.checked })}
                    data-testid="onb-is-sibling"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-blue-900">This student has a sibling already enrolled</span>
                    <span className="text-xs text-blue-600">Sibling discount applied to Admission Fee &amp; Monthly Tuition</span>
                  </span>
                </label>
                {onbData.is_sibling && (
                  <div className="space-y-1 mt-3">
                    <Label>Sibling Student ID (optional)</Label>
                    <Input
                      value={onbData.sibling_student_id}
                      onChange={(e) => setOnbData({ ...onbData, sibling_student_id: e.target.value })}
                      placeholder="STU… — leave blank to auto-detect by parent email"
                      data-testid="onb-sibling-id"
                    />
                  </div>
                )}
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
                    <SelectContent>{classes.map(c => <SelectItem key={c.name} value={c.name}>{c.display_name || (c.name.startsWith('Class ') ? c.name : `Class ${c.name}`)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Section *</Label>
                  <Select value={onbClassData.section} onValueChange={(v) => setOnbClassData({...onbClassData, section: v})} disabled={!onbClassData.class_name}>
                    <SelectTrigger data-testid="onb-section"><SelectValue placeholder="Select section" /></SelectTrigger>
                    <SelectContent>
                      {getSections(onbClassData.class_name).map(s => (
                        <SelectItem key={s.section_name} value={s.section_name}>
                          {STREAMS_FOR_CLASS.includes(onbClassData.class_name)
                            ? s.section_name
                            : `Section ${s.section_name} (${s.student_count || 0}/${s.capacity})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
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
                  Upload admission documents. Skip all now and upload later via the student edit panel.
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
                          {doc.accepts && <p className="text-xs text-slate-400 mt-0.5">Supported formats: {doc.accepts}</p>}
                          {uploaded && (
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-green-600">✓ {uploaded.file_name}</span>
                              {uploaded.file_url && (
                                <button
                                  className="text-xs text-slate-600 underline bg-transparent border-none cursor-pointer p-0"
                                  onClick={async () => {
                                    try {
                                      const fname = uploaded.file_url.split('/uploads/').pop();
                                      const res = await api.get(`/file-view/${fname}`, { responseType: 'blob' });
                                      const url = URL.createObjectURL(res.data);
                                      window.open(url, '_blank');
                                      setTimeout(() => URL.revokeObjectURL(url), 60000);
                                    } catch { toast.error('Failed to open document'); }
                                  }}>View</button>
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
                                (Sibling -Rs.{fee.sibling_discount_amount.toLocaleString()})
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">Rs.{(fee.gross_amount||0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right text-green-600">
                            {fee.discount_amount > 0 ? `-Rs.${fee.discount_amount.toLocaleString()}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">Rs.{(fee.net_amount||0).toLocaleString()}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-bold">
                        <td className="px-3 py-2" colSpan={3}>Total Due at Admission</td>
                        <td className="px-3 py-2 text-right text-slate-900 text-lg">
                          Rs.{(onbFeeData.admission_time_fee||0).toLocaleString()}
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
                  Total annual obligation: Rs.{(onbFeeData.total_annual_fee||0).toLocaleString()}
                  {' '}(one-time + yearly + 12 months tuition)
                </div>
              )}

              {/* Payment collection — required before admission completes */}
              {onbFeeData.fee_breakdown?.length > 0 && (
                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="px-3 py-2 bg-slate-900 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    <CreditCard className="h-3.5 w-3.5" />
                    Collect Admission Payment — Rs.{(onbFeeData.admission_time_fee||0).toLocaleString()}
                  </div>
                  <div className="p-4 space-y-3">
                    {/* Amount to collect — leave blank for full; enter less to record a partial payment */}
                    <div>
                      <Label className="text-xs font-bold uppercase tracking-wider">
                        Amount to Collect <span className="text-slate-400 font-normal normal-case">(leave blank to collect full)</span>
                      </Label>
                      <Input
                        type="number" min="0" step="0.01"
                        max={onbFeeData.admission_time_fee || undefined}
                        readOnly={onbPayment.method === 'split'}
                        className={`mt-1 h-9 text-sm ${onbPayment.method === 'split' ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
                        placeholder={`Full: Rs.${(onbFeeData.admission_time_fee||0).toLocaleString()}`}
                        value={onbPayment.method === 'split'
                          ? (((parseFloat(onbPayment.split_cash) || 0) + (parseFloat(onbPayment.split_online) || 0)) || '')
                          : onbPayment.partial_amount}
                        onChange={e => setOnbPayment(p => ({ ...p, partial_amount: e.target.value }))}
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        Total due at admission: Rs.{(onbFeeData.admission_time_fee||0).toLocaleString()}. Enter a smaller amount for a partial payment — the balance stays due.
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs font-bold uppercase tracking-wider">Payment Method *</Label>
                      <Select value={onbPayment.method} onValueChange={v => setOnbPayment(p => ({ ...p, method: v }))}>
                        <SelectTrigger className="mt-1 h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {onbPaymentMethods.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {onbPayment.method === 'split' && (
                      <div className="grid grid-cols-2 gap-3 p-3 rounded-xl border border-orange-200 bg-orange-50">
                        <div>
                          <Label className="text-xs font-bold uppercase tracking-wider">Cash Amount</Label>
                          <Input type="number" min={0} step="0.01" className="mt-1 h-9 text-sm"
                            value={onbPayment.split_cash}
                            onChange={e => setOnbPayment(p => ({ ...p, split_cash: e.target.value }))} placeholder="0" />
                        </div>
                        <div>
                          <Label className="text-xs font-bold uppercase tracking-wider">Online Amount</Label>
                          <Input type="number" min={0} step="0.01" className="mt-1 h-9 text-sm"
                            value={onbPayment.split_online}
                            onChange={e => setOnbPayment(p => ({ ...p, split_online: e.target.value }))} placeholder="0" />
                        </div>
                        <p className="col-span-2 text-[10px] text-slate-500">
                          Cash + Online must equal the amount being collected.
                        </p>
                      </div>
                    )}
                    {onbPayment.method !== 'cash' && onbPayment.method !== 'split' && (
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
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Payment Receipt</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-emerald-700">{onbResult.receipt_number}</span>
                        {onbResult.admission_payment_id && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                            onClick={() => openReceiptPreview(onbResult.admission_payment_id, onbResult.receipt_number)}>
                            <Download className="h-3 w-3 mr-1" /> View
                          </Button>
                        )}
                      </div>
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

      {/* ===== RECEIPT PREVIEW ===== */}
      <Dialog open={!!receiptPreview} onOpenChange={(open) => { if (!open) closeReceiptPreview(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0" aria-describedby={undefined}>
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Payment recorded
              {receiptPreview?.receiptNumber && (
                <span className="text-xs font-mono text-muted-foreground ml-2">
                  Receipt: {receiptPreview.receiptNumber}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-[60vh] bg-slate-100">
            {receiptPreview?.url && (
              <iframe src={receiptPreview.url} title="Fee receipt" className="w-full h-full min-h-[60vh] border-0" />
            )}
          </div>
          <DialogFooter className="p-3 border-t gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadReceipt(receiptPreview?.paymentId)}>
              <Download className="h-4 w-4 mr-2" /> Open in new tab
            </Button>
            <Button size="sm" onClick={closeReceiptPreview}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== VIEW STUDENT DIALOG ===== */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-2xl" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Student Details</DialogTitle></DialogHeader>
          {selectedStudent && (
            <div className="grid gap-4">
              <div className="flex items-center gap-4 p-4 bg-muted rounded-lg select-none" onCopy={e => e.preventDefault()} onContextMenu={e => e.preventDefault()}>
                <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center"><GraduationCap className="h-8 w-8 text-slate-500" /></div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground">{selectedStudent.first_name} {selectedStudent.last_name}</h3>
                  <p className="text-muted-foreground flex items-center gap-2">
                    <span>Admission No: <span
                      className="font-mono font-semibold text-foreground select-none"
                      onCopy={e => e.preventDefault()}
                      onContextMenu={e => e.preventDefault()}
                    >{selectedStudent.admission_number}</span></span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Copy admission number"
                      onClick={async () => {
                        const ok = await copyText(selectedStudent.admission_number || '');
                        if (ok) toast.success('Admission number copied');
                        else toast.error('Copy failed');
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </p>
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
                <div><Label className="text-muted-foreground">Phone</Label><p className="font-medium text-foreground">{selectedStudent.phone || '-'}</p></div>
                <div className="col-span-2"><Label className="text-muted-foreground">Address</Label><p className="font-medium text-foreground">{selectedStudent.address || '-'}</p></div>
              </div>
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3 text-foreground">Parent / Guardian</h4>

                {/* Father */}
                <div className="mb-4">
                  <p className="text-xs uppercase tracking-wider font-bold text-slate-500 mb-2">Father</p>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div><Label className="text-muted-foreground">Name</Label><p className="font-medium text-foreground">{selectedStudent.father_name || selectedStudent.parent_name || '-'}</p></div>
                    <div><Label className="text-muted-foreground">Phone</Label><p className="font-medium text-foreground">{selectedStudent.father_phone || selectedStudent.parent_phone || '-'}</p></div>
                    <div><Label className="text-muted-foreground">Occupation</Label><p className="font-medium text-foreground">{selectedStudent.father_occupation || '-'}</p></div>
                  </div>
                </div>

                {/* Mother */}
                <div className="mb-4">
                  <p className="text-xs uppercase tracking-wider font-bold text-slate-500 mb-2">Mother</p>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div><Label className="text-muted-foreground">Name</Label><p className="font-medium text-foreground">{selectedStudent.mother_name || '-'}</p></div>
                    <div><Label className="text-muted-foreground">Phone</Label><p className="font-medium text-foreground">{selectedStudent.mother_phone || '-'}</p></div>
                    <div><Label className="text-muted-foreground">Occupation</Label><p className="font-medium text-foreground">{selectedStudent.mother_occupation || '-'}</p></div>
                  </div>
                </div>

                {/* Contact & login */}
                <div className="grid grid-cols-2 gap-4 text-sm pt-2 border-t border-slate-100">
                  <div><Label className="text-muted-foreground">Parent Email</Label><p className="font-medium text-foreground">{selectedStudent.parent_email || '-'}</p></div>
                </div>
              </div>
              {(isAdmin || isAccountant) && (
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
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={async () => { const ok = await copyText(pwResult.password); toast[ok ? 'success' : 'error'](ok ? 'Copied' : 'Copy failed'); }}>
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
            <DialogDescription>{selectedStudent?.first_name} {selectedStudent?.last_name}</DialogDescription>
          </DialogHeader>
          {selectedStudent && (
            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label>Admission Number</Label>
                <Input
                  value={editData.admission_number ?? selectedStudent.admission_number ?? ''}
                  onChange={e => setEditData({...editData, admission_number: e.target.value})}
                  placeholder="e.g. SHM/2025/00001"
                  className="font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Class</Label>
                  <Select value={editData.class_name} onValueChange={(v) => setEditData({...editData, class_name: v, section: ''})}>
                    <SelectTrigger data-testid="edit-class"><SelectValue /></SelectTrigger>
                    <SelectContent>{classes.map(c => <SelectItem key={c.name} value={c.name}>{c.display_name || (c.name.startsWith('Class ') ? c.name : `Class ${c.name}`)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Section</Label>
                  <Select
                    value={editData.section}
                    onValueChange={(v) => {
                      const isStreamClass = STREAMS_FOR_CLASS.includes(editData.class_name);
                      setEditData({
                        ...editData,
                        section: v,
                        ...(isStreamClass ? { stream: (v || '').toLowerCase() } : {}),
                      });
                    }}
                  >
                    <SelectTrigger data-testid="edit-section"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {getSections(editData.class_name).map(s => (
                        <SelectItem key={s.section_name} value={s.section_name}>
                          {STREAMS_FOR_CLASS.includes(editData.class_name) ? s.section_name : `Section ${s.section_name}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={editData.email} onChange={(e) => setEditData({...editData, email: e.target.value})} data-testid="edit-email" /></div>
                <div className="space-y-2"><Label>Phone <span className="text-red-500">*</span></Label><Input required inputMode="numeric" maxLength={10} value={editData.phone} onChange={(e) => setEditData({...editData, phone: e.target.value.replace(/\D/g, '').slice(0, 10)})} data-testid="edit-phone" /></div>
              </div>
              <div className="space-y-2"><Label>Address <span className="text-red-500">*</span></Label><Input required value={editData.address} onChange={(e) => setEditData({...editData, address: e.target.value})} data-testid="edit-address" /></div>
              <div className="space-y-2"><Label>Roll Number</Label><Input value={editData.roll_number} onChange={(e) => setEditData({...editData, roll_number: e.target.value})} data-testid="edit-roll" /></div>
              {/* (#30) Blood group and emergency contact */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Blood Group</Label><Input value={editData.blood_group} onChange={(e) => setEditData({...editData, blood_group: e.target.value})} placeholder="e.g. A+" data-testid="edit-blood-group" /></div>
                <div className="space-y-2"><Label>Emergency Contact</Label><Input inputMode="numeric" maxLength={10} value={editData.emergency_contact} onChange={(e) => setEditData({...editData, emergency_contact: e.target.value.replace(/\D/g, '').slice(0, 10)})} placeholder="10-digit phone number" data-testid="edit-emergency-contact" /></div>
              </div>
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3 text-foreground">Father Details</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Father Name</Label><Input value={editData.father_name ?? editData.parent_name ?? ''} onChange={(e) => setEditData({...editData, father_name: e.target.value, parent_name: e.target.value})} data-testid="edit-father-name" /></div>
                  <div className="space-y-2"><Label>Father Phone</Label><Input inputMode="numeric" maxLength={10} value={editData.father_phone ?? editData.parent_phone ?? ''} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); setEditData({...editData, father_phone: v, parent_phone: v}); }} data-testid="edit-father-phone" /></div>
                  <div className="space-y-2"><Label>Father Occupation</Label><Input value={editData.father_occupation ?? ''} onChange={(e) => setEditData({...editData, father_occupation: e.target.value})} data-testid="edit-father-occupation" /></div>
                  <div className="space-y-2"><Label>Father Email</Label><Input value={editData.parent_email ?? ''} onChange={(e) => setEditData({...editData, parent_email: e.target.value})} data-testid="edit-parent-email" /></div>
                </div>
              </div>
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3 text-foreground">Mother Details</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Mother Name</Label><Input value={editData.mother_name ?? ''} onChange={(e) => setEditData({...editData, mother_name: e.target.value})} data-testid="edit-mother-name" /></div>
                  <div className="space-y-2"><Label>Mother Phone</Label><Input inputMode="numeric" maxLength={10} value={editData.mother_phone ?? ''} onChange={(e) => setEditData({...editData, mother_phone: e.target.value.replace(/\D/g, '').slice(0, 10)})} data-testid="edit-mother-phone" /></div>
                  <div className="space-y-2"><Label>Mother Occupation</Label><Input value={editData.mother_occupation ?? ''} onChange={(e) => setEditData({...editData, mother_occupation: e.target.value})} data-testid="edit-mother-occupation" /></div>
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
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Opt</span>
                        {doc.name}
                      </div>
                      <Button
                        variant="outline" size="sm" className="text-xs h-7"
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.accept = doc.type === 'passport_photo' ? '.jpg,.jpeg,.png' : '.pdf';
                          input.onchange = async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 5 * 1024 * 1024) { toast.error('File too large. Maximum size is 5 MB.'); return; }
                            const isPhoto = doc.type === 'passport_photo';
                            if (isPhoto && !['image/jpeg','image/png'].includes(file.type) && !/(\.jpe?g|\.png)$/i.test(file.name)) {
                              toast.error('Passport photo must be a JPG or PNG image.'); return;
                            }
                            if (!isPhoto && file.type !== 'application/pdf' && !/(\.pdf)$/i.test(file.name)) {
                              toast.error('Documents must be uploaded as PDF.'); return;
                            }
                            try {
                              const fd = new FormData();
                              fd.append('file', file);
                              const uploadRes = await api.post(`/upload?doc_type=${doc.type}`, fd);
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
