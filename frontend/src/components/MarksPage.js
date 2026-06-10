import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';
import api from '../lib/api';
import { previewInTab } from '../lib/preview';
import { getCached, setCached } from '../lib/pageCache';
import { currentAcademicYear } from '../lib/academicYear';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from './ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from './ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from './ui/table';
import { toast } from 'sonner';
import {
  Plus, FileText, Download, Lock, Unlock, Eye, GraduationCap, Award, Loader2, Trash2,
} from 'lucide-react';

const GRADE_MAP = (pct) => {
  if (pct >= 91) return { grade: 'A1', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
  if (pct >= 81) return { grade: 'A2', cls: 'bg-green-50 text-green-700 border border-green-200' };
  if (pct >= 71) return { grade: 'B1', cls: 'bg-blue-50 text-blue-700 border border-blue-200' };
  if (pct >= 61) return { grade: 'B2', cls: 'bg-sky-50 text-sky-700 border border-sky-200' };
  if (pct >= 51) return { grade: 'C1', cls: 'bg-amber-50 text-amber-700 border border-amber-200' };
  if (pct >= 41) return { grade: 'C2', cls: 'bg-orange-50 text-orange-700 border border-orange-200' };
  if (pct >= 33) return { grade: 'D', cls: 'bg-red-50 text-red-600 border border-red-200' };
  return { grade: 'E', cls: 'bg-red-100 text-red-700 border border-red-300' };
};

const MARKS_PAGE_SIZE = 10;

// Compact client-side pager shared by the Marks tabs.
const MarksPager = ({ page, total, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / MARKS_PAGE_SIZE));
  if (total <= MARKS_PAGE_SIZE) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
      <p className="text-xs text-slate-400 mr-auto">
        {(page - 1) * MARKS_PAGE_SIZE + 1}–{Math.min(page * MARKS_PAGE_SIZE, total)} of {total}
      </p>
      <Button variant="outline" size="sm" className="h-8 px-3 rounded-lg" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</Button>
      <span className="text-xs text-slate-500">Page {page} / {pages}</span>
      <Button variant="outline" size="sm" className="h-8 px-3 rounded-lg" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
};

