import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { getCached, setCached, invalidatePrefix } from '../../lib/pageCache';
import { toast } from 'sonner';
import {
  MessageSquare, Send, Plus, Inbox, SendHorizontal, X, Loader2, Mail,
  Check, ChevronRight, Search,
} from 'lucide-react';

// ─── Shared ───────────────────────────────────────────────────────────────

const formLabel = {
  display:'block', fontSize:11, fontWeight:700, textTransform:'uppercase',
  letterSpacing:'0.06em', color:'#666', marginBottom:6,
};

const TabBar = ({ tabs, active, onChange }) => (
  <div style={{display:'flex',gap:6,padding:4,background:'#F0F0F0',borderRadius:12,marginBottom:12,overflowX:'auto'}}>
    {tabs.map(t => (
      <button key={t.key} onClick={() => onChange(t.key)}
        style={{
          flex:1,minWidth:'fit-content',padding:'8px 12px',borderRadius:8,border:'none',
          background: active === t.key ? '#FFF' : 'transparent',
          color: active === t.key ? '#1A1A1A' : '#888',
          fontSize:12,fontWeight:700,cursor:'pointer',
          boxShadow: active === t.key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
          whiteSpace:'nowrap',display:'flex',alignItems:'center',justifyContent:'center',gap:6,
        }}
        data-testid={`m-msg-tab-${t.key}`}
      >
        {t.icon}
        {t.label}
        {t.count > 0 && (
          <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',minWidth:18,height:16,padding:'0 5px',borderRadius:8,background:'#1A1A1A',color:'#FFF',fontSize:9,fontWeight:800}}>
            {t.count}
          </span>
        )}
      </button>
    ))}
  </div>
);

const Sheet = ({ title, sub, onClose, footer, zIndex = 240, children }) => {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
      <div onClick={(e) => e.stopPropagation()}
        style={{background:'#FFF',width:'100%',maxWidth:520,borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:'94dvh',display:'flex',flexDirection:'column',paddingBottom:'env(safe-area-inset-bottom, 0)'}}>
        <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
          <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
        </div>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0',gap:8}}>
          <div style={{minWidth:0,flex:1}}>
            <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{title}</h2>
            {sub && <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888',flexShrink:0}}>
            <X size={20} />
          </button>
        </div>
        <div style={{padding:16,flex:1,overflowY:'auto'}}>{children}</div>
        {footer && <div style={{display:'flex',gap:8,padding:12,borderTop:'1px solid #F0F0F0',background:'#FFF'}}>{footer}</div>}
      </div>
    </div>
  );
};

const formatShortDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch { return iso.slice(0, 10); }
};

const formatFullDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
};

const initials = (name) => {
  if (!name) return '?';
  return name.split(/\s+/).map(p => p.charAt(0)).join('').slice(0, 2).toUpperCase() || '?';
};

// ─── Main ─────────────────────────────────────────────────────────────────

