import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { Badge, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';

// Mirrors the dashboard's SECTION_COLORS map (ClassStructurePage.js).
const SECTION_COLORS = {
  Violet: { bg: '#F5F3FF', fg: '#7C3AED' },
  Indigo: { bg: '#EEF2FF', fg: '#4F46E5' },
  Blue:   { bg: '#EFF6FF', fg: '#2563EB' },
  Green:  { bg: '#ECFDF5', fg: '#059669' },
  Yellow: { bg: '#FEFCE8', fg: '#CA8A04' },
  Orange: { bg: '#FFF7ED', fg: '#EA580C' },
  Red:    { bg: '#FEF2F2', fg: '#DC2626' },
};
const sectionColor = (name) => SECTION_COLORS[name] || { bg: COLORS.lightBg, fg: COLORS.muted };

const DEFAULT_SECTIONS = ['Violet', 'Indigo', 'Blue', 'Green', 'Yellow', 'Orange', 'Red']
  .map(n => ({ section_name: n, capacity: 45, class_teacher_id: null, class_teacher_name: null }));

const feeVariant = (st) => (st === 'paid' ? 'dark' : st === 'overdue' ? 'orange' : 'muted');

const StatTile = ({ label, value, accent }) => (
  <View style={[s.statTile, accent && { borderLeftWidth: 3, borderLeftColor: COLORS.primary }]}>
    <Text style={s.statLabel}>{label}</Text>
    <Text style={s.statValue}>{value}</Text>
  </View>
);

// ─── Add / Edit class form ───────────────────────────────────────────────────

const ClassFormModal = ({ visible, mode, initial, teachers, onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [sections, setSections] = useState([]);
  const [teacherPickerRow, setTeacherPickerRow] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (mode === 'edit' && initial) {
      setName(initial.name || '');
      setDisplayName(initial.display_name || '');
      setSections((initial.sections || []).map(sc => ({ ...sc })));
    } else {
      setName('');
      setDisplayName('');
      setSections(DEFAULT_SECTIONS.map(sc => ({ ...sc })));
    }
  }, [visible, mode, initial]);

  const setSec = (i, patch) => setSections(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    if (!name.trim()) { Alert.alert('Missing field', 'Class name is required.'); return; }
    if (!displayName.trim()) { Alert.alert('Missing field', 'Display name is required.'); return; }
    const cleaned = sections
      .filter(sc => String(sc.section_name || '').trim())
      .map(sc => ({
        section_name: String(sc.section_name).trim(),
        capacity: Number(sc.capacity) || 45,
        class_teacher_id: sc.class_teacher_id || null,
        class_teacher_name: sc.class_teacher_name || null,
      }));
    if (cleaned.length === 0) { Alert.alert('Missing field', 'Add at least one section.'); return; }
    setSaving(true);
    try {
      if (mode === 'edit') {
        await client.put(`/classes/${initial.class_id}`, { name: name.trim(), display_name: displayName.trim(), sections: cleaned });
      } else {
        await client.post('/classes', { name: name.trim(), display_name: displayName.trim(), sections: cleaned });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Could not save class.');
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modalSafe}>
        <View style={s.modalHeader}>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={COLORS.black} /></TouchableOpacity>
          <Text style={s.modalTitle}>{mode === 'edit' ? 'Edit Class' : 'Add Class'}</Text>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={s.formLabel}>CLASS NAME *</Text>
          <TextInput style={s.formInput} value={name} onChangeText={setName} placeholder="e.g. 1st, Nursery" placeholderTextColor={COLORS.lightMuted} />
          <Text style={s.formLabel}>DISPLAY NAME *</Text>
          <TextInput style={s.formInput} value={displayName} onChangeText={setDisplayName} placeholder="e.g. Class 1" placeholderTextColor={COLORS.lightMuted} />

          <Text style={s.formLabel}>SECTIONS *</Text>
          {sections.map((sc, i) => (
            <View key={i} style={s.secEditRow}>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <TextInput
                  style={[s.formInput, { flex: 2, marginBottom: 0 }]}
                  value={String(sc.section_name ?? '')}
                  onChangeText={v => setSec(i, { section_name: v })}
                  placeholder="Section name"
                  placeholderTextColor={COLORS.lightMuted}
                />
                <TextInput
                  style={[s.formInput, { flex: 1, marginBottom: 0, textAlign: 'center' }]}
                  value={String(sc.capacity ?? '')}
                  onChangeText={v => setSec(i, { capacity: v })}
                  keyboardType="numeric"
                  placeholder="Cap"
                  placeholderTextColor={COLORS.lightMuted}
                />
                <TouchableOpacity style={{ justifyContent: 'center' }} onPress={() => setSections(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs)}>
                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[s.formInput, { marginBottom: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                onPress={() => setTeacherPickerRow(i)}
              >
                <Text style={{ fontSize: 13, color: sc.class_teacher_name ? COLORS.black : COLORS.lightMuted }}>
                  {sc.class_teacher_name || 'Class teacher — unassigned'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={s.addRowBtn} onPress={() => setSections(rs => [...rs, { section_name: '', capacity: 45, class_teacher_id: null, class_teacher_name: null }])}>
            <Ionicons name="add" size={16} color={COLORS.black} />
            <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.black }}>Add Section</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.saveBtn, { marginTop: 20 }]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="checkmark" size={16} color={COLORS.white} />}
            <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.white }}>{mode === 'edit' ? 'Save Changes' : 'Create Class'}</Text>
          </TouchableOpacity>
        </ScrollView>

        <Modal visible={teacherPickerRow !== null} transparent animationType="fade" onRequestClose={() => setTeacherPickerRow(null)}>
          <TouchableOpacity style={s.pickerBackdrop} activeOpacity={1} onPress={() => setTeacherPickerRow(null)}>
            <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
              <Text style={s.pickerTitle}>Class teacher</Text>
              <ScrollView style={{ maxHeight: 400 }}>
                <TouchableOpacity style={s.pickerRow} onPress={() => { setSec(teacherPickerRow, { class_teacher_id: null, class_teacher_name: null }); setTeacherPickerRow(null); }}>
                  <Text style={[s.pickerRowText, { fontStyle: 'italic', color: COLORS.muted }]}>Unassigned</Text>
                </TouchableOpacity>
                {teachers.map(t => (
                  <TouchableOpacity key={t.user_id} style={s.pickerRow} onPress={() => { setSec(teacherPickerRow, { class_teacher_id: t.user_id, class_teacher_name: t.name }); setTeacherPickerRow(null); }}>
                    <Text style={s.pickerRowText}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
};

// ─── Section student list ─────────────────────────────────────────────────────

const StudentListModal = ({ target, onClose }) => {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    const params = { section: target.section };
    if (target.cls.has_streams) params.stream = String(target.section).toLowerCase();
    client.get(`/classes/${target.cls.class_id}/students`, { params })
      .then(r => setStudents(Array.isArray(r.data) ? r.data : []))
      .catch(() => setStudents([]))
      .finally(() => setLoading(false));
  }, [target]);

  return (
    <Modal visible={!!target} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modalSafe}>
        <View style={s.modalHeader}>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={COLORS.black} /></TouchableOpacity>
          <Text style={s.modalTitle}>{target ? `${target.cls.display_name || target.cls.name} — ${target.section}` : ''}</Text>
          <View style={{ width: 36 }} />
        </View>
        {loading ? <ScreenLoader /> : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <View style={s.list}>
              {students.map(st => (
                <View key={st.student_id} style={s.studentRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', fontSize: 13, color: COLORS.black }}>{st.first_name} {st.last_name}</Text>
                    <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
                      {st.admission_number} · Roll {st.roll_number || '-'}
                    </Text>
                  </View>
                  <Badge text={st.fee_status || 'pending'} variant={feeVariant(st.fee_status)} />
                </View>
              ))}
              {students.length === 0 && <EmptyState icon={<Ionicons name="people-outline" size={48} color="#DDD" />} text="No students in this section" />}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
};

// ─── Main screen ─────────────────────────────────────────────────────────────

const ClassesScreen = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const session = useSession() || {};

  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState(null);        // {mode, initial}
  const [studentTarget, setStudentTarget] = useState(null); // {cls, section}

  const load = useCallback(() =>
    client.get('/classes')
      .then(r => setClasses(Array.isArray(r.data) ? r.data : []))
      .catch(() => {}), []);

  useEffect(() => {
    Promise.all([
      load(),
      isAdmin
        ? client.get('/users/search', { params: { role: 'teacher' } })
            .then(r => setTeachers(Array.isArray(r.data) ? r.data : []))
            .catch(() => setTeachers([]))
        : Promise.resolve(),
    ]).finally(() => setLoading(false));
  }, [load, isAdmin, session.viewSession]);

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  if (loading) return <SafeAreaView style={s.safe}><ScreenLoader /></SafeAreaView>;

  // Stat tiles — computed client-side, same as the dashboard.
  const totalSections = classes.reduce((a, c) => a + (c.sections || []).length, 0);
  const totalStudents = classes.reduce((a, c) => a + (c.sections || []).reduce((b, sc) => b + (sc.student_count || 0), 0), 0);
  const teachersAssigned = classes.reduce((a, c) => a + (c.sections || []).filter(sc => sc.class_teacher_id).length, 0);
  const yearBadge = session.viewSession || session.activeSession;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        <View style={[s.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }]}>
          <View>
            <Text style={s.h1}>Class Structure</Text>
            <Text style={s.sub}>Classes, sections & teacher assignments</Text>
          </View>
          {isAdmin && (
            <TouchableOpacity style={s.addBtn} onPress={() => setForm({ mode: 'add' })}>
              <Ionicons name="add" size={15} color={COLORS.white} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.white }}>Add Class</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={s.statGrid}>
          <StatTile label="Total Classes" value={classes.length} accent />
          <StatTile label="Total Sections" value={totalSections} />
          <StatTile label="Total Students" value={totalStudents} />
          <StatTile label="Teachers Assigned" value={teachersAssigned} />
        </View>

        {classes.map(cls => {
          const shownSections = cls.has_streams
            ? (cls.sections || []).filter(sc => (cls.streams || []).some(st => st.toLowerCase() === String(sc.section_name).toLowerCase()))
            : (cls.sections || []);
          return (
            <View key={cls.class_id} style={s.classCard}>
              <View style={s.classHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <Text style={s.className}>{cls.display_name || cls.name}</Text>
                  {cls.has_streams && <Badge text="Streams" variant="muted" />}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={s.yearBadge}><Text style={s.yearBadgeText}>{yearBadge || cls.academic_year}</Text></View>
                  {isAdmin && (
                    <TouchableOpacity onPress={() => setForm({ mode: 'edit', initial: cls })}>
                      <Ionicons name="create-outline" size={20} color={COLORS.muted} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {shownSections.map(sc => {
                const col = sectionColor(sc.section_name);
                const count = sc.student_count || 0;
                const cap = sc.capacity || 45;
                const pctFill = Math.min(100, (count / cap) * 100);
                return (
                  <TouchableOpacity
                    key={sc.section_name}
                    style={s.sectionRow}
                    activeOpacity={0.7}
                    onPress={() => setStudentTarget({ cls, section: sc.section_name })}
                  >
                    <View style={[s.sectionBadge, { backgroundColor: col.bg }]}>
                      <Text style={[s.sectionBadgeText, { color: col.fg }]}>{sc.section_name}</Text>
                    </View>
                    <View style={{ flex: 1, marginHorizontal: 10 }}>
                      <View style={s.progressTrack}>
                        <View style={[s.progressFill, { width: `${pctFill}%` }]} />
                      </View>
                      <Text style={s.progressText}>{count}/{cap}</Text>
                    </View>
                    <Text style={[s.teacherText, !sc.class_teacher_name && { fontStyle: 'italic', color: COLORS.lightMuted }]} numberOfLines={1}>
                      {sc.class_teacher_name || 'Unassigned'}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={COLORS.lightMuted} style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
        {classes.length === 0 && <EmptyState icon={<Ionicons name="grid-outline" size={48} color="#DDD" />} text="No classes defined" />}
        <View style={{ height: 20 }} />
      </ScrollView>

      <ClassFormModal
        visible={!!form}
        mode={form?.mode}
        initial={form?.initial}
        teachers={teachers}
        onClose={() => setForm(null)}
        onSaved={load}
      />
      <StudentListModal target={studentTarget} onClose={() => setStudentTarget(null)} />
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 22, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingHorizontal: 12, paddingVertical: 9, ...SHADOW.sm },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statTile: { width: '47%', flexGrow: 1, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: 12, ...SHADOW.sm },
  statLabel: { ...FONTS.small },
  statValue: { fontSize: 22, fontWeight: '800', color: COLORS.black, marginTop: 4 },
  classCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, marginBottom: 14, overflow: 'hidden', ...SHADOW.sm },
  classHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  className: { fontSize: 16, fontWeight: '800', color: COLORS.black },
  yearBadge: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  yearBadgeText: { fontSize: 11, fontWeight: '700', color: COLORS.black },
  sectionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  sectionBadge: { borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 5, minWidth: 62, alignItems: 'center' },
  sectionBadgeText: { fontSize: 12, fontWeight: '700' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: COLORS.lightBg, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  progressText: { fontSize: 10, color: COLORS.muted, marginTop: 3 },
  teacherText: { fontSize: 12, fontWeight: '600', color: COLORS.black, maxWidth: 110, textAlign: 'right' },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  studentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  modalSafe: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.white },
  modalTitle: { ...FONTS.h2, flex: 1, textAlign: 'center', fontSize: 16 },
  formLabel: { ...FONTS.small, marginBottom: 6, marginTop: 4 },
  formInput: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: COLORS.black, backgroundColor: COLORS.white, marginBottom: 14 },
  secEditRow: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, padding: 10, marginBottom: 10, backgroundColor: COLORS.white },
  addRowBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: COLORS.border, borderStyle: 'dashed', borderRadius: RADIUS.md, paddingVertical: 11, backgroundColor: COLORS.white },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...SHADOW.sm },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'center', padding: 28 },
  pickerCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 12, ...SHADOW.md },
  pickerTitle: { fontSize: 13, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 8 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderRadius: RADIUS.md },
  pickerRowText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
});

export default ClassesScreen;