const MarksPage = () => {
  const { user } = useAuth();
  const { viewSession } = useSession();
  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';
  // Only admins and teachers can enter / save marks. Students & parents view only.
  const canEditMarks = isAdmin || isTeacher;

  const [activeTab, setActiveTab] = useState(
    isAdmin ? 'exams' : (canEditMarks ? 'entry' : 'view')
  );
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(false);

  // Exam definition
  const [showExamDialog, setShowExamDialog] = useState(false);
  const [examForm, setExamForm] = useState({
    name: '', exam_type: 'term', class_name: '', academic_year: currentAcademicYear(),
    subjects: [{ subject: '', max_marks: 100 }], start_date: '', end_date: '',
  });
  const [savingExam, setSavingExam] = useState(false);

  // Marks entry
  const [selectedExam, setSelectedExam] = useState(null);
  const [selectedSection, setSelectedSection] = useState('');
  const [students, setStudents] = useState([]);
  const [marksData, setMarksData] = useState({});
  const [existingMarks, setExistingMarks] = useState([]);
  const [savingMarks, setSavingMarks] = useState(false);
  const [marksLoading, setMarksLoading] = useState(false);

  // Marksheet
  const [showMarksheetDialog, setShowMarksheetDialog] = useState(false);
  const [marksheetStudentId, setMarksheetStudentId] = useState('');
  const [marksheetData, setMarksheetData] = useState(null);
  const [marksheetStudents, setMarksheetStudents] = useState([]);
  const [marksheetSearch, setMarksheetSearch] = useState('');
  const [marksheetSearchResults, setMarksheetSearchResults] = useState([]);
  const [marksheetSearchLoading, setMarksheetSearchLoading] = useState(false);
  const [marksheetYear, setMarksheetYear] = useState('all');

  useEffect(() => {
    const examParams = viewSession ? { academic_year: viewSession } : {};
    // SWR: show cached data immediately, then refresh in background
    const cached = getCached(`marks:init:${viewSession || 'all'}`);
    if (cached) {
      setClasses(cached.classes);
      setSubjects(cached.subjects);
      setExams(cached.exams);
    }
    Promise.all([
      api.get('/classes'),
      api.get('/subjects'),
      api.get('/exams', { params: examParams }),
    ]).then(([c, s, e]) => {
      setClasses(c.data);
      setSubjects(s.data);
      setExams(e.data);
      setCached(`marks:init:${viewSession || 'all'}`, { classes: c.data, subjects: s.data, exams: e.data });
    }).catch(() => {});
  }, [viewSession]);

  // Debounced server-side search for the marksheet student picker
  useEffect(() => {
    if (!showMarksheetDialog || !canEditMarks) return;
    if (marksheetSearch.length < 2) { setMarksheetSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        setMarksheetSearchLoading(true);
        const res = await api.get('/students', { params: { search: marksheetSearch, limit: 30 } });
        const arr = Array.isArray(res.data) ? res.data : (res.data?.students ?? []);
        setMarksheetSearchResults(arr);
      } catch { setMarksheetSearchResults([]); }
      finally { setMarksheetSearchLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [marksheetSearch, showMarksheetDialog, canEditMarks]);

  const refreshExams = async () => {
    try {
      const res = await api.get('/exams', { params: viewSession ? { academic_year: viewSession } : {} });
      setExams(res.data);
    } catch (e) {}
  };

  const openMarksheetDialog = async () => {
    setShowMarksheetDialog(true);
    setMarksheetData(null);
    setMarksheetStudentId('');
    setMarksheetSearch('');
    setMarksheetSearchResults([]);
    setMarksheetYear('all');
    // Students/parents: auto-load the student's own marksheet
    if (!canEditMarks) {
      try {
        const res = await api.get('/students');
        const arr = Array.isArray(res.data) ? res.data : (res.data?.students ?? []);
        setMarksheetStudents(arr);
        if (arr.length === 1) {
          const self = arr[0];
          setMarksheetStudentId(self.student_id);
          setMarksheetSearch(`${self.first_name} ${self.last_name} (${self.admission_number})`);
          try {
            const mr = await api.get(`/marks/marksheet/${self.student_id}`, {
              params: { academic_year: currentAcademicYear() },
            });
            setMarksheetData(mr.data);
          } catch (err) {}
        }
      } catch (e) {}
    }
  };

  // ====== EXAM CRUD ======
  const addSubjectRow = () => {
    setExamForm(prev => ({
      ...prev,
      subjects: [...prev.subjects, { subject: '', max_marks: 100 }]
    }));
  };

  const removeSubjectRow = (idx) => {
    setExamForm(prev => ({
      ...prev,
      subjects: prev.subjects.filter((_, i) => i !== idx)
    }));
  };

  const updateSubjectRow = (idx, field, value) => {
    setExamForm(prev => ({
      ...prev,
      subjects: prev.subjects.map((s, i) => i === idx ? { ...s, [field]: value } : s)
    }));
  };

  const createExam = async () => {
    if (!examForm.name || !examForm.class_name || examForm.subjects.length === 0) {
      toast.error('Fill all required fields');
      return;
    }
    const validSubjects = examForm.subjects.filter(s => s.subject && s.max_marks > 0);
    if (validSubjects.length === 0) {
      toast.error('Add at least one subject with max marks');
      return;
    }

    setSavingExam(true);
    try {
      await api.post('/exams', {
        ...examForm,
        subjects: validSubjects.map(s => ({ subject: s.subject, max_marks: parseFloat(s.max_marks) }))
      });
      toast.success('Exam created');
      setShowExamDialog(false);
      setExamForm({ name: '', exam_type: 'term', class_name: '', academic_year: currentAcademicYear(), subjects: [{ subject: '', max_marks: 100 }], start_date: '', end_date: '' });
      refreshExams();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create exam');
    } finally {
      setSavingExam(false);
    }
  };

  const toggleLockExam = async (exam) => {
    try {
      if (exam.is_locked) {
        await api.post(`/exams/${exam.exam_id}/unlock`);
        toast.success('Exam unlocked');
      } else {
        await api.post(`/exams/${exam.exam_id}/lock`);
        toast.success('Exam locked');
      }
      refreshExams();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  const publishExam = async (exam) => {
    try {
      await api.post(`/exams/${exam.exam_id}/publish`);
      toast.success('Results published');
      refreshExams();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed');
    }
  };

  // ====== MARKS ENTRY ======
  const loadStudentsForMarks = useCallback(async () => {
    if (!selectedExam || !selectedSection) return;
    const cacheKey = `marks:${selectedExam.exam_id}:${selectedSection}`;
    const cached = getCached(cacheKey);
    if (cached) {
      setStudents(cached.students);
      setExistingMarks(cached.existingMarks);
      setMarksData(cached.marksData);
      setMarksLoading(false);
    } else {
      setMarksLoading(true);
    }
    try {
      const [studRes, marksRes] = await Promise.all([
        api.get('/students', { params: { class_name: selectedExam.class_name, section: selectedSection } }),
        api.get('/marks', { params: { exam_id: selectedExam.exam_id, class_name: selectedExam.class_name, section: selectedSection } }),
      ]);
      const studArr = studRes.data.students ?? studRes.data ?? [];
      setStudents(studArr);
      setExistingMarks(marksRes.data);
      // Build marks map: { student_id: { subject: marks_obtained } }
      const map = {};
      marksRes.data.forEach(m => {
        if (!map[m.student_id]) map[m.student_id] = {};
        map[m.student_id][m.subject] = m.marks_obtained;
      });
      setMarksData(map);
      setCached(cacheKey, { students: studArr, existingMarks: marksRes.data, marksData: map });
    } catch (error) {
      if (!cached) toast.error('Failed to load data');
    } finally {
      setMarksLoading(false);
    }
  }, [selectedExam, selectedSection]);

  useEffect(() => {
    loadStudentsForMarks();
  }, [loadStudentsForMarks]);

  const handleMarkChange = (studentId, subject, value, maxMarks) => {
    const num = parseFloat(value);
    if (value !== '' && !isNaN(num) && maxMarks !== undefined && num > maxMarks) return;
    setMarksData(prev => ({
      ...prev,
      [studentId]: { ...(prev[studentId] || {}), [subject]: value }
    }));
  };

  const saveMarks = async () => {
    if (!selectedExam) return;
    // Pre-save validation: block if any entered mark exceeds max
    for (const s of students) {
      for (const subj of (selectedExam.subjects || [])) {
        const val = marksData[s.student_id]?.[subj.subject];
        if (val !== undefined && val !== '') {
          const num = parseFloat(val);
          if (!isNaN(num) && num > subj.max_marks) {
            toast.error(`${s.first_name} ${s.last_name}: ${subj.subject} marks (${num}) exceed maximum (${subj.max_marks})`);
            return;
          }
          if (!isNaN(num) && num < 0) {
            toast.error(`${s.first_name} ${s.last_name}: ${subj.subject} marks cannot be negative`);
            return;
          }
        }
      }
    }
    setSavingMarks(true);
    try {
      const records = [];
      students.forEach(s => {
        (selectedExam.subjects || []).forEach(subj => {
          const val = marksData[s.student_id]?.[subj.subject];
          if (val !== undefined && val !== '') {
            records.push({
              student_id: s.student_id,
              subject: subj.subject,
              marks_obtained: parseFloat(val),
              max_marks: subj.max_marks,
              section: selectedSection,
            });
          }
        });
      });

      if (records.length === 0) {
        toast.error('No marks to save');
        setSavingMarks(false);
        return;
      }

      const res = await api.post('/marks', { exam_id: selectedExam.exam_id, records });
      if (res.data.failed > 0) {
        toast.warning(`${res.data.success} saved, ${res.data.failed} failed`);
      } else {
        toast.success(`${res.data.success} marks saved`);
      }
      loadStudentsForMarks();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save marks');
    } finally {
      setSavingMarks(false);
    }
  };

  // ====== MARKSHEET ======
  const generateMarksheet = async () => {
    if (!marksheetStudentId) {
      toast.error('Select a student first');
      return;
    }
    try {
      const params = (marksheetYear && marksheetYear !== 'all') ? { academic_year: marksheetYear } : {};
      const res = await api.get(`/marks/marksheet/${marksheetStudentId}`, { params });
      setMarksheetData(res.data);
      if (res.data.summary?.total_max === 0) {
        toast.warning('No marks found for this student. Try a different academic year or check that marks have been entered.');
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to generate marksheet');
    }
  };

  const selectedExamSections = selectedExam
    ? (classes.find(c => c.name === selectedExam.class_name)?.sections || [])
    : [];

  const examTypes = [
    { value: 'unit_test', label: 'Unit Test' },
    { value: 'term', label: 'Term Exam' },
    { value: 'annual', label: 'Annual Exam' },
  ];

  const [examsPage, setExamsPage] = useState(1);
  const [entryPage, setEntryPage] = useState(1);
  const [viewPage, setViewPage] = useState(1);
  useEffect(() => { setExamsPage(1); }, [exams]);
  useEffect(() => { setEntryPage(1); setViewPage(1); }, [students]);

  return (
    <div data-testid="marks-page">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 pb-6 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Marks & Grades</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Define exams, enter marks, generate marksheets</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-xl text-xs" onClick={openMarksheetDialog} data-testid="generate-marksheet-btn">
            <FileText className="h-4 w-4 mr-2" strokeWidth={1.5} /> Marksheet
          </Button>
          {isAdmin && (
            <Button className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs" onClick={() => setShowExamDialog(true)} data-testid="create-exam-btn">
              <Plus className="h-4 w-4 mr-2" strokeWidth={1.5} /> Create Exam
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6 rounded-xl h-10 bg-slate-100">
          {isAdmin && <TabsTrigger value="exams" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="exams-tab">Exams</TabsTrigger>}
          {canEditMarks && <TabsTrigger value="entry" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="entry-tab">Marks Entry</TabsTrigger>}
          {/* Teachers enter marks via Marks Entry — they don't need a separate read-only view. */}
          {!isTeacher && (
            <TabsTrigger value="view" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="view-tab">
              {isAdmin ? 'View Marks' : 'My Marks'}
            </TabsTrigger>
          )}
        </TabsList>

        {/* ====== EXAMS TAB (Admin) ====== */}
        {isAdmin && (
          <TabsContent value="exams">
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs text-muted-foreground font-medium">Exam Name</TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium">Type</TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium">Class</TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium">Subjects</TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium">Status</TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exams.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-slate-500">No exams defined yet</TableCell>
                    </TableRow>
                  ) : exams.slice((examsPage - 1) * MARKS_PAGE_SIZE, examsPage * MARKS_PAGE_SIZE).map(exam => (
                    <TableRow key={exam.exam_id} className="hover:bg-slate-50">
                      <TableCell className="font-semibold text-slate-900">{exam.name}</TableCell>
                      <TableCell className="text-xs uppercase text-slate-500">{exam.exam_type}</TableCell>
                      <TableCell>{exam.class_name}</TableCell>
                      <TableCell className="text-xs text-slate-500">{exam.subjects?.map(s => s.subject).join(', ')}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {exam.is_locked && (
                            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
                              <Lock className="h-3 w-3 mr-1" /> Locked
                            </span>
                          )}
                          {exam.is_published && (
                            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                              <Eye className="h-3 w-3 mr-1" /> Published
                            </span>
                          )}
                          {!exam.is_locked && !exam.is_published && (
                            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200">
                              Draft
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button variant="outline" size="sm" className="text-xs rounded-xl" onClick={() => toggleLockExam(exam)} data-testid={`toggle-lock-${exam.exam_id}`}>
                            {exam.is_locked ? <><Unlock className="h-3 w-3 mr-1" /> Unlock</> : <><Lock className="h-3 w-3 mr-1" /> Lock</>}
                          </Button>
                          {!exam.is_published && (
                            <Button variant="outline" size="sm" className="text-xs rounded-xl border-slate-900 text-slate-900" onClick={() => publishExam(exam)} data-testid={`publish-${exam.exam_id}`}>
                              <Eye className="h-3 w-3 mr-1" /> Publish
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <MarksPager page={examsPage} total={exams.length} onPage={setExamsPage} />
            </div>
          </TabsContent>
        )}

        {/* ====== MARKS ENTRY TAB ====== */}
        <TabsContent value="entry">
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
                <div className="space-y-1.5 min-w-[200px]">
                  <Label>Select Exam</Label>
                  <Select value={selectedExam?.exam_id || ''} onValueChange={(v) => {
                    const exam = exams.find(e => e.exam_id === v);
                    setSelectedExam(exam || null);
                    setSelectedSection('');
                  }} disabled={exams.length === 0}>
                    <SelectTrigger data-testid="marks-exam-select">
                      <SelectValue placeholder={exams.length === 0 ? 'No exams for this session' : 'Choose an exam'} />
                    </SelectTrigger>
                    <SelectContent>
                      {exams.filter(e => !e.is_locked || isAdmin).map(e => (
                        <SelectItem key={e.exam_id} value={e.exam_id}>
                          {e.name} — {e.class_name} {e.is_locked ? '(Locked)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {exams.length === 0 && isAdmin && (
                    <p className="text-xs text-slate-500">
                      Go to the <button className="underline text-slate-700 font-medium" onClick={() => setActiveTab('exams')}>Exams tab</button> to create one.
                    </p>
                  )}
                </div>
                {selectedExam && (
                  <div className="space-y-1.5">
                    <Label>Section</Label>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                      <SelectTrigger className="w-[150px]" data-testid="marks-section-select">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedExamSections.map(sec => {
                          const secName = typeof sec === 'string' ? sec : sec.section_name;
                          return <SelectItem key={secName} value={secName}>{secName}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {canEditMarks && selectedExam && selectedSection && (
                  <Button
                    onClick={saveMarks}
                    disabled={savingMarks || selectedExam.is_locked}
                    className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs"
                    data-testid="save-marks-btn"
                  >
                    {savingMarks ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : 'Save Marks'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Locked Banner */}
          {selectedExam?.is_locked && (
            <div className="mb-4 flex items-center gap-3 bg-slate-900 text-white px-5 py-3 rounded-xl" data-testid="exam-locked-banner">
              <Lock className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
              <span className="text-sm font-medium">This exam is locked. {isAdmin ? 'Unlock from the Exams tab to edit.' : 'Contact admin to unlock.'}</span>
            </div>
          )}

          {/* Marks Entry Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-auto">
            {marksLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-900 border-t-transparent" />
              </div>
            ) : !selectedExam || !selectedSection ? (
              <div className="text-center py-12 text-slate-500">
                <GraduationCap className="h-12 w-12 mx-auto mb-4" strokeWidth={1} />
                <p className="font-medium">Select an exam and section to enter marks</p>
              </div>
            ) : students.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <p>No students found in {selectedExam.class_name}-{selectedSection}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs text-muted-foreground font-medium sticky left-0 bg-slate-50">Student</TableHead>
                    {(selectedExam.subjects || []).map(s => (
                      <TableHead key={s.subject} className="text-xs text-muted-foreground font-medium text-center min-w-[100px]">
                        {s.subject}<br /><span className="text-[10px] font-normal text-muted-foreground">/{s.max_marks}</span>
                      </TableHead>
                    ))}
                    <TableHead className="text-xs text-muted-foreground font-medium text-center">Total</TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium text-center">%</TableHead>
                    <TableHead className="text-xs text-muted-foreground font-medium text-center">Grade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.slice((entryPage - 1) * MARKS_PAGE_SIZE, entryPage * MARKS_PAGE_SIZE).map(student => {
                    const studentMarks = marksData[student.student_id] || {};
                    let totalObt = 0, totalMax = 0;
                    (selectedExam.subjects || []).forEach(s => {
                      const val = parseFloat(studentMarks[s.subject]);
                      if (!isNaN(val)) { totalObt += val; totalMax += s.max_marks; }
                    });
                    const pct = totalMax > 0 ? (totalObt / totalMax) * 100 : 0;
                    const gradeInfo = totalMax > 0 ? GRADE_MAP(pct) : null;

                    return (
                      <TableRow key={student.student_id}>
                        <TableCell className="sticky left-0 bg-white">
                          <p className="font-medium text-slate-900 text-sm">{student.first_name} {student.last_name}</p>
                          <p className="text-[10px] text-slate-500">{student.admission_number}</p>
                        </TableCell>
                        {(selectedExam.subjects || []).map(s => (
                          <TableCell key={s.subject} className="text-center">
                            <Input
                              type="number"
                              min="0"
                              max={s.max_marks}
                              className={`w-20 text-center mx-auto text-sm ${
                                (() => { const v = parseFloat(studentMarks[s.subject]); return !isNaN(v) && v > s.max_marks ? 'border-red-500 focus-visible:ring-red-500' : ''; })()
                              }`}
                              value={studentMarks[s.subject] ?? ''}
                              onChange={(e) => handleMarkChange(student.student_id, s.subject, e.target.value, s.max_marks)}
                              disabled={selectedExam.is_locked && !isAdmin}
                              data-testid={`marks-input-${student.student_id}-${s.subject}`}
                            />
                          </TableCell>
                        ))}
                        <TableCell className="text-center font-bold text-slate-900">{totalMax > 0 ? totalObt : '-'}</TableCell>
                        <TableCell className="text-center font-medium">{totalMax > 0 ? `${pct.toFixed(1)}%` : '-'}</TableCell>
                        <TableCell className="text-center">
                          {gradeInfo && (
                            <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${gradeInfo.cls}`}>
                              {gradeInfo.grade}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            <MarksPager page={entryPage} total={students.length} onPage={setEntryPage} />
          </div>
        </TabsContent>

        {/* ====== VIEW MARKS TAB ====== */}
        <TabsContent value="view">
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
                  <div className="space-y-1.5 min-w-[200px]">
                    <Label>Select Exam</Label>
                    <Select value={selectedExam?.exam_id || ''} onValueChange={(v) => {
                      const exam = exams.find(e => e.exam_id === v);
                      setSelectedExam(exam || null);
                      setSelectedSection('');
                    }}>
                      <SelectTrigger data-testid="view-exam-select">
                        <SelectValue placeholder="Choose an exam" />
                      </SelectTrigger>
                      <SelectContent>
                        {exams.map(e => (
                          <SelectItem key={e.exam_id} value={e.exam_id}>{e.name} — {e.class_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedExam && (
                    <div className="space-y-1.5">
                      <Label>Section</Label>
                      <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-[150px]" data-testid="view-section-select">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedExamSections.map(sec => {
                            const secName = typeof sec === 'string' ? sec : sec.section_name;
                            return <SelectItem key={secName} value={secName}>{secName}</SelectItem>;
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {selectedExam && selectedSection && students.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs text-muted-foreground font-medium">Student</TableHead>
                      {(selectedExam.subjects || []).map(s => (
                        <TableHead key={s.subject} className="text-xs text-muted-foreground font-medium text-center">{s.subject}</TableHead>
                      ))}
                      <TableHead className="text-xs text-muted-foreground font-medium text-center">Total</TableHead>
                      <TableHead className="text-xs text-muted-foreground font-medium text-center">Grade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.slice((viewPage - 1) * MARKS_PAGE_SIZE, viewPage * MARKS_PAGE_SIZE).map(student => {
                      const studentMarks = marksData[student.student_id] || {};
                      let totalObt = 0, totalMax = 0;
                      (selectedExam.subjects || []).forEach(s => {
                        const val = parseFloat(studentMarks[s.subject]);
                        if (!isNaN(val)) { totalObt += val; totalMax += s.max_marks; }
                      });
                      const pct = totalMax > 0 ? (totalObt / totalMax) * 100 : 0;
                      const gradeInfo = totalMax > 0 ? GRADE_MAP(pct) : null;

                      return (
                        <TableRow key={student.student_id}>
                          <TableCell>
                            <p className="font-medium text-slate-900">{student.first_name} {student.last_name}</p>
                            <p className="text-[10px] text-slate-500">{student.admission_number}</p>
                          </TableCell>
                          {(selectedExam.subjects || []).map(s => (
                            <TableCell key={s.subject} className="text-center">
                              {studentMarks[s.subject] !== undefined ? studentMarks[s.subject] : '-'}
                            </TableCell>
                          ))}
                          <TableCell className="text-center font-bold">{totalMax > 0 ? `${totalObt}/${totalMax}` : '-'}</TableCell>
                          <TableCell className="text-center">
                            {gradeInfo && <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${gradeInfo.cls}`}>{gradeInfo.grade}</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <MarksPager page={viewPage} total={students.length} onPage={setViewPage} />
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ====== CREATE EXAM DIALOG ====== */}
      <Dialog open={showExamDialog} onOpenChange={setShowExamDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-900">Create Exam Definition</DialogTitle>
            <DialogDescription>Define exam with subjects and max marks per subject</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Exam Name</Label>
                <Input value={examForm.name} onChange={e => setExamForm({ ...examForm, name: e.target.value })} placeholder="e.g. Term 1 Exam" data-testid="exam-name-input" />
              </div>
              <div className="space-y-1.5">
                <Label>Exam Type</Label>
                <Select value={examForm.exam_type} onValueChange={v => setExamForm({ ...examForm, exam_type: v })}>
                  <SelectTrigger data-testid="exam-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {examTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Class</Label>
                <Select value={examForm.class_name} onValueChange={v => setExamForm({ ...examForm, class_name: v })}>
                  <SelectTrigger data-testid="exam-class-select"><SelectValue placeholder="Select class" /></SelectTrigger>
                  <SelectContent>
                    {classes.map(c => <SelectItem key={c.name} value={c.name}>{c.display_name || c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Academic Year</Label>
                <Input value={examForm.academic_year} onChange={e => setExamForm({ ...examForm, academic_year: e.target.value })} data-testid="exam-year-input" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Subjects & Max Marks</Label>
                <Button variant="outline" size="sm" className="text-xs" onClick={addSubjectRow} data-testid="add-subject-btn">
                  <Plus className="h-3 w-3 mr-1" /> Add Subject
                </Button>
              </div>
              {examForm.subjects.map((s, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Select value={s.subject} onValueChange={v => updateSubjectRow(idx, 'subject', v)}>
                    <SelectTrigger className="flex-1" data-testid={`exam-subject-${idx}`}><SelectValue placeholder="Subject" /></SelectTrigger>
                    <SelectContent>
                      {subjects.map(subj => <SelectItem key={subj} value={subj}>{subj}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    className="w-24"
                    value={s.max_marks}
                    onChange={e => updateSubjectRow(idx, 'max_marks', e.target.value)}
                    placeholder="Max"
                    data-testid={`exam-max-marks-${idx}`}
                  />
                  {examForm.subjects.length > 1 && (
                    <Button variant="outline" size="sm" className="h-10 w-10 p-0" onClick={() => removeSubjectRow(idx)}>
                      <Trash2 className="h-4 w-4 text-slate-500" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExamDialog(false)}>Cancel</Button>
            <Button className="bg-slate-900 text-white hover:bg-slate-800" onClick={createExam} disabled={savingExam} data-testid="save-exam-btn">
              {savingExam ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : 'Create Exam'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ====== MARKSHEET DIALOG ====== */}
      <Dialog open={showMarksheetDialog} onOpenChange={setShowMarksheetDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-900">CBSE Format Marksheet</DialogTitle>
            <DialogDescription>
              {canEditMarks ? 'Enter student ID to generate marksheet' : 'Preview your marksheet below and download as PDF.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {canEditMarks ? (
            <div className="flex gap-4 items-end">
              <div className="flex-1 space-y-1.5">
                <Label>Search Student</Label>
                <Input
                  value={marksheetSearch}
                  onChange={e => { setMarksheetSearch(e.target.value); setMarksheetStudentId(''); }}
                  placeholder="Type name, admission number or class..."
                  data-testid="marksheet-student-search"
                />
                {marksheetSearch.length >= 2 && !marksheetStudentId && (
                  <div className="border border-slate-200 rounded-xl bg-white shadow-sm max-h-48 overflow-y-auto">
                    {marksheetSearchLoading && (
                      <p className="px-3 py-2 text-sm text-slate-400">Searching...</p>
                    )}
                    {!marksheetSearchLoading && marksheetSearchResults.map(s => (
                      <div
                        key={s.student_id}
                        className="px-3 py-2 cursor-pointer hover:bg-slate-50 flex justify-between items-center"
                        onClick={() => {
                          setMarksheetStudentId(s.student_id);
                          setMarksheetSearch(`${s.first_name} ${s.last_name} (${s.admission_number})`);
                          setMarksheetSearchResults([]);
                        }}
                      >
                        <span className="text-sm font-medium text-slate-900">{s.first_name} {s.last_name}</span>
                        <span className="text-xs text-slate-500">{s.class_name} - {s.section} · {s.admission_number}</span>
                      </div>
                    ))}
                    {!marksheetSearchLoading && marksheetSearchResults.length === 0 && (
                      <p className="px-3 py-2 text-sm text-slate-500">No students found</p>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Academic Year</Label>
                <Select value={marksheetYear} onValueChange={setMarksheetYear}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="All years" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All years</SelectItem>
                    {(() => {
                      const cur = currentAcademicYear();
                      const [y] = cur.split('-').map(Number);
                      return [cur, `${y - 1}-${y}`, `${y - 2}-${y - 1}`];
                    })().map(yr => <SelectItem key={yr} value={yr}>{yr}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl" onClick={generateMarksheet} disabled={!marksheetStudentId} data-testid="fetch-marksheet-btn">Generate</Button>
            </div>
            ) : null}

            {marksheetData && (
              <div className="border border-slate-200 rounded-2xl p-6 bg-white" id="marksheet">
                <div className="text-center border-b border-slate-200 pb-4 mb-4">
                  <h2 className="text-2xl font-bold text-slate-900">SHEMFORD FUTURISTIC SCHOOL</h2>
                  <p className="text-sm text-slate-500">Katwa, West Bengal | CBSE Affiliated</p>
                  <h3 className="text-lg font-semibold mt-2 text-slate-900">Progress Report</h3>
                  <p className="text-xs text-slate-500">Academic Year: {marksheetData.academic_year || 'All'}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6 p-4 bg-slate-50 rounded-xl">
                  <div>
                    <p className="stat-label">Student Name</p>
                    <p className="font-semibold text-slate-900">{marksheetData.student?.first_name} {marksheetData.student?.last_name}</p>
                  </div>
                  <div>
                    <p className="stat-label">Admission No.</p>
                    <p className="font-semibold text-slate-900">{marksheetData.student?.admission_number}</p>
                  </div>
                  <div>
                    <p className="stat-label">Class</p>
                    <p className="font-semibold text-slate-900">{marksheetData.student?.class_name} - {marksheetData.student?.section}</p>
                  </div>
                  <div>
                    <p className="stat-label">Roll No.</p>
                    <p className="font-semibold text-slate-900">{marksheetData.student?.roll_number || '-'}</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <Table className="w-full table-fixed">
                    <TableHeader>
                      <TableRow className="bg-slate-100">
                        <TableHead className="w-[40%] text-xs text-slate-900 font-semibold">Subject</TableHead>
                        <TableHead className="w-[15%] text-xs text-slate-900 font-semibold text-center whitespace-nowrap">Obtained</TableHead>
                        <TableHead className="w-[15%] text-xs text-slate-900 font-semibold text-center whitespace-nowrap">Max</TableHead>
                        <TableHead className="w-[15%] text-xs text-slate-900 font-semibold text-center whitespace-nowrap">%</TableHead>
                        <TableHead className="w-[15%] text-xs text-slate-900 font-semibold text-center">Grade</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(marksheetData.subjects || {}).map(([subject, marks]) => {
                        const totalObtained = marks.reduce((sum, m) => sum + m.marks_obtained, 0);
                        const totalMax = marks.reduce((sum, m) => sum + m.max_marks, 0);
                        const pct = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0;
                        const gradeInfo = GRADE_MAP(pct);
                        const fmt = v => Number.isInteger(v) ? v : parseFloat(v.toFixed(2));
                        return (
                          <TableRow key={subject}>
                            <TableCell className="font-medium text-slate-900 truncate max-w-0">{subject}</TableCell>
                            <TableCell className="text-center text-sm tabular-nums">{fmt(totalObtained)}</TableCell>
                            <TableCell className="text-center text-sm tabular-nums">{fmt(totalMax)}</TableCell>
                            <TableCell className="text-center text-sm tabular-nums whitespace-nowrap">{pct.toFixed(2)}%</TableCell>
                            <TableCell className="text-center">
                              <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${gradeInfo.cls}`}>{gradeInfo.grade}</span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-900 p-3 rounded-xl text-center">
                    <p className="stat-label-dark text-xs">Total</p>
                    <p className="text-base font-bold text-white tabular-nums leading-tight">
                      {marksheetData.summary?.total_obtained}/{marksheetData.summary?.total_max}
                    </p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl text-center">
                    <p className="stat-label text-xs">Percentage</p>
                    <p className="text-base font-bold text-slate-900 tabular-nums leading-tight">
                      {parseFloat(marksheetData.summary?.percentage ?? 0).toFixed(2)}%
                    </p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl text-center">
                    <p className="stat-label text-xs">Grade</p>
                    <p className="text-base font-bold text-slate-900 leading-tight">{marksheetData.summary?.grade}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl text-center">
                    <p className="stat-label text-xs">Result</p>
                    <p className={`text-base font-bold leading-tight ${marksheetData.summary?.result === 'PASS' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {marksheetData.summary?.result}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="outline" className="rounded-xl text-xs" onClick={() => window.print()} data-testid="print-marksheet-btn">
                    <Download className="h-4 w-4 mr-2" strokeWidth={1.5} /> Print
                  </Button>
                  <Button className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs" onClick={() => {
                    const pdfParams = (marksheetYear && marksheetYear !== 'all') ? { academic_year: marksheetYear } : {};
                    return previewInTab(
                      () => api.get(`/marks/marksheet/${marksheetStudentId}/pdf`, { params: pdfParams, responseType: 'blob' }),
                      { kind: 'pdf', errorMessage: 'Failed to load marksheet' },
                    );
                  }} data-testid="download-marksheet-pdf">
                    <Download className="h-4 w-4 mr-2" strokeWidth={1.5} /> PDF
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MarksPage;
