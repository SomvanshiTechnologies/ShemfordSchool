import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import { getCached, setCached } from '../../lib/pageCache';
import { toast } from 'sonner';
import { GraduationCap, Loader2, Download, Share2, Printer, IdCard } from 'lucide-react';

const LOGO_URL = '/logo.webp';

const MobileIdCard = () => {
  const { user } = useAuth();
  const role = user?.role;
  const allowed = role === 'student' || role === 'parent' || role === 'admin';

  const cached = getCached('m-idcard:children') || null;
  const [children, setChildren] = useState(cached || []);
  const [selected, setSelected] = useState(cached?.[0] || null);
  const [loading, setLoading] = useState(!cached);
  const cardRef = useRef(null);

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    (async () => {
      try {
        const r = await api.get('/students');
        const list = r.data?.students ?? (Array.isArray(r.data) ? r.data : []);
        setChildren(list);
        setCached('m-idcard:children', list);
        if (!selected && list[0]) setSelected(list[0]);
      } catch { toast.error('Failed to load student'); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line
  }, [allowed]);

  if (!allowed) {
    return (
      <div data-testid="m-id-card">
        <div className="m-header"><div><h1>ID Card</h1></div></div>
        <div className="m-empty"><IdCard className="m-empty-icon" /><p>ID cards are only available for students and parents.</p></div>
      </div>
    );
  }

  return (
    <div data-testid="m-id-card" style={{minWidth:0}}>
      <div className="m-header">
        <div><h1>Digital ID Card</h1><p className="m-header-sub">Show this at the school gate</p></div>
      </div>

      {/* Child switcher when parent has multiple children */}
      {children.length > 1 && (
        <div className="m-chips" style={{marginBottom:12}}>
          {children.map(c => (
            <button
              key={c.student_id}
              className={`m-chip ${selected?.student_id === c.student_id ? 'active' : ''}`}
              onClick={() => setSelected(c)}
            >
              {c.first_name}
            </button>
          ))}
        </div>
      )}

      {loading && !selected ? (
        <div className="m-skeleton" style={{height:480,borderRadius:18}} />
      ) : !selected ? (
        <div className="m-empty"><IdCard className="m-empty-icon" /><p>No student record linked to this account.</p></div>
      ) : (
        <>
          <IdCardView student={selected} cardRef={cardRef} />

          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button
              onClick={() => window.print()}
              className="m-btn m-btn-outline"
              style={{flex:1}}
              data-testid="m-idcard-print"
            >
              <Printer size={14} /> Print
            </button>
            <button
              onClick={() => shareCard(selected)}
              className="m-btn m-btn-primary"
              style={{flex:1}}
              data-testid="m-idcard-share"
            >
              <Share2 size={14} /> Share
            </button>
          </div>

          <p style={{fontSize:11,color:'#888',marginTop:12,textAlign:'center',lineHeight:1.5}}>
            Use the Print option to save as PDF, or Share to send via WhatsApp / Email.
            The gate guard can verify by scanning the barcode-style number or reading the admission number aloud.
          </p>
        </>
      )}
    </div>
  );
};

export default MobileIdCard;

// ─── The visual card ───────────────────────────────────────────────────────

const IdCardView = ({ student, cardRef }) => {
  const initials = `${student.first_name?.charAt(0) || ''}${student.last_name?.charAt(0) || ''}`.toUpperCase() || '?';

  return (
    <div
      ref={cardRef}
      data-testid="m-idcard-view"
      style={{
        background: 'linear-gradient(135deg, #1A1A1A 0%, #2a2a2a 100%)',
        borderRadius: 18,
        overflow: 'hidden',
        boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        color: '#FFF',
        position: 'relative',
      }}
    >
      {/* Header band — school identity */}
      <div style={{
        background: '#E88A1A',
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <img
          src={LOGO_URL}
          alt=""
          style={{width: 32, height: 32, borderRadius: 8, background: '#FFF', padding: 4, objectFit: 'contain'}}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <div style={{minWidth: 0, flex: 1}}>
          <p style={{fontSize: 14, fontWeight: 800, color: '#FFF', letterSpacing: '0.02em'}}>
            SHEMFORD FUTURISTIC SCHOOL
          </p>
          <p style={{fontSize: 10, color: 'rgba(255,255,255,0.85)'}}>Student Identity Card</p>
        </div>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
          background: 'rgba(255,255,255,0.2)', color: '#FFF', textTransform: 'uppercase',
        }}>
          {student.academic_year || 'Current'}
        </span>
      </div>

      {/* Body — photo + details */}
      <div style={{padding: 18, display: 'flex', gap: 16, alignItems: 'flex-start'}}>
        <div style={{flexShrink: 0}}>
          {student.picture ? (
            <img
              src={student.picture}
              alt={`${student.first_name} ${student.last_name}`}
              style={{
                width: 100, height: 120, borderRadius: 10, objectFit: 'cover',
                border: '3px solid #E88A1A', background: '#FFF',
              }}
              onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
            />
          ) : null}
          <div style={{
            width: 100, height: 120, borderRadius: 10,
            border: '3px solid #E88A1A', background: '#3a3a3a',
            display: student.picture ? 'none' : 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: '#E88A1A', fontWeight: 800, fontSize: 36,
          }}>
            {initials}
          </div>
        </div>

        <div style={{minWidth: 0, flex: 1}}>
          <p style={{fontSize: 17, fontWeight: 800, color: '#FFF', lineHeight: 1.2, wordBreak: 'break-word'}}>
            {student.first_name} {student.last_name}
          </p>
          <p style={{fontSize: 11, color: '#E88A1A', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', marginTop: 4, fontWeight: 700, letterSpacing: '0.04em'}}>
            {student.admission_number || '—'}
          </p>

          <div style={{marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8}}>
            <Field label="Class" value={`${student.class_name || ''}${student.section ? '-' + student.section : ''}${student.stream ? ` (${student.stream})` : ''}`} />
            <Field label="Roll No" value={student.roll_number || '—'} />
            <Field label="DOB" value={student.date_of_birth || '—'} />
            <Field label="Blood" value={student.blood_group || '—'} />
          </div>
        </div>
      </div>

      {/* Emergency contact strip */}
      <div style={{
        margin: '0 18px',
        padding: '10px 12px',
        background: 'rgba(255,255,255,0.06)',
        borderRadius: 10,
        marginBottom: 14,
      }}>
        <p style={{fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.5)'}}>
          Parent / Emergency
        </p>
        <p style={{fontSize: 12, fontWeight: 600, color: '#FFF', marginTop: 2}}>
          {student.parent_name || student.father_name || '—'}
          {(student.parent_phone || student.father_phone) && (
            <span style={{color: '#E88A1A', marginLeft: 6}}>
              · {student.parent_phone || student.father_phone}
            </span>
          )}
        </p>
      </div>

      {/* "Barcode" strip — visual element + admission no for gate scanning */}
      <Barcode value={student.admission_number || student.student_id} />

      {/* Footer — validity */}
      <div style={{padding: '12px 18px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <div>
          <p style={{fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.5)'}}>
            Issued
          </p>
          <p style={{fontSize: 11, color: '#FFF', fontWeight: 600}}>
            {student.admission_date || '—'}
          </p>
        </div>
        <div style={{textAlign: 'right'}}>
          <p style={{fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.5)'}}>
            Valid Until
          </p>
          <p style={{fontSize: 11, color: '#E88A1A', fontWeight: 700}}>
            31 Mar {(student.academic_year || '').split('-')[1] || '—'}
          </p>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, value }) => (
  <div style={{minWidth: 0}}>
    <p style={{fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.5)'}}>
      {label}
    </p>
    <p style={{fontSize: 12, fontWeight: 600, color: '#FFF', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
      {value || '—'}
    </p>
  </div>
);

// Deterministic pseudo-barcode generated from the admission/student id.
// Easier to spot-check than nothing; not a real Code-128 but visually
// distinct per student. The number is printed underneath for verification.
const Barcode = ({ value }) => {
  const seed = String(value || '');
  const bars = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 60; i++) {
      const ch = seed.charCodeAt(i % seed.length) + i;
      arr.push(((ch % 4) + 1)); // width 1..4
    }
    return arr;
  }, [seed]);
  return (
    <div style={{margin: '0 18px 4px', background: '#FFF', borderRadius: 6, padding: '8px 10px'}}>
      <div style={{display: 'flex', alignItems: 'flex-end', gap: 1, height: 36}}>
        {bars.map((w, i) => (
          <div
            key={i}
            style={{
              width: w,
              height: '100%',
              background: i % 2 === 0 ? '#000' : 'transparent',
            }}
          />
        ))}
      </div>
      <p style={{
        fontSize: 11, color: '#000', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        textAlign: 'center', marginTop: 4, letterSpacing: '0.12em', fontWeight: 700,
      }}>
        {value || '—'}
      </p>
    </div>
  );
};

// ─── Share helpers ─────────────────────────────────────────────────────────

const shareCard = async (student) => {
  const text =
    `🎓 Shemford Futuristic School — Student ID\n` +
    `Name: ${student.first_name} ${student.last_name}\n` +
    `Admission: ${student.admission_number}\n` +
    `Class: ${student.class_name}${student.section ? '-' + student.section : ''}\n` +
    `Academic Year: ${student.academic_year || '—'}`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Student ID Card',
        text,
      });
      return;
    } catch (e) {
      // user cancelled — fall through to clipboard
      if (e?.name === 'AbortError') return;
    }
  }

  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied ID details to clipboard');
  } catch {
    toast.error('Sharing not supported on this device');
  }
};
