import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';
import { SectionTitle, CardDark, CardOrange, Badge } from '../components/UI';
import { StatCard, StatGrid } from '../components/StatCard';
import { ScreenLoader } from '../components/LoadingSkeleton';

const AttendanceScreen = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isStudentOrParent = user?.role === 'student' || user?.role === 'parent';

  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [attData, setAttData] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState(null);
  const [selClass, setSelClass] = useState('');
  const [selSection, setSelSection] = useState('');
  const [selDate] = useState(new Date().toISOString().split('T')[0]);
  const [myRecords, setMyRecords] = useState([]);
  const [myLoading, setMyLoading] = useState(true);

  useEffect(() => {
    if (isStudentOrParent) {
      client.get('/attendance', { params: { entity_type: 'student' } })
        .then(r => setMyRecords(r.data)).finally(() => setMyLoading(false));
    } else {
      client.get('/classes').then(r => setClasses(r.data)).finally(() => setMyLoading(false));
    }
  }, []);

  useEffect(() => {
    if (selClass && selSection && !isStudentOrParent) {
      setLoading(true);
      Promise.all([
        client.get('/students', { params: { class_name: selClass, section: selSection } }),
        client.get('/attendance', { params: { entity_type: 'student', date: selDate, class_name: selClass, section: selSection } }),
        client.get('/attendance/session-status', { params: { class_name: selClass, section: selSection, date: selDate } }),
      ]).then(([s, a, sess]) => {
        setStudents(s.data);
        setSession(sess.data);
        const m = {};
        a.data.forEach(r => { m[r.entity_id] = r.status; });
        setAttData(m);
      }).finally(() => setLoading(false));
    }
  }, [selClass, selSection, selDate]);

  const isLocked = session?.is_locked && session?.submitted;
  const isHoliday = session?.is_holiday;
  const canEdit = (!isLocked && !isHoliday) || isAdmin;

  const markAll = (status) => {
    const n = {};
    students.forEach(s => { n[s.student_id] = status; });
    setAttData(n);
  };

  const submitAttendance = async () => {
    setSaving(true);
    try {
      const records = students.map(s => ({
        entity_type: 'student', entity_id: s.student_id, date: selDate,
        status: attData[s.student_id] || 'absent', class_name: selClass, section: selSection,
      }));
      const res = await client.post('/attendance', { class_name: selClass, section: selSection, date: selDate, records });
      Alert.alert('Success', `Attendance submitted${res.data.parents_notified > 0 ? `. ${res.data.parents_notified} parent(s) notified` : ''}`);
      setSession({ submitted: true, is_locked: true });
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to submit');
    } finally { setSaving(false); }
  };

  const unlock = async () => {
    try {
      await client.post('/attendance/unlock', { class_name: selClass, section: selSection, date: selDate });
      Alert.alert('Success', 'Unlocked');
      setSession({ ...session, is_locked: false });
    } catch { Alert.alert('Error', 'Failed to unlock'); }
  };

  if (myLoading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  // Student/Parent view
  if (isStudentOrParent) {
    const present = myRecords.filter(r => r.status === 'present').length;
    const absent = myRecords.filter(r => r.status === 'absent').length;
    const total = myRecords.length;
    const pct = total > 0 ? Math.round(present / total * 100) : 0;

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.h1}>My Attendance</Text>
            <Text style={styles.sub}>{total} days recorded</Text>
          </View>
          <StatGrid>
            <StatCard label="Present" value={present} />
            <StatCard label="Absent" value={absent} accent />
            <StatCard label="Total" value={total} />
            <StatCard label="Percentage" value={`${pct}%`} />
          </StatGrid>
          <View style={styles.list}>
            {myRecords.slice(0, 30).map((r, i) => (
              <View key={i} style={styles.listItem}>
                <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }}>{r.date}</Text>
                <Badge text={r.status} variant={r.status === 'present' ? 'dark' : r.status === 'absent' ? 'orange' : 'muted'} />
              </View>
            ))}
            {myRecords.length === 0 && (
              <View style={styles.empty}><Ionicons name="calendar-outline" size={48} color="#DDD" /><Text style={styles.emptyText}>No records yet</Text></View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Teacher/Admin view
  const sections = classes.find(c => c.name === selClass)?.sections || [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.h1}>Attendance</Text>
          <Text style={styles.sub}>{selDate}</Text>
        </View>

        <SectionTitle>Select Class</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          {classes.map(c => (
            <TouchableOpacity
              key={c.name}
              style={[styles.chip, selClass === c.name && styles.chipActive]}
              onPress={() => { setSelClass(c.name); setSelSection(''); setSession(null); }}
            >
              <Text style={[styles.chipText, selClass === c.name && styles.chipTextActive]}>{c.display_name || c.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {selClass && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {sections.map(s => {
              const n = typeof s === 'string' ? s : s.section_name;
              return (
                <TouchableOpacity key={n} style={[styles.chip, selSection === n && styles.chipActive]} onPress={() => setSelSection(n)}>
                  <Text style={[styles.chipText, selSection === n && styles.chipTextActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {isHoliday && (
          <CardOrange style={{ alignItems: 'center' }}>
            <Ionicons name="calendar" size={20} color={COLORS.white} />
            <Text style={{ fontWeight: '700', color: COLORS.white, marginTop: 8 }}>{session?.holiday_name}</Text>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>Holiday — attendance blocked</Text>
          </CardOrange>
        )}

        {isLocked && !isHoliday && (
          <CardDark style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Ionicons name="lock-closed" size={18} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: COLORS.white, fontSize: 13 }}>Submitted & Locked</Text>
              {!isAdmin && <Text style={{ fontSize: 11, color: COLORS.muted }}>Contact admin to edit</Text>}
            </View>
            {isAdmin && (
              <TouchableOpacity style={styles.unlockBtn} onPress={unlock}>
                <Ionicons name="lock-open" size={14} color={COLORS.white} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.white }}>Unlock</Text>
              </TouchableOpacity>
            )}
          </CardDark>
        )}

        {canEdit && students.length > 0 && !isHoliday && (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <TouchableOpacity style={[styles.actionBtn, { borderWidth: 1.5, borderColor: COLORS.border, flex: 1 }]} onPress={() => markAll('present')}>
              <Ionicons name="checkmark-circle" size={14} color={COLORS.black} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.black }}>All Present</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.primary, flex: 1 }]} onPress={submitAttendance} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color={COLORS.white} /> : <Ionicons name="checkmark" size={14} color={COLORS.white} />}
              <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.white }}>Submit & Lock</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading ? <ScreenLoader /> : students.length === 0 && selClass && selSection ? (
          <View style={styles.empty}><Text style={styles.emptyText}>No students found</Text></View>
        ) : (
          <View style={styles.list}>
            {students.map(s => {
              const status = attData[s.student_id] || '';
              return (
                <View key={s.student_id} style={styles.attRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }} numberOfLines={1}>{s.first_name} {s.last_name}</Text>
                    <Text style={{ fontSize: 10, color: COLORS.muted }}>{s.roll_number || s.admission_number}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      style={[styles.attBtn, status === 'present' && styles.attBtnPresent]}
                      onPress={() => canEdit && setAttData(p => ({ ...p, [s.student_id]: 'present' }))}
                      disabled={!canEdit}
                    >
                      <Ionicons name="checkmark-circle" size={16} color={status === 'present' ? COLORS.white : COLORS.muted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.attBtn, status === 'absent' && styles.attBtnAbsent]}
                      onPress={() => canEdit && setAttData(p => ({ ...p, [s.student_id]: 'absent' }))}
                      disabled={!canEdit}
                    >
                      <Ionicons name="close-circle" size={16} color={status === 'absent' ? COLORS.white : COLORS.muted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.attBtn, status === 'leave' && styles.attBtnLeave]}
                      onPress={() => canEdit && setAttData(p => ({ ...p, [s.student_id]: 'leave' }))}
                      disabled={!canEdit}
                    >
                      <Ionicons name="time" size={16} color={status === 'leave' ? COLORS.warning : COLORS.muted} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 24, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white, marginRight: 8 },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  chipTextActive: { color: COLORS.white },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, ...SHADOW.sm },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  attRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  attBtn: { width: 38, height: 38, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  attBtnPresent: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  attBtnAbsent: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
  attBtnLeave: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: RADIUS.md },
  unlockBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 14, color: COLORS.lightMuted, marginTop: 12 },
});

export default AttendanceScreen;
