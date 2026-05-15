import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { getCached, setCached } from '../lib/pageCache';

const TopProgressBar = ({ active }) =>
  active ? (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px] overflow-hidden" style={{ background: '#fde8c8' }}>
      <div className="h-full w-2/5" style={{ background: '#E88A1A', animation: 'topbar-slide 1.4s ease-in-out infinite' }} />
    </div>
  ) : null;
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
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
import {
  School,
  Plus,
  Users,
  Edit,
  ChevronRight,
  BookOpen,
  UserCog,
  Layers
} from 'lucide-react';

const SHEMFORD_SECTIONS = ['Violet', 'Indigo', 'Blue', 'Green', 'Yellow', 'Orange', 'Red'];
const SECTION_COLORS = {
  Violet: 'bg-violet-100 text-violet-800',
  Indigo: 'bg-indigo-100 text-indigo-800',
  Blue: 'bg-blue-100 text-blue-800',
  Green: 'bg-green-100 text-green-800',
  Yellow: 'bg-yellow-100 text-yellow-800',
  Orange: 'bg-orange-100 text-orange-800',
  Red: 'bg-red-100 text-red-800',
};

const ClassStructurePage = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedClass, setSelectedClass] = useState(null);
  const [classStudents, setClassStudents] = useState([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editData, setEditData] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [selectedStream, setSelectedStream] = useState(null);
  const [newClass, setNewClass] = useState({
    name: '', display_name: '', sections: SHEMFORD_SECTIONS.map(s => ({ section_name: s, capacity: 45, class_teacher_id: null, class_teacher_name: null }))
  });

  useEffect(() => { fetchClasses(); fetchTeachers(); }, []);

  const fetchClasses = async () => {
    const cached = getCached('classes:all');
    if (cached) {
      setClasses(cached);
      setLoading(false);
    }
    setRefreshing(true);
    try {
      const res = await api.get('/classes');
      setClasses(res.data);
      setCached('classes:all', res.data);
    } catch { if (!cached) toast.error('Failed to load classes'); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const fetchTeachers = async () => {
    try {
      const res = await api.get('/users/search', { params: { role: 'teacher' } });
      setTeachers(res.data);
    } catch {}
  };

  const fetchClassStudents = async (cls, sectionName, stream = null) => {
    try {
      const params = { section: sectionName };
      if (stream) params.stream = stream;
      const res = await api.get(`/classes/${cls.class_id}/students`, { params });
      setClassStudents(res.data);
    } catch { toast.error('Failed to load students'); }
  };

  const handleAddClass = async (e) => {
    e.preventDefault();
    try {
      await api.post('/classes', newClass);
      toast.success('Class created successfully');
      setShowAddDialog(false);
      setNewClass({ name: '', display_name: '', sections: [{ section_name: 'A', capacity: 40 }] });
      fetchClasses();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to create class'); }
  };

  const handleEditClass = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/classes/${editData.class_id}`, editData);
      toast.success('Class updated');
      setShowEditDialog(false);
      fetchClasses();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to update'); }
  };

  const addSection = (target, setter) => {
    const existing = new Set(target.sections.map(s => s.section_name));
    const nextColor = SHEMFORD_SECTIONS.find(s => !existing.has(s)) || `Section ${target.sections.length + 1}`;
    setter({ ...target, sections: [...target.sections, { section_name: nextColor, capacity: 45, class_teacher_id: null, class_teacher_name: null }] });
  };

  const removeSection = (target, setter, idx) => {
    setter({ ...target, sections: target.sections.filter((_, i) => i !== idx) });
  };

  const updateSection = (target, setter, idx, field, value) => {
    const updated = [...target.sections];
    updated[idx] = { ...updated[idx], [field]: field === 'capacity' ? parseInt(value) || 0 : value };
    setter({ ...target, sections: updated });
  };

  const SectionEditor = ({ data, setData }) => (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <Label>Sections</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => addSection(data, setData)}>
          <Plus className="h-3 w-3 mr-1" />Add Section
        </Button>
      </div>
      {data.sections.map((sec, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3">
            <Label className="text-xs">Name</Label>
            <Input value={sec.section_name} onChange={(e) => updateSection(data, setData, idx, 'section_name', e.target.value)} />
          </div>
          <div className="col-span-3">
            <Label className="text-xs">Capacity</Label>
            <Input type="number" value={sec.capacity} onChange={(e) => updateSection(data, setData, idx, 'capacity', e.target.value)} />
          </div>
          <div className="col-span-4">
            <Label className="text-xs">Class Teacher</Label>
            <Select value={sec.class_teacher_id || 'none'} onValueChange={(v) => {
              const teacher = teachers.find(t => t.user_id === v);
              const updated = [...data.sections];
              updated[idx] = { ...updated[idx], class_teacher_id: v === 'none' ? null : v, class_teacher_name: teacher?.name || null };
              setData({ ...data, sections: updated });
            }}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {teachers.map(t => <SelectItem key={t.user_id} value={t.user_id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            {data.sections.length > 1 && (
              <Button type="button" variant="ghost" size="sm" className="text-slate-600" onClick={() => removeSection(data, setData, idx)}>Remove</Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  if (loading && classes.length === 0) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-slate-900 border-t-transparent rounded-full" /></div>;

  return (
    <div data-testid="class-structure-page">
      <TopProgressBar active={refreshing} />
      <div className="mb-8 pb-6 border-b border-slate-200 flex justify-between items-start">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Class Structure</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Manage classes, sections, and teacher assignments</p>
          </div>
        </div>
        {isAdmin && (
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button data-testid="add-class-btn"><Plus className="h-4 w-4 mr-2" />Add Class</Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Create New Class</DialogTitle>
                <DialogDescription>Define a new class with sections and capacity</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddClass}>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Class Name *</Label>
                      <Input value={newClass.name} onChange={(e) => setNewClass({...newClass, name: e.target.value})} placeholder="e.g., 1, Nursery" required data-testid="class-name" />
                    </div>
                    <div className="space-y-2">
                      <Label>Display Name *</Label>
                      <Input value={newClass.display_name} onChange={(e) => setNewClass({...newClass, display_name: e.target.value})} placeholder="e.g., Class 1" required data-testid="class-display-name" />
                    </div>
                  </div>
                  <SectionEditor data={newClass} setData={setNewClass} />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                  <Button type="submit" data-testid="submit-class-btn">Create Class</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <div className="bg-white border border-slate-200 border-l-4 border-l-[#E88A1A] p-5 rounded-2xl">
          <p className="stat-label">Total Classes</p>
          <p className="text-2xl font-bold text-slate-900">{classes.length}</p>
        </div>
        <div className="bg-white border border-slate-200 p-5 rounded-2xl">
          <p className="stat-label">Total Sections</p>
          <p className="text-2xl font-bold text-slate-900">{classes.reduce((sum, c) => sum + (c.sections?.length || 0), 0)}</p>
        </div>
        <div className="bg-white border border-slate-200 p-5 rounded-2xl">
          <p className="stat-label">Total Students</p>
          <p className="text-2xl font-bold text-slate-900">{classes.reduce((sum, c) => sum + (c.sections?.reduce((s, sec) => s + (sec.student_count || 0), 0) || 0), 0)}</p>
        </div>
        <div className="bg-white border border-slate-200 p-5 rounded-2xl">
          <p className="stat-label">Teachers Assigned</p>
          <p className="text-2xl font-bold text-slate-900">{classes.reduce((sum, c) => sum + (c.sections?.filter(s => s.class_teacher_id).length || 0), 0)}</p>
        </div>
      </div>

      {/* Class Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
        {classes.map(cls => (
          <Card key={cls.class_id} className="hover:shadow-md transition-shadow" data-testid={`class-card-${cls.name}`}>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg text-foreground">{cls.display_name || cls.name}</CardTitle>
                  {cls.has_streams && (
                    <Badge className="text-xs bg-purple-100 text-purple-800 border-purple-200">
                      <Layers className="h-2.5 w-2.5 mr-1" />Streams
                    </Badge>
                  )}
                </div>
                <div className="flex gap-1">
                  <Badge variant="outline" className="text-xs">{cls.academic_year}</Badge>
                  {isAdmin && (
                    <Button variant="ghost" size="sm" onClick={() => { setEditData({...cls}); setShowEditDialog(true); }}>
                      <Edit className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
              {cls.has_streams && (
                <div className="flex gap-1 mt-1">
                  {(cls.streams || []).map(st => (
                    <Badge key={st} variant="secondary" className="text-xs capitalize">{st}</Badge>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Section</TableHead>
                    <TableHead className="text-xs">Students</TableHead>
                    <TableHead className="text-xs">Teacher</TableHead>
                    <TableHead className="text-xs w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(cls.sections || []).map(sec => {
                    const pct = sec.capacity > 0 ? ((sec.student_count || 0) / sec.capacity) * 100 : 0;
                    const colorClass = SECTION_COLORS[sec.section_name] || 'bg-gray-100 text-gray-800';
                    return (
                      <TableRow key={sec.section_name}>
                        <TableCell className="font-medium">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${colorClass}`}>{sec.section_name}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={pct} className="h-2 w-16" />
                            <span className="text-xs text-muted-foreground">{sec.student_count || 0}/{sec.capacity}</span>
                          </div>
                          {cls.has_streams && sec.stream_student_counts && (
                            <div className="flex gap-1 mt-1">
                              {Object.entries(sec.stream_student_counts).map(([st, cnt]) => (
                                <span key={st} className="text-[10px] text-muted-foreground capitalize">{st}: {cnt}</span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{sec.class_teacher_name || <span className="text-muted-foreground italic">Unassigned</span>}</TableCell>
                        <TableCell>
                          {cls.has_streams ? (
                            <div className="flex flex-col gap-0.5">
                              {(cls.streams || []).map(st => (
                                <Button key={st} variant="ghost" size="sm" className="h-5 text-xs justify-start px-1"
                                  onClick={() => { setSelectedClass({ cls, section: sec.section_name, stream: st }); setSelectedStream(st); fetchClassStudents(cls, sec.section_name, st); }}>
                                  <ChevronRight className="h-2.5 w-2.5 mr-0.5" />{st.charAt(0).toUpperCase() + st.slice(1)}
                                </Button>
                              ))}
                            </div>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => { setSelectedClass({ cls, section: sec.section_name, stream: null }); setSelectedStream(null); fetchClassStudents(cls, sec.section_name); }}>
                              <ChevronRight className="h-3 w-3" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit Class Dialog */}
      {editData && (
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Edit {editData.display_name || editData.name}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleEditClass}>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Class Name</Label>
                    <Input value={editData.name} onChange={(e) => setEditData({...editData, name: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>Display Name</Label>
                    <Input value={editData.display_name} onChange={(e) => setEditData({...editData, display_name: e.target.value})} />
                  </div>
                </div>
                <SectionEditor data={editData} setData={setEditData} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
                <Button type="submit">Save Changes</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Student List Drawer */}
      {selectedClass && (
        <Dialog open={!!selectedClass} onOpenChange={() => { setSelectedClass(null); setSelectedStream(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {selectedClass.cls.display_name} — {selectedClass.section}
                {selectedClass.stream && (
                  <Badge className="ml-2 text-xs capitalize bg-purple-100 text-purple-800">{selectedClass.stream}</Badge>
                )}
              </DialogTitle>
              <DialogDescription>{classStudents.length} students enrolled</DialogDescription>
            </DialogHeader>
            <div className="max-h-96 overflow-y-auto">
              {classStudents.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No students in this section</p>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Adm. No.</TableHead><TableHead>Name</TableHead><TableHead>Roll No.</TableHead><TableHead>Fee Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {classStudents.map(s => (
                      <TableRow key={s.student_id}>
                        <TableCell className="font-mono text-xs">{s.admission_number}</TableCell>
                        <TableCell>{s.first_name} {s.last_name}</TableCell>
                        <TableCell>{s.roll_number || '-'}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium capitalize ${
                            s.fee_status === 'paid' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            s.fee_status === 'overdue' ? 'bg-red-50 text-red-600 border border-red-200' :
                            'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>{s.fee_status}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default ClassStructurePage;
