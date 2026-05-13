/**
 * IssuesScreen — report and track issues, mirrors desktop IssuesPage.
 *
 * Role behavior matches the backend:
 *   • parents/students see only their own issues
 *   • admin/teacher see everything and can mark in-progress / resolved
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { Badge, EmptyState, SectionTitle } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { useAuth } from '../contexts/AuthContext';

const CATEGORIES = ['academic', 'fee', 'transport', 'facility', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUS_FILTERS = [
  { key: '', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
];

const statusVariant = (s) => {
  if (s === 'resolved') return 'dark';
  if (s === 'in_progress') return 'warning';
  if (s === 'closed') return 'muted';
  return 'muted';
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const IssuesScreen = () => {
  const { user } = useAuth();
  const role = user?.role;
  const canManage = role === 'admin' || role === 'teacher';

  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [createVisible, setCreateVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', category: 'academic', priority: 'normal',
  });

  const [viewing, setViewing] = useState(null);
  const [resolution, setResolution] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = filterStatus ? `?status=${filterStatus}` : '';
    client.get(`/issues${params}`)
      .then(r => setIssues(Array.isArray(r.data) ? r.data : []))
      .catch(() => setIssues([]))
      .finally(() => setLoading(false));
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm({ title: '', description: '', category: 'academic', priority: 'normal' });
    setCreateVisible(true);
  };

  const submitIssue = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      Alert.alert('Missing fields', 'Title and description are required.');
      return;
    }
    setSubmitting(true);
    try {
      await client.post('/issues', form);
      setCreateVisible(false);
      load();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Could not submit issue.');
    } finally {
      setSubmitting(false);
    }
  };

  const openView = (issue) => {
    setViewing(issue);
    setResolution(issue.resolution || '');
  };
  const closeView = () => {
    setViewing(null);
    setResolution('');
  };

  const updateStatus = async (newStatus) => {
    if (!viewing) return;
    setSavingStatus(true);
    try {
      const body = { status: newStatus };
      if (newStatus === 'resolved' && resolution.trim()) {
        body.resolution = resolution.trim();
      }
      await client.put(`/issues/${viewing.issue_id}`, body);
      closeView();
      load();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Could not update issue.');
    } finally {
      setSavingStatus(false);
    }
  };

  const filtered = issues.filter(i => {
    const t = search.toLowerCase();
    return !t
      || (i.title || '').toLowerCase().includes(t)
      || (i.description || '').toLowerCase().includes(t);
  });

  if (loading) return <SafeAreaView style={s.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <View>
          <Text style={s.h1}>Issues</Text>
          <Text style={s.sub}>{issues.length} reported</Text>
        </View>
        <TouchableOpacity style={s.fab} onPress={openCreate} activeOpacity={0.85}>
          <Ionicons name="add" size={22} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      <View style={s.searchWrap}>
        <Ionicons name="search" size={16} color={COLORS.muted} style={s.searchIcon} />
        <TextInput
          style={s.searchInput}
          placeholder="Search issues..."
          placeholderTextColor={COLORS.lightMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={{ paddingHorizontal: 16 }}>
        {STATUS_FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[s.chip, filterStatus === f.key && s.chipActive]}
            onPress={() => setFilterStatus(f.key)}
          >
            <Text style={[s.chipText, filterStatus === f.key && s.chipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {filtered.length === 0 ? (
          <EmptyState icon={<Ionicons name="alert-circle-outline" size={48} color="#DDD" />} text="No issues found" />
        ) : (
          <View style={s.list}>
            {filtered.map(issue => (
              <TouchableOpacity
                key={issue.issue_id}
                style={s.card}
                onPress={() => openView(issue)}
                activeOpacity={0.7}
              >
                <View style={s.cardTopRow}>
                  <Text style={s.cardTitle} numberOfLines={2}>{issue.title}</Text>
                  <Badge text={issue.status} variant={statusVariant(issue.status)} />
                </View>
                <View style={s.badgeRow}>
                  <Badge text={issue.category} variant="muted" />
                  <Badge text={`P: ${issue.priority}`} variant={issue.priority === 'urgent' ? 'danger' : issue.priority === 'high' ? 'warning' : 'muted'} />
                </View>
                <Text style={s.cardDesc} numberOfLines={2}>{issue.description}</Text>
                <Text style={s.cardMeta}>
                  {fmtDate(issue.created_at)} · {issue.raised_by_role || 'user'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Create Issue Modal */}
      <Modal visible={createVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCreateVisible(false)}>
        <SafeAreaView style={s.modalSafe}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setCreateVisible(false)}>
              <Ionicons name="close" size={24} color={COLORS.black} />
            </TouchableOpacity>
            <Text style={s.modalTitle}>Raise Issue</Text>
            <TouchableOpacity
              onPress={submitIssue}
              disabled={submitting}
              style={[s.modalAction, submitting && s.modalActionDisabled]}
            >
              {submitting
                ? <ActivityIndicator size="small" color={COLORS.white} />
                : <Ionicons name="checkmark" size={20} color={COLORS.white} />}
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1, padding: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>TITLE</Text>
            <TextInput
              style={s.input}
              value={form.title}
              onChangeText={t => setForm(f => ({ ...f, title: t }))}
              placeholder="Brief summary"
              placeholderTextColor={COLORS.lightMuted}
            />

            <Text style={s.fieldLabel}>CATEGORY</Text>
            <View style={s.chipWrap}>
              {CATEGORIES.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[s.chip, form.category === c && s.chipActive]}
                  onPress={() => setForm(f => ({ ...f, category: c }))}
                >
                  <Text style={[s.chipText, form.category === c && s.chipTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.fieldLabel}>PRIORITY</Text>
            <View style={s.chipWrap}>
              {PRIORITIES.map(p => (
                <TouchableOpacity
                  key={p}
                  style={[s.chip, form.priority === p && s.chipActive]}
                  onPress={() => setForm(f => ({ ...f, priority: p }))}
                >
                  <Text style={[s.chipText, form.priority === p && s.chipTextActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.fieldLabel}>DESCRIPTION</Text>
            <TextInput
              style={[s.input, { minHeight: 140 }]}
              value={form.description}
              onChangeText={t => setForm(f => ({ ...f, description: t }))}
              placeholder="Details about the issue"
              placeholderTextColor={COLORS.lightMuted}
              multiline
              textAlignVertical="top"
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* View / Update Modal */}
      <Modal visible={!!viewing} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeView}>
        {viewing && (
          <SafeAreaView style={s.modalSafe}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={closeView}>
                <Ionicons name="chevron-back" size={24} color={COLORS.black} />
              </TouchableOpacity>
              <Text style={s.modalTitle}>Issue Details</Text>
              <View style={{ width: 36 }} />
            </View>

            <ScrollView style={{ flex: 1, padding: 16 }}>
              <View style={s.detailHead}>
                <Text style={s.detailTitle}>{viewing.title}</Text>
                <Badge text={viewing.status} variant={statusVariant(viewing.status)} />
              </View>
              <View style={s.badgeRow}>
                <Badge text={viewing.category} variant="muted" />
                <Badge text={`Priority: ${viewing.priority}`} variant={viewing.priority === 'urgent' ? 'danger' : viewing.priority === 'high' ? 'warning' : 'muted'} />
              </View>

              <SectionTitle>Description</SectionTitle>
              <View style={s.detailBox}>
                <Text style={s.detailText}>{viewing.description}</Text>
              </View>

              {viewing.resolution ? (
                <>
                  <SectionTitle>Resolution</SectionTitle>
                  <View style={s.resolutionBox}>
                    <Text style={s.detailText}>{viewing.resolution}</Text>
                  </View>
                </>
              ) : null}

              <Text style={s.detailMeta}>
                Issue ID: {viewing.issue_id} · {fmtDate(viewing.created_at)}
              </Text>

              {canManage && viewing.status !== 'resolved' && viewing.status !== 'closed' && (
                <View style={s.manageBox}>
                  <Text style={s.fieldLabel}>RESOLUTION NOTES</Text>
                  <TextInput
                    style={[s.input, { minHeight: 80 }]}
                    value={resolution}
                    onChangeText={setResolution}
                    placeholder="Add resolution notes..."
                    placeholderTextColor={COLORS.lightMuted}
                    multiline
                    textAlignVertical="top"
                  />
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                    {viewing.status === 'open' && (
                      <TouchableOpacity
                        style={[s.secondaryBtn, savingStatus && { opacity: 0.6 }]}
                        onPress={() => updateStatus('in_progress')}
                        disabled={savingStatus}
                      >
                        <Text style={s.secondaryBtnText}>Mark In Progress</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[s.primaryBtn, savingStatus && { opacity: 0.6 }]}
                      onPress={() => updateStatus('resolved')}
                      disabled={savingStatus}
                    >
                      {savingStatus
                        ? <ActivityIndicator size="small" color={COLORS.white} />
                        : <Text style={s.primaryBtnText}>Mark Resolved</Text>}
                    </TouchableOpacity>
                  </View>
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
  chipText: { fontSize: 12, fontWeight: '600', color: COLORS.muted, textTransform: 'capitalize' },
  chipTextActive: { color: COLORS.white },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 4 },

  list: { paddingHorizontal: 16, gap: 10 },
  card: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, padding: 14, ...SHADOW.sm,
  },
  cardTopRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6,
  },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: COLORS.black, lineHeight: 20 },
  badgeRow: { flexDirection: 'row', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  cardDesc: { fontSize: 13, color: COLORS.muted, lineHeight: 19 },
  cardMeta: { fontSize: 10, color: COLORS.lightMuted, marginTop: 8 },

  modalSafe: { flex: 1, backgroundColor: COLORS.white },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: FONTS.h2,
  modalAction: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  modalActionDisabled: { backgroundColor: COLORS.lightBg },

  fieldLabel: { ...FONTS.small, marginTop: 12 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 6,
    fontSize: 14, color: COLORS.black,
  },

  detailHead: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 12, marginBottom: 8,
  },
  detailTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: COLORS.black },
  detailBox: {
    backgroundColor: COLORS.lightBg, borderRadius: RADIUS.lg, padding: 14, marginBottom: 8,
  },
  resolutionBox: {
    backgroundColor: '#F1F5F9', borderRadius: RADIUS.lg, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  detailText: { fontSize: 13, color: COLORS.black, lineHeight: 20 },
  detailMeta: { fontSize: 11, color: COLORS.lightMuted, marginTop: 10 },

  manageBox: { marginTop: 20, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 16 },
  primaryBtn: {
    flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  secondaryBtn: {
    flex: 1, backgroundColor: COLORS.white, borderRadius: RADIUS.md,
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  secondaryBtnText: { color: COLORS.black, fontSize: 13, fontWeight: '700' },
});

export default IssuesScreen;
