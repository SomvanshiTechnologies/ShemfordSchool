import React, { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { getCached, setCached } from '../lib/pageCache';
import { useAuth } from '../contexts/AuthContext';
import { VoiceNotePlayer, VoiceNoteRecorder, useVoiceRecorder } from './VoiceNote';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Textarea } from './ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
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
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { toast } from 'sonner';
import { Plus, MessageSquare, Send, Inbox, SendHorizontal, Search, Mail, Check } from 'lucide-react';
import { formatDateTime, getInitials } from '../lib/utils';

const MessagesPage = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [sentMessages, setSentMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('inbox');
  const [showComposeDialog, setShowComposeDialog] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [formData, setFormData] = useState({
    recipient_type: 'user',
    recipient_id: '',
    recipient_value: '',
    subject: '',
    content: ''
  });
  const voice = useVoiceRecorder();

  useEffect(() => {
    fetchMessages();
    fetchClasses();
  }, [activeTab]);

  const fetchClasses = async () => {
    try {
      const res = await api.get('/classes');
      setClasses(res.data);
    } catch {}
  };

  const fetchMessages = async () => {
    const cacheKey = `messages:${activeTab}`;
    const cached = getCached(cacheKey);
    if (cached) {
      if (activeTab === 'inbox') setMessages(cached); else setSentMessages(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const response = await api.get('/messages', { params: { sent: activeTab !== 'inbox' } });
      if (activeTab === 'inbox') setMessages(response.data);
      else setSentMessages(response.data);
      setCached(cacheKey, response.data);
    } catch (error) {
      if (!cached) toast.error('Failed to fetch messages');
    } finally {
      setLoading(false);
    }
  };

  const searchUsers = async (query) => {
    setUserSearchQuery(query);
    if (query.length < 2) {
      setUserSearchResults([]);
      return;
    }
    try {
      const response = await api.get('/users/search', { params: { q: query } });
      setUserSearchResults(response.data.filter(u => u.user_id !== user?.user_id));
    } catch (error) {
      console.error('User search failed');
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const payload = { ...formData };
    // For class/section types, set recipient_value
    if (formData.recipient_type === 'class') {
      payload.recipient_value = selectedClass;
      delete payload.recipient_id;
    } else if (formData.recipient_type === 'section') {
      payload.recipient_value = `${selectedClass}:${selectedSection}`;
      delete payload.recipient_id;
    }
    try {
      const msgRes = await api.post('/messages', payload);
      const msgId = msgRes.data.message_id;

      // Upload voice note if recorded
      if (voice.audioBlob && msgId) {
        try {
          const fd = new FormData();
          fd.append('file', voice.audioBlob, 'voice_note.webm');
          if (voice.duration) fd.append('duration_seconds', voice.duration);
          await api.post(`/messages/${msgId}/voice-note`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch {
          toast.error('Message sent, but voice note failed to upload.');
        }
      }

      toast.success('Message sent');
      setShowComposeDialog(false);
      voice.discard();
      setFormData({ recipient_type: 'user', recipient_id: '', recipient_value: '', subject: '', content: '' });
      setSelectedClass('');
      setSelectedSection('');
      setUserSearchQuery('');
      fetchMessages();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send message');
    }
  };

  const markAsRead = async (messageId) => {
    try {
      await api.put(`/messages/${messageId}/read`);
      fetchMessages();
    } catch (error) {
      console.error('Failed to mark as read');
    }
  };

  const handleViewMessage = (message) => {
    setSelectedMessage(message);
    if (!message.is_read && activeTab === 'inbox') {
      markAsRead(message.message_id);
    }
  };

  const currentMessages = activeTab === 'inbox' ? messages : sentMessages;

  return (
    <div data-testid="messages-page">
      <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="page-header-inner">
          <div className="page-header-accent" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Messages</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Internal communication system</p>
          </div>
        </div>
        <Dialog open={showComposeDialog} onOpenChange={setShowComposeDialog}>
          <DialogTrigger asChild>
            <Button data-testid="compose-btn">
              <Plus className="h-4 w-4 mr-2" />
              Compose
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Message</DialogTitle>
              <DialogDescription>Send a message to users or groups</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSend}>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Send To</Label>
                  <Select
                    value={formData.recipient_type}
                    onValueChange={(value) => setFormData({...formData, recipient_type: value, recipient_id: ''})}
                  >
                    <SelectTrigger data-testid="recipient-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Specific User / Student</SelectItem>
                      {(user?.role === 'admin' || user?.role === 'teacher') && (
                        <>
                          <SelectItem value="all">Everyone</SelectItem>
                          <SelectItem value="teacher">All Teachers</SelectItem>
                          <SelectItem value="student">All Students</SelectItem>
                          <SelectItem value="parent">All Parents</SelectItem>
                          <SelectItem value="class">Entire Class</SelectItem>
                          <SelectItem value="section">Specific Section</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {/* Class selector for class/section broadcast */}
                {(formData.recipient_type === 'class' || formData.recipient_type === 'section') && (
                  <div className="space-y-2">
                    <Label>Select Class <span className="text-red-500">*</span></Label>
                    <Select value={selectedClass} onValueChange={(v) => { setSelectedClass(v); setSelectedSection(''); }}>
                      <SelectTrigger><SelectValue placeholder="Choose class" /></SelectTrigger>
                      <SelectContent>
                        {classes.map(c => <SelectItem key={c.class_id || c.name} value={c.name}>{c.display_name || `Class ${c.name}`}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {formData.recipient_type === 'section' && selectedClass && (
                  <div className="space-y-2">
                    <Label>Select Section <span className="text-red-500">*</span></Label>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                      <SelectTrigger><SelectValue placeholder="Choose section" /></SelectTrigger>
                      <SelectContent>
                        {(classes.find(c => c.name === selectedClass)?.sections || []).map(s => (
                          <SelectItem key={s.section_name} value={s.section_name}>{s.section_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {formData.recipient_type === 'user' && (
                  <div className="space-y-2">
                    <Label>Search User or Student</Label>
                    <Input
                      value={userSearchQuery}
                      onChange={(e) => searchUsers(e.target.value)}
                      placeholder="Type name, admission number or email..."
                      data-testid="recipient-search"
                    />
                    {userSearchResults.length > 0 && (
                      <div className="border rounded-md max-h-40 overflow-y-auto divide-y">
                        {userSearchResults.map(u => (
                          <div
                            key={u.user_id}
                            className={`p-2 cursor-pointer hover:bg-muted text-sm flex justify-between items-center ${formData.recipient_id === u.user_id ? 'bg-muted' : ''}`}
                            onClick={() => {
                              setFormData({...formData, recipient_id: u.user_id});
                              setUserSearchQuery(u.name);
                              setUserSearchResults([]);
                            }}
                            data-testid={`user-option-${u.user_id}`}
                          >
                            <div>
                              <span className="font-medium text-foreground">{u.name}</span>
                              {u.class_name && <span className="ml-2 text-xs text-slate-500">Class {u.class_name} - {u.section}</span>}
                              {u.admission_number && <span className="ml-1 text-xs text-slate-400">({u.admission_number})</span>}
                            </div>
                            <Badge variant="outline" className="text-xs capitalize">{u.role}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                    {formData.recipient_id && (
                      <p className="text-xs text-slate-600">Selected: {userSearchQuery}</p>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Subject *</Label>
                  <Input
                    value={formData.subject}
                    onChange={(e) => setFormData({...formData, subject: e.target.value})}
                    placeholder="Message subject"
                    required
                    data-testid="message-subject"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Message *</Label>
                  <Textarea
                    value={formData.content}
                    onChange={(e) => setFormData({...formData, content: e.target.value})}
                    placeholder="Write your message..."
                    rows={4}
                    required
                    data-testid="message-content"
                  />
                </div>
                <VoiceNoteRecorder voice={voice} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowComposeDialog(false)}>Cancel</Button>
                <Button type="submit" disabled={voice.recording} data-testid="send-message-btn">
                  <Send className="h-4 w-4 mr-2" />
                  Send
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Message List */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-2">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="inbox" data-testid="inbox-tab">
                    <Inbox className="h-4 w-4 mr-2" />
                    Inbox
                    {messages.filter(m => !m.is_read).length > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-slate-900 text-white text-[9px] font-bold">
                        {messages.filter(m => !m.is_read).length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="sent" data-testid="sent-tab">
                    <SendHorizontal className="h-4 w-4 mr-2" />
                    Sent
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-900 border-t-transparent"></div>
                </div>
              ) : currentMessages.length === 0 ? (
                <div className="text-center py-10">
                  <div className="empty-state-icon"><Mail className="h-7 w-7" /></div>
                  <p className="text-sm text-slate-500 font-medium">No messages</p>
                  <p className="text-xs text-slate-500 mt-1">{activeTab === 'inbox' ? 'Your inbox is empty' : 'You have not sent any messages'}</p>
                </div>
              ) : (
                <div className="divide-y max-h-[500px] overflow-y-auto">
                  {currentMessages.map((message) => {
                    const isUnread = !message.is_read && activeTab === 'inbox';
                    const isSelected = selectedMessage?.message_id === message.message_id;
                    return (
                      <div
                        key={message.message_id}
                        className={`p-3 cursor-pointer transition-colors ${
                          isSelected ? 'bg-slate-50 border-l-2 border-slate-900' :
                          isUnread ? 'bg-amber-50/40 hover:bg-amber-50/70' :
                          'hover:bg-slate-50'
                        }`}
                        onClick={() => handleViewMessage(message)}
                        data-testid={`message-${message.message_id}`}
                      >
                        <div className="flex items-start gap-2.5">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback className="text-[10px] bg-slate-100 text-slate-600">
                              {getInitials(activeTab === 'inbox' ? message.sender_name : 'Me')}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <p className={`text-sm truncate ${isUnread ? 'font-bold text-slate-900' : 'font-medium text-slate-800'}`}>
                                {activeTab === 'inbox' ? message.sender_name : 'To: ' + (message.recipient_type || 'User')}
                              </p>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {isUnread && <span className="h-2 w-2 rounded-full bg-slate-900 inline-block" />}
                                <span className="text-[10px] text-slate-500">
                                  {message.created_at ? new Date(message.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                                </span>
                              </div>
                            </div>
                            <p className={`text-xs truncate ${isUnread ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{message.subject}</p>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">{message.content}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Message View */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            {selectedMessage ? (
              <>
                <CardHeader className="border-b">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle>{selectedMessage.subject}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        From: {selectedMessage.sender_name} • {formatDateTime(selectedMessage.created_at)}
                      </p>
                    </div>
                    {selectedMessage.is_read && (
                      <Badge variant="outline">
                        <Check className="h-3 w-3 mr-1" />
                        Read
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <p className="whitespace-pre-wrap">{selectedMessage.content}</p>
                  {selectedMessage.voice_note_id && (
                    <div className="mt-4">
                      <p className="text-xs text-slate-500 mb-1 font-medium">Voice note</p>
                      <VoiceNotePlayer
                        url={`/api/media/voice-notes/${selectedMessage.voice_note_id}`}
                      />
                    </div>
                  )}
                </CardContent>
              </>
            ) : (
              <CardContent className="flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="empty-state-icon"><MessageSquare className="h-7 w-7" /></div>
                  <p className="text-sm text-slate-500 font-medium">Select a message to view</p>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default MessagesPage;
