import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { Bell, ChevronRight } from 'lucide-react';

const MobileNotices = () => {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/announcements').then(r => setAnnouncements(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div>
      <div className="m-header"><div><div className="m-skeleton" style={{width:120,height:24}} /></div></div>
      {[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:72,borderRadius:14,marginBottom:8}} />)}
    </div>
  );

  return (
    <div data-testid="m-notices">
      <div className="m-header"><div><h1>Notices</h1><p className="m-header-sub">{announcements.length} announcements</p></div></div>
      {announcements.length === 0 ? (
        <div className="m-empty"><Bell className="m-empty-icon" /><p>No announcements yet</p></div>
      ) : (
        <div className="m-list">
          {announcements.map((a, i) => (
            <div key={i} className="m-list-item" style={{flexDirection:'column',alignItems:'flex-start',gap:6}}>
              <div style={{display:'flex',justifyContent:'space-between',width:'100%',alignItems:'center'}}>
                <p style={{fontWeight:700,fontSize:14,color:'#1A1A1A'}}>{a.title}</p>
                <span className="m-badge m-badge-muted">{a.created_at?.slice(0, 10) || 'Recent'}</span>
              </div>
              <p style={{fontSize:12,color:'#888',lineHeight:1.5}}>{a.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MobileNotices;
