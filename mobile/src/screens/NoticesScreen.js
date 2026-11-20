/**
 * NoticesScreen — announcements list with inline voice note playback.
 *
 * Admin users see Edit and Delete actions on each notice card.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { Badge, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { VoiceNotePlayer } from '../components/VoiceNotePlayer';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';

const priorityVariant = (p) => {
  if (p === 'urgent') return 'danger';
  if (p === 'high') return 'warning';
  return 'muted';
};

const voiceNoteUrl = (id) => `${API_URL}/media/voice-notes/${id}`;

const CATEGORIES = [
  { key: 'general',   label: 'General' },
  { key: 'homework',  label: 'Homework' },
  { key: 'classwork', label: 'Classwork' },
];

const fmtPosted = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso.slice(0, 10);
  return `Posted on ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
};

const targetLabel = (a) => {
  if (!a.target_type || a.target_type === 'all') return 'Everyone';
  if (a.target_value) return `${a.target_type}: ${a.target_value}`;
  return a.target_type;
};

const NoticesScreen = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Same as the web: admins and teachers can post notices.
  const canPost = isAdmin || user?.role === 'teacher';

  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('general');
  const [search, setSearch] = useState('');

  const categories = isAdmin ? [...CATEGORIES, { key: 'employees', label: 'Employees' }] : CATEGORIES;
  const countFor = (key) => announcements.filter(a => (a.announcement_type || 'general') === key).length;
  const visible = announcements.filter(a => {
    if ((a.announcement_type || 'general') !== category) return false;
    const t = search.trim().toLowerCase();
    if (!t) return true;
    return (a.title || '').toLowerCase().includes(t) || (a.content || '').toLowerCase().includes(t);
  });

  // Edit modal state
  const [editing, setEditing] = useState(null); // the announcement being edited
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editPriority, setEditPriority] = useState('normal');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    client.get('/announcements')
      .then(r => setAnnouncements(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAnnouncements([]))
      .finally(() => setLoading(false));
  }, []);

  // Reload on focus so a notice posted from the composer shows straight away.
  useFocusEffect(load);

  const openEdit = useCallback((a) => {
    setEditing(a);
    setEditTitle(a.title || '');
    setEditContent(a.content || '');
    setEditPriority(a.priority || 'normal');
  }, []);

  const closeEdit = useCallback(() => {
    setEditing(null);
    setEditTitle('');
    setEditContent('');
    setEditPriority('normal');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    if (!editTitle.trim() || !editContent.trim()) {
      Alert.alert('Missing fields', 'Title and content are required.');
      return;
    }
    setSaving(true);
    try {
      await client.put(`/announcements/${editing.announcement_id}`, {
        title: editTitle.trim(),
        content: editContent.trim(),
        priority: editPriority,
      });
      closeEdit();
      load();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to update notice.');
    } finally {
      setSaving(false);
    }
  }, [editing, editTitle, editContent, editPriority, closeEdit, load]);

  const confirmDelete = useCallback((a) => {
    Alert.alert(
      'Delete notice?',
      `"${a.title}" will be removed for everyone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await client.delete(`/announcements/${a.announcement_id}`);
              load();
            } catch (e) {
              Alert.alert('Error', e.response?.data?.detail || 'Failed to delete notice.');
            }
          },
        },
      ],
    );
  }, [load]);

  if (loading) return <SafeAreaView style={s.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={[s.header, { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.h1}>Announcements</Text>
            <Text style={s.sub}>School-wide notifications and updates</Text>
          </View>
          {canPost && (
            <TouchableOpacity style={s.newBtn} onPress={() => navigation.navigate('NoticeCompose', { category })}>
              <Ionicons name="add" size={16} color={COLORS.white} />
              <Text style={s.newBtnText}>New</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={s.tabs}>
          {categories.map(c => {
            const active = category === c.key;
            return (
              <TouchableOpacity key={c.key} style={[s.tab, active && s.tabActive]} onPress={() => setCategory(c.key)}>
                <Text style={[s.tabText, active && s.tabTextActive]}>{c.label}</Text>
                <Text style={[s.tabCount, active && s.tabCountActive]}>({countFor(c.key)})</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={s.searchWrap}>
          <Ionicons name="search" size={16} color={COLORS.muted} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search announcements..."
            placeholderTextColor={COLORS.lightMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {visible.length === 0 ? (
          <EmptyState
            icon={<Ionicons name="notifications-outline" size={48} color="#DDD" />}
            text={search ? 'No announcements match your search' : `No ${categories.find(c => c.key === category)?.label.toLowerCase()} announcements yet`}
          />
        ) : (
          <View style={s.list}>
            {visible.map((a, i) => (
              <View
                key={a.announcement_id || i}
                style={[s.card, i === visible.length - 1 && s.cardLast]}
              >
                <View style={s.cardHeader}>
                  <Text style={s.cardTitle} numberOfLines={2}>{a.title}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Badge text={a.priority || 'normal'} variant={priorityVariant(a.priority)} />
                    <Badge text={targetLabel(a)} variant="muted" />
                  </View>
                </View>

                <Text style={s.cardContent}>{a.content}</Text>

                {a.voice_note_id ? (
                  <View style={s.voiceWrap}>
                    <View style={s.voiceLabelRow}>
                      <Ionicons name="mic" size={12} color={COLORS.primary} />
                      <Text style={s.voiceLabelText}>Voice note</Text>
                    </View>
                    <VoiceNotePlayer uri={voiceNoteUrl(a.voice_note_id)} />
                  </View>
                ) : null}

                <View style={s.cardFooter}>
                  <Text style={s.cardDate}>{fmtPosted(a.created_at)}</Text>
                  {isAdmin && (
                    <View style={s.adminActions}>
                      <TouchableOpacity
                        onPress={() => openEdit(a)}
                        style={s.actionBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="pencil" size={16} color={COLORS.black} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => confirmDelete(a)}
                        style={s.actionBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="trash" size={16} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Edit modal */}
      <Modal
        visible={!!editing}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeEdit}
      >
        <SafeAreaView style={s.modalSafe}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={closeEdit}>
              <Ionicons name="close" size={24} color={COLORS.black} />
            </TouchableOpacity>
            <Text style={s.modalTitle}>Edit Notice</Text>
            <TouchableOpacity
              onPress={saveEdit}
              disabled={saving}
              style={[s.saveBtn, saving && s.saveBtnDisabled]}
            >
              {saving
                ? <ActivityIndicator size="small" color={COLORS.white} />
                : <Ionicons name="checkmark" size={20} color={COLORS.white} />
              }
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1, padding: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>TITLE</Text>
            <TextInput
              style={s.input}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Notice title"
              placeholderTextColor={COLORS.lightMuted}
            />

            <Text style={s.fieldLabel}>CONTENT</Text>
            <TextInput
              style={[s.input, { minHeight: 140 }]}
              value={editContent}
              onChangeText={setEditContent}
              placeholder="Notice body"
              placeholderTextColor={COLORS.lightMuted}
              multiline
              textAlignVertical="top"
            />

            <Text style={s.fieldLabel}>PRIORITY</Text>
            <View style={s.priorityRow}>
              {['normal', 'high', 'urgent'].map(p => (
                <TouchableOpacity
                  key={p}
                  style={[s.priorityChip, editPriority === p && s.priorityChipActive]}
                  onPress={() => setEditPriority(p)}
                >
                  <Text style={[s.priorityChipText, editPriority === p && s.priorityChipTextActive]}>
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 16 },
  h1: FONTS.h1,
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingHorizontal: 12, paddingVertical: 9, ...SHADOW.sm },
  newBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.white },
  sub: { ...FONTS.caption, marginTop: 2 },

  tabs: {
    flexDirection: 'row', backgroundColor: COLORS.lightBg, borderRadius: RADIUS.lg,
    padding: 4, marginBottom: 12, gap: 4,
  },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 9, borderRadius: RADIUS.md },
  tabActive: { backgroundColor: COLORS.white, ...SHADOW.sm },
  tabText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  tabTextActive: { color: COLORS.black, fontWeight: '700' },
  tabCount: { fontSize: 11, color: COLORS.lightMuted },
  tabCountActive: { color: COLORS.muted },
  searchWrap: { position: 'relative', marginBottom: 14 },
  searchIcon: { position: 'absolute', left: 14, top: 14, zIndex: 1 },
  searchInput: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg, paddingLeft: 38, paddingRight: 16, paddingVertical: 12,
    fontSize: 14, color: COLORS.black, borderWidth: 1.5, borderColor: COLORS.border, ...SHADOW.sm,
  },

  list: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden',
    marginBottom: 16, ...SHADOW.sm,
  },
  card: {
    paddingVertical: 16, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.lightBg,
  },
  cardLast: { borderBottomWidth: 0 },
  cardHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', gap: 8, marginBottom: 6,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: COLORS.black, flex: 1, lineHeight: 20 },
  cardContent: { fontSize: 13, color: COLORS.muted, lineHeight: 19, marginBottom: 8 },
  voiceWrap: { marginTop: 4, marginBottom: 8 },
  voiceLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  voiceLabelText: { fontSize: 11, color: COLORS.primary, fontWeight: '600' },

  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 4,
  },
  cardDate: { fontSize: 10, color: COLORS.lightMuted },
  adminActions: { flexDirection: 'row', gap: 12 },
  actionBtn: { padding: 4 },

  modalSafe: { flex: 1, backgroundColor: COLORS.white },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: { ...FONTS.h2 },
  saveBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  saveBtnDisabled: { backgroundColor: COLORS.lightBg },

  fieldLabel: { ...FONTS.small, marginTop: 8 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 6, marginBottom: 4,
    fontSize: 14, color: COLORS.black,
  },
  priorityRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  priorityChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white,
  },
  priorityChipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  priorityChipText: { fontSize: 13, fontWeight: '600', color: COLORS.muted, textTransform: 'capitalize' },
  priorityChipTextActive: { color: COLORS.white },
});

export default NoticesScreen;
