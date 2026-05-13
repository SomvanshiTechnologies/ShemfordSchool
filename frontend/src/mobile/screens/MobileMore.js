import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Users, CreditCard, Calendar, GraduationCap, BarChart3, Bell, MessageSquare, BookOpen, ClipboardList, Settings, LogOut, User, Building, Monitor, History } from 'lucide-react';

const MobileMore = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  const menuItems = [
    ...(isAdmin ? [
      { icon: Users, label: 'Students', path: '/m/students', color: '#E88A1A' },
      { icon: Building, label: 'Classes', path: '/class-structure', color: '#1A1A1A' },
      { icon: User, label: 'Employees', path: '/employees', color: '#1A1A1A' },
      { icon: BarChart3, label: 'Reports', path: '/m/reports', color: '#E88A1A' },
      { icon: History, label: 'Audit Trails', path: '/m/audit-trail', color: '#E88A1A' },
    ] : []),
    { icon: Bell, label: 'Notices', path: '/m/notices', color: '#E88A1A' },
    { icon: MessageSquare, label: 'Messages', path: '/m/messages', color: '#1A1A1A' },
    { icon: BookOpen, label: 'Syllabus', path: '/syllabus', color: '#1A1A1A' },
    { icon: ClipboardList, label: 'Issues', path: '/issues', color: '#888' },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div data-testid="m-more">
      <div className="m-header"><div><h1>More</h1></div></div>

      {/* Profile card */}
      <div className="m-card" style={{display:'flex',alignItems:'center',gap:14,marginBottom:20}}>
        <div className="m-avatar" style={{background:'#E88A1A',color:'#FFF',width:48,height:48,fontSize:18}}>
          {user?.name?.charAt(0) || 'U'}
        </div>
        <div>
          <p style={{fontWeight:700,fontSize:16,color:'#1A1A1A'}}>{user?.name || user?.email}</p>
          <span className="m-badge m-badge-dark" style={{marginTop:4}}>{user?.role}</span>
        </div>
      </div>

      <div className="m-menu-grid">
        {menuItems.map(item => {
          const Icon = item.icon;
          return (
            <button key={item.label} className="m-menu-item" onClick={() => navigate(item.path)}>
              <div className="m-menu-icon" style={{color: item.color}}><Icon size={18} /></div>
              <span className="m-menu-label">{item.label}</span>
            </button>
          );
        })}
      </div>

      <button className="m-btn m-btn-outline" style={{marginTop:24}} onClick={() => navigate('/dashboard')} data-testid="m-switch-desktop">
        <Monitor size={16} /> Switch to Desktop
      </button>
      <button className="m-btn m-btn-outline" style={{marginTop:10}} onClick={handleLogout} data-testid="m-logout-btn">
        <LogOut size={16} /> Sign Out
      </button>
    </div>
  );
};

export default MobileMore;
