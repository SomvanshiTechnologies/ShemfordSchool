import React, { useState, useEffect } from 'react';
import { currentAcademicYear } from '../lib/academicYear';
import api from '../lib/api';
import { getCached, setCached } from '../lib/pageCache';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
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
import { toast } from 'sonner';
import { Plus, BookOpen, Search, FileText, ExternalLink, Calendar, GraduationCap, BookMarked, ChevronDown, ChevronUp } from 'lucide-react';

// Canonical class order for sorting
const CLASS_ORDER = ['Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12'];

function sortClasses(a, b) {
  const ia = CLASS_ORDER.indexOf(a);
  const ib = CLASS_ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

const SUBJECT_COLORS = {
  'English':       'bg-blue-50 text-blue-700 border-blue-200',
  'Hindi':         'bg-orange-50 text-orange-700 border-orange-200',
  'Math':          'bg-purple-50 text-purple-700 border-purple-200',
  'Mathematics':   'bg-purple-50 text-purple-700 border-purple-200',
  'Science':       'bg-green-50 text-green-700 border-green-200',
  'Social Studies':'bg-yellow-50 text-yellow-700 border-yellow-200',
  'Social Science':'bg-yellow-50 text-yellow-700 border-yellow-200',
  'Physics':       'bg-cyan-50 text-cyan-700 border-cyan-200',
  'Chemistry':     'bg-red-50 text-red-700 border-red-200',
  'Biology':       'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Sanskrit':      'bg-amber-50 text-amber-700 border-amber-200',
  'EVS':           'bg-lime-50 text-lime-700 border-lime-200',
  'Drawing':       'bg-pink-50 text-pink-700 border-pink-200',
  'default':       'bg-gray-50 text-gray-700 border-gray-200',
};

function subjectColor(subject) {
  return SUBJECT_COLORS[subject] || SUBJECT_COLORS['default'];
}

const SyllabusPage = () => {
  const { isAdmin, isTeacher, isParent } = useAuth();
  const [syllabusList, setSyllabusList] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [viewItem, setViewItem] = useState(null);
  const [expandedClasses, setExpandedClasses] = useState({});
  const [formData, setFormData] = useState({
    class_name: '',
    subject: '',
    title: '',
    description: '',
    file_url: '',
    file_name: '',
    academic_year: currentAcademicYear()
  });

  useEffect(() => {
    fetchData();
  }, [filterClass, filterSubject]);

  const fetchData = async () => {
    const cacheKey = `syllabus:${filterClass}:${filterSubject}`;
    const cached = getCached(cacheKey);
    if (cached) {
      setSyllabusList(cached.syllabus);
      setClasses(cached.classes);
      setLoading(false);
    }
    try {
      const params = {};
      if (filterClass) params.class_name = filterClass;
      if (filterSubject) params.subject = filterSubject;

      const [syllabusRes, classesRes] = await Promise.all([
        api.get('/syllabus', { params }),
        api.get('/classes'),
      ]);

      let syllabus = syllabusRes.data;

      // Parents: restrict to their children's classes only
      if (isParent) {
        try {
          const childrenRes = await api.get('/students');
          const childClasses = [...new Set(childrenRes.data.map(c => c.class_name))];
          syllabus = syllabus.filter(s => childClasses.includes(s.class_name));
        } catch {
          syllabus = [];
        }
      }

      setSyllabusList(syllabus);
      setClasses(classesRes.data);
      setCached(cacheKey, { syllabus, classes: classesRes.data });
    } catch (error) {
      if (!cached) toast.error('Failed to fetch syllabus data');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/syllabus', formData);
      toast.success('Syllabus uploaded successfully');
      setShowAddDialog(false);
      setFormData({
        class_name: '',
        subject: '',
        title: '',
        description: '',
        file_url: '',
        file_name: '',
        academic_year: currentAcademicYear()
      });
      fetchData();
    } catch (error) {
      toast.error('Failed to upload syllabus');
    }
  };

  // Derive unique subjects from actual data
  const allSubjects = [...new Set(syllabusList.map(s => s.subject))].sort();

  const filteredSyllabus = syllabusList.filter(s => {
    const term = searchTerm.toLowerCase();
    return (
      s.title.toLowerCase().includes(term) ||
      s.subject.toLowerCase().includes(term) ||
      s.description?.toLowerCase().includes(term)
    );
  });

  // Group by class_name, sorted in school order
  const groupedSyllabus = filteredSyllabus.reduce((acc, item) => {
    const key = item.class_name;
    if (!acc[key]) acc[key] = {};
    if (!acc[key][item.subject]) acc[key][item.subject] = [];
    acc[key][item.subject].push(item);
    return acc;
  }, {});

  const sortedClassKeys = Object.keys(groupedSyllabus).sort(sortClasses);

  const toggleClass = (cls) => {
    setExpandedClasses(prev => ({ ...prev, [cls]: !prev[cls] }));
  };

  const isExpanded = (cls) => expandedClasses[cls] !== false; // default expanded

  const displayClassName = (cls) => {
    if (['Nursery','LKG','UKG'].includes(cls)) return cls;
    return `Class ${cls}`;
  };

  return (
    <div data-testid="syllabus-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Syllabus</h1>
          <p className="text-sm text-slate-500 mt-1">
            {syllabusList.length} entries across {sortedClassKeys.length} classes
          </p>
        </div>
        {(isAdmin || isTeacher) && (
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button data-testid="upload-syllabus-btn">
                <Plus className="h-4 w-4 mr-2" />
                Upload Syllabus
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Upload Syllabus</DialogTitle>
                <DialogDescription>Add a new syllabus or study material</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit}>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Class *</Label>
                      <Select
                        value={formData.class_name}
                        onValueChange={(value) => setFormData({...formData, class_name: value})}
                      >
                        <SelectTrigger data-testid="syllabus-class">
                          <SelectValue placeholder="Select class" />
                        </SelectTrigger>
                        <SelectContent>
                          {classes.sort((a,b) => sortClasses(a.name, b.name)).map((cls) => (
                            <SelectItem key={cls.name} value={cls.name}>{displayClassName(cls.name)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Subject *</Label>
                      <Input
                        value={formData.subject}
                        onChange={(e) => setFormData({...formData, subject: e.target.value})}
                        placeholder="e.g., Mathematics"
                        required
                        data-testid="syllabus-subject"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Title *</Label>
                    <Input
                      value={formData.title}
                      onChange={(e) => setFormData({...formData, title: e.target.value})}
                      placeholder="e.g., Chapter 1 – Number Systems"
                      required
                      data-testid="syllabus-title"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input
                      value={formData.description}
                      onChange={(e) => setFormData({...formData, description: e.target.value})}
                      placeholder="Brief description of topics covered"
                      data-testid="syllabus-description"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>File URL <span className="text-slate-500 font-normal">(optional)</span></Label>
                    <Input
                      value={formData.file_url}
                      onChange={(e) => setFormData({...formData, file_url: e.target.value})}
                      placeholder="https://drive.google.com/..."
                      data-testid="syllabus-url"
                    />
                    <p className="text-xs text-slate-500">Direct link to PDF or document (Google Drive, etc.)</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Academic Year</Label>
                    <Input
                      value={formData.academic_year}
                      onChange={(e) => setFormData({...formData, academic_year: e.target.value})}
                      data-testid="syllabus-year"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                  <Button type="submit" data-testid="submit-syllabus-btn">Upload</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Parent notice */}
      {isParent && (
        <div className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800 flex items-center gap-2">
          <BookOpen className="h-4 w-4 shrink-0" />
          Showing syllabus only for your children's classes.
        </div>
      )}

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search by title, subject or description…"
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="search-syllabus"
              />
            </div>
            <Select value={filterClass || 'all'} onValueChange={(v) => setFilterClass(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-[160px]" data-testid="filter-class">
                <SelectValue placeholder="All Classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {classes.sort((a,b) => sortClasses(a.name, b.name)).map((cls) => (
                  <SelectItem key={cls.name} value={cls.name}>{displayClassName(cls.name)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSubject || 'all'} onValueChange={(v) => setFilterSubject(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-[160px]" data-testid="filter-subject">
                <SelectValue placeholder="All Subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subjects</SelectItem>
                {allSubjects.map((subj) => (
                  <SelectItem key={subj} value={subj}>{subj}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-900 border-t-transparent" />
        </div>
      ) : sortedClassKeys.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-slate-500">
            <BookOpen className="h-14 w-14 mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-semibold text-slate-900 mb-1">No syllabus found</h3>
            <p className="text-sm">Try adjusting your filters or upload a new entry.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sortedClassKeys.map((cls) => {
            const subjectMap = groupedSyllabus[cls];
            const subjects = Object.keys(subjectMap).sort();
            const totalItems = subjects.reduce((n, s) => n + subjectMap[s].length, 0);
            const expanded = isExpanded(cls);

            return (
              <Card key={cls} className="overflow-hidden">
                {/* Class header — click to expand/collapse */}
                <button
                  className="w-full flex items-center justify-between px-5 py-4 bg-slate-50 border-b border-slate-200 hover:bg-slate-100 transition-colors text-left"
                  onClick={() => toggleClass(cls)}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-slate-900 flex items-center justify-center shrink-0">
                      <GraduationCap className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">{displayClassName(cls)}</h2>
                      <p className="text-xs text-slate-500">{subjects.length} subjects · {totalItems} entries</p>
                    </div>
                  </div>
                  {expanded
                    ? <ChevronUp className="h-4 w-4 text-slate-500" />
                    : <ChevronDown className="h-4 w-4 text-slate-500" />}
                </button>

                {expanded && (
                  <CardContent className="p-5">
                    <div className="space-y-5">
                      {subjects.map((subject) => (
                        <div key={subject}>
                          {/* Subject row */}
                          <div className="flex items-center gap-2 mb-3">
                            <BookMarked className="h-3.5 w-3.5 text-slate-500" />
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${subjectColor(subject)}`}>
                              {subject}
                            </span>
                            <span className="text-xs text-slate-500">{subjectMap[subject].length} item{subjectMap[subject].length !== 1 ? 's' : ''}</span>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {subjectMap[subject].map((item) => (
                              <button
                                key={item.syllabus_id}
                                data-testid={`syllabus-${item.syllabus_id}`}
                                onClick={() => setViewItem(item)}
                                className="text-left border border-slate-200 rounded-lg p-3.5 hover:border-slate-900 hover:shadow-sm transition-all bg-white group"
                              >
                                <div className="flex items-start gap-3">
                                  <div className="h-8 w-8 rounded-md bg-slate-100 group-hover:bg-slate-900 flex items-center justify-center shrink-0 transition-colors">
                                    <FileText className="h-4 w-4 text-slate-500 group-hover:text-white transition-colors" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-900 leading-snug line-clamp-2">{item.title}</p>
                                    {item.description && (
                                      <p className="text-xs text-slate-500 mt-1 line-clamp-1">{item.description}</p>
                                    )}
                                    <div className="flex items-center gap-1.5 mt-2">
                                      <Calendar className="h-3 w-3 text-slate-400" />
                                      <span className="text-xs text-slate-400">{item.academic_year}</span>
                                      {item.file_url && (
                                        <span className="ml-auto text-xs text-blue-600 font-medium">PDF</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* View / Detail Dialog */}
      <Dialog open={!!viewItem} onOpenChange={(open) => !open && setViewItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="leading-snug">{viewItem?.title}</DialogTitle>
            <DialogDescription asChild>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${subjectColor(viewItem?.subject)}`}>
                  {viewItem?.subject}
                </span>
                <span className="text-xs text-slate-500">{displayClassName(viewItem?.class_name)}</span>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {viewItem?.description && (
              <div>
                <Label className="text-xs text-slate-500 uppercase tracking-wide">Description</Label>
                <p className="text-sm text-slate-900 mt-1 leading-relaxed">{viewItem.description}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-slate-500 uppercase tracking-wide">Class</Label>
                <p className="text-sm font-medium mt-0.5">{displayClassName(viewItem?.class_name)}</p>
              </div>
              <div>
                <Label className="text-xs text-slate-500 uppercase tracking-wide">Subject</Label>
                <p className="text-sm font-medium mt-0.5">{viewItem?.subject}</p>
              </div>
              <div>
                <Label className="text-xs text-slate-500 uppercase tracking-wide">Academic Year</Label>
                <p className="text-sm font-medium mt-0.5">{viewItem?.academic_year}</p>
              </div>
              <div>
                <Label className="text-xs text-slate-500 uppercase tracking-wide">File</Label>
                <p className="text-sm font-medium mt-0.5">{viewItem?.file_name || '—'}</p>
              </div>
            </div>

            {viewItem?.file_url ? (
              <a
                href={viewItem.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full border border-slate-900 rounded-md py-2.5 text-sm font-medium hover:bg-slate-900 hover:text-white transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                Open Document
              </a>
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 p-4 text-center">
                <FileText className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                <p className="text-xs text-slate-500">No file attached to this entry.</p>
                {(isAdmin || isTeacher) && (
                  <p className="text-xs text-slate-400 mt-0.5">Edit the entry to add a document URL.</p>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SyllabusPage;
