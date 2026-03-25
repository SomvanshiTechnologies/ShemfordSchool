import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';
import { SectionTitle, CardDark, Badge, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';

const GRADE = (pct) => {
  if (pct >= 91) return 'A1'; if (pct >= 81) return 'A2'; if (pct >= 71) return 'B1';
  if (pct >= 61) return 'B2'; if (pct >= 51) return 'C1'; if (pct >= 41) return 'C2';
  if (pct >= 33) return 'D'; return 'E';
};

const MarksScreen = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';
  const isStudentOrParent = user?.role === 'student' || user?.role === 'parent';

  const [exams, setExams] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selExam, setSelExam] = useState(null);
  const [selSection, setSelSection] = useState('');
  const [students, setStudents] = useState([]);
  const [marks, setMarks] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [myMarks, setMyMarks] = useState([]);

  useEffect(() => {
    if (isStudentOrParent) {
      client.get('/marks').then(r => setMyMarks(r.data)).finally(() => setLoading(false));
    } else {
      Promise.all([client.get('/exams'), client.get('/classes')])
        .then(([e, c]) => { setExams(e.data); setClasses(c.data); })
        .finally(() => setLoading(false));
    }
  }, []);

  useEffect(() => {
    if (selExam && selSection) {
      setLoading(true);
      Promise.all([
        client.get('/students', { params: { class_name: selExam.class_name, section: selSection } }),
        client.get('/marks', { params: { exam_id: selExam.exam_id, class_name: selExam.class_name, section: selSection } }),
      ]).then(([s, m]) => {
        setStudents(s.data);
        const map = {};
        m.data.forEach(mk => {
          if (!map[mk.student_id]) map[mk.student_id] = {};
          map[mk.student_id][mk.subject] = mk.marks_obtained;
        });
        setMarks(map);
      }).finally(() => setLoading(false));
    }
  }, [selExam, selSection]);

  const saveMarks = async () => {
    setSaving(true);
    try {
      const records = [];
      students.forEach(s => {
        (selExam.subjects || []).forEach(subj => {
          const val = marks[s.student_id]?.[subj.subject];
          if (val !== undefined && val !== '') {
            records.push({ student_id: s.student_id, subject: subj.subject, marks_obtained: parseFloat(val), max_marks: subj.max_marks, section: selSection });
          }
        });
      });
      const res = await client.post('/marks', { exam_id: selExam.exam_id, records });
      Alert.alert('Success', `${res.data.success} marks saved`);
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to save');
    } finally { setSaving(false); }
  };

  if (loading && !selExam) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  // Student view
  if (isStudentOrParent) {
    const bySubject = {};
    myMarks.forEach(m => {
      if (!bySubject[m.subject]) bySubject[m.subject] = [];
      bySubject[m.subject].push(m);
    });

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.h1}>My Marks</Text>
            <Text style={styles.sub}>{myMarks.length} records</Text>
          </View>
          {Object.keys(bySubject).length === 0 ? (
            <EmptyState icon={<Ionicons name="school-outline" size={48} color="#DDD" />} text="No marks published yet" />
          ) : (
            <View style={styles.list}>
              {Object.entries(bySubject).map(([subject, mks]) => {
                const totalObt = mks.reduce((s, m) => s + m.marks_obtained, 0);
                const totalMax = mks.reduce((s, m) => s + m.max_marks, 0);
                const pct = totalMax > 0 ? (totalObt / totalMax * 100) : 0;
                return (
                  <View key={subject} style={styles.listItem}>
                    <View>
                      <Text style={{ fontWeight: '700', fontSize: 14, color: COLORS.black }}>{subject}</Text>
                      <Text style={{ fontSize: 12, color: COLORS.muted }}>{totalObt}/{totalMax}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Badge text={GRADE(pct)} variant={pct >= 60 ? 'dark' : pct >= 33 ? 'muted' : 'orange'} />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.black, marginTop: 4 }}>{pct.toFixed(0)}%</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Teacher/Admin view
  const examSections = selExam ? (classes.find(c => c.name === selExam.class_name)?.sections || []) : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.h1}>Marks</Text>
          <Text style={styles.sub}>{exams.length} exams defined</Text>
        </View>

        <SectionTitle>Select Exam</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          {exams.map(e => (
            <TouchableOpacity key={e.exam_id} style={[styles.chip, selExam?.exam_id === e.exam_id && styles.chipActive]} onPress={() => { setSelExam(e); setSelSection(''); }}>
              <Text style={[styles.chipText, selExam?.exam_id === e.exam_id && styles.chipTextActive]}>
                {e.name} {e.is_locked ? '(Locked)' : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {selExam && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {examSections.map(s => {
              const n = typeof s === 'string' ? s : s.section_name;
              return (
                <TouchableOpacity key={n} style={[styles.chip, selSection === n && styles.chipActive]} onPress={() => setSelSection(n)}>
                  <Text style={[styles.chipText, selSection === n && styles.chipTextActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {selExam?.is_locked && (
          <CardDark style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="lock-closed" size={16} color={COLORS.primary} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.white }}>Exam locked — {isAdmin ? 'unlock from web app' : 'contact admin'}</Text>
          </CardDark>
        )}

        {selExam && selSection && !loading && (
          <>
            {!selExam.is_locked && (
              <TouchableOpacity style={styles.saveBtn} onPress={saveMarks} disabled={saving}>
                {saving ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="save" size={16} color={COLORS.white} />}
                <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.white }}>Save Marks</Text>
              </TouchableOpacity>
            )}
            <View style={styles.list}>
              {students.map(s => {
                const sm = marks[s.student_id] || {};
                return (
                  <View key={s.student_id} style={{ paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg }}>
                    <Text style={{ fontWeight: '700', fontSize: 13, color: COLORS.black, marginBottom: 8 }}>{s.first_name} {s.last_name}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {(selExam.subjects || []).map(subj => (
                        <View key={subj.subject} style={{ flex: 1, minWidth: 80 }}>
                          <Text style={{ fontSize: 10, fontWeight: '600', color: COLORS.muted, marginBottom: 4 }}>{subj.subject}</Text>
                          <TextInput
                            style={styles.marksInput}
                            placeholder={`/${subj.max_marks}`}
                            placeholderTextColor={COLORS.lightMuted}
                            value={sm[subj.subject]?.toString() ?? ''}
                            onChangeText={v => setMarks(p => ({ ...p, [s.student_id]: { ...(p[s.student_id] || {}), [subj.subject]: v } }))}
                            keyboardType="numeric"
                            editable={!selExam.is_locked || isAdmin}
                          />
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {loading && selExam && selSection && <ScreenLoader />}
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
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white, marginRight: 8 },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  chipTextActive: { color: COLORS.white },
  list: { backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  marksInput: { backgroundColor: COLORS.white, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, textAlign: 'center', borderWidth: 1.5, borderColor: COLORS.border },
});

export default MarksScreen;
