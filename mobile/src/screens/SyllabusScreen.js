/**
 * SyllabusScreen — study materials grouped by class and subject.
 * Mirrors the desktop SyllabusPage.
 *
 * Role behavior:
 *   • admin/teacher can upload new syllabus entries
 *   • parents see only their children's classes (filtered server-side too)
 *   • everyone can tap an item to view details + open file URL
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { Badge, EmptyState, SectionTitle } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { useAuth } from '../contexts/AuthContext';

const CLASS_ORDER = ['Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12'];
const sortClasses = (a, b) => {
  const ia = CLASS_ORDER.indexOf(a);
  const ib = CLASS_ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
};
const displayClassName = (c) => (['Nursery','LKG','UKG'].includes(c) ? c : `Class ${c}`);

const currentAcademicYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  // April-March academic year (Indian school convention)
  return now.getMonth() >= 3 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
};

const SyllabusScreen = () => {
  const { user } = useAuth();
  const role = user?.role;
  const canUpload = role === 'admin' || role === 'teacher';
  const isParent = role === 'parent';

  const [items, setItems] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [expanded, setExpanded] = useState({});

  const [uploadVisible, setUploadVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    class_name: '', subject: '', title: '', description: '',
    file_url: '', file_name: '', academic_year: currentAcademicYear(),
  });

  const [viewing, setViewing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = filterClass ? `?class_name=${encodeURIComponent(filterClass)}` : '';
    Promise.all([
      client.get(`/syllabus${params}`).then(r => Array.isArray(r.data) ? r.data : []).catch(() => []),
      client.get('/classes').then(r => Array.isArray(r.data) ? r.data : []).catch(() => []),
    ]).then(([syl, cls]) => {
      setItems(syl);
      setClasses(cls);
    }).finally(() => setLoading(false));
  }, [filterClass]);

  useEffect(() => { load(); }, [load]);

  const openUpload = () => {
    setForm({
      class_name: '', subject: '', title: '', description: '',
      file_url: '', file_name: '', academic_year: currentAcademicYear(),
    });
    setUploadVisible(true);
  };

  const submit = async () => {
    if (!form.class_name || !form.subject.trim() || !form.title.trim()) {
      Alert.alert('Missing fields', 'Class, subject and title are required.');
      return;
    }
    setSubmitting(true);
    try {
      await client.post('/syllabus', form);
      setUploadVisible(false);
      load();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Could not upload syllabus.');
    } finally {
      setSubmitting(false);
    }
  };

  const openLink = async (url) => {
    if (!url) return;
    try {
      const ok = await Linking.canOpenURL(url);
      if (ok) await Linking.openURL(url);
      else Alert.alert('Cannot open', 'The URL is not supported by this device.');
    } catch {
      Alert.alert('Cannot open', 'Failed to open the document.');
    }
  };

  const filtered = items.filter(item => {
    const t = search.toLowerCase();
    if (!t) return true;
    return (item.title || '').toLowerCase().includes(t)
        || (item.subject || '').toLowerCase().includes(t)
        || (item.description || '').toLowerCase().includes(t);
  });

  // group: class -> subject -> [items]
  const grouped = filtered.reduce((acc, item) => {
    const c = item.class_name;
    const sub = item.subject || 'General';
    if (!acc[c]) acc[c] = {};
    if (!acc[c][sub]) acc[c][sub] = [];
    acc[c][sub].push(item);
    return acc;
  }, {});
  const classKeys = Object.keys(grouped).sort(sortClasses);

  const isExpanded = (c) => expanded[c] !== false; // default true
  const toggle = (c) => setExpanded(p => ({ ...p, [c]: !isExpanded(c) }));

  if (loading) return <SafeAreaView style={s.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <View>
          <Text style={s.h1}>Syllabus</Text>
          <Text style={s.sub}>
            {items.length} entries{classKeys.length ? ` · ${classKeys.length} classes` : ''}
          </Text>
        </View>
        {canUpload && (
          <TouchableOpacity style={s.fab} onPress={openUpload} activeOpacity={0.85}>
            <Ionicons name="add" size={22} color={COLORS.white} />
          </TouchableOpacity>
        )}
      </View>

      {isParent && (
        <View style={s.parentNotice}>
          <Ionicons name="book-outline" size={14} color="#1E40AF" />
          <Text style={s.parentNoticeText}>Showing syllabus for your children's classes only.</Text>
        </View>
      )}

      <View style={s.searchWrap}>
        <Ionicons name="search" size={16} color={COLORS.muted} style={s.searchIcon} />
        <TextInput
          style={s.searchInput}
          placeholder="Search by title, subject..."
          placeholderTextColor={COLORS.lightMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={{ paddingHorizontal: 16 }}>
        <TouchableOpacity
          style={[s.chip, filterClass === '' && s.chipActive]}
          onPress={() => setFilterClass('')}
        >
          <Text style={[s.chipText, filterClass === '' && s.chipTextActive]}>All</Text>
        </TouchableOpacity>
        {[...classes].sort((a, b) => sortClasses(a.name, b.name)).map(c => (
          <TouchableOpacity
            key={c.name}
            style={[s.chip, filterClass === c.name && s.chipActive]}
            onPress={() => setFilterClass(c.name)}
          >
            <Text style={[s.chipText, filterClass === c.name && s.chipTextActive]}>{displayClassName(c.name)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {classKeys.length === 0 ? (
          <EmptyState icon={<Ionicons name="book-outline" size={48} color="#DDD" />} text="No syllabus found" />
        ) : (
          classKeys.map(cls => {
            const subjects = Object.keys(grouped[cls]).sort();
            const total = subjects.reduce((n, sub) => n + grouped[cls][sub].length, 0);
            const open = isExpanded(cls);
            return (
              <View key={cls} style={s.classCard}>
                <TouchableOpacity style={s.classHeader} onPress={() => toggle(cls)} activeOpacity={0.7}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={s.classIcon}>
                      <Ionicons name="school" size={16} color={COLORS.white} />
                    </View>
                    <View>
                      <Text style={s.className}>{displayClassName(cls)}</Text>
                      <Text style={s.classMeta}>{subjects.length} subjects · {total} entries</Text>
                    </View>
                  </View>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.muted} />
                </TouchableOpacity>

                {open && (
                  <View style={s.classBody}>
                    {subjects.map(sub => (
                      <View key={sub} style={{ marginBottom: 14 }}>
                        <View style={s.subjectRow}>
                          <Ionicons name="bookmark" size={12} color={COLORS.primary} />
                          <Text style={s.subjectLabel}>{sub}</Text>
                          <Text style={s.subjectCount}>{grouped[cls][sub].length} item{grouped[cls][sub].length !== 1 ? 's' : ''}</Text>
                        </View>
                        {grouped[cls][sub].map(item => (
                          <TouchableOpacity
                            key={item.syllabus_id}
                            style={s.itemCard}
                            onPress={() => setViewing(item)}
                            activeOpacity={0.7}
                          >
                            <View style={s.itemIcon}>
                              <Ionicons name="document-text" size={16} color={COLORS.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.itemTitle} numberOfLines={2}>{item.title}</Text>
                              {item.description ? (
                                <Text style={s.itemDesc} numberOfLines={1}>{item.description}</Text>
                              ) : null}
                              <View style={s.itemMetaRow}>
                                <Ionicons name="calendar-outline" size={10} color={COLORS.lightMuted} />
                                <Text style={s.itemMeta}>{item.academic_year}</Text>
                                {item.file_url ? <Badge text="PDF" variant="dark" /> : null}
                              </View>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Upload Modal */}
      <Modal visible={uploadVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setUploadVisible(false)}>
        <SafeAreaView style={s.modalSafe}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setUploadVisible(false)}>
              <Ionicons name="close" size={24} color={COLORS.black} />
            </TouchableOpacity>
            <Text style={s.modalTitle}>Upload Syllabus</Text>
            <TouchableOpacity
              onPress={submit}
              disabled={submitting}
              style={[s.modalAction, submitting && s.modalActionDisabled]}
            >
              {submitting
                ? <ActivityIndicator size="small" color={COLORS.white} />
                : <Ionicons name="checkmark" size={20} color={COLORS.white} />}
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1, padding: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>CLASS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
              {[...classes].sort((a, b) => sortClasses(a.name, b.name)).map(c => (
                <TouchableOpacity
                  key={c.name}
                  style={[s.chip, form.class_name === c.name && s.chipActive]}
                  onPress={() => setForm(f => ({ ...f, class_name: c.name }))}
                >
                  <Text style={[s.chipText, form.class_name === c.name && s.chipTextActive]}>{displayClassName(c.name)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={s.fieldLabel}>SUBJECT</Text>
            <TextInput
              style={s.input}
              value={form.subject}
              onChangeText={t => setForm(f => ({ ...f, subject: t }))}
              placeholder="e.g., Mathematics"
              placeholderTextColor={COLORS.lightMuted}
            />

            <Text style={s.fieldLabel}>TITLE</Text>
            <TextInput
              style={s.input}
              value={form.title}
              onChangeText={t => setForm(f => ({ ...f, title: t }))}
              placeholder="e.g., Chapter 1 — Number Systems"
              placeholderTextColor={COLORS.lightMuted}
            />

            <Text style={s.fieldLabel}>DESCRIPTION</Text>
            <TextInput
              style={[s.input, { minHeight: 80 }]}
              value={form.description}
              onChangeText={t => setForm(f => ({ ...f, description: t }))}
              placeholder="Topics covered..."
              placeholderTextColor={COLORS.lightMuted}
              multiline
              textAlignVertical="top"
            />

            <Text style={s.fieldLabel}>FILE URL (optional)</Text>
            <TextInput
              style={s.input}
              value={form.file_url}
              onChangeText={t => setForm(f => ({ ...f, file_url: t }))}
              placeholder="https://drive.google.com/..."
              placeholderTextColor={COLORS.lightMuted}
              autoCapitalize="none"
              keyboardType="url"
            />

            <Text style={s.fieldLabel}>ACADEMIC YEAR</Text>
            <TextInput
              style={s.input}
              value={form.academic_year}
              onChangeText={t => setForm(f => ({ ...f, academic_year: t }))}
              placeholder="2025-2026"
              placeholderTextColor={COLORS.lightMuted}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* View Detail Modal */}
      <Modal visible={!!viewing} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setViewing(null)}>
        {viewing && (
          <SafeAreaView style={s.modalSafe}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={() => setViewing(null)}>
                <Ionicons name="chevron-back" size={24} color={COLORS.black} />
              </TouchableOpacity>
              <Text style={s.modalTitle} numberOfLines={1}>{viewing.title}</Text>
              <View style={{ width: 36 }} />
            </View>
            <ScrollView style={{ flex: 1, padding: 16 }}>
              <View style={s.badgeRow}>
                <Badge text={viewing.subject || ''} variant="muted" />
                <Badge text={displayClassName(viewing.class_name)} variant="dark" />
              </View>

              {viewing.description ? (
                <>
                  <SectionTitle>Description</SectionTitle>
                  <View style={s.detailBox}>
                    <Text style={s.detailText}>{viewing.description}</Text>
                  </View>
                </>
              ) : null}

              <View style={s.gridRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.gridLabel}>CLASS</Text>
                  <Text style={s.gridValue}>{displayClassName(viewing.class_name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.gridLabel}>SUBJECT</Text>
                  <Text style={s.gridValue}>{viewing.subject}</Text>
                </View>
              </View>
              <View style={s.gridRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.gridLabel}>ACADEMIC YEAR</Text>
                  <Text style={s.gridValue}>{viewing.academic_year || '—'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.gridLabel}>FILE</Text>
                  <Text style={s.gridValue}>{viewing.file_name || (viewing.file_url ? 'Document' : '—')}</Text>
                </View>
              </View>

              {viewing.file_url ? (
                <TouchableOpacity style={s.openBtn} onPress={() => openLink(viewing.file_url)}>
                  <Ionicons name="open-outline" size={16} color={COLORS.white} />
                  <Text style={s.openBtnText}>Open Document</Text>
                </TouchableOpacity>
              ) : (
                <View style={s.noFile}>
                  <Ionicons name="document-outline" size={28} color="#DDD" />
                  <Text style={s.noFileText}>No file attached</Text>
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
  },
  h1: FONTS.h1,
  sub: { ...FONTS.caption, marginTop: 2 },

  fab: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', ...SHADOW.sm,
  },

  parentNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EFF6FF', borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10,
    marginHorizontal: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  parentNoticeText: { fontSize: 12, color: '#1E40AF', flex: 1 },

  searchWrap: { paddingHorizontal: 16, position: 'relative', marginBottom: 12 },
  searchIcon: { position: 'absolute', left: 30, top: 14, zIndex: 1 },
  searchInput: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    paddingLeft: 38, paddingRight: 16, paddingVertical: 12,
    fontSize: 14, color: COLORS.black, borderWidth: 1.5, borderColor: COLORS.border, ...SHADOW.sm,
  },

  filterRow: { flexGrow: 0, marginBottom: 12 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white, marginRight: 8,
  },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  chipTextActive: { color: COLORS.white },

  classCard: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 12, overflow: 'hidden', ...SHADOW.sm,
  },
  classHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: COLORS.lightBg,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  classIcon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.black,
    alignItems: 'center', justifyContent: 'center',
  },
  className: { fontSize: 14, fontWeight: '700', color: COLORS.black },
  classMeta: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  classBody: { padding: 14 },

  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  subjectLabel: { fontSize: 12, fontWeight: '700', color: COLORS.primary, textTransform: 'uppercase' },
  subjectCount: { fontSize: 11, color: COLORS.muted },

  itemCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: COLORS.white, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 10, marginBottom: 6,
  },
  itemIcon: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: COLORS.lightBg,
    alignItems: 'center', justifyContent: 'center',
  },
  itemTitle: { fontSize: 13, fontWeight: '600', color: COLORS.black, lineHeight: 18 },
  itemDesc: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  itemMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  itemMeta: { fontSize: 10, color: COLORS.lightMuted },

  modalSafe: { flex: 1, backgroundColor: COLORS.white },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: { ...FONTS.h2, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  modalAction: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  modalActionDisabled: { backgroundColor: COLORS.lightBg },

  fieldLabel: { ...FONTS.small, marginTop: 14 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 6,
    fontSize: 14, color: COLORS.black,
  },

  badgeRow: { flexDirection: 'row', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  detailBox: { backgroundColor: COLORS.lightBg, borderRadius: RADIUS.lg, padding: 14, marginBottom: 8 },
  detailText: { fontSize: 13, color: COLORS.black, lineHeight: 20 },

  gridRow: { flexDirection: 'row', gap: 14, marginTop: 12 },
  gridLabel: { ...FONTS.small },
  gridValue: { fontSize: 13, fontWeight: '600', color: COLORS.black, marginTop: 4 },

  openBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.black, borderRadius: RADIUS.md, paddingVertical: 14,
    marginTop: 20,
  },
  openBtnText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },

  noFile: {
    alignItems: 'center', padding: 24, marginTop: 20,
    borderRadius: RADIUS.md, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border,
  },
  noFileText: { fontSize: 12, color: COLORS.lightMuted, marginTop: 8 },
});

export default SyllabusScreen;
