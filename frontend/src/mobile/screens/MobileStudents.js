import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { Users, ChevronRight, Search } from 'lucide-react';

const MobileStudents = () => {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/students').then(r => setStudents(r.data.students ?? r.data ?? [])).finally(() => setLoading(false));
  }, []);

  const filtered = students.filter(s =>
    `${s.first_name} ${s.last_name} ${s.admission_number}`.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div>
      <div className="m-header"><div><div className="m-skeleton" style={{width:120,height:24}} /></div></div>
      {[1,2,3,4,5].map(i => <div key={i} className="m-skeleton" style={{height:60,borderRadius:14,marginBottom:8}} />)}
    </div>
  );

  return (
    <div data-testid="m-students">
      <div className="m-header"><div><h1>Students</h1><p className="m-header-sub">{students.length} enrolled</p></div></div>

      <div style={{position:'relative',marginBottom:16}}>
        <Search size={16} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'#888'}} />
        <input className="m-input" style={{paddingLeft:38}} placeholder="Search students..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="m-list">
        {filtered.map(s => (
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
        {filtered.length === 0 && <div className="m-empty"><Users className="m-empty-icon" /><p>No students found</p></div>}
      </div>
    </div>
  );
};

export default MobileStudents;
