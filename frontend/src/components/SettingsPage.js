import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { Lock, Building2, CheckCircle, XCircle, Loader2, User as UserIcon } from 'lucide-react';

const SettingsPage = () => {
  const { user, setAuthUser } = useAuth();
  const isAdmin = user?.role === 'admin';

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
      // Only send email when the user typed one (blank = keep current login email)
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

  // ── School profile (admin only) ──────────────────────────────────────────
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  // ── System status (admin only) ───────────────────────────────────────────
  const [systemStatus, setSystemStatus] = useState(null);

  useEffect(() => {
    if (isAdmin) {
      setProfileLoading(true);
      Promise.all([
        api.get('/settings/school'),
        api.get('/settings/system'),
      ])
        .then(([profileRes, statusRes]) => {
          setProfile(profileRes.data);
          setSystemStatus(statusRes.data);
        })
        .catch(() => toast.error('Failed to load settings'))
        .finally(() => setProfileLoading(false));
    }
  }, [isAdmin]);

  const handleProfileSave = async (e) => {
    e.preventDefault();
    setProfileSaving(true);
    try {
      const res = await api.put('/settings/school', profile);
      setProfile(res.data);
      toast.success('School profile saved');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save profile');
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Settings</h1>

      {/* ── My Profile (all users) ── */}
      <Card className="border border-slate-200 shadow-none rounded-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <UserIcon className="h-4 w-4" strokeWidth={1.5} /> My Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
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

      {/* ── Change Password ── */}
      <Card className="border border-slate-200 shadow-none rounded-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Lock className="h-4 w-4" strokeWidth={1.5} /> Change Password
          </CardTitle>
        </CardHeader>
        <CardContent>
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

      {/* ── School Profile (admin only) ── */}
      {isAdmin && (
        <Card className="border border-slate-200 shadow-none rounded-xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <Building2 className="h-4 w-4" strokeWidth={1.5} /> School Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profileLoading || !profile ? (
              <div className="flex items-center justify-center h-24">
                <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            ) : (
              <form onSubmit={handleProfileSave} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'school_name', label: 'School Name', full: true },
                    { key: 'principal_name', label: 'Principal Name', full: true },
                    { key: 'address', label: 'Address', full: true },
                    { key: 'city', label: 'City' },
                    { key: 'state', label: 'State' },
                    { key: 'pincode', label: 'PIN Code' },
                    { key: 'phone', label: 'Phone' },
                    { key: 'email', label: 'Email' },
                    { key: 'website', label: 'Website' },
                    { key: 'affiliation_number', label: 'Affiliation No.' },
                  ].map(({ key, label, full }) => (
                    <div key={key} className={`space-y-1.5 ${full ? 'col-span-2' : ''}`}>
                      <Label className="text-xs font-bold uppercase tracking-wider">{label}</Label>
                      <Input
                        className="h-10 rounded-xl border-slate-200 focus:border-slate-900 focus:ring-0 text-sm"
                        value={profile[key] || ''}
                        onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
                <Button
                  type="submit"
                  disabled={profileSaving}
                  className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs uppercase tracking-wider font-semibold h-10"
                >
                  {profileSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save Profile
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── System Status (admin only) ── */}
      {isAdmin && systemStatus && (
        <Card className="border border-slate-200 shadow-none rounded-xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold uppercase tracking-wider">System Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                { key: 'email_configured', label: 'Email (Resend)', description: 'Password reset and payment confirmation emails' },
                { key: 'stripe_configured', label: 'Stripe Payments', description: 'Online fee collection via credit/debit card' },
                { key: 'oauth_configured', label: 'Google Sign-In', description: 'OAuth login for parents' },
              ].map(({ key, label, description }) => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-slate-500">{description}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      systemStatus[key]
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : 'border-gray-200 bg-gray-50 text-gray-500'
                    }`}
                  >
                    {systemStatus[key] ? (
                      <><CheckCircle className="h-3 w-3 mr-1" /> Configured</>
                    ) : (
                      <><XCircle className="h-3 w-3 mr-1" /> Not configured</>
                    )}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-4">
              To configure services, update the backend <code className="bg-slate-100 px-1 rounded">.env</code> file and restart the server.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SettingsPage;
