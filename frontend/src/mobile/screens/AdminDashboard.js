import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useSession } from '../../contexts/SessionContext';
import { Users, CreditCard, Calendar, GraduationCap, BarChart3, Bell, FileText, ClipboardList, Settings } from 'lucide-react';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { viewSession } = useSession();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ay = viewSession ? { academic_year: viewSession } : {};
    Promise.all([
      api.get('/students').catch(() => ({ data: [] })),
      api.get('/employees').catch(() => ({ data: [] })),
      api.get('/fees/due-chart', { params: ay }).catch(() => ({ data: [] })),
      api.get('/reports/financial', { params: ay }).catch(() => ({ data: {} })),
    ]).then(([s, e, d, f]) => {
      const totalDue = d.data.reduce((sum, x) => sum + (x.total_due || 0), 0);
      const overdueCount = d.data.filter(x => x.months_overdue > 0).length;
      setStats({
        students: s.data.length,
        employees: e.data.length,
        totalDue,
        overdueStudents: overdueCount,
        totalCollection: f.data.total_collection || 0,
        pending: f.data.total_pending || 0,
      });
    }).finally(() => setLoading(false));
  }, [viewSession]);

  if (loading) return (
    <div>
      <div className="m-header"><div><div className="m-skeleton" style={{width:140,height:24,marginBottom:6}} /><div className="m-skeleton" style={{width:100,height:14}} /></div></div>
      <div className="m-stat-grid">{[1,2,3,4].map(i => <div key={i} className="m-skeleton" style={{height:80,borderRadius:14}} />)}</div>
      <div className="m-skeleton" style={{height:120,borderRadius:14}} />
    </div>
  );

  return (
    <div data-testid="m-admin-dashboard">
      <div className="m-header">
        <div><h1>Dashboard</h1><p className="m-header-sub">Admin Overview</p></div>
        <div className="m-avatar" style={{background:'#E88A1A',color:'#FFF'}}>A</div>
      </div>

      {/* Revenue card */}
      <div className="m-card-dark" style={{marginBottom:16}}>
        <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#888',marginBottom:4}}>Total Collection</p>
        <p style={{fontSize:28,fontWeight:800,color:'#FFF',letterSpacing:'-0.02em'}}>Rs.{(stats.totalCollection || 0).toLocaleString()}</p>
        <p style={{fontSize:12,color:'#888',marginTop:4}}>Rs.{(stats.pending || 0).toLocaleString()} pending</p>
      </div>

      <div className="m-stat-grid">
        <div className="m-stat"><p className="m-stat-label">Students</p><p className="m-stat-value">{stats.students}</p></div>
        <div className="m-stat"><p className="m-stat-label">Staff</p><p className="m-stat-value">{stats.employees}</p></div>
        <div className="m-stat m-stat-accent"><p className="m-stat-label">Overdue</p><p className="m-stat-value">{stats.overdueStudents}</p></div>
        <div className="m-stat"><p className="m-stat-label">Pending Dues</p><p className="m-stat-value">Rs.{Math.round(stats.totalDue/1000)}k</p></div>
      </div>

      <p className="m-section">Quick Actions</p>
      <div className="m-actions">
        <button className="m-action-btn" onClick={() => navigate('/m/attendance')}><div className="m-action-icon"><Calendar size={18} /></div><span className="m-action-label">Attendance</span></button>
        <button className="m-action-btn" onClick={() => navigate('/m/fees')}><div className="m-action-icon"><CreditCard size={18} /></div><span className="m-action-label">Fees</span></button>
        <button className="m-action-btn" onClick={() => navigate('/m/students')}><div className="m-action-icon"><Users size={18} /></div><span className="m-action-label">Students</span></button>
      </div>

      <p className="m-section">Management</p>
      <div className="m-menu-grid">
        <button className="m-menu-item" onClick={() => navigate('/m/marks')}><div className="m-menu-icon"><GraduationCap size={18} /></div><span className="m-menu-label">Marks</span></button>
        <button className="m-menu-item" onClick={() => navigate('/m/reports')}><div className="m-menu-icon"><BarChart3 size={18} /></div><span className="m-menu-label">Reports</span></button>
        <button className="m-menu-item" onClick={() => navigate('/m/notices')}><div className="m-menu-icon"><Bell size={18} /></div><span className="m-menu-label">Notices</span></button>
      </div>
    </div>
  );
};

export default AdminDashboard;
