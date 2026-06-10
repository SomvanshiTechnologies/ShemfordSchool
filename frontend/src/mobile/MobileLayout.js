import React, { useState, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';
import api from '../lib/api';
import {
  LayoutDashboard, Users, CreditCard, BarChart3, Menu, Calendar,
  GraduationCap, Bell, MessageSquare, BookOpen, User, FileText, ClipboardList, Lock, AlertTriangle,
  ChevronDown, Settings, X,
} from 'lucide-react';

const getBottomTabs = (role) => {
  switch (role) {
    case 'admin':
      return [
        { key: 'dashboard', label: 'Home', icon: LayoutDashboard, path: '/m' },
        { key: 'students', label: 'Students', icon: Users, path: '/m/students' },
        { key: 'fees', label: 'Fees', icon: CreditCard, path: '/m/fees' },
        { key: 'attendance', label: 'Attendance', icon: Calendar, path: '/m/attendance' },
        { key: 'more', label: 'More', icon: Menu, path: '/m/more' },
      ];
    case 'teacher':
      return [
        { key: 'dashboard', label: 'Home', icon: LayoutDashboard, path: '/m' },
        { key: 'attendance', label: 'Attendance', icon: Calendar, path: '/m/attendance' },
        { key: 'marks', label: 'Marks', icon: GraduationCap, path: '/m/marks' },
        { key: 'messages', label: 'Messages', icon: MessageSquare, path: '/m/messages' },
        { key: 'more', label: 'More', icon: Menu, path: '/m/more' },
      ];
    case 'parent':
      return [
        { key: 'dashboard', label: 'Home', icon: LayoutDashboard, path: '/m' },
        { key: 'fees', label: 'Fees', icon: CreditCard, path: '/m/fees' },
        { key: 'messages', label: 'Messages', icon: MessageSquare, path: '/m/messages' },
        { key: 'notices', label: 'Notices', icon: Bell, path: '/m/notices' },
        { key: 'more', label: 'More', icon: Menu, path: '/m/more' },
      ];
    case 'student':
      return [
        { key: 'dashboard', label: 'Home', icon: LayoutDashboard, path: '/m' },
        { key: 'marks', label: 'Marks', icon: GraduationCap, path: '/m/marks' },
        { key: 'attendance', label: 'Attendance', icon: Calendar, path: '/m/attendance' },
        { key: 'notices', label: 'Notices', icon: Bell, path: '/m/notices' },
        { key: 'more', label: 'More', icon: Menu, path: '/m/more' },
      ];
    default:
      return [
        { key: 'dashboard', label: 'Home', icon: LayoutDashboard, path: '/m' },
        { key: 'more', label: 'More', icon: Menu, path: '/m/more' },
      ];
  }
};

// ─── Manage Sessions modal ──────────────────────────────────────────────────

const ManageSessionsModal = ({ onClose }) => {
  const { sessions, createSession, activateSession, setArchived, reloadSessions } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const create = async () => {
    setBusy(true); setErr('');
    try { await createSession({ session_name: name.trim() }); setName(''); }
    catch (e) { setErr(e.response?.data?.detail || 'Failed to create session'); }
    finally { setBusy(false); }
  };

  const act = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); }
    catch (e) { setErr(e.response?.data?.detail || 'Action failed'); }
    finally { setBusy(false); }
  };

  const badge = (st) => {
    const map = {
      active:   { bg: '#dcfce7', color: '#16a34a', text: 'Current' },
      archived: { bg: '#f1f5f9', color: '#64748b', text: 'Previous Year' },
      upcoming: { bg: '#dbeafe', color: '#2563eb', text: 'Upcoming' },
    };
    const b = map[st] || { bg: '#f1f5f9', color: '#64748b', text: st };
    return (
      <span style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',
        padding:'2px 7px',borderRadius:99,background:b.bg,color:b.color}}>
        {b.text}
      </span>
    );
  };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:200,display:'flex',alignItems:'flex-end'}}
      onClick={onClose}>
      <div style={{background:'#fff',borderRadius:'20px 20px 0 0',width:'100%',maxHeight:'85vh',display:'flex',flexDirection:'column'}}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 16px 12px',borderBottom:'1px solid #F0F0F0'}}>
          <span style={{fontSize:15,fontWeight:700,color:'#1A1A1A'}}>Manage Academic Sessions</span>
          <button onClick={onClose} style={{background:'none',border:'none',padding:4,cursor:'pointer',color:'#888'}}>
            <X size={18} />
          </button>
        </div>

        {/* Create new */}
        <div style={{padding:'12px 16px',borderBottom:'1px solid #F0F0F0',background:'#FAFAFA'}}>
          <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.07em',color:'#888',marginBottom:6}}>New session</p>
          <div style={{display:'flex',gap:8}}>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="YYYY-YYYY  e.g. 2026-2027"
              style={{flex:1,height:36,padding:'0 10px',fontSize:13,border:'1px solid #E0E0E0',borderRadius:8,outline:'none'}} />
            <button onClick={create} disabled={busy || !name.trim()}
              style={{height:36,padding:'0 14px',fontSize:12,fontWeight:700,background:busy||!name.trim()?'#ccc':'#1A1A1A',color:'#fff',border:'none',borderRadius:8,cursor:busy||!name.trim()?'default':'pointer'}}>
              Create
            </button>
          </div>
          {err && <p style={{fontSize:11,color:'#dc2626',marginTop:6}}>{err}</p>}
        </div>

        {/* Session list */}
        <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
          {sessions.length === 0 && (
            <p style={{textAlign:'center',fontSize:13,color:'#888',padding:'24px 0'}}>No sessions yet.</p>
          )}
          {sessions.map(s => (
            <div key={s.session_id}
              style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'10px 16px',borderBottom:'1px solid #F5F5F5'}}>
              <div style={{minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                  <span style={{fontSize:13,fontWeight:700,color:'#1A1A1A'}}>{s.session_name}</span>
                  {badge(s.status)}
                </div>
                <p style={{fontSize:10,color:'#888'}}>{s.start_date} → {s.end_date}</p>
              </div>
              <div style={{display:'flex',gap:6,flexShrink:0}}>
                {s.is_active && (
                  <button onClick={() => act(() => setArchived(s.session_id, true))} disabled={busy}
                    style={{fontSize:11,fontWeight:600,padding:'4px 10px',borderRadius:7,border:'1px solid #fde68a',color:'#b45309',background:'#fffbeb',cursor:'pointer'}}>
                    End
                  </button>
                )}
                {!s.is_active && (
                  <button onClick={() => act(() => activateSession(s.session_id))} disabled={busy}
                    style={{fontSize:11,fontWeight:600,padding:'4px 10px',borderRadius:7,border:'1px solid #bbf7d0',color:'#15803d',background:'#f0fdf4',cursor:'pointer'}}>
                    Activate
                  </button>
                )}
                {s.status !== 'archived' && !s.is_active && (
                  <button onClick={() => act(() => setArchived(s.session_id, true))} disabled={busy}
                    style={{fontSize:11,fontWeight:600,padding:'4px 10px',borderRadius:7,border:'1px solid #E0E0E0',color:'#444',background:'#F8F8F8',cursor:'pointer'}}>
                    Close
                  </button>
                )}
                {s.status === 'archived' && (
                  <button onClick={() => act(() => setArchived(s.session_id, false))} disabled={busy}
                    style={{fontSize:11,fontWeight:600,padding:'4px 10px',borderRadius:7,border:'1px solid #bfdbfe',color:'#1d4ed8',background:'#eff6ff',cursor:'pointer'}}>
                    Reopen
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{padding:'12px 16px',borderTop:'1px solid #F0F0F0'}}>
          <button onClick={() => { reloadSessions(); onClose(); }}
            style={{width:'100%',height:40,fontSize:13,fontWeight:700,color:'#1A1A1A',background:'#F5F5F5',border:'none',borderRadius:10,cursor:'pointer'}}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Session bar (admin-only, shown at top of every screen) ────────────────

const MobileSessionBar = () => {
  const { activeSession, viewSession, availableSessions, setViewSession } = useSession();
  const [pending, setPending] = useState(null);
  const [showManage, setShowManage] = useState(false);

  if (!viewSession || availableSessions.length === 0) return null;

  const label = (s) => (s === activeSession ? `${s} (current)` : s);
  const isViewing = viewSession !== activeSession;

  return (
    <>
      <div style={{
        display:'flex',alignItems:'center',gap:8,
        padding:'7px 12px',
        background: isViewing ? '#fff7ed' : '#F8F8F8',
        borderBottom: isViewing ? '1px solid #fed7aa' : '1px solid #EBEBEB',
        position:'sticky',top:0,zIndex:10,
      }}>
        <Calendar size={13} color={isViewing ? '#c2410c' : '#888'} style={{flexShrink:0}} />
        <div style={{position:'relative',flex:1,minWidth:0}}>
          <select
            value={viewSession}
            onChange={e => { if (e.target.value !== viewSession) setPending(e.target.value); }}
            data-testid="m-session-select"
            style={{
              width:'100%',appearance:'none',background:'transparent',border:'none',outline:'none',
              fontSize:12,fontWeight:700,color: isViewing ? '#c2410c' : '#444',
              paddingRight:18,cursor:'pointer',
            }}
          >
            {availableSessions.map(s => (
              <option key={s} value={s}>{label(s)}</option>
            ))}
          </select>
          <ChevronDown size={11} color={isViewing ? '#c2410c' : '#888'}
            style={{position:'absolute',right:0,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}} />
        </div>
        <button onClick={() => setShowManage(true)}
          style={{background:'none',border:'none',padding:'2px 4px',cursor:'pointer',color:'#888',display:'flex',alignItems:'center',gap:3,fontSize:11,flexShrink:0}}>
          <Settings size={13} />
        </button>
      </div>

      {/* Confirm switch dialog */}
      {pending && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
          onClick={() => setPending(null)}>
          <div style={{background:'#fff',borderRadius:18,padding:20,width:'100%',maxWidth:340,boxShadow:'0 8px 40px rgba(0,0,0,0.18)'}}
            onClick={e => e.stopPropagation()}>
            <h3 style={{fontSize:15,fontWeight:700,color:'#1A1A1A',marginBottom:6}}>View {pending}?</h3>
            <p style={{fontSize:13,color:'#666',marginBottom:16,lineHeight:1.5}}>
              All modules will show <strong>{pending}</strong> data.
              {pending !== activeSession && ' This is a previous year — new entries are made in the current year. '}
              The current session ({activeSession}) stays unchanged.
            </p>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={() => setPending(null)}
                style={{padding:'8px 16px',fontSize:13,fontWeight:600,border:'1px solid #E0E0E0',borderRadius:9,background:'#fff',cursor:'pointer',color:'#444'}}>
                Cancel
              </button>
              <button onClick={() => { setViewSession(pending); setPending(null); }}
                style={{padding:'8px 16px',fontSize:13,fontWeight:700,border:'none',borderRadius:9,background:'#E88A1A',color:'#fff',cursor:'pointer'}}>
                View
              </button>
            </div>
          </div>
        </div>
      )}

      {showManage && <ManageSessionsModal onClose={() => setShowManage(false)} />}
    </>
  );
};

const PullToRefresh = ({ onRefresh, children }) => {
  const [pulling, setPulling] = useState(false);
  const [startY, setStartY] = useState(0);
  const [pullDist, setPullDist] = useState(0);

  const handleTouchStart = useCallback((e) => {
    if (window.scrollY === 0) setStartY(e.touches[0].clientY);
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (startY === 0) return;
    const dist = e.touches[0].clientY - startY;
    if (dist > 0 && dist < 120) {
      setPullDist(dist);
      setPulling(true);
    }
  }, [startY]);

  const handleTouchEnd = useCallback(() => {
    if (pullDist > 60 && onRefresh) onRefresh();
    setPulling(false);
    setPullDist(0);
    setStartY(0);
  }, [pullDist, onRefresh]);

  return (
    <div onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      {pulling && pullDist > 10 && (
        <div className="flex justify-center py-2" style={{ height: Math.min(pullDist * 0.5, 40) }}>
          <div className={`w-5 h-5 border-2 border-[#E88A1A] border-t-transparent rounded-full ${pullDist > 60 ? 'animate-spin' : ''}`} />
        </div>
      )}
      {children}
    </div>
  );
};

const MobileLayout = ({ children, onRefresh }) => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const tabs = getBottomTabs(user?.role);

  // Fee lock: students/parents with overdue fees are limited to Home + Fees
  // (mirrors the desktop Layout behaviour).
  const [appLocked, setAppLocked] = useState(false);
  useEffect(() => {
    if (user?.role === 'student' || user?.role === 'parent') {
      api.get('/reports/dashboard')
        .then(r => setAppLocked(!!r.data.app_locked))
        .catch(() => {});
    } else {
      setAppLocked(false);
    }
  }, [user]);
  const isLockedOut = appLocked && !(location.pathname === '/m' || location.pathname.startsWith('/m/fees'));

  const activeTab = tabs.find(t => {
    if (t.path === '/m') return location.pathname === '/m';
    return location.pathname.startsWith(t.path);
  })?.key || 'dashboard';

  return (
    <div className="m-app" data-testid="mobile-app">
      <PullToRefresh onRefresh={onRefresh}>
        <div className="m-content">
          {/* Session selector — admin only, platform-wide */}
          {user?.role === 'admin' && <MobileSessionBar />}

          {appLocked && (
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:'#fee2e2',border:'1px solid #fecaca',borderRadius:12,marginBottom:12}}>
              <AlertTriangle size={16} color="#dc2626" style={{flexShrink:0}} />
              <span style={{fontSize:12,color:'#991b1b'}}>Account restricted due to overdue fees. Access limited to Home and Fees.</span>
            </div>
          )}
          {isLockedOut ? (
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',padding:'48px 20px'}} data-testid="m-locked-content">
              <div style={{width:56,height:56,borderRadius:28,background:'#fee2e2',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:12}}>
                <Lock size={26} color="#dc2626" />
              </div>
              <h2 style={{fontSize:18,fontWeight:800,color:'#1A1A1A',marginBottom:6}}>Access Restricted</h2>
              <p style={{fontSize:13,color:'#666',marginBottom:16,maxWidth:280}}>Clear overdue fees to restore full access to the portal.</p>
              <button className="m-btn m-btn-primary" style={{width:'auto'}} onClick={() => navigate('/m/fees')}>
                <CreditCard size={16} /> View Fees
              </button>
            </div>
          ) : children}
        </div>
      </PullToRefresh>

      {/* Bottom Navigation */}
      <nav className="m-bottom-nav" data-testid="mobile-bottom-nav">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => navigate(tab.path)}
              className={`m-nav-item ${isActive ? 'm-nav-active' : ''}`}
              data-testid={`m-nav-${tab.key}`}
            >
              <Icon className="m-nav-icon" strokeWidth={isActive ? 2 : 1.5} />
              <span className="m-nav-label">{tab.label}</span>
              {isActive && <div className="m-nav-dot" />}
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export { MobileLayout, PullToRefresh };
export default MobileLayout;
