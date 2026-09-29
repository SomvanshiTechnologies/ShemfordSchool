import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, RefreshControl, Modal, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { Avatar, Badge, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { useAuth } from '../contexts/AuthContext';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active Only' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All Students' },
];

// Bottom-sheet option picker used by all three filter chips.
const OptionPicker = ({ visible, title, options, selected, onSelect, onClose }) => (
  <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={styles.modalOverlay}>
      <TouchableOpacity style={styles.modalBg} onPress={onClose} />
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <Text style={styles.modalTitle}>{title}</Text>
        <ScrollView style={{ maxHeight: 380 }}>
          {options.map(opt => (
            <TouchableOpacity
              key={opt.value ?? '__all__'}
              style={styles.optionRow}
              onPress={() => { onSelect(opt.value); onClose(); }}
            >
              <Text style={[styles.optionText, selected === opt.value && { color: COLORS.primary, fontWeight: '800' }]}>
                {opt.label}
              </Text>
              {selected === opt.value && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  </Modal>
);

const StudentsScreen = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState(null);   // null = all classes
  const [sectionFilter, setSectionFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('active');
  const [picker, setPicker] = useState(null); // 'class' | 'section' | 'status' | null
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    const params = { app_visible: true, status: statusFilter };
    if (classFilter) params.class_name = classFilter;
    if (sectionFilter) params.section = sectionFilter;
    return client.get('/students', { params })
      .then(r => setStudents(Array.isArray(r.data) ? r.data : (r.data?.students || [])))
      .catch(() => {});
  }, [classFilter, sectionFilter, statusFilter]);

  useEffect(() => {
    client.get('/classes')
      .then(r => setClasses(Array.isArray(r.data) ? r.data : []))
      .catch(() => setClasses([]));
  }, []);

  // Tabs stay mounted, so refetch whenever this tab regains focus — otherwise
  // visibility changes made on the web dashboard don't show until app restart.
  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const filtered = students.filter(s =>
    `${s.first_name} ${s.last_name} ${s.admission_number}`.toLowerCase().includes(search.toLowerCase())
  );

  const selectedClass = classes.find(c => c.name === classFilter);
  const sectionOptions = [
    { value: null, label: 'All Sections' },
    ...((selectedClass?.sections || []).map(sn => ({ value: sn.section_name, label: sn.section_name }))),
  ];
  const classOptions = [
    { value: null, label: 'All Classes' },
    ...classes.map(c => ({ value: c.name, label: c.name })),
  ];
  const statusLabel = STATUS_OPTIONS.find(o => o.value === statusFilter)?.label || 'Active Only';

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={styles.h1}>Students</Text>
              <Text style={styles.sub}>{students.length} enrolled</Text>
            </View>
            {isAdmin && (
              <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('NewAdmission')}>
                <Ionicons name="add" size={16} color={COLORS.white} />
                <Text style={styles.newBtnText}>New Admission</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={COLORS.muted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or admission number..."
            placeholderTextColor={COLORS.lightMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
          <TouchableOpacity style={[styles.filterChip, classFilter && styles.filterChipActive]} onPress={() => setPicker('class')}>
            <Ionicons name="funnel-outline" size={13} color={classFilter ? COLORS.white : COLORS.muted} />
            <Text style={[styles.filterChipText, classFilter && styles.filterChipTextActive]}>{classFilter || 'All Classes'}</Text>
            <Ionicons name="chevron-down" size={13} color={classFilter ? COLORS.white : COLORS.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, sectionFilter && styles.filterChipActive, !classFilter && { opacity: 0.5 }]}
            onPress={() => classFilter && setPicker('section')}
            disabled={!classFilter}
          >
            <Text style={[styles.filterChipText, sectionFilter && styles.filterChipTextActive]}>{sectionFilter || 'All Sections'}</Text>
            <Ionicons name="chevron-down" size={13} color={sectionFilter ? COLORS.white : COLORS.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.filterChip, statusFilter !== 'active' && styles.filterChipActive]} onPress={() => setPicker('status')}>
            <Text style={[styles.filterChipText, statusFilter !== 'active' && styles.filterChipTextActive]}>{statusLabel}</Text>
            <Ionicons name="chevron-down" size={13} color={statusFilter !== 'active' ? COLORS.white : COLORS.muted} />
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.list}>
          {filtered.map(s => (
            <TouchableOpacity
              key={s.student_id}
              style={styles.listItem}
              activeOpacity={0.6}
              onPress={() => navigation.navigate('StudentDetail', { student: s })}
            >
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flex: 1 }}>
                <Avatar letter={s.first_name?.charAt(0)} bg={COLORS.lightBg} color={COLORS.black} size={36} />
                <View>
                  <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }}>{s.first_name} {s.last_name}</Text>
                  <Text style={{ fontSize: 11, color: COLORS.muted }}>{s.class_name}-{s.section} | {s.admission_number}</Text>
                </View>
              </View>
              <Badge text={s.fee_status || 'pending'} variant={s.fee_status === 'paid' ? 'dark' : s.fee_status === 'overdue' ? 'orange' : 'muted'} />
              <Ionicons name="chevron-forward" size={16} color={COLORS.lightMuted} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          ))}
          {filtered.length === 0 && <EmptyState icon={<Ionicons name="people-outline" size={48} color="#DDD" />} text="No students found" />}
        </View>
      </ScrollView>

      <OptionPicker
        visible={picker === 'class'}
        title="Filter by class"
        options={classOptions}
        selected={classFilter}
        onSelect={(v) => { setClassFilter(v); setSectionFilter(null); }}
        onClose={() => setPicker(null)}
      />
      <OptionPicker
        visible={picker === 'section'}
        title={`Sections — ${classFilter || ''}`}
        options={sectionOptions}
        selected={sectionFilter}
        onSelect={setSectionFilter}
        onClose={() => setPicker(null)}
      />
      <OptionPicker
        visible={picker === 'status'}
        title="Student status"
        options={STATUS_OPTIONS}
        selected={statusFilter}
        onSelect={setStatusFilter}
        onClose={() => setPicker(null)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 24, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.lg,
    paddingHorizontal: 12, paddingVertical: 10, ...SHADOW.sm,
  },
  newBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.white },
  searchWrap: { position: 'relative', marginBottom: 12 },
  searchIcon: { position: 'absolute', left: 14, top: 14, zIndex: 1 },
  searchInput: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, paddingLeft: 38, paddingRight: 16, paddingVertical: 12, fontSize: 14, color: COLORS.black, borderWidth: 1.5, borderColor: COLORS.border, ...SHADOW.sm },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white,
  },
  filterChipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  filterChipText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  filterChipTextActive: { color: COLORS.white },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, ...SHADOW.sm },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  modalSheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, ...SHADOW.md },
  modalHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontWeight: '800', fontSize: 16, color: COLORS.black, marginBottom: 12 },
  optionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  optionText: { fontSize: 14, color: COLORS.black, fontWeight: '600' },
});

export default StudentsScreen;
