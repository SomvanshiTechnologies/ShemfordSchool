import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { toast } from 'sonner';
import { Lock, Loader2, User as UserIcon, Trash2, AlertTriangle } from 'lucide-react';

const SettingsPage = () => {
  const { user, setAuthUser, isAdmin } = useAuth();

  // ── My profile (all users) ───────────────────────────────────────────────
  // System-generated logins (no real email) use a synthetic address — hide it
  // so the user can add their own real email.
  const isSyntheticEmail = (em) => /@(student|staff)\.shemford\.in$/i.test(em || '');
  const [meForm, setMeForm] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    email: isSyntheticEmail(user?.email) ? '' : (user?.email || ''),
  });
  const [meSaving, setMeSaving] = useState(false);
  useEffect(() => {
    setMeForm({
      name: user?.name || '',
      phone: user?.phone || '',
      email: isSyntheticEmail(user?.email) ? '' : (user?.email || ''),
    });
  }, [user?.user_id, user?.name, user?.phone, user?.email]);

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    if (!meForm.name?.trim()) {
      toast.error('Name cannot be empty');
      return;
    }
    setMeSaving(true);
    try {
      const payload = {
        name: meForm.name.trim(),
        phone: meForm.phone?.trim() || null,
      };
      if (meForm.email?.trim()) payload.email = meForm.email.trim();
      const res = await api.put('/auth/me', payload);
      if (typeof setAuthUser === 'function') setAuthUser(res.data);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update profile');
    } finally {
      setMeSaving(false);
    }
  };

  // ── Change password ──────────────────────────────────────────────────────
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [pwLoading, setPwLoading] = useState(false);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (pwForm.new_password !== pwForm.confirm) {
      toast.error('New passwords do not match');
      return;
    }
    if (pwForm.new_password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setPwLoading(true);
    try {
      await api.put('/settings/change-password', {
        current_password: pwForm.current_password,
        new_password: pwForm.new_password,
      });
      toast.success('Password changed successfully');
      setPwForm({ current_password: '', new_password: '', confirm: '' });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to change password');
    } finally {
      setPwLoading(false);
    }
  };

  // ── Account deletion: my own request (all users) ─────────────────────────
  const [myDelReq, setMyDelReq] = useState(undefined); // undefined=loading, null=none
  const [showDelDialog, setShowDelDialog] = useState(false);
  const [delReason, setDelReason] = useState('');
  const [delLoading, setDelLoading] = useState(false);

  useEffect(() => {
    let active = true;
    api.get('/account-deletion/my-request')
      .then(r => { if (active) setMyDelReq(r.data?.request || null); })
      .catch(() => { if (active) setMyDelReq(null); });
    return () => { active = false; };
  }, [user?.user_id]);

  const submitDeletion = async () => {
    setDelLoading(true);
    try {
      const res = await api.post('/account-deletion/request', { reason: delReason.trim() || undefined });
      setMyDelReq(res.data.request);
      setShowDelDialog(false);
      setDelReason('');
      toast.success('Deletion request sent to admin for approval.');
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to submit request');
    } finally { setDelLoading(false); }
  };

  const cancelDeletion = async () => {
    if (!myDelReq) return;
    setDelLoading(true);
    try {
      await api.post(`/account-deletion/${myDelReq.request_id}/cancel`);
      setMyDelReq(null);
      toast.success('Deletion request cancelled.');
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to cancel');
    } finally { setDelLoading(false); }
  };

  const triggerCls = "justify-start gap-2 px-3 py-2.5 rounded-xl text-slate-600 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 data-[state=active]:shadow-none";

  return (
    <div className="max-w-4xl p-6">
      <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Settings</h1>

      <Tabs defaultValue="profile" orientation="vertical" className="mt-6 flex flex-col sm:flex-row gap-6">
        <TabsList className="h-auto w-full sm:w-52 shrink-0 flex-row sm:flex-col items-stretch gap-1 bg-transparent p-0 overflow-x-auto sm:sticky sm:top-6 sm:self-start">
          <TabsTrigger value="profile" className={triggerCls}>
            <UserIcon className="h-4 w-4" strokeWidth={1.5} /> Profile
          </TabsTrigger>
          <TabsTrigger value="password" className={triggerCls}>
            <Lock className="h-4 w-4" strokeWidth={1.5} /> Password
          </TabsTrigger>
        </TabsList>

        {/* Single static panel — only the inner content changes per tab */}
        <div className="flex-1 min-w-0 self-start w-full rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {/* ── Profile tab: profile + delete account ── */}
          <TabsContent value="profile" className="mt-0 divide-y divide-slate-100">
            <Card className="border-0 shadow-none rounded-none bg-transparent">
              <CardHeader className="pt-4 pb-2">
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <UserIcon className="h-4 w-4" strokeWidth={1.5} /> My Profile
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <form onSubmit={handleProfileUpdate} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold uppercase tracking-wider">Name</Label>
                      <Input
                        className="h-10 rounded-xl border-slate-200 focus:border-slate-900 focus:ring-0"
                        value={meForm.name}
                        onChange={e => setMeForm(f => ({ ...f, name: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold uppercase tracking-wider">Phone</Label>
                      <Input
                        className="h-10 rounded-xl border-slate-200 focus:border-slate-900 focus:ring-0"
                        value={meForm.phone}
                        onChange={e => setMeForm(f => ({ ...f, phone: e.target.value }))}
                        placeholder="—"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Email</Label>
                      <Input
                        type="email"
                        className="h-10 rounded-xl"
                        placeholder="you@example.com (optional)"
                        value={meForm.email}
                        onChange={e => setMeForm(f => ({ ...f, email: e.target.value }))}
                        data-testid="profile-email-input"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Role</Label>
                      <Input className="h-10 rounded-xl bg-slate-50 text-slate-500 capitalize" value={user?.role || ''} disabled />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">Add or update your email to log in with it. You can also log in with your admission/employee ID. Role can't be changed here — contact an admin.</p>
                  <div className="flex justify-end">
                    <Button type="submit" className="rounded-xl" disabled={meSaving}>
                      {meSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={1.5} />}
                      Save Profile
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* ── Delete My Account (Danger Zone — non-admins only) ── */}
            {!isAdmin && (
            <Card className="border-0 shadow-none rounded-none bg-transparent">
              <CardHeader className="pt-4 pb-2">
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-red-700">
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} /> Delete My Account
                </CardTitle>
              </CardHeader>
              <CardContent>
                {myDelReq === undefined ? (
                  <div className="flex items-center h-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                ) : myDelReq && myDelReq.status === 'revoke_pending' ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-200 p-3">
                      <AlertTriangle className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                      <p className="text-sm text-blue-800">
                        Your restoration request has been sent to the admin. <strong>Once approved, your account will be fully recovered</strong> and you can login normally.
                      </p>
                    </div>
                  </div>
                ) : myDelReq && myDelReq.status === 'pending' ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3">
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <p className="text-sm text-amber-800">
                        Your account deletion request is <strong>pending admin approval</strong>. Your account is deactivated.
                        {myDelReq.expires_at && (
                          <span className="block mt-1 text-xs text-amber-700">
                            You can revoke this by {new Date(myDelReq.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.
                          </span>
                        )}
                      </p>
                    </div>
                    <Button variant="outline" className="rounded-xl" onClick={cancelDeletion} disabled={delLoading}>
                      {delLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Cancel Request &amp; Restore Account
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-600">
                      Permanently delete your account and all associated data. Your request is sent to an administrator for approval; once approved it <strong>cannot be undone</strong>.
                    </p>
                    {myDelReq && myDelReq.status === 'rejected' && (
                      <p className="text-xs text-red-600">Your previous request was rejected{myDelReq.rejection_reason ? `: “${myDelReq.rejection_reason}”` : '.'}</p>
                    )}
                    <Button
                      className="bg-red-600 hover:bg-red-700 text-white rounded-xl"
                      onClick={() => { setDelReason(''); setShowDelDialog(true); }}
                      data-testid="delete-account-btn"
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> Request Account Deletion
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
            )}
          </TabsContent>

          {/* ── Password tab ── */}
          <TabsContent value="password" className="mt-0">
            <Card className="border-0 shadow-none rounded-none bg-transparent">
              <CardHeader className="pt-4 pb-2">
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <Lock className="h-4 w-4" strokeWidth={1.5} /> Change Password
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wider">Current Password</Label>
                    <Input
                      type="password"
                      className="h-10 rounded-xl border-slate-200 focus:border-slate-900 focus:ring-0"
                      value={pwForm.current_password}
                      onChange={e => setPwForm(p => ({ ...p, current_password: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wider">New Password</Label>
                    <Input
                      type="password"
                      className="h-10 rounded-xl border-slate-200 focus:border-slate-900 focus:ring-0"
                      value={pwForm.new_password}
                      onChange={e => setPwForm(p => ({ ...p, new_password: e.target.value }))}
                      required
                      minLength={8}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wider">Confirm New Password</Label>
                    <Input
                      type="password"
                      className={`h-10 rounded-xl border-slate-200 focus:ring-0 ${
                        pwForm.confirm && pwForm.confirm !== pwForm.new_password
                          ? 'border-red-400 focus:border-red-400'
                          : 'focus:border-slate-900'
                      }`}
                      value={pwForm.confirm}
                      onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={pwLoading}
                    className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs uppercase tracking-wider font-semibold h-10"
                  >
                    {pwLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Update Password
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>

      {/* Confirm deletion-request dialog */}
      {showDelDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !delLoading && setShowDelDialog(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="text-lg font-semibold">Delete My Account</h3>
            </div>
            <p className="text-sm text-slate-600">
              This sends a deletion request to an administrator. Once they approve it, your account and <strong>all of your data are permanently deleted</strong> and cannot be recovered.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider">Reason (optional)</Label>
              <Input className="h-10 rounded-xl" value={delReason} onChange={e => setDelReason(e.target.value)} placeholder="Why are you leaving?" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" className="rounded-xl" onClick={() => setShowDelDialog(false)} disabled={delLoading}>Cancel</Button>
              <Button className="bg-red-600 hover:bg-red-700 text-white rounded-xl" onClick={submitDeletion} disabled={delLoading} data-testid="delete-account-confirm">
                {delLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Send Request
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
