import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { getCached, setCached } from '../lib/pageCache';

const TopProgressBar = ({ active }) =>
  active ? (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px] overflow-hidden" style={{ background: '#fde8c8' }}>
      <div className="h-full w-2/5" style={{ background: '#E88A1A', animation: 'topbar-slide 1.4s ease-in-out infinite' }} />
    </div>
  ) : null;
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { toast } from 'sonner';
import { History, RotateCcw, ShieldCheck, FileSearch } from 'lucide-react';
import { formatDateTime } from '../lib/utils';

const ROLE_COLORS = {
  admin: 'bg-slate-900/90 text-white border-transparent',
  teacher: 'bg-amber-50 text-amber-800 border-amber-200',
  student: 'bg-blue-50 text-blue-700 border-blue-200',
  parent: 'bg-purple-50 text-purple-700 border-purple-200',
  accountant: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const ENTITY_LABELS = {
  student: 'Student',
  employee: 'Employee',
  holiday: 'Holiday',
  announcement: 'Announcement',
  pos_device: 'POS Device',
};

const summarize = (entry) => {
  const c = entry.changes || {};
  if (c.name) return c.name;
  if (c.title) return c.title;
  if (c.date) return c.date;
  if (c.device_id) return c.device_id;
  return entry.entity_id;
};

const AuditTrailPage = () => {
  const [entries, setEntries] = useState([]);
  const [restorableTypes, setRestorableTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalEntries, setTotalEntries] = useState(0);
  const sentinelRef = useRef(null);
  const PAGE_SIZE = 30;
  const [entityType, setEntityType] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [restoring, setRestoring] = useState(false);

  const fetchEntries = useCallback(async (pg = 1, append = false) => {
    const cacheKey = `audit:${entityType}:${pg}`;
    const cached = getCached(cacheKey);

    if (!append) {
      if (cached) {
        setEntries(cached.entries);
        setTotalEntries(cached.total);
        setTotalPages(cached.pages);
        setRestorableTypes(cached.types || []);
        setLoading(false);
      }
      setRefreshing(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = {
        only_non_admin: true,
        include_restored: true,
        page: pg,
        limit: PAGE_SIZE,
      };
      if (entityType) params.entity_type = entityType;
      const res = await api.get('/admin/audit-trail', { params });
      const arr = res.data.entries || [];
      const total = parseInt(res.headers?.['x-total-count'] ?? res.data?.count ?? arr.length);
      const pages = parseInt(res.headers?.['x-total-pages'] ?? 1);
      const types = res.data.restorable_entity_types || [];
      setCached(cacheKey, { entries: arr, total, pages, types });
      setEntries(prev => append ? [...prev, ...arr] : arr);
      setTotalEntries(total);
      setTotalPages(pages);
      setRestorableTypes(types);
    } catch (err) {
      if (!cached && !append) toast.error(err.response?.data?.detail || 'Failed to load audit trail');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [entityType]);

  useEffect(() => {
    setPage(1);
    setEntries([]);
    fetchEntries(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingMore && !loading) {
        setPage(prev => {
          const next = prev + 1;
          if (next <= totalPages) { fetchEntries(next, true); return next; }
          return prev;
        });
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadingMore, loading, totalPages, fetchEntries]);

  const handleRestore = async () => {
    if (!confirming) return;
    setRestoring(true);
    try {
      const res = await api.post(`/admin/audit-trail/${confirming.log_id}/restore`);
      toast.success(res.data.message || 'Restored');
      setConfirming(null);
      fetchEntries();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="audit-trail-page">
      <TopProgressBar active={refreshing} />
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <History className="h-6 w-6 text-[#E88A1A]" strokeWidth={1.5} />
          Audit Trails
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Track who deleted what and restore items if needed. Only soft-deletable
          entities (students, employees, holidays, announcements, POS devices) are listed.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSearch className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
                Deletion log
              </CardTitle>
              <CardDescription>
                {loading ? 'Loading…' : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
              </CardDescription>
            </div>
            <Select
              value={entityType || 'all'}
              onValueChange={(v) => setEntityType(v === 'all' ? '' : v)}
            >
              <SelectTrigger className="h-9 w-44 text-xs">
                <SelectValue placeholder="All entity types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All entity types</SelectItem>
                {restorableTypes.map((t) => (
                  <SelectItem key={t} value={t}>{ENTITY_LABELS[t] || t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading && entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading audit log…</div>
          ) : entries.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center text-slate-500">
              <ShieldCheck className="h-10 w-10 text-slate-300 mb-3" strokeWidth={1.5} />
              <p className="text-sm font-medium">No matching deletion events</p>
              <p className="text-xs mt-1">Adjust the filters above to widen the search.</p>
            </div>
          ) : (
            <Table data-testid="audit-trail-table">
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Performed by</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>What was deleted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const isRestored = !!entry.restored_at;
                  const canRestore = restorableTypes.includes(entry.entity_type);
                  return (
                    <TableRow key={entry.log_id}>
                      <TableCell className="text-xs text-slate-600 whitespace-nowrap">
                        {formatDateTime(entry.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-sm text-slate-800 font-medium">
                            {entry.performed_by_name || entry.performed_by}
                          </span>
                          {entry.performed_by_role && (
                            <Badge
                              variant="outline"
                              className={`capitalize font-medium text-[10px] w-fit ${ROLE_COLORS[entry.performed_by_role] || 'bg-gray-50 text-gray-600'}`}
                            >
                              {entry.performed_by_role}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-medium">
                          {ENTITY_LABELS[entry.entity_type] || entry.entity_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-slate-700">{summarize(entry)}</div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          {entry.entity_id}
                        </div>
                      </TableCell>
                      <TableCell>
                        {isRestored ? (
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200" variant="outline">
                            Restored
                          </Badge>
                        ) : (
                          <Badge className="bg-rose-50 text-rose-700 border-rose-200" variant="outline">
                            Deleted
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isRestored ? (
                          <span className="text-[11px] text-slate-400">
                            by {entry.restored_by_name || entry.restored_by}
                          </span>
                        ) : canRestore ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirming(entry)}
                            data-testid={`restore-${entry.log_id}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />
                            Restore
                          </Button>
                        ) : (
                          <span className="text-[11px] text-slate-400">Not restorable</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex items-center justify-center py-4 gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading more...
            </div>
          )}
          {!loading && !loadingMore && page >= totalPages && totalEntries > 0 && (
            <p className="text-center text-xs text-slate-400 py-3">{totalEntries} entr{totalEntries !== 1 ? 'ies' : 'y'} total</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore {confirming ? (ENTITY_LABELS[confirming.entity_type] || confirming.entity_type) : ''}?</DialogTitle>
            <DialogDescription>
              Are you sure you want to restore {confirming ? (ENTITY_LABELS[confirming.entity_type] || confirming.entity_type).toLowerCase() : ''}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={restoring}>
              Cancel
            </Button>
            <Button onClick={handleRestore} disabled={restoring}>
              {restoring ? 'Restoring…' : 'Confirm restore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AuditTrailPage;
