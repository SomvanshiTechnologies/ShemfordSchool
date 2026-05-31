import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import { toast } from 'sonner';
import { User, Lock, Trash2, AlertTriangle, Loader2, X } from 'lucide-react';

const formLabel = {
  display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase',
  letterSpacing:'0.06em', color:'#666', marginBottom:6,
};

const isSyntheticEmail = (em) => /@(student|staff)\.shemford\.in$/i.test(em || '');

// Module-level sheet so inputs inside keep focus across re-renders.
const Sheet = ({ title, onClose, children }) => {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:240,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
      <div onClick={(e) => e.stopPropagation()}
        style={{background:'#FFF',width:'100%',maxWidth:520,borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:'94dvh',display:'flex',flexDirection:'column',paddingBottom:'env(safe-area-inset-bottom, 0)'}}>
        <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
          <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0'}}>
          <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A'}}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888'}}><X size={20} /></button>
        </div>
        <div style={{padding:16,overflowY:'auto',flex:1}}>{children}</div>
      </div>
    </div>
  );
};

const MobileSettings = () => {
  const { user, setAuthUser } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('profile');

  // ── Profile ──
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

  const saveProfile = async () => {
    if (!meForm.name?.trim()) { toast.error('Name cannot be empty'); return; }
    setMeSaving(true);
    try {
      const payload = { name: meForm.name.trim(), phone: meForm.phone?.trim() || null };
      if (meForm.email?.trim()) payload.email = meForm.email.trim();
      const res = await api.put('/auth/me', payload);
      if (typeof setAuthUser === 'function') setAuthUser(res.data);
      toast.success('Profile updated');
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to update profile');
    } finally { setMeSaving(false); }
  };

  // ── Password ──
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [pwLoading, setPwLoading] = useState(false);

  const changePassword = async () => {
    if (pwForm.new_password !== pwForm.confirm) { toast.error('New passwords do not match'); return; }
    if (pwForm.new_password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setPwLoading(true);
    try {
      await api.put('/settings/change-password', {
        current_password: pwForm.current_password,
        new_password: pwForm.new_password,
      });
      toast.success('Password changed successfully');
      setPwForm({ current_password: '', new_password: '', confirm: '' });
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to change password');
    } finally { setPwLoading(false); }
  };

  // ── Delete my account ──
  const [myDelReq, setMyDelReq] = useState(undefined);
  const [showDel, setShowDel] = useState(false);
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
      setShowDel(false);
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

  const TABS = [{ key: 'profile', label: 'Profile' }, { key: 'password', label: 'Password' }];

  return (
    <div data-testid="m-settings">
      <div className="m-header"><div><h1>Settings</h1></div></div>

      {/* Tab bar */}
      <div style={{display:'flex',gap:6,padding:4,background:'#F0F0F0',borderRadius:12,marginBottom:12}}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              flex:1,padding:'8px 12px',borderRadius:8,border:'none',
              background: tab === t.key ? '#FFF' : 'transparent',
              color: tab === t.key ? '#1A1A1A' : '#888',
              fontSize:12,fontWeight:700,cursor:'pointer',
              boxShadow: tab === t.key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <>
          <div className="m-card" style={{marginBottom:12}}>
            <p style={{fontSize:13,fontWeight:800,color:'#1A1A1A',display:'flex',alignItems:'center',gap:6,marginBottom:12}}>
              <User size={15} color="#888" /> My Profile
            </p>
            <div style={{marginBottom:10}}>
              <label style={formLabel}>Name</label>
              <input className="m-input" value={meForm.name} onChange={(e) => setMeForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div style={{marginBottom:10}}>
              <label style={formLabel}>Phone</label>
              <input className="m-input" inputMode="numeric" value={meForm.phone} onChange={(e) => setMeForm(f => ({ ...f, phone: e.target.value }))} placeholder="—" />
            </div>
            <div style={{marginBottom:10}}>
              <label style={formLabel}>Email</label>
              <input className="m-input" type="email" value={meForm.email} onChange={(e) => setMeForm(f => ({ ...f, email: e.target.value }))} placeholder="you@example.com (optional)" />
            </div>
            <div style={{marginBottom:10}}>
              <label style={formLabel}>Role</label>
              <input className="m-input" value={user?.role || ''} disabled style={{background:'#F8F8F8',color:'#888',textTransform:'capitalize'}} />
            </div>
            <p style={{fontSize:11,color:'#888',marginBottom:12}}>Add or update your email to log in with it. You can also log in with your admission/employee ID.</p>
            <button onClick={saveProfile} disabled={meSaving} className="m-btn m-btn-primary" style={{width:'100%'}}>
              {meSaving ? <Loader2 size={14} className="animate-spin" /> : null} Save Profile
            </button>
          </div>

          {/* Delete my account — non-admins only */}
          {!isAdmin && (
          <div className="m-card" style={{border:'1px solid #fecaca'}}>
            <p style={{fontSize:13,fontWeight:800,color:'#dc2626',display:'flex',alignItems:'center',gap:6,marginBottom:10}}>
              <Trash2 size={15} /> Delete My Account
            </p>
            {myDelReq === undefined ? (
              <Loader2 size={18} className="animate-spin" color="#aaa" />
            ) : myDelReq && myDelReq.status === 'pending' ? (
              <>
                <div style={{display:'flex',gap:8,padding:12,background:'#fffbeb',border:'1px solid #fde68a',borderRadius:12,marginBottom:12}}>
                  <AlertTriangle size={16} color="#d97706" style={{flexShrink:0,marginTop:2}} />
                  <p style={{fontSize:13,color:'#92400e'}}>Your deletion request is <strong>pending admin approval</strong>. Once approved, your account and all your data are permanently deleted.</p>
                </div>
                <button onClick={cancelDeletion} disabled={delLoading} className="m-btn m-btn-outline" style={{width:'100%'}}>
                  {delLoading ? <Loader2 size={14} className="animate-spin" /> : null} Cancel Request
                </button>
              </>
            ) : (
              <>
                <p style={{fontSize:13,color:'#666',marginBottom:10}}>Permanently delete your account and all associated data. Your request is sent to an administrator for approval; once approved it <strong>cannot be undone</strong>.</p>
                {myDelReq && myDelReq.status === 'rejected' && (
                  <p style={{fontSize:11,color:'#dc2626',marginBottom:10}}>Your previous request was rejected{myDelReq.rejection_reason ? `: “${myDelReq.rejection_reason}”` : '.'}</p>
                )}
                <button onClick={() => { setDelReason(''); setShowDel(true); }} className="m-btn" style={{width:'100%',background:'#dc2626',color:'#FFF'}} data-testid="m-delete-account-btn">
                  <Trash2 size={14} /> Request Account Deletion
                </button>
              </>
            )}
          </div>
          )}
        </>
      )}

      {tab === 'password' && (
        <div className="m-card">
          <p style={{fontSize:13,fontWeight:800,color:'#1A1A1A',display:'flex',alignItems:'center',gap:6,marginBottom:12}}>
            <Lock size={15} color="#888" /> Change Password
          </p>
          <div style={{marginBottom:10}}>
            <label style={formLabel}>Current Password</label>
            <input className="m-input" type="password" value={pwForm.current_password} onChange={(e) => setPwForm(p => ({ ...p, current_password: e.target.value }))} />
          </div>
          <div style={{marginBottom:10}}>
            <label style={formLabel}>New Password</label>
            <input className="m-input" type="password" value={pwForm.new_password} onChange={(e) => setPwForm(p => ({ ...p, new_password: e.target.value }))} />
          </div>
          <div style={{marginBottom:12}}>
            <label style={formLabel}>Confirm New Password</label>
            <input className="m-input" type="password" value={pwForm.confirm} onChange={(e) => setPwForm(p => ({ ...p, confirm: e.target.value }))}
              style={pwForm.confirm && pwForm.confirm !== pwForm.new_password ? { borderColor:'#f87171' } : undefined} />
          </div>
          <button onClick={changePassword} disabled={pwLoading} className="m-btn" style={{width:'100%',background:'#1A1A1A',color:'#FFF'}}>
            {pwLoading ? <Loader2 size={14} className="animate-spin" /> : null} Update Password
          </button>
        </div>
      )}

      {showDel && (
        <Sheet title="Delete My Account" onClose={() => !delLoading && setShowDel(false)}>
          <div style={{display:'flex',gap:8,padding:12,background:'#fee2e2',border:'1px solid #fecaca',borderRadius:12,marginBottom:12}}>
            <AlertTriangle size={16} color="#dc2626" style={{flexShrink:0,marginTop:2}} />
            <p style={{fontSize:13,color:'#991b1b'}}>This sends a deletion request to an administrator. Once approved, your account and <strong>all of your data are permanently deleted</strong> and cannot be recovered.</p>
          </div>
          <label style={formLabel}>Reason (optional)</label>
          <input className="m-input" value={delReason} onChange={(e) => setDelReason(e.target.value)} placeholder="Why are you leaving?" />
          <div style={{display:'flex',gap:8,marginTop:12}}>
            <button onClick={() => setShowDel(false)} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
            <button onClick={submitDeletion} disabled={delLoading} className="m-btn" style={{flex:1,background:'#dc2626',color:'#FFF'}} data-testid="m-delete-account-confirm">
              {delLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Send Request
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
};

export default MobileSettings;
