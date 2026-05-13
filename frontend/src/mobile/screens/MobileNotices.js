import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Bell, Pencil, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const MobileNotices = () => {
  const { isAdmin, isTeacher } = useAuth();
  const canManage = isAdmin || isTeacher;
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', content: '', priority: 'normal' });
  const [editing, setEditing] = useState(false);

  const fetchData = () => {
    setLoading(true);
    api.get('/announcements')
      .then(r => setAnnouncements(r.data))
      .catch(() => toast.error('Failed to load announcements'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/announcements/${deleteTarget.announcement_id}`);
      toast.success('Announcement deleted');
      setDeleteTarget(null);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const openEdit = (a) => {
    setEditTarget(a);
    setEditForm({ title: a.title || '', content: a.content || '', priority: a.priority || 'normal' });
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    if (!editForm.title.trim() || !editForm.content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    setEditing(true);
    try {
      await api.put(`/announcements/${editTarget.announcement_id}`, editForm);
      toast.success('Announcement updated');
      setEditTarget(null);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Update failed');
    } finally {
      setEditing(false);
    }
  };

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
          {announcements.map((a) => (
            <div key={a.announcement_id} className="m-list-item" style={{flexDirection:'column',alignItems:'flex-start',gap:6}}>
              <div style={{display:'flex',justifyContent:'space-between',width:'100%',alignItems:'center',gap:8}}>
                <p style={{fontWeight:700,fontSize:14,color:'#1A1A1A',flex:1}}>{a.title}</p>
                <span className="m-badge m-badge-muted">{a.created_at?.slice(0, 10) || 'Recent'}</span>
              </div>
              <p style={{fontSize:12,color:'#888',lineHeight:1.5}}>{a.content}</p>
              {canManage && (
                <div style={{display:'flex',gap:6,marginTop:6}}>
                  <button
                    className="m-btn m-btn-outline m-btn-sm"
                    onClick={() => openEdit(a)}
                    data-testid={`m-edit-${a.announcement_id}`}
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <button
                    className="m-btn m-btn-outline m-btn-sm"
                    style={{borderColor:'#E11D48',color:'#E11D48'}}
                    onClick={() => setDeleteTarget(a)}
                    data-testid={`m-delete-${a.announcement_id}`}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div
          onClick={() => !deleting && setDeleteTarget(null)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'flex-end',zIndex:50}}
        >
          <div onClick={(e) => e.stopPropagation()} style={{background:'#FFF',width:'100%',padding:20,borderTopLeftRadius:20,borderTopRightRadius:20}}>
            <h3 style={{fontSize:18,fontWeight:700,marginBottom:8}}>Delete Announcement?</h3>
            <p style={{fontSize:13,color:'#666',marginBottom:16}}>Are you sure you want to delete announcement?</p>
            <div style={{display:'flex',gap:8}}>
              <button className="m-btn m-btn-outline" onClick={() => setDeleteTarget(null)} disabled={deleting} style={{flex:1}}>Cancel</button>
              <button
                className="m-btn m-btn-primary"
                style={{background:'#E11D48',borderColor:'#E11D48'}}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit dialog */}
      {editTarget && (
        <div
          onClick={() => !editing && setEditTarget(null)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'flex-end',zIndex:50}}
        >
          <div onClick={(e) => e.stopPropagation()} style={{background:'#FFF',width:'100%',padding:20,borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:'80vh',overflowY:'auto'}}>
            <h3 style={{fontSize:18,fontWeight:700,marginBottom:12}}>Edit Announcement</h3>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <div>
                <label style={{fontSize:12,color:'#666',display:'block',marginBottom:4}}>Title</label>
                <input
                  className="m-input"
                  value={editForm.title}
                  onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                  style={{width:'100%',padding:10,border:'1px solid #E5E5E5',borderRadius:8,fontSize:14}}
                />
              </div>
              <div>
                <label style={{fontSize:12,color:'#666',display:'block',marginBottom:4}}>Content</label>
                <textarea
                  rows={4}
                  value={editForm.content}
                  onChange={(e) => setEditForm({...editForm, content: e.target.value})}
                  style={{width:'100%',padding:10,border:'1px solid #E5E5E5',borderRadius:8,fontSize:14,fontFamily:'inherit',resize:'vertical'}}
                />
              </div>
              <div>
                <label style={{fontSize:12,color:'#666',display:'block',marginBottom:4}}>Priority</label>
                <select
                  value={editForm.priority}
                  onChange={(e) => setEditForm({...editForm, priority: e.target.value})}
                  style={{width:'100%',padding:10,border:'1px solid #E5E5E5',borderRadius:8,fontSize:14,background:'#FFF'}}
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:16}}>
              <button className="m-btn m-btn-outline" onClick={() => setEditTarget(null)} disabled={editing} style={{flex:1}}>Cancel</button>
              <button className="m-btn m-btn-primary" onClick={handleEditSave} disabled={editing} style={{flex:1}}>
                {editing ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileNotices;
