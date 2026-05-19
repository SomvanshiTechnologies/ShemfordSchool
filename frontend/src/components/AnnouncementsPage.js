import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import { getCached, setCached } from '../lib/pageCache';

const TopProgressBar = ({ active }) =>
  active ? (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px] overflow-hidden" style={{ background: '#fde8c8' }}>
      <div className="h-full w-2/5" style={{ background: '#E88A1A', animation: 'topbar-slide 1.4s ease-in-out infinite' }} />
    </div>
  ) : null;
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Textarea } from './ui/textarea';
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
import { Plus, Bell, Search, Megaphone, Loader2, X, Trash2, Pencil } from 'lucide-react';
import { Checkbox } from './ui/checkbox';
import { formatDateTime } from '../lib/utils';
import { VoiceNotePlayer, VoiceNoteRecorder, useVoiceRecorder } from './VoiceNote';

const AnnouncementsPage = () => {
  const { user, isAdmin, isTeacher } = useAuth();
  const [deleting, setDeleting] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', content: '', priority: 'normal', target_type: 'all', target_value: '', target_audiences: [] });
  const [editing, setEditing] = useState(false);
  // When true, the existing voice note on editTarget is dropped on Save.
  const [discardExistingVoice, setDiscardExistingVoice] = useState(false);

  const openEdit = (a) => {
    setEditTarget(a);
    setDiscardExistingVoice(false);
    setEditForm({
      title: a.title || '',
      content: a.content || '',
      priority: a.priority || 'normal',
      target_type: a.target_type || 'all',
      target_value: a.target_value || '',
      target_audiences: Array.isArray(a.target_audiences) ? a.target_audiences : [],
    });
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    if (!editForm.title.trim()) {
      toast.error('Title is required');
      return;
    }
    setEditing(true);
    try {
      const audiencePayload = buildAudiencePayload({
        announcement_type: editTarget?.announcement_type,
        target_audiences: editForm.target_audiences,
        target_value: editForm.target_value,
        use_class_filter: editForm.target_type === 'class',
      });
      const payload = {
        title: editForm.title,
        content: editForm.content,
        priority: editForm.priority,
        ...audiencePayload,
      };
      // If admin explicitly discarded the existing voice note, clear the link.
      // The eventual new-upload (below) will overwrite this with the fresh id.
      if (discardExistingVoice) {
        payload.voice_note_id = null;
      }
      await api.put(`/announcements/${editTarget.announcement_id}`, payload);

      // If the admin recorded a new voice note in the edit dialog, upload it.
      // This replaces any existing voice_note_id on the announcement.
      if (editVoice.audioBlob) {
        try {
          const fd = new FormData();
          fd.append('file', editVoice.audioBlob, 'voice_note.webm');
          if (editVoice.duration) fd.append('duration_seconds', editVoice.duration);
          await api.post(
            `/announcements/${editTarget.announcement_id}/voice-note`,
            fd,
            { headers: { 'Content-Type': 'multipart/form-data' } }
          );
        } catch {
          toast.error('Announcement updated, but voice note failed to upload.');
        }
      }

      toast.success('Announcement updated');
      editVoice.discard();
      setDiscardExistingVoice(false);
      setEditTarget(null);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update');
    } finally {
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(deleteTarget.announcement_id);
    try {
      await api.delete(`/announcements/${deleteTarget.announcement_id}`);
      toast.success('Announcement deleted');
      setDeleteTarget(null);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete');
    } finally {
      setDeleting(null);
    }
  };

  const [announcements, setAnnouncements] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('general');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    target_type: 'all',
    target_value: '',
    target_audiences: [],
    use_class_filter: false,
    priority: 'normal',
    announcement_type: 'general',
    // General modal: single-select target mode
    // Employees modal: 'all' (all employees) or 'department'
    target_mode: 'all',
  });

  const AUDIENCE_OPTIONS = [
    { value: 'student', label: 'All Students' },
    { value: 'parent', label: 'All Parents' },
    { value: 'teacher', label: 'All Teachers' },
    { value: 'employee', label: 'All Employees' },
  ];

  // Homework / classwork should never target employees — keep it to students/parents/teachers
  const audienceOptionsFor = (announcementType) => {
    if (announcementType === 'homework' || announcementType === 'classwork') {
      return AUDIENCE_OPTIONS.filter((o) => o.value !== 'employee');
    }
    return AUDIENCE_OPTIONS;
  };

  const toggleAudience = (audience, formSetter) => {
    formSetter((f) => {
      const current = Array.isArray(f.target_audiences) ? f.target_audiences : [];
      const next = current.includes(audience)
        ? current.filter((a) => a !== audience)
        : [...current, audience];
      return { ...f, target_audiences: next };
    });
  };
  const voice = useVoiceRecorder();
  const editVoice = useVoiceRecorder();

  // Lazy-loaded directories for "Specific" pickers (Create-Announcement modal)
  const [departments, setDepartments] = useState([]);
  const [studentsList, setStudentsList] = useState([]);
  const [teachersList, setTeachersList] = useState([]);
  const [employeesList, setEmployeesList] = useState([]);
  const [directoriesLoaded, setDirectoriesLoaded] = useState(false);

  const loadDirectories = async () => {
    if (directoriesLoaded) return;
    try {
      const [deptRes, stuRes, empRes] = await Promise.all([
        // /employees/departments returns distinct departments actually present in DB
        // (falls back to the curated /departments list if the user lacks access)
        api.get('/employees/departments')
          .catch(() => api.get('/departments').catch(() => ({ data: [] }))),
        api.get('/students?limit=500').catch(() => ({ data: { students: [] } })),
        api.get('/employees?limit=500').catch(() => ({ data: [] })),
      ]);
      setDepartments(Array.isArray(deptRes.data) ? deptRes.data : []);
      const stu = Array.isArray(stuRes.data) ? stuRes.data : (stuRes.data?.students || []);
      setStudentsList(stu);
      const emps = Array.isArray(empRes.data) ? empRes.data : [];
      setEmployeesList(emps);
      setTeachersList(emps.filter(e => /teach|faculty|academic/i.test(e.department || '') || /teacher/i.test(e.designation || '')));
      setDirectoriesLoaded(true);
    } catch {
      // silent — pickers will appear empty and user can retry by reopening
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const cached = getCached('announcements:all');
    if (cached) {
      setAnnouncements(cached.announcements);
      setClasses(cached.classes);
      setLoading(false);
    }
    setRefreshing(true);
    try {
      const [announcementsRes, classesRes] = await Promise.all([
        api.get('/announcements'),
        api.get('/classes')
      ]);
      setAnnouncements(announcementsRes.data);
      setClasses(classesRes.data);
      setCached('announcements:all', { announcements: announcementsRes.data, classes: classesRes.data });
    } catch (error) {
      if (!cached) toast.error('Failed to fetch announcements');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Derive target_type/target_value/target_audiences for the API payload
  const buildAudiencePayload = (f) => {
    const mode = f.target_mode;
    const value = (f.target_value || '').trim();

    // Employees-category: dropdown is { all | department }
    if (f.announcement_type === 'employees') {
      if (mode === 'department' && value) {
        return { target_type: 'department', target_value: value, target_audiences: ['employee'] };
      }
      return { target_type: 'audience', target_value: null, target_audiences: ['employee'] };
    }

    // General-category: single-select mode
    if (f.announcement_type === 'general') {
      switch (mode) {
        case 'all_teachers':
          return { target_type: 'audience', target_value: null, target_audiences: ['teacher'] };
        case 'all_students':
          return { target_type: 'audience', target_value: null, target_audiences: ['student'] };
        case 'all_parents':
          return { target_type: 'audience', target_value: null, target_audiences: ['parent'] };
        case 'all_employees':
          return { target_type: 'audience', target_value: null, target_audiences: ['employee'] };
        case 'specific_teacher':
        case 'specific_employee':
          return value ? { target_type: 'user', target_value: value, target_audiences: null } : null;
        case 'specific_student':
          return value ? { target_type: 'user', target_value: value, target_audiences: null } : null;
        case 'specific_class':
          return value ? { target_type: 'class', target_value: value, target_audiences: null } : null;
        case 'all':
        default:
          return { target_type: 'all', target_value: null, target_audiences: null };
      }
    }

    // Homework / Classwork: multi-checkbox + optional class
    const audiences = Array.isArray(f.target_audiences) ? f.target_audiences : [];
    const cls = f.use_class_filter ? value : '';
    if (cls) {
      return { target_type: 'class', target_value: cls, target_audiences: audiences.length ? audiences : null };
    }
    if (audiences.length === 0 || audiences.length === audienceOptionsFor(f.announcement_type).length) {
      return { target_type: 'all', target_value: null, target_audiences: null };
    }
    return { target_type: 'audience', target_value: null, target_audiences: audiences };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const audiencePayload = buildAudiencePayload(formData);
    if (!audiencePayload) {
      toast.error('Please pick a target for the selected audience option');
      return;
    }
    setPosting(true);
    try {
      const payload = {
        title: formData.title,
        content: formData.content,
        priority: formData.priority,
        announcement_type: formData.announcement_type,
        ...audiencePayload,
      };
      const annRes = await api.post('/announcements', payload);
      const annId = annRes.data.announcement_id;

      // Upload voice note if recorded
      if (voice.audioBlob && annId) {
        try {
          const fd = new FormData();
          fd.append('file', voice.audioBlob, 'voice_note.webm');
          if (voice.duration) fd.append('duration_seconds', voice.duration);
          await api.post(`/announcements/${annId}/voice-note`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch {
          toast.error('Announcement posted, but voice note failed to upload.');
        }
      }

      toast.success('Announcement posted');
      setShowAddDialog(false);
      voice.discard();
      setFormData({ title: '', content: '', target_type: 'all', target_value: '', target_audiences: [], use_class_filter: false, priority: 'normal', announcement_type: activeCategory, target_mode: 'all' });
      fetchData();
    } catch (error) {
      toast.error('Failed to post announcement');
    } finally {
      setPosting(false);
    }
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'urgent':
        return <Badge variant="destructive">Urgent</Badge>;
      case 'high':
        return <Badge className="bg-amber-500 text-white">High</Badge>;
      case 'normal':
        return <Badge variant="secondary">Normal</Badge>;
      default:
        return <Badge variant="outline">Low</Badge>;
    }
  };

  const audienceLabel = (a) => ({
    student: 'Students',
    parent: 'Parents',
    teacher: 'Teachers',
    employee: 'Employees',
  }[a] || a);

  const getTargetLabel = (announcement) => {
    if (!announcement) return '';
    const { target_type, target_value, target_audiences } = announcement;
    const audiences = Array.isArray(target_audiences) ? target_audiences : [];
    if (target_type === 'class') {
      const cls = `Class ${target_value}`;
      return audiences.length ? `${cls} · ${audiences.map(audienceLabel).join(', ')}` : cls;
    }
    if (target_type === 'department') return `Dept: ${target_value}`;
    if (target_type === 'user') return 'Specific person';
    if (target_type === 'audience' && audiences.length) {
      return audiences.map(audienceLabel).join(', ');
    }
    if (target_type === 'all') return 'Everyone';
    // Legacy fallbacks
    switch (target_type) {
      case 'student': return 'All Students';
      case 'parent': return 'All Parents';
      case 'teacher': return 'All Teachers';
      case 'section': return `Section ${target_value}`;
      default: return target_type || 'Everyone';
    }
  };

  const ALL_CATEGORIES = [
    { key: 'general', label: 'General' },
    { key: 'homework', label: 'Homework' },
    { key: 'classwork', label: 'Classwork' },
    { key: 'employees', label: 'Employees' },
  ];
  // Students/parents don't see the Employees tab — it's staff-only content
  const isStaff = isAdmin || isTeacher || user?.role === 'accountant';
  const CATEGORIES = isStaff ? ALL_CATEGORIES : ALL_CATEGORIES.filter(c => c.key !== 'employees');

  const filteredAnnouncements = announcements.filter(a => {
    const cat = a.announcement_type || 'general';
    const matchCat = cat === activeCategory;
    const matchSearch = !searchTerm ||
      a.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.content.toLowerCase().includes(searchTerm.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div data-testid="announcements-page">
      <TopProgressBar active={refreshing} />
      <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="page-header-inner">
          <div className="page-header-accent" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Announcements</h1>
            <p className="text-xs text-muted-foreground mt-0.5">School-wide notifications and updates</p>
          </div>
        </div>
        {(isAdmin || isTeacher) && (
          <Dialog open={showAddDialog} onOpenChange={(open) => {
            setShowAddDialog(open);
            if (open) {
              setFormData(f => ({ ...f, announcement_type: activeCategory, target_mode: 'all', target_value: '' }));
              loadDirectories();
            }
          }}>
            <DialogTrigger asChild>
              <Button data-testid="add-announcement-btn">
                <Plus className="h-4 w-4 mr-2" />
                New Announcement
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Announcement</DialogTitle>
                <DialogDescription>
                  Posting to <span className="font-semibold capitalize">{ALL_CATEGORIES.find(c => c.key === formData.announcement_type)?.label || formData.announcement_type}</span>
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit}>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label>Title *</Label>
                    <Input
                      value={formData.title}
                      onChange={(e) => setFormData({...formData, title: e.target.value})}
                      placeholder="Announcement title"
                      required
                      data-testid="announcement-title"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Content</Label>
                    <Textarea
                      value={formData.content}
                      onChange={(e) => setFormData({...formData, content: e.target.value})}
                      placeholder="Write your announcement..."
                      rows={4}
                      data-testid="announcement-content"
                    />
                  </div>
                  {formData.announcement_type === 'employees' && (
                    <div className="space-y-2">
                      <Label>Target Audience</Label>
                      <Select
                        value={formData.target_mode}
                        onValueChange={(v) => setFormData(f => ({ ...f, target_mode: v, target_value: '' }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent side="bottom" avoidCollisions={false} className="max-h-[220px]">
                          <SelectItem value="all">All Employees</SelectItem>
                          <SelectItem value="department">Specific Department</SelectItem>
                        </SelectContent>
                      </Select>
                      {formData.target_mode === 'department' && (
                        <Select
                          value={formData.target_value}
                          onValueChange={(v) => setFormData(f => ({ ...f, target_value: v }))}
                        >
                          <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                          <SelectContent side="bottom" avoidCollisions={false} className="max-h-[220px]">
                            {departments.length === 0 ? (
                              <div className="px-2 py-1.5 text-xs text-muted-foreground">No departments found</div>
                            ) : departments.map(d => (
                              <SelectItem key={d} value={d}>{d}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}
                  {formData.announcement_type === 'general' && (
                    <div className="space-y-2">
                      <Label>Target Audience</Label>
                      <Select
                        value={formData.target_mode}
                        onValueChange={(v) => setFormData(f => ({ ...f, target_mode: v, target_value: '' }))}
                      >
                        <SelectTrigger data-testid="announcement-target"><SelectValue /></SelectTrigger>
                        <SelectContent side="bottom" avoidCollisions={false} className="max-h-[260px]">
                          <SelectItem value="all">Everyone</SelectItem>
                          <SelectItem value="all_teachers">All Teachers</SelectItem>
                          <SelectItem value="all_students">All Students</SelectItem>
                          <SelectItem value="all_parents">All Parents</SelectItem>
                          <SelectItem value="all_employees">All Employees</SelectItem>
                          <SelectItem value="specific_teacher">Specific Teacher</SelectItem>
                          <SelectItem value="specific_student">Specific Student</SelectItem>
                          <SelectItem value="specific_employee">Specific Employee</SelectItem>
                          <SelectItem value="specific_class">Specific Class</SelectItem>
                        </SelectContent>
                      </Select>
                      {formData.target_mode === 'specific_class' && (
                        <Select value={formData.target_value} onValueChange={(v) => setFormData(f => ({ ...f, target_value: v }))}>
                          <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                          <SelectContent side="bottom" avoidCollisions={false} className="max-h-[220px]">
                            {classes.map((c) => (
                              <SelectItem key={c.name} value={c.name}>Class {c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {formData.target_mode === 'specific_student' && (
                        <Select value={formData.target_value} onValueChange={(v) => setFormData(f => ({ ...f, target_value: v }))}>
                          <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
                          <SelectContent side="bottom" avoidCollisions={false} className="max-h-[220px]">
                            {studentsList.length === 0 ? (
                              <div className="px-2 py-1.5 text-xs text-muted-foreground">No students loaded</div>
                            ) : studentsList.map((s) => (
                              s.user_id ? (
                                <SelectItem key={s.user_id} value={s.user_id}>
                                  {s.first_name} {s.last_name}{s.class_name ? ` — Class ${s.class_name}${s.section ? '-' + s.section : ''}` : ''}
                                </SelectItem>
                              ) : null
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {(formData.target_mode === 'specific_teacher' || formData.target_mode === 'specific_employee') && (
                        <Select value={formData.target_value} onValueChange={(v) => setFormData(f => ({ ...f, target_value: v }))}>
                          <SelectTrigger>
                            <SelectValue placeholder={`Select ${formData.target_mode === 'specific_teacher' ? 'teacher' : 'employee'}`} />
                          </SelectTrigger>
                          <SelectContent side="bottom" avoidCollisions={false} className="max-h-[220px]">
                            {(formData.target_mode === 'specific_teacher' ? teachersList : employeesList).map((e) => (
                              e.user_id ? (
                                <SelectItem key={e.user_id} value={e.user_id}>
                                  {e.first_name} {e.last_name}{e.designation ? ` — ${e.designation}` : ''}
                                </SelectItem>
                              ) : null
                            ))}
                            {((formData.target_mode === 'specific_teacher' ? teachersList : employeesList).length === 0) && (
                              <div className="px-2 py-1.5 text-xs text-muted-foreground">No records loaded</div>
                            )}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}
                  {(formData.announcement_type === 'homework' || formData.announcement_type === 'classwork') && (
                    <>
                      <div className="space-y-2">
                        <Label>Target Audience</Label>
                        <p className="text-xs text-muted-foreground">Tick one or more. Leave all unticked to send to everyone.</p>
                        <div className="grid grid-cols-2 gap-2 pt-1" data-testid="announcement-target">
                          {audienceOptionsFor(formData.announcement_type).map(opt => (
                            <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={formData.target_audiences.includes(opt.value)}
                                onCheckedChange={() => toggleAudience(opt.value, setFormData)}
                              />
                              {opt.label}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={formData.use_class_filter}
                            onCheckedChange={(v) => setFormData(f => ({ ...f, use_class_filter: !!v, target_value: v ? f.target_value : '' }))}
                          />
                          Limit to a specific class
                        </label>
                        {formData.use_class_filter && (
                          <Select
                            value={formData.target_value}
                            onValueChange={(value) => setFormData({ ...formData, target_value: value })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select class" />
                            </SelectTrigger>
                            <SelectContent>
                              {classes.map((cls) => (
                                <SelectItem key={cls.name} value={cls.name}>Class {cls.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </>
                  )}
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select
                      value={formData.priority}
                      onValueChange={(value) => setFormData({...formData, priority: value})}
                    >
                      <SelectTrigger data-testid="announcement-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <VoiceNoteRecorder voice={voice} />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                  <Button type="submit" disabled={posting || voice.recording} data-testid="submit-announcement-btn">
                    {posting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Posting...</> : 'Post Announcement'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl w-fit">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => {
              setActiveCategory(cat.key);
              setFormData(f => ({
                ...f,
                announcement_type: cat.key,
                target_audiences: (cat.key === 'homework' || cat.key === 'classwork')
                  ? (f.target_audiences || []).filter(a => a !== 'employee')
                  : (f.target_audiences || []),
              }));
            }}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeCategory === cat.key
                ? 'bg-white shadow text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {cat.label}
            <span className="ml-1.5 text-[10px] text-slate-400">
              ({announcements.filter(a => (a.announcement_type || 'general') === cat.key).length})
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search announcements..."
              className="pl-10 pr-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="search-announcements"
            />
            {searchTerm && (
              <button className="absolute right-3 top-3 text-muted-foreground hover:text-slate-900" onClick={() => setSearchTerm('')}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Announcements List */}
      {loading && announcements.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-900 border-t-transparent"></div>
        </div>
      ) : filteredAnnouncements.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="empty-state-icon"><Megaphone className="h-8 w-8" /></div>
            <h3 className="text-lg font-semibold text-slate-900 mb-1">No Announcements</h3>
            <p className="text-sm text-slate-500">There are no announcements at this time.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredAnnouncements.map((announcement) => (
            <Card key={announcement.announcement_id} className="hover:shadow-md transition-shadow" data-testid={`announcement-${announcement.announcement_id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">{announcement.title}</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    {getPriorityBadge(announcement.priority)}
                    <Badge variant="outline">{getTargetLabel(announcement)}</Badge>
                    {(isAdmin || isTeacher) && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => openEdit(announcement)}
                          data-testid={`edit-announcement-${announcement.announcement_id}`}
                          title="Edit announcement"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                          onClick={() => setDeleteTarget(announcement)}
                          data-testid={`delete-announcement-${announcement.announcement_id}`}
                          title="Delete announcement"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4 whitespace-pre-wrap">{announcement.content}</p>
                {announcement.voice_note_id && (
                  <VoiceNotePlayer
                    url={`/api/media/voice-notes/${announcement.voice_note_id}`}
                    mimeType="audio/webm"
                  />
                )}
                <p className="text-xs text-muted-foreground mt-3">
                  Posted on {formatDateTime(announcement.created_at)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Delete Confirmation Dialog ───────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Announcement?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete announcement?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={!!deleting}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDelete}
              disabled={!!deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirm delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) { setEditTarget(null); editVoice.discard(); setDiscardExistingVoice(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Announcement</DialogTitle>
            <DialogDescription>Update title, content, audience, or priority.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Title</Label>
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                placeholder="Announcement title"
              />
            </div>
            <div className="space-y-1">
              <Label>Content</Label>
              <Textarea
                rows={4}
                value={editForm.content}
                onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                placeholder="Announcement message"
              />
            </div>
            <div className="space-y-1">
              <Label>Priority</Label>
              <Select value={editForm.priority} onValueChange={(v) => setEditForm({ ...editForm, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editTarget?.announcement_type === 'employees' ? (
              <div className="space-y-1">
                <Label>Target Audience</Label>
                <div className="text-sm bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                  Employees <span className="text-xs text-muted-foreground">(visible to all staff)</span>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label>Target Audience</Label>
                  <p className="text-xs text-muted-foreground">Tick one or more. Leave all unticked to send to everyone.</p>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {audienceOptionsFor(editTarget?.announcement_type).map(opt => (
                      <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={editForm.target_audiences.includes(opt.value)}
                          onCheckedChange={() => toggleAudience(opt.value, setEditForm)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={editForm.target_type === 'class'}
                      onCheckedChange={(v) => setEditForm(f => ({ ...f, target_type: v ? 'class' : 'all', target_value: v ? f.target_value : '' }))}
                    />
                    Limit to a specific class
                  </label>
                  {editForm.target_type === 'class' && (
                    <Select
                      value={editForm.target_value}
                      onValueChange={(v) => setEditForm({ ...editForm, target_value: v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                      <SelectContent>
                        {classes.map((c) => (
                          <SelectItem key={c.name || c} value={c.name || c}>Class {c.name || c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </>
            )}

            {/* Voice note section — existing player (with discard) + (re)record */}
            <div className="space-y-2 pt-2 border-t">
              {editTarget?.voice_note_id && !discardExistingVoice && !editVoice.audioBlob && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Current voice note</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => setDiscardExistingVoice(true)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" /> Discard
                    </Button>
                  </div>
                  <VoiceNotePlayer
                    url={`/api/media/voice-notes/${editTarget.voice_note_id}`}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Discard to remove it, or record below to replace it on save.
                  </p>
                </div>
              )}
              {editTarget?.voice_note_id && discardExistingVoice && !editVoice.audioBlob && (
                <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <span className="text-xs text-red-700">
                    Existing voice note will be removed on save.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setDiscardExistingVoice(false)}
                  >
                    Undo
                  </Button>
                </div>
              )}
              <VoiceNoteRecorder voice={editVoice} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditTarget(null); editVoice.discard(); }} disabled={editing}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={editing || editVoice.recording}>
              {editing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AnnouncementsPage;
