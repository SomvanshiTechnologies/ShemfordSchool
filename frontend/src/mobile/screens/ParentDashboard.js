import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import { CreditCard, Calendar, GraduationCap, Bell, ChevronRight, BookOpen } from 'lucide-react';

const ParentDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [children, setChildren] = useState([]);
  const [feeSummary, setFeeSummary] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/students').catch(() => ({ data: [] })),
      api.get('/announcements').catch(() => ({ data: [] })),
    ]).then(([s, a]) => {
      setChildren(s.data);
      setAnnouncements(a.data.slice(0, 3));
      if (s.data.length > 0) {
        api.get(`/fees/student/${s.data[0].student_id}`).then(r => setFeeSummary(r.data.summary)).catch(() => {});
      }
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div>
      <div className="m-header"><div><div className="m-skeleton" style={{width:160,height:24,marginBottom:6}} /><div className="m-skeleton" style={{width:120,height:14}} /></div></div>
      <div className="m-skeleton" style={{height:100,borderRadius:14,marginBottom:12}} />
      <div className="m-stat-grid">{[1,2,3,4].map(i => <div key={i} className="m-skeleton" style={{height:70,borderRadius:14}} />)}</div>
    </div>
  );

  const child = children[0];
  const hasChildren = children.length > 0;

  return (
    <div data-testid="m-parent-dashboard">
      <div className="m-header">
        <div><h1>{child ? `${child.first_name}'s` : 'Parent Portal'}</h1><p className="m-header-sub">Parent Dashboard</p></div>
        <div className="m-avatar" style={{background:'#E88A1A',color:'#FFF'}}>{child?.first_name?.charAt(0) || 'P'}</div>
      </div>

      {/* No children linked */}
      {!hasChildren && (
        <div className="m-empty" style={{marginTop:32}}>
          <GraduationCap className="m-empty-icon" />
          <p style={{fontWeight:700,fontSize:14,color:'#1A1A1A',marginBottom:6}}>No Children Linked</p>
          <p style={{fontSize:12,color:'#888',textAlign:'center',lineHeight:1.5}}>Your account has no students linked to it. Please contact the school administrator to link your child's record.</p>
        </div>
      )}

      {/* Fee Summary Card */}
      {hasChildren && (feeSummary && feeSummary.total_pending > 0 ? (
        <div className="m-card-orange" onClick={() => navigate('/m/fees')} style={{cursor:'pointer'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(255,255,255,0.7)'}}>Fees Due</p>
              <p style={{fontSize:28,fontWeight:800,color:'#FFF',letterSpacing:'-0.02em'}}>Rs.{feeSummary.total_pending.toLocaleString()}</p>
              <p style={{fontSize:12,color:'rgba(255,255,255,0.7)',marginTop:2}}>{feeSummary.months_pending} month(s) pending</p>
            </div>
            <button className="m-btn m-btn-dark m-btn-sm" style={{width:'auto'}}><CreditCard size={14} /> Pay Now</button>
          </div>
        </div>
      ) : (
        <div className="m-card-dark">
          <p style={{fontSize:12,fontWeight:600,color:'#888'}}>FEE STATUS</p>
          <p style={{fontSize:20,fontWeight:800,color:'#FFF',marginTop:4}}>All Clear</p>
          <p style={{fontSize:12,color:'#888',marginTop:2}}>No pending fees</p>
        </div>
      ))}

      {hasChildren && (
        <div className="m-stat-grid">
          <div className="m-stat" onClick={() => navigate('/m/attendance')} style={{cursor:'pointer'}}>
            <p className="m-stat-label">Attendance</p>
            <p className="m-stat-value">{feeSummary?.months_paid || 0}<span style={{fontSize:14,color:'#888'}}>/{feeSummary?.months_total || 0}</span></p>
            <p style={{fontSize:10,color:'#888'}}>months paid</p>
          </div>
          <div className="m-stat" onClick={() => navigate('/m/fees')} style={{cursor:'pointer'}}>
            <p className="m-stat-label">Total Paid</p>
            <p className="m-stat-value">Rs.{((feeSummary?.total_paid || 0)/1000).toFixed(0)}k</p>
          </div>
        </div>
      )}

      {hasChildren && (
        <>
          <p className="m-section">Quick Access</p>
          <div className="m-actions">
            <button className="m-action-btn" onClick={() => navigate('/m/fees')}><div className="m-action-icon"><CreditCard size={18} /></div><span className="m-action-label">Fees</span></button>
            <button className="m-action-btn" onClick={() => navigate('/m/attendance')}><div className="m-action-icon"><Calendar size={18} /></div><span className="m-action-label">Attendance</span></button>
            <button className="m-action-btn" onClick={() => navigate('/m/marks')}><div className="m-action-icon"><GraduationCap size={18} /></div><span className="m-action-label">Results</span></button>
            <button className="m-action-btn" onClick={() => navigate('/m/notices')}><div className="m-action-icon"><Bell size={18} /></div><span className="m-action-label">Notices</span></button>
          </div>
        </>
      )}

      {/* Child info */}
      {child && (
        <>
          <p className="m-section">Student Info</p>
          <div className="m-card">
            <div style={{display:'flex',gap:12,alignItems:'center'}}>
              <div className="m-avatar" style={{background:'#F5F5F5',color:'#1A1A1A'}}>{child.first_name?.charAt(0)}</div>
              <div>
                <p style={{fontWeight:700,fontSize:14,color:'#1A1A1A'}}>{child.first_name} {child.last_name}</p>
                <p style={{fontSize:12,color:'#888'}}>Class {child.class_name}-{child.section} | {child.admission_number}</p>
              </div>
            </div>
          </div>
        </>
      )}

      {announcements.length > 0 && (
        <>
          <p className="m-section">Announcements</p>
          <div className="m-list">
            {announcements.map((a, i) => (
              <div key={i} className="m-list-item">
                <div><p style={{fontWeight:600,fontSize:13,color:'#1A1A1A'}}>{a.title}</p><p style={{fontSize:11,color:'#888',marginTop:2}}>{a.content?.slice(0, 80)}</p></div>
                <ChevronRight size={16} color="#CCC" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ParentDashboard;
