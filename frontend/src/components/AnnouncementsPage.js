import React, { useState, useEffect } from 'react';
import api from '../lib/api';
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
import { formatDateTime } from '../lib/utils';
import { VoiceNotePlayer, VoiceNoteRecorder, useVoiceRecorder } from './VoiceNote';

const AnnouncementsPage = () => {
  const { user, isAdmin, isTeacher } = useAuth();
  const [deleting, setDeleting] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', content: '', priority: 'normal', target_type: 'all', target_value: '' });
  const [editing, setEditing] = useState(false);

  const openEdit = (a) => {
    setEditTarget(a);
    setEditForm({
      title: a.title || '',
      content: a.content || '',
      priority: a.priority || 'normal',
      target_type: a.target_type || 'all',
      target_value: a.target_value || '',
    });
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    if (!editForm.title.trim() || !editForm.content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    setEditing(true);
    try {
      const payload = { ...editForm };
      if (payload.target_type === 'all') payload.target_value = null;
      await api.put(`/announcements/${editTarget.announcement_id}`, payload);
      toast.success('Announcement updated');
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
  const [posting, setPosting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    target_type: 'all',
    target_value: '',
    priority: 'normal'
  });
  const voice = useVoiceRecorder();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [announcementsRes, classesRes] = await Promise.all([
        api.get('/announcements'),
        api.get('/classes')
      ]);
      setAnnouncements(announcementsRes.data);
      setClasses(classesRes.data);
    } catch (error) {
      toast.error('Failed to fetch announcements');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setPosting(true);
    try {
      const annRes = await api.post('/announcements', formData);
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
      setFormData({ title: '', content: '', target_type: 'all', target_value: '', priority: 'normal' });
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

  const getTargetLabel = (type, value) => {
    switch (type) {
      case 'all':
        return 'Everyone';
      case 'class':
        return `Class ${value}`;
      case 'section':
        return `Section ${value}`;
      case 'student':
        return 'Specific Student';
      case 'parent':
        return 'All Parents';
      default:
        return type;
    }
  };

  const filteredAnnouncements = announcements.filter(a => 
    a.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.content.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div data-testid="announcements-page">
      <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="page-header-inner">
          <div className="page-header-accent" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Announcements</h1>
            <p className="text-xs text-muted-foreground mt-0.5">School-wide notifications and updates</p>
          </div>
        </div>
        {(isAdmin || isTeacher) && (
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button data-testid="add-announcement-btn">
                <Plus className="h-4 w-4 mr-2" />
                New Announcement
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Announcement</DialogTitle>
                <DialogDescription>Post a new announcement to students and parents</DialogDescription>
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
                    <Label>Content *</Label>
                    <Textarea
                      value={formData.content}
                      onChange={(e) => setFormData({...formData, content: e.target.value})}
                      placeholder="Write your announcement..."
                      rows={4}
                      required
                      data-testid="announcement-content"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Target Audience</Label>
                      <Select
                        value={formData.target_type}
                        onValueChange={(value) => setFormData({...formData, target_type: value, target_value: ''})}
                      >
                        <SelectTrigger data-testid="announcement-target">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Everyone</SelectItem>
                          <SelectItem value="class">Specific Class</SelectItem>
                          <SelectItem value="parent">All Parents</SelectItem>
                          <SelectItem value="student">All Students</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
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
                  </div>
                  {formData.target_type === 'class' && (
                    <div className="space-y-2">
                      <Label>Select Class</Label>
                      <Select
                        value={formData.target_value}
                        onValueChange={(value) => setFormData({...formData, target_value: value})}
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
                    </div>
                  )}
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
      {loading ? (
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
                    <Badge variant="outline">{getTargetLabel(announcement.target_type, announcement.target_value)}</Badge>
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
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
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
            <div className="grid grid-cols-2 gap-3">
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
              <div className="space-y-1">
                <Label>Audience</Label>
                <Select
                  value={editForm.target_type}
                  onValueChange={(v) => setEditForm({ ...editForm, target_type: v, target_value: '' })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="student">Students</SelectItem>
                    <SelectItem value="parent">Parents</SelectItem>
                    <SelectItem value="teacher">Teachers</SelectItem>
                    <SelectItem value="class">Specific Class</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editForm.target_type === 'class' && (
              <div className="space-y-1">
                <Label>Class</Label>
                <Select
                  value={editForm.target_value}
                  onValueChange={(v) => setEditForm({ ...editForm, target_value: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.name || c} value={c.name || c}>{c.name || c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editing}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={editing}>
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
