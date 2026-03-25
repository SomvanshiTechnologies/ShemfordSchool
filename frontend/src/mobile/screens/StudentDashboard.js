import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import { Calendar, GraduationCap, BookOpen, Bell, ChevronRight } from 'lucide-react';

const StudentDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [studentInfo, setStudentInfo] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/students').catch(() => ({ data: [] })),
      api.get('/announcements').catch(() => ({ data: [] })),
      api.get('/attendance', { params: { entity_type: 'student' } }).catch(() => ({ data: [] })),
    ]).then(([s, a, att]) => {
      setStudentInfo(s.data[0] || null);
      setAnnouncements(a.data.slice(0, 3));
      setAttendance(att.data);
    }).finally(() => setLoading(false));
  }, []);

  const present = attendance.filter(r => r.status === 'present').length;
  const total = attendance.length;
  const pct = total > 0 ? Math.round(present / total * 100) : 0;

  if (loading) return (
    <div>
      <div className="m-header"><div><div className="m-skeleton" style={{width:160,height:24,marginBottom:6}} /><div className="m-skeleton" style={{width:120,height:14}} /></div></div>
      <div className="m-skeleton" style={{height:100,borderRadius:14,marginBottom:12}} />
      <div className="m-stat-grid">{[1,2].map(i => <div key={i} className="m-skeleton" style={{height:70,borderRadius:14}} />)}</div>
    </div>
  );

  return (
    <div data-testid="m-student-dashboard">
      <div className="m-header">
        <div><h1>Hi, {studentInfo?.first_name || 'Student'}</h1><p className="m-header-sub">Class {studentInfo?.class_name}-{studentInfo?.section}</p></div>
        <div className="m-avatar" style={{background:'#1A1A1A',color:'#FFF'}}>{studentInfo?.first_name?.charAt(0) || 'S'}</div>
      </div>

      {/* Attendance ring card */}
      <div className="m-card-dark" style={{textAlign:'center',padding:24}}>
        <div style={{position:'relative',width:80,height:80,margin:'0 auto 12px'}}>
          <svg viewBox="0 0 36 36" style={{width:80,height:80,transform:'rotate(-90deg)'}}>
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#333" strokeWidth="3" />
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#E88A1A" strokeWidth="3" strokeDasharray={`${pct}, 100`} strokeLinecap="round" />
          </svg>
          <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',color:'#FFF',fontWeight:800,fontSize:18}}>{pct}%</div>
        </div>
        <p style={{fontSize:12,color:'#888'}}>Attendance — {present} of {total} days</p>
      </div>

      <div className="m-stat-grid">
        <div className="m-stat"><p className="m-stat-label">Present</p><p className="m-stat-value">{present}</p></div>
        <div className="m-stat m-stat-accent"><p className="m-stat-label">Absent</p><p className="m-stat-value">{total - present}</p></div>
      </div>

      <p className="m-section">Quick Access</p>
      <div className="m-actions">
        <button className="m-action-btn" onClick={() => navigate('/m/marks')}><div className="m-action-icon"><GraduationCap size={18} /></div><span className="m-action-label">Marks</span></button>
        <button className="m-action-btn" onClick={() => navigate('/m/attendance')}><div className="m-action-icon"><Calendar size={18} /></div><span className="m-action-label">Attendance</span></button>
        <button className="m-action-btn" onClick={() => navigate('/m/notices')}><div className="m-action-icon"><Bell size={18} /></div><span className="m-action-label">Notices</span></button>
      </div>

      {announcements.length > 0 && (
        <>
          <p className="m-section">Announcements</p>
          <div className="m-list">
            {announcements.map((a, i) => (
              <div key={i} className="m-list-item">
                <div><p style={{fontWeight:600,fontSize:13,color:'#1A1A1A'}}>{a.title}</p><p style={{fontSize:11,color:'#888',marginTop:2}}>{a.content?.slice(0, 80)}</p></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default StudentDashboard;
