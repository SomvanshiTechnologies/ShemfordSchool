import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { Calendar, GraduationCap, MessageSquare, Users, Bell } from 'lucide-react';

const TeacherDashboard = () => {
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/classes').catch(() => ({ data: [] })),
      api.get('/announcements').catch(() => ({ data: [] })),
    ]).then(([c, a]) => {
      setClasses(c.data);
      setAnnouncements(a.data.slice(0, 3));
    }).finally(() => setLoading(false));
  }, []);

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

  if (loading) return (
    <div>
      <div className="m-header"><div><div className="m-skeleton" style={{width:140,height:24,marginBottom:6}} /><div className="m-skeleton" style={{width:100,height:14}} /></div></div>
      {[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:80,borderRadius:14,marginBottom:10}} />)}
    </div>
  );

  return (
    <div data-testid="m-teacher-dashboard">
      <div className="m-header">
        <div><h1>Good Morning</h1><p className="m-header-sub">{today}</p></div>
        <div className="m-avatar" style={{background:'#1A1A1A',color:'#FFF'}}>T</div>
      </div>

      <div className="m-card-orange">
        <p style={{fontSize:12,fontWeight:600,color:'rgba(255,255,255,0.7)'}}>TODAY'S TASKS</p>
        <p style={{fontSize:20,fontWeight:800,color:'#FFF',marginTop:4}}>Mark Attendance</p>
        <p style={{fontSize:12,color:'rgba(255,255,255,0.7)',marginTop:2}}>{classes.length} classes assigned</p>
        <button className="m-btn m-btn-dark m-btn-sm" style={{marginTop:12,width:'auto'}} onClick={() => navigate('/m/attendance')}>
          <Calendar size={14} /> Start Now
        </button>
      </div>

      <p className="m-section">Quick Actions</p>
      <div className="m-actions">
        <button className="m-action-btn" onClick={() => navigate('/m/attendance')}><div className="m-action-icon"><Calendar size={18} /></div><span className="m-action-label">Attendance</span></button>
        <button className="m-action-btn" onClick={() => navigate('/m/marks')}><div className="m-action-icon"><GraduationCap size={18} /></div><span className="m-action-label">Marks</span></button>
        <button className="m-action-btn" onClick={() => navigate('/m/messages')}><div className="m-action-icon"><MessageSquare size={18} /></div><span className="m-action-label">Messages</span></button>
      </div>

      <p className="m-section">My Classes</p>
      <div className="m-list">
        {classes.slice(0, 5).map(cls => (
          <div key={cls.name} className="m-list-item">
            <div>
              <p style={{fontWeight:700,fontSize:14,color:'#1A1A1A'}}>{cls.display_name || cls.name}</p>
              <p style={{fontSize:12,color:'#888'}}>{(cls.sections || []).length} section(s)</p>
            </div>
            <span className="m-badge m-badge-muted">{(cls.sections || []).map(s => typeof s === 'string' ? s : s.section_name).join(', ')}</span>
          </div>
        ))}
      </div>

      {announcements.length > 0 && (
        <>
          <p className="m-section">Recent Notices</p>
          <div className="m-list">
            {announcements.map((a, i) => (
              <div key={i} className="m-list-item">
                <div>
                  <p style={{fontWeight:600,fontSize:13,color:'#1A1A1A'}}>{a.title}</p>
                  <p style={{fontSize:11,color:'#888',marginTop:2}}>{a.content?.slice(0, 60)}...</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default TeacherDashboard;
