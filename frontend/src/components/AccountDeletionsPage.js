import React, { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { Trash2, AlertTriangle, Check, X, Loader2, ShieldCheck, RotateCcw, Clock } from 'lucide-react';

const AccountDeletionsPage = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectType, setRejectType] = useState('deletion'); // 'deletion' | 'revoke'

  const load = useCallback(() => {
    setLoading(true);
    api.get('/account-deletion/requests')
      .then(r => setRequests(Array.isArray(r.data) ? r.data : []))
      .catch((e) => { if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to load requests'); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    if (actingId) return;
    if (!window.confirm("Permanently delete this account and ALL of the user's data? This cannot be undone.")) return;
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
      const endpoint = rejectType === 'revoke'
        ? `/account-deletion/${rejectId}/reject-revoke`
        : `/account-deletion/${rejectId}/reject`;
      await api.post(endpoint, { reason: rejectReason.trim() || undefined });
      toast.success(rejectType === 'revoke' ? 'Revoke request rejected — deletion proceeds.' : 'Request rejected.');
      setRejectId(null);
      setRejectReason('');
      load();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to reject');
    } finally { setActingId(null); }
  };

  const approveRevoke = async (id) => {
    if (actingId) return;
    setActingId(id);
    try {
      const res = await api.post(`/account-deletion/${id}/approve-revoke`);
      toast.success(res.data.message || 'Account restored.');
      load();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to approve revoke');
    } finally { setActingId(null); }
  };

  const deletionReqs  = requests.filter(r => r.status === 'pending');
  const revokeReqs    = requests.filter(r => r.status === 'revoke_pending');
  const approvedReqs  = requests.filter(r => r.status === 'approved');

  const daysRemaining = (isoDate) => {
    if (!isoDate) return null;
    const diff = new Date(isoDate) - new Date();
    return Math.max(0, Math.ceil(diff / 86400000));
  };

  const executeDeletion = async (id, force = false) => {
    if (actingId) return;
    const msg = force
      ? "Force-delete now? The 30-day window hasn't expired yet."
      : "Permanently delete this account now? This cannot be undone.";
    if (!window.confirm(msg)) return;
    setActingId(id);
    try {
      const res = await api.post(`/account-deletion/${id}/execute`, { force });
      toast.success(res.data.message || 'Account deleted.');
      load();
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to execute deletion');
    } finally { setActingId(null); }
  };

  return (
    <div className="max-w-5xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Trash2 className="h-6 w-6 text-red-600" strokeWidth={1.5} /> Account Deletion Requests
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Review and act on users who requested to delete their account. Approving permanently deletes the account and all their data.
        </p>
      </div>

      {/* ── Revoke / Restoration Requests ── */}
      {revokeReqs.length > 0 && (
        <Card className="border border-blue-200 shadow-none rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-blue-700">
              <RotateCcw className="h-4 w-4" /> Account Restoration Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-xs text-blue-700 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                These users requested deletion but changed their mind. Approving will reactivate their account.
              </p>
              {revokeReqs.map(r => (
                <div key={r.request_id} className="border border-blue-100 rounded-xl p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{r.user_name || r.user_id}</p>
                      <Badge variant="outline" className="text-[10px] capitalize">{r.user_role}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 truncate">{r.user_email}</p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Deletion requested {r.requested_at?.slice(0, 10)}
                      {r.revoke_requested_at && <span> · Revoke requested {r.revoke_requested_at.slice(0, 10)}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost"
                      className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 h-8"
                      onClick={() => approveRevoke(r.request_id)}
                      disabled={actingId === r.request_id}
                      title="Approve — restore account"
                    >
                      {actingId === r.request_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="ghost"
                      className="text-red-600 hover:text-red-800 hover:bg-red-50 h-8"
                      onClick={() => { setRejectId(r.request_id); setRejectReason(''); setRejectType('revoke'); }}
                      disabled={actingId === r.request_id}
                      title="Reject — proceed with deletion"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Approved — 30-day grace period ── */}
      {approvedReqs.length > 0 && (
        <Card className="border border-amber-200 shadow-none rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-amber-700">
              <Clock className="h-4 w-4" /> Scheduled for Deletion (30-day window)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-xs text-amber-700 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                These accounts are approved for deletion. Users can still revoke within 30 days. Execute once the window closes or click Force Delete to act immediately.
              </p>
              {approvedReqs.map(r => {
                const days = daysRemaining(r.final_deletion_at);
                const expired = days === 0;
                return (
                  <div key={r.request_id} className="border border-amber-100 rounded-xl p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm truncate">{r.user_name || r.user_id}</p>
                        <Badge variant="outline" className="text-[10px] capitalize">{r.user_role}</Badge>
                        {expired
                          ? <Badge className="bg-red-100 text-red-700 text-[10px]">Window expired</Badge>
                          : <Badge className="bg-amber-100 text-amber-700 text-[10px]">{days}d remaining</Badge>
                        }
                      </div>
                      <p className="text-xs text-slate-500 truncate">{r.user_email}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        Approved {r.reviewed_at?.slice(0, 10)}
                        {r.final_deletion_at && <span> · Deletes {r.final_deletion_at.slice(0, 10)}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {expired ? (
                        <Button size="sm"
                          className="text-xs h-7 px-2 bg-red-600 hover:bg-red-700 text-white"
                          onClick={() => executeDeletion(r.request_id, false)}
                          disabled={actingId === r.request_id}
                        >
                          {actingId === r.request_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Delete Now
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost"
                          className="text-red-600 hover:text-red-800 hover:bg-red-50 h-8 text-xs"
                          onClick={() => executeDeletion(r.request_id, true)}
                          disabled={actingId === r.request_id}
                          title="Force delete before window expires"
                        >
                          {actingId === r.request_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Pending Deletion Requests ── */}
      <Card className="border border-slate-200 shadow-none rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold uppercase tracking-wider">Pending Deletion Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-24"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
          ) : deletionReqs.length === 0 ? (
            <div className="py-12 flex flex-col items-center text-center text-slate-500">
              <ShieldCheck className="h-10 w-10 text-slate-300 mb-3" strokeWidth={1.5} />
              <p className="text-sm font-medium">No pending deletion requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-red-600 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Approving permanently deletes the account and all data. This cannot be undone.
              </p>
              {deletionReqs.map(r => (
                <div key={r.request_id} className="border border-slate-200 rounded-xl p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{r.user_name || r.user_id}</p>
                      <Badge variant="outline" className="text-[10px] capitalize">{r.user_role}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 truncate">{r.user_email}</p>
                    {r.reason && <p className="text-xs text-slate-600 mt-1">"{r.reason}"</p>}
                    <p className="text-[10px] text-slate-400 mt-1">
                      Requested {r.requested_at?.slice(0, 10)}
                      {r.expires_at && <span> · Revoke window until {r.expires_at.slice(0, 10)}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost"
                      className="text-green-600 hover:text-green-800 hover:bg-green-50 h-8"
                      onClick={() => approve(r.request_id)}
                      disabled={actingId === r.request_id}
                      title="Approve & delete"
                    >
                      {actingId === r.request_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="ghost"
                      className="text-red-600 hover:text-red-800 hover:bg-red-50 h-8"
                      onClick={() => { setRejectId(r.request_id); setRejectReason(''); setRejectType('deletion'); }}
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
            <h3 className="text-lg font-semibold">
              {rejectType === 'revoke' ? 'Reject Restore Request' : 'Reject Deletion Request'}
            </h3>
            <p className="text-sm text-slate-600">
              {rejectType === 'revoke'
                ? 'Deletion will proceed as originally requested.'
                : 'The user keeps their account.'}
              {' '}Optionally explain why.
            </p>
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
