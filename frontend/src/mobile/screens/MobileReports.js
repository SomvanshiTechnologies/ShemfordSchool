import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { BarChart3, CreditCard, Calendar, GraduationCap } from 'lucide-react';

const MobileReports = () => {
  const [activeTab, setActiveTab] = useState('financial');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchReport = (type) => {
    setActiveTab(type);
    setLoading(true);
    const endpoints = {
      financial: '/reports/financial',
      attendance: '/reports/attendance',
      academic: '/reports/academic',
    };
    api.get(endpoints[type]).then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  };

  useEffect(() => { fetchReport('financial'); }, []);

  return (
    <div data-testid="m-reports">
      <div className="m-header"><div><h1>Reports</h1></div></div>

      <div className="m-chips" style={{marginBottom:16}}>
        <button className={`m-chip ${activeTab === 'financial' ? 'active' : ''}`} onClick={() => fetchReport('financial')}>Financial</button>
        <button className={`m-chip ${activeTab === 'attendance' ? 'active' : ''}`} onClick={() => fetchReport('attendance')}>Attendance</button>
        <button className={`m-chip ${activeTab === 'academic' ? 'active' : ''}`} onClick={() => fetchReport('academic')}>Academic</button>
      </div>

      {loading ? (
        <div>{[1,2,3,4].map(i => <div key={i} className="m-skeleton" style={{height:70,borderRadius:14,marginBottom:10}} />)}</div>
      ) : !data ? (
        <div className="m-empty"><BarChart3 className="m-empty-icon" /><p>No data</p></div>
      ) : activeTab === 'financial' ? (
        <div>
          <div className="m-card-dark" style={{marginBottom:12}}>
            <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#888'}}>Total Collection</p>
            <p style={{fontSize:28,fontWeight:800,color:'#FFF'}}>₹{(data.total_collection || 0).toLocaleString()}</p>
          </div>
          <div className="m-stat-grid">
            <div className="m-stat m-stat-accent"><p className="m-stat-label">Pending</p><p className="m-stat-value">₹{Math.round((data.total_pending || 0)/1000)}k</p></div>
            <div className="m-stat"><p className="m-stat-label">Transactions</p><p className="m-stat-value">{data.transaction_count || 0}</p></div>
          </div>
          {data.by_method && Object.keys(data.by_method).length > 0 && (
            <div className="m-list">
              <div className="m-list-header"><span className="m-list-title">By Method</span></div>
              {Object.entries(data.by_method).map(([m, amt]) => (
                <div key={m} className="m-list-item">
                  <span style={{fontWeight:600,fontSize:13,color:'#1A1A1A',textTransform:'capitalize'}}>{m}</span>
                  <span style={{fontWeight:700,color:'#1A1A1A'}}>₹{amt.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'attendance' ? (
        <div>
          <div className="m-stat-grid">
            <div className="m-stat"><p className="m-stat-label">Total</p><p className="m-stat-value">{data.total_records || 0}</p></div>
            <div className="m-stat"><p className="m-stat-label">Present</p><p className="m-stat-value">{data.present || 0}</p></div>
            <div className="m-stat m-stat-accent"><p className="m-stat-label">Absent</p><p className="m-stat-value">{data.absent || 0}</p></div>
            <div className="m-stat"><p className="m-stat-label">Attendance %</p><p className="m-stat-value">{data.percentage || 0}%</p></div>
          </div>
        </div>
      ) : (
        <div>
          <div className="m-stat-grid">
            <div className="m-stat"><p className="m-stat-label">Students</p><p className="m-stat-value">{data.total_students || 0}</p></div>
            <div className="m-stat"><p className="m-stat-label">Class Average</p><p className="m-stat-value">{data.class_average || 0}%</p></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileReports;
