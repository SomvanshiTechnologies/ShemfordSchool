import React, { useEffect } from 'react';
import { X, Bell } from 'lucide-react';
import { VoiceNotePlayer } from '../components/VoiceNote';

const fmtDateTime = (s) => {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return String(s).slice(0, 10);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Bottom sheet showing one announcement in full (dashboard previews are truncated).
const AnnouncementSheet = ({ announcement: a, onClose }) => {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  if (!a) return null;
  return (
    <div onClick={onClose} data-testid="m-announcement-sheet"
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:240,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
      <div onClick={(e) => e.stopPropagation()}
        style={{background:'#FFF',width:'100%',maxWidth:520,borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:'94dvh',display:'flex',flexDirection:'column',paddingBottom:'env(safe-area-inset-bottom, 0)'}}>
        <div style={{display:'flex',justifyContent:'center',padding:'8px 0 0'}}>
          <div style={{width:40,height:4,borderRadius:2,background:'#E5E5E5'}} />
        </div>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'10px 16px 8px',borderBottom:'1px solid #F0F0F0',gap:8}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:6,minWidth:0,flex:1}}>
            <Bell size={16} color="#E88A1A" style={{flexShrink:0,marginTop:2}} />
            <div style={{minWidth:0}}>
              <h2 style={{fontSize:16,fontWeight:800,color:'#1A1A1A',wordBreak:'break-word'}}>{a.title}</h2>
              {a.created_at && <p style={{fontSize:11,color:'#888'}}>Posted on {fmtDateTime(a.created_at)}</p>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',padding:6,cursor:'pointer',color:'#888',flexShrink:0}}>
            <X size={20} />
          </button>
        </div>
        <div style={{padding:16,flex:1,overflowY:'auto'}}>
          {a.content && (
            <p style={{fontSize:14,color:'#333',lineHeight:1.6,whiteSpace:'pre-wrap',wordBreak:'break-word',marginBottom:12}}>
              {a.content}
            </p>
          )}
          {a.voice_note_id && (
            <VoiceNotePlayer url={`/api/media/voice-notes/${a.voice_note_id}`} />
          )}
        </div>
      </div>
    </div>
  );
};

export default AnnouncementSheet;
