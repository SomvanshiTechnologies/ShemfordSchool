import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/api';
import { Users, Search } from 'lucide-react';

const PAGE_SIZE = 20;

const MobileStudents = () => {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const searchDebounce = useRef(null);
  const listRef = useRef(null);

  const fetchStudents = useCallback(async (pg = 1, q = '', append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = { page: pg, limit: PAGE_SIZE };
      if (q.trim()) params.search = q.trim();
      const r = await api.get('/students', { params });
      const arr = Array.isArray(r.data) ? r.data : (r.data?.students ?? []);
      const pages = r.data?.pages ?? 1;
      const tot = r.data?.total ?? arr.length;
      setStudents(prev => append ? [...prev, ...arr] : arr);
      setTotalPages(pages);
      setTotal(tot);
    } catch {}
    finally { setLoading(false); setLoadingMore(false); }
  }, []);

  useEffect(() => { fetchStudents(1, '', false); }, [fetchStudents]);

  // Scroll-based infinite load
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (loadingMore || loading) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
        setPage(prev => {
          const next = prev + 1;
          if (next <= totalPages) { fetchStudents(next, search, true); return next; }
          return prev;
        });
      }
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [loadingMore, loading, totalPages, search, fetchStudents]);

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setPage(1);
      setStudents([]);
      fetchStudents(1, val, false);
    }, 400);
  };

  if (loading) return (
    <div>
      <div className="m-header"><div><div className="m-skeleton" style={{width:120,height:24}} /></div></div>
      {[1,2,3,4,5].map(i => <div key={i} className="m-skeleton" style={{height:60,borderRadius:14,marginBottom:8}} />)}
    </div>
  );

  return (
    <div data-testid="m-students" style={{display:'flex',flexDirection:'column',height:'100%'}}>
      <div className="m-header">
        <div><h1>Students</h1><p className="m-header-sub">{total} enrolled</p></div>
      </div>

      <div style={{position:'relative',marginBottom:16,flexShrink:0}}>
        <Search size={16} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'#888'}} />
        <input className="m-input" style={{paddingLeft:38}} placeholder="Search students..." value={search} onChange={e => handleSearch(e.target.value)} />
      </div>

      <div ref={listRef} className="m-list" style={{flex:1,overflowY:'auto'}}>
        {students.map(s => (
          <div key={s.student_id} className="m-list-item">
            <div style={{display:'flex',gap:10,alignItems:'center'}}>
              <div className="m-avatar" style={{background:'#F5F5F5',color:'#1A1A1A',width:36,height:36,fontSize:14,borderRadius:10}}>
                {s.first_name?.charAt(0)}
              </div>
              <div>
                <p style={{fontWeight:600,fontSize:13,color:'#1A1A1A'}}>{s.first_name} {s.last_name}</p>
                <p style={{fontSize:11,color:'#888'}}>{s.class_name}-{s.section} | {s.admission_number}</p>
              </div>
            </div>
            <span className={`m-badge ${s.fee_status === 'paid' ? 'm-badge-dark' : s.fee_status === 'overdue' ? 'm-badge-orange' : 'm-badge-muted'}`}>
              {s.fee_status || 'pending'}
            </span>
          </div>
        ))}
        {loadingMore && (
          <div style={{textAlign:'center',padding:'12px 0',color:'#888',fontSize:12}}>Loading more...</div>
        )}
        {!loadingMore && page >= totalPages && students.length === 0 && (
          <div className="m-empty"><Users className="m-empty-icon" /><p>No students found</p></div>
        )}
        {!loadingMore && page >= totalPages && students.length > 0 && (
          <div style={{textAlign:'center',padding:'12px 0',color:'#aaa',fontSize:11}}>{total} students total</div>
        )}
      </div>
    </div>
  );
};

export default MobileStudents;
