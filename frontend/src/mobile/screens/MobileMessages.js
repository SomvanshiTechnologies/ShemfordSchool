import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { MessageSquare, Send } from 'lucide-react';

const MobileMessages = () => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/messages').then(r => setMessages(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div>
      <div className="m-header"><div><div className="m-skeleton" style={{width:120,height:24}} /></div></div>
      {[1,2,3].map(i => <div key={i} className="m-skeleton" style={{height:60,borderRadius:14,marginBottom:8}} />)}
    </div>
  );

  return (
    <div data-testid="m-messages">
      <div className="m-header"><div><h1>Messages</h1><p className="m-header-sub">{messages.length} conversations</p></div></div>
      {messages.length === 0 ? (
        <div className="m-empty"><MessageSquare className="m-empty-icon" /><p>No messages yet</p></div>
      ) : (
        <div className="m-list">
          {messages.map((m, i) => (
            <div key={i} className="m-list-item">
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <div className="m-avatar" style={{background:'#F5F5F5',color:'#1A1A1A',width:36,height:36,fontSize:14,borderRadius:10}}>
                  {m.sender_name?.charAt(0) || 'M'}
                </div>
                <div>
                  <p style={{fontWeight:600,fontSize:13,color:'#1A1A1A'}}>{m.sender_name || m.sender_id}</p>
                  <p style={{fontSize:11,color:'#888',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.content}</p>
                </div>
              </div>
              <span style={{fontSize:10,color:'#888'}}>{m.created_at?.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MobileMessages;
