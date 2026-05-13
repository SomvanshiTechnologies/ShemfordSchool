/**
 * MessagesScreen — inbox + compose with hold-to-record voice notes.
 *
 * Features:
 *   • Inbox list with unread badge and voice-note indicator
 *   • Tap a message to read it; voice notes play inline
 *   • Compose modal: text message + optional hold-to-record voice note (auto-send on release)
 *   • Voice note messages show a custom audio player row
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { Avatar, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { useVoiceRecorder, VoiceNotePlayer, HoldToRecordButton } from '../components/VoiceNotePlayer';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const voiceNoteUrl = (id) => `${API_URL}/media/voice-notes/${id}`;

// ─── MessagesScreen ───────────────────────────────────────────────────────────

const MessagesScreen = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  // Compose state
  const [composeVisible, setComposeVisible] = useState(false);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);

  const voice = useVoiceRecorder();

  const load = useCallback(() => {
    client.get('/messages')
      .then(r => setMessages(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openMessage = useCallback(async (msg) => {
    setSelected(msg);
    if (!msg.is_read) {
      client.put(`/messages/${msg.message_id}/read`).then(load).catch(() => {});
    }
  }, [load]);

  const closeCompose = useCallback(() => {
    setComposeVisible(false);
    setSubject('');
    setContent('');
    voice.reset();
  }, [voice]);

  // Send typed text message (with optional pre-recorded voice note attached)
  const sendMessage = useCallback(async () => {
    if (!content.trim() && !voice.uri) {
      Alert.alert('Empty message', 'Write a message or record a voice note before sending.');
      return;
    }
    setSending(true);
    try {
      const res = await client.post('/messages', {
        recipient_type: 'all',
        subject: subject.trim() || 'Voice note',
        content: content.trim() || '🎤 Voice note',
        message_type: voice.uri ? 'voice' : 'text',
      });
      const msgId = res.data.message_id;

      if (voice.uri && msgId) {
        setUploadingVoice(true);
        try {
          const fd = new FormData();
          fd.append('file', { uri: voice.uri, name: 'voice_note.m4a', type: 'audio/m4a' });
          if (voice.durationMs) fd.append('duration_seconds', String(voice.durationMs / 1000));
          await client.post(`/messages/${msgId}/voice-note`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch {
          Alert.alert('Note', 'Message sent, but the voice note failed to upload.');
        } finally {
          setUploadingVoice(false);
        }
      }

      closeCompose();
      load();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  }, [subject, content, voice, closeCompose, load]);

  // Hold-to-record: press = start, release = stop + auto-send voice note
  const handleRecordStart = useCallback(async () => {
    return await voice.startRecording();
  }, [voice]);

  const handleRecordStop = useCallback(async () => {
    const uri = await voice.stopRecording();
    if (!uri) return;
    setSending(true);
    try {
      const res = await client.post('/messages', {
        recipient_type: 'all',
        subject: 'Voice note',
        content: '🎤 Voice note',
        message_type: 'voice',
      });
      const msgId = res.data.message_id;
      const fd = new FormData();
      fd.append('file', { uri, name: 'voice_note.m4a', type: 'audio/m4a' });
      if (voice.durationMs) fd.append('duration_seconds', String(voice.durationMs / 1000));
      await client.post(`/messages/${msgId}/voice-note`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      load();
    } catch {
      Alert.alert('Error', 'Failed to send voice note.');
    } finally {
      setSending(false);
    }
  }, [voice, load]);

  if (loading) return <SafeAreaView style={s.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.h1}>Messages</Text>
          <Text style={s.sub}>{messages.length} conversations</Text>
        </View>
        <TouchableOpacity style={s.composeBtn} onPress={() => setComposeVisible(true)} activeOpacity={0.7}>
          <Ionicons name="create-outline" size={22} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      {/* Message list */}
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {messages.length === 0 ? (
          <EmptyState icon={<Ionicons name="chatbubble-outline" size={48} color="#DDD" />} text="No messages yet" />
        ) : (
          <View style={s.list}>
            {messages.map((m) => (
              <TouchableOpacity key={m.message_id} style={s.msgRow} onPress={() => openMessage(m)} activeOpacity={0.7}>
                <Avatar letter={m.sender_name?.charAt(0) || 'M'} bg={COLORS.lightBg} color={COLORS.black} size={40} />
                <View style={s.msgBody}>
                  <View style={s.msgTop}>
                    <Text style={[s.msgSender, !m.is_read && s.unreadText]}>{m.sender_name || 'Unknown'}</Text>
                    <Text style={s.msgTime}>{fmtDate(m.created_at)}</Text>
                  </View>
                  <View style={s.msgPreviewRow}>
                    {m.voice_note_id && (
                      <Ionicons name="mic" size={12} color={COLORS.primary} style={{ marginRight: 3 }} />
                    )}
                    <Text style={s.msgPreview} numberOfLines={1}>
                      {m.voice_note_id ? 'Voice note' : m.content}
                    </Text>
                    {!m.is_read && <View style={s.unreadDot} />}
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Hold-to-record FAB (bottom-right) when not composing */}
      {!composeVisible && !selected && (
        <View style={s.fab}>
          {voice.recording && (
            <Text style={s.recTimer}>{Math.floor(voice.durationMs / 1000)}s</Text>
          )}
          <HoldToRecordButton
            onStart={handleRecordStart}
            onStop={handleRecordStop}
            disabled={sending}
          />
        </View>
      )}

      {/* Message detail modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelected(null)}
      >
        {selected && (
          <SafeAreaView style={s.detailSafe}>
            <View style={s.detailHeader}>
              <TouchableOpacity onPress={() => setSelected(null)} style={s.backBtn}>
                <Ionicons name="chevron-back" size={22} color={COLORS.black} />
              </TouchableOpacity>
              <Text style={s.detailTitle} numberOfLines={1}>{selected.subject}</Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={s.detailMeta}>
                From: {selected.sender_name} · {fmtDate(selected.created_at)}
              </Text>
              <Text style={s.detailContent}>{selected.content}</Text>
              {selected.voice_note_id && (
                <View style={s.voiceSection}>
                  <Text style={s.voiceLabel}>🎤 Voice note</Text>
                  <VoiceNotePlayer uri={voiceNoteUrl(selected.voice_note_id)} />
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>

      {/* Compose modal */}
      <Modal
        visible={composeVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeCompose}
      >
        <SafeAreaView style={s.composeSafe}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={s.composeHeader}>
              <TouchableOpacity onPress={closeCompose}>
                <Ionicons name="close" size={24} color={COLORS.black} />
              </TouchableOpacity>
              <Text style={s.composeTitle}>New Message</Text>
              <TouchableOpacity
                onPress={sendMessage}
                disabled={sending || voice.recording}
                style={[s.sendBtn, (sending || voice.recording) && s.sendBtnDisabled]}
              >
                {sending
                  ? <ActivityIndicator size="small" color={COLORS.white} />
                  : <Ionicons name="send" size={18} color={COLORS.white} />
                }
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1, padding: 16 }} keyboardShouldPersistTaps="handled">
              <View style={s.inputRow}>
                <Text style={s.inputLabel}>SUBJECT</Text>
                <TextInput
                  style={s.input}
                  value={subject}
                  onChangeText={setSubject}
                  placeholder="Message subject"
                  placeholderTextColor={COLORS.lightMuted}
                />
              </View>
              <View style={s.inputRow}>
                <Text style={s.inputLabel}>MESSAGE</Text>
                <TextInput
                  style={[s.input, { minHeight: 100 }]}
                  value={content}
                  onChangeText={setContent}
                  placeholder="Write your message…"
                  placeholderTextColor={COLORS.lightMuted}
                  multiline
                  textAlignVertical="top"
                />
              </View>

              {/* Voice note recorder in compose */}
              <View style={s.inputRow}>
                <Text style={s.inputLabel}>VOICE NOTE (hold to record)</Text>
                {voice.micError ? (
                  <Text style={s.micError}>{voice.micError}</Text>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 }}>
                  <HoldToRecordButton
                    onStart={handleRecordStart}
                    onStop={async () => { await voice.stopRecording(); }}
                    disabled={sending}
                  />
                  {voice.recording && (
                    <Text style={s.recTimer}>{Math.floor(voice.durationMs / 1000)}s</Text>
                  )}
                  {voice.uri && !voice.recording && (
                    <View style={{ flex: 1, gap: 8 }}>
                      <VoiceNotePlayer uri={voice.uri} />
                      <TouchableOpacity onPress={voice.reset} style={s.discardBtn}>
                        <Ionicons name="trash-outline" size={14} color={COLORS.danger} />
                        <Text style={s.discardText}> Discard</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                {uploadingVoice && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <ActivityIndicator size="small" color={COLORS.primary} />
                    <Text style={{ fontSize: 12, color: COLORS.muted }}>Uploading voice note…</Text>
                  </View>
                )}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

// ─── styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16,
  },
  h1: FONTS.h1,
  sub: { ...FONTS.caption, marginTop: 2 },
  composeBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
    ...SHADOW.sm,
  },

  list: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', ...SHADOW.sm,
  },
  msgRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.lightBg,
  },
  msgBody: { flex: 1 },
  msgTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  msgSender: { fontSize: 13, color: COLORS.black },
  unreadText: { fontWeight: '700' },
  msgTime: { fontSize: 10, color: COLORS.muted },
  msgPreviewRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  msgPreview: { fontSize: 12, color: COLORS.muted, flex: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.primary },

  fab: {
    position: 'absolute', right: 20, bottom: 24,
    alignItems: 'center', gap: 6,
  },
  recTimer: { fontSize: 16, fontWeight: '700', color: COLORS.danger },

  detailSafe: { flex: 1, backgroundColor: COLORS.white },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { marginRight: 12 },
  detailTitle: FONTS.h2,
  detailMeta: { fontSize: 12, color: COLORS.muted, marginBottom: 12 },
  detailContent: { fontSize: 14, color: COLORS.black, lineHeight: 22 },
  voiceSection: { marginTop: 20 },
  voiceLabel: { fontSize: 12, color: COLORS.muted, fontWeight: '600', marginBottom: 8 },

  composeSafe: { flex: 1, backgroundColor: COLORS.white },
  composeHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  composeTitle: FONTS.h2,
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.lightBg },

  inputRow: { marginBottom: 16 },
  inputLabel: FONTS.small,
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: COLORS.black, marginTop: 6,
  },
  discardBtn: { flexDirection: 'row', alignItems: 'center' },
  discardText: { fontSize: 12, color: COLORS.danger },
  micError: { fontSize: 12, color: COLORS.warning, marginTop: 4 },
});

export default MessagesScreen;
