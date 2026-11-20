import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { Badge } from './UI';

// Search box over every active student, by name, roll number or admission
// number. Uses the same endpoint as the web fee-collection search, which
// returns up to 10 matches. onSelect receives
// { student_id, name, admission_number, class_name, section, fee_status }.
const StudentSearch = ({ onSelect, placeholder = 'Search any student by name or admission no.', academicYear, autoFocus }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const timer = useRef(null);
  const seq = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = (value) => {
    setQ(value);
    clearTimeout(timer.current);
    if (!value.trim()) { setResults([]); setSearched(false); setSearching(false); return; }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      setSearching(true);
      try {
        const res = await client.get('/fees/search-students', { params: { q: value.trim(), ...(academicYear ? { academic_year: academicYear } : {}) } });
        if (mine === seq.current) setResults(Array.isArray(res.data) ? res.data : []);
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) { setSearching(false); setSearched(true); }
      }
    }, 400);
  };

  const clear = () => { clearTimeout(timer.current); seq.current++; setQ(''); setResults([]); setSearched(false); setSearching(false); };

  const pick = (s) => { clear(); onSelect?.(s); };

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={st.box}>
        <Ionicons name="search" size={16} color={COLORS.muted} />
        <TextInput
          style={st.input}
          value={q}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={COLORS.lightMuted}
          autoCorrect={false}
          autoFocus={autoFocus}
          returnKeyType="search"
        />
        {searching ? <ActivityIndicator size="small" color={COLORS.primary} /> : !!q && (
          <TouchableOpacity onPress={clear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close-circle" size={18} color={COLORS.lightMuted} />
          </TouchableOpacity>
        )}
      </View>
      {!!q && searched && (
        <View style={st.results}>
          {results.map(s => (
            <TouchableOpacity key={s.student_id} style={st.row} onPress={() => pick(s)}>
              <View style={{ flex: 1 }}>
                <Text style={st.name}>{s.name}</Text>
                <Text style={st.sub}>{s.class_name}{s.section ? `-${s.section}` : ''} · {s.admission_number || s.roll_number || s.student_id}</Text>
              </View>
              <Badge text={s.fee_status || 'pending'} variant={s.fee_status === 'paid' ? 'dark' : s.fee_status === 'overdue' ? 'orange' : 'muted'} />
            </TouchableOpacity>
          ))}
          {results.length === 0 && <Text style={st.none}>No students match "{q.trim()}"</Text>}
        </View>
      )}
    </View>
  );
};

const st = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 14, ...SHADOW.sm,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 14, color: COLORS.black },
  results: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginTop: 6, overflow: 'hidden', ...SHADOW.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  name: { fontSize: 13, fontWeight: '600', color: COLORS.black },
  sub: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  none: { fontSize: 12, color: COLORS.muted, padding: 14 },
});

export default StudentSearch;
