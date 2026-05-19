/**
 * NoticesScreen — announcements list with inline voice note playback.
 *
 * Admin users see Edit and Delete actions on each notice card.
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

const NoticesScreen = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => { load(); }, [load]);

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
        <View style={s.header}>
          <Text style={s.h1}>Notices</Text>
          <Text style={s.sub}>{announcements.length} announcements</Text>
        </View>

        {announcements.length === 0 ? (
          <EmptyState
            icon={<Ionicons name="notifications-outline" size={48} color="#DDD" />}
            text="No announcements yet"
          />
        ) : (
          <View style={s.list}>
            {announcements.map((a, i) => (
              <View
                key={a.announcement_id || i}
                style={[s.card, i === announcements.length - 1 && s.cardLast]}
              >
                <View style={s.cardHeader}>
                  <Text style={s.cardTitle} numberOfLines={2}>{a.title}</Text>
                  <Badge text={a.priority || 'normal'} variant={priorityVariant(a.priority)} />
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
                  <Text style={s.cardDate}>{a.created_at?.slice(0, 10) || ''}</Text>
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
  sub: { ...FONTS.caption, marginTop: 2 },

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