const MobileMessages = () => {
  const { user } = useAuth();
  const canBroadcast = user?.role === 'admin' || user?.role === 'teacher';

  const [tab, setTab] = useState('inbox');
  const [inbox, setInbox] = useState(getCached('m-messages:inbox') || []);
  const [sent, setSent] = useState(getCached('m-messages:sent') || []);
  const [loading, setLoading] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [selected, setSelected] = useState(null);

  const fetchList = useCallback(async (which) => {
    const cacheKey = `m-messages:${which}`;
    const cached = getCached(cacheKey);
    if (cached) {
      if (which === 'inbox') setInbox(cached); else setSent(cached);
      setLoading(false);
    } else { setLoading(true); }
    try {
      const r = await api.get('/messages', { params: { sent: which !== 'inbox' } });
      const arr = Array.isArray(r.data) ? r.data : [];
      if (which === 'inbox') setInbox(arr); else setSent(arr);
      setCached(cacheKey, arr);
    } catch {
      if (!cached) toast.error('Failed to fetch messages');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchList(tab); }, [tab, fetchList]);

  const messages = tab === 'inbox' ? inbox : sent;
  const unreadCount = useMemo(() => inbox.filter(m => !m.is_read).length, [inbox]);

  const markAsRead = async (messageId) => {
    try {
      await api.put(`/messages/${messageId}/read`);
      setInbox(prev => prev.map(m => m.message_id === messageId ? { ...m, is_read: true } : m));
      invalidatePrefix('m-messages:');
    } catch {}
  };

  const open = (message) => {
    setSelected(message);
    if (!message.is_read && tab === 'inbox') markAsRead(message.message_id);
  };

  return (
    <div data-testid="m-messages" style={{minWidth:0}}>
      <div className="m-header" style={{gap:8,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:0}}>
          <h1>Messages</h1>
          <p className="m-header-sub">Internal communication</p>
        </div>
        <button onClick={() => setShowCompose(true)}
          style={{display:'flex',alignItems:'center',gap:4,padding:'8px 12px',borderRadius:10,background:'#1A1A1A',border:'none',fontSize:12,fontWeight:700,color:'#FFF',cursor:'pointer'}}
          data-testid="m-compose-btn">
          <Plus size={14} /> Compose
        </button>
      </div>

      <TabBar
        tabs={[
          { key: 'inbox', label: 'Inbox', icon: <Inbox size={14} />, count: unreadCount },
          { key: 'sent', label: 'Sent', icon: <SendHorizontal size={14} /> },
        ]}
        active={tab}
        onChange={setTab}
      />

      {loading && messages.length === 0 ? (
        <div>{[1,2,3,4].map(i => <div key={i} className="m-skeleton" style={{height:64,borderRadius:14,marginBottom:8}} />)}</div>
      ) : messages.length === 0 ? (
        <div className="m-empty">
          <Mail className="m-empty-icon" />
          <p>{tab === 'inbox' ? 'Your inbox is empty' : 'No messages sent yet'}</p>
        </div>
      ) : (
        <div className="m-list">
          {messages.map(message => {
            const isUnread = !message.is_read && tab === 'inbox';
            const who = tab === 'inbox' ? (message.sender_name || message.sender_id || 'Unknown') : ('To: ' + (message.recipient_label || message.recipient_type || 'User'));
            return (
              <button key={message.message_id}
                onClick={() => open(message)}
                className="m-list-item"
                style={{
                  background: isUnread ? '#fffbeb' : 'none',
                  border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', gap: 10,
                  alignItems: 'flex-start',
                }}
                data-testid={`m-msg-${message.message_id}`}
              >
                <div className="m-avatar" style={{background:'#F5F5F5',color:'#1A1A1A',width:36,height:36,fontSize:12,borderRadius:10,flexShrink:0}}>
                  {initials(tab === 'inbox' ? message.sender_name : 'Me')}
                </div>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:2}}>
                    <p style={{fontSize:13,fontWeight: isUnread ? 800 : 600,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0,flex:1}}>{who}</p>
                    <div style={{display:'flex',alignItems:'center',gap:5,flexShrink:0}}>
                      {isUnread && <span style={{width:6,height:6,borderRadius:3,background:'#1A1A1A',display:'inline-block'}} />}
                      <span style={{fontSize:10,color:'#888'}}>{formatShortDate(message.created_at)}</span>
                    </div>
                  </div>
                  <p style={{fontSize:12,fontWeight: isUnread ? 700 : 500,color: isUnread ? '#1A1A1A' : '#444',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{message.subject}</p>
                  <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginTop:2}}>{message.content}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <MessageDetailSheet
          message={selected}
          tab={tab}
          onClose={() => setSelected(null)}
        />
      )}

      {showCompose && (
        <ComposeSheet
          canBroadcast={canBroadcast}
          onClose={() => setShowCompose(false)}
          onSent={() => { setShowCompose(false); invalidatePrefix('m-messages:'); fetchList(tab); }}
        />
      )}
    </div>
  );
};

export default MobileMessages;

// ─── Message detail ────────────────────────────────────────────────────────

const MessageDetailSheet = ({ message, tab, onClose }) => {
  const isInbox = tab === 'inbox';
  const counterparty = isInbox
    ? (message.sender_name || message.sender_id || 'Unknown')
    : (message.recipient_label || message.recipient_type || 'Recipient');

  return (
    <div
      onClick={onClose}
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:240,
        // Center the dialog instead of docking it at the bottom
        display:'flex', alignItems:'center', justifyContent:'center',
        padding:16,
      }}
      data-testid="m-msg-detail"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background:'#FFF', width:'100%', maxWidth:520,
          borderRadius:18,
          maxHeight: 'calc(100dvh - 32px)',
          display:'flex', flexDirection:'column',
          boxShadow:'0 20px 50px rgba(0,0,0,0.25)',
          overflow:'hidden',
        }}
      >
        {/* Hero header */}
        <div style={{padding:'14px 18px 16px',borderBottom:'1px solid #F0F0F0'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0,flex:1}}>
              <div style={{
                width:40,height:40,borderRadius:12,
                background:'#F5F5F5',display:'flex',alignItems:'center',justifyContent:'center',
                color:'#1A1A1A',fontSize:14,fontWeight:800,flexShrink:0,
              }}>
                {initials(counterparty)}
              </div>
              <div style={{minWidth:0,flex:1}}>
                <p style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888'}}>
                  {isInbox ? 'From' : 'To'}
                </p>
                <p style={{fontSize:14,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                  {counterparty}
                </p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888',flexShrink:0}}>
              <X size={20} />
            </button>
          </div>

          <h2 style={{fontSize:18,fontWeight:800,color:'#1A1A1A',lineHeight:1.3,wordBreak:'break-word'}}>
            {message.subject || '(No subject)'}
          </h2>

          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:8,flexWrap:'wrap'}}>
            <span style={{fontSize:11,color:'#888'}}>{formatFullDate(message.created_at)}</span>
            {message.is_read && (
              <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:700,background:'#dcfce7',color:'#15803d'}}>
                <Check size={10} /> Read
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{padding:18,flex:1,overflowY:'auto'}}>
          {message.content ? (
            <p style={{fontSize:14,color:'#1A1A1A',lineHeight:1.6,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>
              {message.content}
            </p>
          ) : (
            <p style={{fontSize:13,color:'#888',fontStyle:'italic'}}>(No message body)</p>
          )}

          {message.voice_note_id && (
            <div style={{marginTop:18,padding:12,background:'#F8F8F8',borderRadius:12,border:'1px solid rgba(0,0,0,0.04)'}}>
              <p style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#888',marginBottom:8}}>
                Voice Note
              </p>
              <audio controls src={`/api/media/voice-notes/${message.voice_note_id}`} style={{width:'100%'}} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Compose ───────────────────────────────────────────────────────────────

const RECIPIENT_TYPES_BASIC = [
  { value: 'user', label: 'Specific User / Student' },
];
const RECIPIENT_TYPES_BROADCAST = [
  { value: 'user', label: 'Specific User / Student' },
  { value: 'all', label: 'Everyone' },
  { value: 'teacher', label: 'All Teachers' },
  { value: 'student', label: 'All Students' },
  { value: 'parent', label: 'All Parents' },
  { value: 'class', label: 'Entire Class' },
  { value: 'section', label: 'Specific Section' },
];

const ComposeSheet = ({ canBroadcast, onClose, onSent }) => {
  const { user } = useAuth();
  const [recipientType, setRecipientType] = useState('user');
  const [recipientId, setRecipientId] = useState('');
  const [recipientLabel, setRecipientLabel] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  const [classes, setClasses] = useState(getCached('classes') || []);
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/classes');
        const arr = Array.isArray(r.data) ? r.data : [];
        setClasses(arr);
        setCached('classes', arr);
      } catch {}
    })();
  }, []);

  // Resolve recipients via the role-scoped /messages/contacts endpoint.
  // It works for every authenticated user (students/parents included), unlike
  // /users/search which is staff-only.  The endpoint also handles the q filter
  // server-side, so we just hand the search string through.
  useEffect(() => {
    if (recipientType !== 'user') return;
    if (recipientId && recipientLabel === userSearch) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        // Empty q returns the contact directory (teachers, admins, classmates
        // depending on role) so the picker isn't blank before the user types.
        const r = await api.get('/messages/contacts', {
          params: userSearch.trim() ? { q: userSearch.trim() } : {},
        });
        const arr = Array.isArray(r.data) ? r.data : [];
        setUserResults(arr.filter(u => u.user_id !== user?.user_id));
      } catch { setUserResults([]); }
      finally { setSearching(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [userSearch, recipientType, recipientId, recipientLabel, user?.user_id]);

  const sections = useMemo(() => {
    if (!selectedClass) return [];
    return classes.find(c => c.name === selectedClass)?.sections || [];
  }, [classes, selectedClass]);

  const send = async () => {
    if (!subject.trim()) { toast.error('Subject is required'); return; }
    if (!content.trim()) { toast.error('Message content is required'); return; }
    if (recipientType === 'user' && !recipientId) { toast.error('Pick a recipient'); return; }
    if (recipientType === 'class' && !selectedClass) { toast.error('Select a class'); return; }
    if (recipientType === 'section' && (!selectedClass || !selectedSection)) { toast.error('Select class and section'); return; }

    setSending(true);
    try {
      const payload = { recipient_type: recipientType, subject, content };
      if (recipientType === 'user') {
        payload.recipient_id = recipientId;
      } else if (recipientType === 'class') {
        payload.recipient_value = selectedClass;
      } else if (recipientType === 'section') {
        payload.recipient_value = `${selectedClass}:${selectedSection}`;
      }
      await api.post('/messages', payload);
      toast.success('Message sent');
      onSent();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to send'); }
    finally { setSending(false); }
  };

  const recipientTypes = canBroadcast ? RECIPIENT_TYPES_BROADCAST : RECIPIENT_TYPES_BASIC;

  return (
    <Sheet
      title="New Message"
      sub="Send a message to users or groups"
      onClose={onClose}
      footer={(
        <>
          <button onClick={onClose} className="m-btn m-btn-outline" style={{flex:1}}>Cancel</button>
          <button onClick={send} disabled={sending} className="m-btn m-btn-primary" style={{flex:1}} data-testid="m-msg-send">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
          </button>
        </>
      )}
    >
      <div style={{marginBottom:10}}>
        <label style={formLabel}>Send To</label>
        <select className="m-input" value={recipientType} onChange={(e) => {
          setRecipientType(e.target.value);
          setRecipientId(''); setRecipientLabel('');
          setSelectedClass(''); setSelectedSection('');
          setUserSearch(''); setUserResults([]);
        }}>
          {recipientTypes.map(rt => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
        </select>
      </div>

      {recipientType === 'user' && (
        <div style={{marginBottom:10}}>
          <label style={formLabel}>Search User or Student</label>
          <div style={{position:'relative'}}>
            <Search size={14} style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'#888'}} />
            <input className="m-input" style={{paddingLeft:34}}
              value={userSearch}
              onChange={(e) => { setUserSearch(e.target.value); setRecipientId(''); setRecipientLabel(''); }}
              placeholder="Type name, admission number or email..."
              data-testid="m-msg-user-search"
            />
            {searching && <Loader2 size={14} className="animate-spin" style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',color:'#888'}} />}
          </div>
          {!recipientId && userResults.length > 0 && (
            <div style={{border:'1px solid #E5E5E5',borderRadius:10,maxHeight:220,overflowY:'auto',marginTop:6}}>
              {userResults.map(u => (
                <button key={u.user_id}
                  onClick={() => {
                    setRecipientId(u.user_id);
                    setRecipientLabel(u.name);
                    setUserSearch(u.name);
                    setUserResults([]);
                  }}
                  style={{width:'100%',textAlign:'left',padding:10,background:'none',border:'none',borderBottom:'1px solid #F5F5F5',cursor:'pointer',display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}
                  data-testid={`m-msg-user-${u.user_id}`}>
                  <div style={{minWidth:0,flex:1}}>
                    <p style={{fontSize:13,fontWeight:700,color:'#1A1A1A',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{u.name}</p>
                    <p style={{fontSize:11,color:'#888',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                      {u.class_name ? `Class ${u.class_name} - ${u.section} · ` : ''}{u.admission_number || u.email || u.user_id}
                    </p>
                  </div>
                  <span style={{padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,background:'#F1F5F9',color:'#475569',textTransform:'capitalize',flexShrink:0}}>{u.role}</span>
                </button>
              ))}
            </div>
          )}
          {recipientId && (
            <p style={{fontSize:11,color:'#15803d',marginTop:4}}>✓ Selected: {recipientLabel}</p>
          )}
        </div>
      )}

      {(recipientType === 'class' || recipientType === 'section') && (
        <div style={{marginBottom:10}}>
          <label style={formLabel}>Class <span style={{color:'#dc2626'}}>*</span></label>
          <select className="m-input" value={selectedClass}
            onChange={(e) => { setSelectedClass(e.target.value); setSelectedSection(''); }}>
            <option value="">Select class</option>
            {classes.map(c => <option key={c.class_id || c.name} value={c.name}>{c.display_name || `Class ${c.name}`}</option>)}
          </select>
        </div>
      )}

      {recipientType === 'section' && selectedClass && (
        <div style={{marginBottom:10}}>
          <label style={formLabel}>Section <span style={{color:'#dc2626'}}>*</span></label>
          <select className="m-input" value={selectedSection} onChange={(e) => setSelectedSection(e.target.value)}>
            <option value="">Select section</option>
            {sections.map(s => <option key={s.section_name} value={s.section_name}>{s.section_name}</option>)}
          </select>
        </div>
      )}

      <div style={{marginBottom:10}}>
        <label style={formLabel}>Subject <span style={{color:'#dc2626'}}>*</span></label>
        <input className="m-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Message subject" data-testid="m-msg-subject" />
      </div>

      <div style={{marginBottom:10}}>
        <label style={formLabel}>Message <span style={{color:'#dc2626'}}>*</span></label>
        <textarea className="m-input" rows={5}
          style={{padding:10,resize:'vertical',fontFamily:'inherit'}}
          value={content} onChange={(e) => setContent(e.target.value)}
          placeholder="Write your message..."
          data-testid="m-msg-content"
        />
      </div>
    </Sheet>
  );
};
