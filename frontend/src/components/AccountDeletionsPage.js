import React, { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { Trash2, AlertTriangle, Check, X, Loader2, ShieldCheck } from 'lucide-react';

const AccountDeletionsPage = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/account-deletion/requests', { params: { status: 'pending' } })
      .then(r => setRequests(Array.isArray(r.data) ? r.data : []))
      .catch((e) => { if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to load requests'); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    if (actingId) return;
    if (!window.confirm('Permanently delete this account and ALL of the user’s data? This cannot be undone.')) return;
    setActingId(id);
    try {
      const res = await api.post(`/account-deletion/${id}/approve`);
      toast.success(res.data.message || 'Account deleted.');
      load();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to approve');
    } finally { setActingId(null); }
  };

  const reject = async () => {
    if (!rejectId) return;
    setActingId(rejectId);
    try {
      await api.post(`/account-deletion/${rejectId}/reject`, { reason: rejectReason.trim() || undefined });
      toast.success('Request rejected.');
      setRejectId(null);
      setRejectReason('');
      load();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to reject');
    } finally { setActingId(null); }
  };

  return (
    <div className="max-w-5xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Trash2 className="h-6 w-6 text-red-600" strokeWidth={1.5} /> Account Deletion Requests
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Review and act on users who requested to delete their account. Approving permanently deletes the account and all of their data — this cannot be undone.
        </p>
      </div>

      <Card className="border border-slate-200 shadow-none rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold uppercase tracking-wider">Pending Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-24"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
          ) : requests.length === 0 ? (
            <div className="py-12 flex flex-col items-center text-center text-slate-500">
              <ShieldCheck className="h-10 w-10 text-slate-300 mb-3" strokeWidth={1.5} />
              <p className="text-sm font-medium">No pending deletion requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-red-600 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Approving permanently deletes the user’s account and all of their data. This cannot be undone.
              </p>
              {requests.map(r => (
                <div key={r.request_id} className="border border-slate-200 rounded-xl p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{r.user_name || r.user_id}</p>
                      <Badge variant="outline" className="text-[10px] capitalize">{r.user_role}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 truncate">{r.user_email}</p>
                    {r.reason && <p className="text-xs text-slate-600 mt-1">“{r.reason}”</p>}
                    <p className="text-[10px] text-slate-400 mt-1">Requested {r.requested_at?.slice(0, 10)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm" variant="ghost"
                      className="text-green-600 hover:text-green-800 hover:bg-green-50 h-8"
                      onClick={() => approve(r.request_id)}
                      disabled={actingId === r.request_id}
                      title="Approve & delete"
                    >
                      {actingId === r.request_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      className="text-red-600 hover:text-red-800 hover:bg-red-50 h-8"
                      onClick={() => { setRejectId(r.request_id); setRejectReason(''); }}
                      disabled={actingId === r.request_id}
                      title="Reject"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reject-reason dialog */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !actingId && setRejectId(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Reject Deletion Request</h3>
            <p className="text-sm text-slate-600">The user keeps their account. Optionally tell them why.</p>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider">Reason (optional)</Label>
              <Input className="h-10 rounded-xl" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="e.g. Outstanding dues" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" className="rounded-xl" onClick={() => setRejectId(null)} disabled={!!actingId}>Cancel</Button>
              <Button className="bg-red-600 hover:bg-red-700 text-white rounded-xl" onClick={reject} disabled={!!actingId}>
                {actingId === rejectId ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Confirm Reject
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountDeletionsPage;
