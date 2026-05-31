import React, { useState, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import {
  LayoutDashboard, Users, CreditCard, BarChart3, Menu, Calendar,
  GraduationCap, Bell, MessageSquare, BookOpen, User, FileText, ClipboardList, Lock, AlertTriangle
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
