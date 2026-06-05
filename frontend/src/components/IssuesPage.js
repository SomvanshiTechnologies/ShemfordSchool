import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import { getCached, setCached } from '../lib/pageCache';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';
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
import { Plus, TicketCheck, Search, Clock, CheckCircle, AlertCircle, MessageSquare, Loader2, X } from 'lucide-react';
import { formatDateTime } from '../lib/utils';

const IssuesPage = () => {
  const { user, isAdmin, isTeacher } = useAuth();
  const { viewSession } = useSession();
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [resolution, setResolution] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'academic',
    priority: 'normal'
  });

  useEffect(() => {
    fetchIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, viewSession]);

  const fetchIssues = async () => {
    const cacheKey = `issues:${filterStatus || 'all'}`;
    const cached = getCached(cacheKey);
    if (cached) {
      setIssues(cached);
      setLoading(false);
    }
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      const response = await api.get('/issues', { params });
      setIssues(response.data);
      setCached(cacheKey, response.data);
    } catch (error) {
      if (!cached && !error?._handled) toast.error('Failed to fetch issues');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/issues', formData);
      toast.success('Issue reported successfully');
      setShowAddDialog(false);
      setFormData({
        title: '',
        description: '',
        category: 'academic',
        priority: 'normal'
      });
      fetchIssues();
    } catch (error) {
      toast.error('Failed to report issue');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (issueId, newStatus) => {
    try {
      const updateData = { status: newStatus };
      if (newStatus === 'resolved' && resolution) {
        updateData.resolution = resolution;
      }
      await api.put(`/issues/${issueId}`, updateData);
      toast.success('Issue updated');
      setShowViewDialog(false);
      setResolution('');
      fetchIssues();
    } catch (error) {
      toast.error('Failed to update issue');
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'open':
        return <Badge className="bg-slate-50 text-slate-900 border border-slate-200">Open</Badge>;
      case 'in_progress':
        return <Badge className="bg-amber-50 text-amber-700 border border-amber-200">In Progress</Badge>;
      case 'resolved':
        return <Badge className="bg-slate-900 text-white">Resolved</Badge>;
      case 'closed':
        return <Badge variant="secondary">Closed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'open':
        return <AlertCircle className="h-5 w-5 text-slate-500" />;
      case 'in_progress':
        return <Clock className="h-5 w-5 text-amber-500" />;
      case 'resolved':
        return <CheckCircle className="h-5 w-5 text-slate-900" />;
      default:
        return <TicketCheck className="h-5 w-5 text-gray-600" />;
    }
  };

  const getCategoryBadge = (category) => {
    const colors = {
      academic: 'bg-slate-50 text-slate-900',
      fee: 'bg-slate-50 text-slate-900',
      transport: 'bg-amber-50 text-amber-700',
      facility: 'bg-cyan-100 text-cyan-800',
      other: 'bg-gray-100 text-gray-800'
    };
    return <Badge className={colors[category] || colors.other}>{category}</Badge>;
  };

  const filteredIssues = issues.filter(issue =>
    issue.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    issue.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const categories = ['academic', 'fee', 'transport', 'facility', 'other'];

  return (
    <div data-testid="issues-page">
      <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="page-header-inner">
          <div className="page-header-accent" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Issue Tracking</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Report and track issues</p>
          </div>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button data-testid="raise-issue-btn">
              <Plus className="h-4 w-4 mr-2" />
              Raise Issue
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Raise New Issue</DialogTitle>
              <DialogDescription>Report a problem or concern</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Title *</Label>
                  <Input
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                    placeholder="Brief description of the issue"
                    required
                    data-testid="issue-title"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(value) => setFormData({...formData, category: value})}
                    >
                      <SelectTrigger data-testid="issue-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat} value={cat} className="capitalize">{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select
                      value={formData.priority}
                      onValueChange={(value) => setFormData({...formData, priority: value})}
                    >
                      <SelectTrigger data-testid="issue-priority">
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
                <div className="space-y-2">
                  <Label>Description *</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="Provide details about the issue..."
                    rows={4}
                    required
                    data-testid="issue-description"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting} data-testid="submit-issue-btn">
                  {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Submitting...</> : 'Submit Issue'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search issues..."
                className="pl-10 pr-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="search-issues"
              />
              {searchTerm && (
                <button className="absolute right-3 top-3 text-muted-foreground hover:text-slate-900" onClick={() => setSearchTerm('')}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select value={filterStatus || "all"} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[180px]" data-testid="filter-status">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Issues List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-900 border-t-transparent"></div>
        </div>
      ) : filteredIssues.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="empty-state-icon"><TicketCheck className="h-8 w-8" /></div>
            <h3 className="text-lg font-semibold text-slate-900 mb-1">No Issues Found</h3>
            <p className="text-sm text-slate-500">There are no issues matching your criteria.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredIssues.map((issue) => (
            <Card 
              key={issue.issue_id} 
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => { setSelectedIssue(issue); setShowViewDialog(true); }}
              data-testid={`issue-${issue.issue_id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {getStatusIcon(issue.status)}
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold">{issue.title}</h3>
                      <div className="flex gap-2">
                        {getCategoryBadge(issue.category)}
                        {getStatusBadge(issue.status)}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{issue.description}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Reported on {formatDateTime(issue.created_at)} by {issue.raised_by_role}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* View/Update Issue Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue Details</DialogTitle>
          </DialogHeader>
          {selectedIssue && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{selectedIssue.title}</h3>
                {getStatusBadge(selectedIssue.status)}
              </div>
              
              <div className="flex gap-2">
                {getCategoryBadge(selectedIssue.category)}
                <Badge variant="outline">Priority: {selectedIssue.priority}</Badge>
              </div>

              <div className="p-4 bg-muted rounded-lg">
                <Label className="text-muted-foreground">Description</Label>
                <p className="mt-1 whitespace-pre-wrap">{selectedIssue.description}</p>
              </div>

              {selectedIssue.resolution && (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <Label className="text-slate-900">Resolution</Label>
                  <p className="mt-1 text-slate-900">{selectedIssue.resolution}</p>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Issue ID: {selectedIssue.issue_id} | Reported: {formatDateTime(selectedIssue.created_at)}
              </p>

              {(isAdmin || isTeacher) && selectedIssue.status !== 'resolved' && selectedIssue.status !== 'closed' && (
                <div className="space-y-4 border-t pt-4">
                  <div className="space-y-2">
                    <Label>Resolution Notes</Label>
                    <Textarea
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      placeholder="Add resolution notes..."
                      rows={3}
                    />
                  </div>
                  <div className="flex gap-2">
                    {selectedIssue.status === 'open' && (
                      <Button 
                        variant="outline"
                        onClick={() => handleUpdateStatus(selectedIssue.issue_id, 'in_progress')}
                      >
                        Mark In Progress
                      </Button>
                    )}
                    <Button onClick={() => handleUpdateStatus(selectedIssue.issue_id, 'resolved')}>
                      Mark Resolved
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IssuesPage;
