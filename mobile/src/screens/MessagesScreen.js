/**
 * MessagesScreen — inbox/sent + compose with a recipient picker and hold-to-record voice notes.
 *
 *   • Inbox / Sent tabs, unread badge and voice-note indicator
 *   • Tap a message to read it; voice notes play inline
 *   • Compose: pick a recipient (contacts from /messages/contacts), text + optional voice note
 *   • Admin/teacher can broadcast to everyone; students/parents must pick a contact (backend enforces)
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
import { Avatar, Badge, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { useVoiceRecorder, VoiceNotePlayer, HoldToRecordButton } from '../components/VoiceNotePlayer';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';

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
const EVERYONE = { all: true, name: 'Everyone' };

const MessagesScreen = () => {
  const { user } = useAuth();
  const canBroadcast = user?.role === 'admin' || user?.role === 'teacher';

  const [tab, setTab] = useState('inbox');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  // Compose state
  const [composeVisible, setComposeVisible] = useState(false);
  const [recipient, setRecipient] = useState(canBroadcast ? EVERYONE : null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);

  const voice = useVoiceRecorder();

  const load = useCallback(() => {
    client.get('/messages', { params: tab === 'sent' ? { sent: true } : {} })
      .then(r => setMessages(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const loadContacts = useCallback(() => {
    setContactsLoading(true);
    client.get('/messages/contacts')
      .then(r => setContacts(Array.isArray(r.data) ? r.data : []))
      .catch(() => setContacts([]))
      .finally(() => setContactsLoading(false));
  }, []);

  const openCompose = () => {
    setComposeVisible(true);
    if (contacts.length === 0) loadContacts();
  };

  const openMessage = useCallback(async (msg) => {
    setSelected(msg);
    if (!msg.is_read && tab === 'inbox') {
      client.put(`/messages/${msg.message_id}/read`).then(load).catch(() => {});
    }
  }, [load, tab]);

  const closeCompose = useCallback(() => {
    setComposeVisible(false);
    setSubject('');
    setContent('');
    setRecipient(canBroadcast ? EVERYONE : null);
    voice.reset();
  }, [voice, canBroadcast]);

  const recipientPayload = () => (
    recipient?.all
      ? { recipient_type: 'all' }
      : { recipient_type: 'user', recipient_id: recipient.user_id, recipient_label: recipient.name || recipient.email }
  );

  const uploadVoice = async (msgId, uri) => {
    const fd = new FormData();
    fd.append('file', { uri, name: 'voice_note.m4a', type: 'audio/m4a' });
    if (voice.durationMs) fd.append('duration_seconds', String(voice.durationMs / 1000));
    await client.post(`/messages/${msgId}/voice-note`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  };

  // Send typed text message (with optional pre-recorded voice note attached)
  const sendMessage = useCallback(async () => {
    if (!recipient) {
      Alert.alert('Choose a recipient', 'Select who you want to send this message to.');
      return;
    }
    if (!content.trim() && !voice.uri) {
      Alert.alert('Empty message', 'Write a message or record a voice note before sending.');
      return;
    }
    setSending(true);
    try {
      const res = await client.post('/messages', {
        ...recipientPayload(),
        subject: subject.trim() || 'Voice note',
        content: content.trim() || '🎤 Voice note',
        message_type: voice.uri ? 'voice' : 'text',
      });
      const msgId = res.data.message_id;
      if (voice.uri && msgId) {
        setUploadingVoice(true);
        try { await uploadVoice(msgId, voice.uri); }
        catch { Alert.alert('Note', 'Message sent, but the voice note failed to upload.'); }
        finally { setUploadingVoice(false); }
      }
      closeCompose();
      setTab('sent');
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  }, [recipient, subject, content, voice, closeCompose]);

  // Hold-to-record FAB (broadcast roles only): press = start, release = stop + auto-send
  const handleRecordStart = useCallback(async () => voice.startRecording(), [voice]);
  const handleRecordStop = useCallback(async () => {
    const uri = await voice.stopRecording();
    if (!uri) return;
    setSending(true);
    try {
      const res = await client.post('/messages', {
        recipient_type: 'all', subject: 'Voice note', content: '🎤 Voice note', message_type: 'voice',
      });
      await uploadVoice(res.data.message_id, uri);
      setTab('sent');
    } catch {
      Alert.alert('Error', 'Failed to send voice note.');
    } finally {
      setSending(false);
    }
  }, [voice]);

  const filteredContacts = contacts.filter(c => {
    const t = contactSearch.trim().toLowerCase();
    if (!t) return true;
    return (c.name || '').toLowerCase().includes(t) || (c.email || '').toLowerCase().includes(t) || (c.role || '').toLowerCase().includes(t);
  });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <View>
          <Text style={s.h1}>Messages</Text>
          <Text style={s.sub}>{messages.length} {tab === 'sent' ? 'sent' : 'received'}</Text>
        </View>
        <TouchableOpacity style={s.composeBtn} onPress={openCompose} activeOpacity={0.7}>
          <Ionicons name="create-outline" size={22} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      <View style={s.tabs}>
        {[['inbox', 'Inbox'], ['sent', 'Sent']].map(([key, label]) => (
          <TouchableOpacity key={key} style={[s.tab, tab === key && s.tabActive]} onPress={() => setTab(key)}>
            <Text style={[s.tabText, tab === key && s.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <ScreenLoader /> : (
        <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
          {messages.length === 0 ? (
            <EmptyState icon={<Ionicons name="chatbubble-outline" size={48} color="#DDD" />} text={tab === 'sent' ? 'No sent messages' : 'No messages yet'} />
          ) : (
            <View style={s.list}>
              {messages.map((m) => {
                const who = tab === 'sent' ? (m.recipient_label || (m.recipient_type === 'all' ? 'Everyone' : m.recipient_type)) : (m.sender_name || 'Unknown');
                const unread = tab === 'inbox' && !m.is_read;
                return (
                  <TouchableOpacity key={m.message_id} style={s.msgRow} onPress={() => openMessage(m)} activeOpacity={0.7}>
                    <Avatar letter={(who || 'M').charAt(0).toUpperCase()} bg={COLORS.lightBg} color={COLORS.black} size={40} />
                    <View style={s.msgBody}>
                      <View style={s.msgTop}>
                        <Text style={[s.msgSender, unread && s.unreadText]} numberOfLines={1}>{tab === 'sent' ? `To: ${who}` : who}</Text>
                        <Text style={s.msgTime}>{fmtDate(m.created_at)}</Text>
                      </View>
                      <Text style={s.msgSubject} numberOfLines={1}>{m.subject}</Text>
                      <View style={s.msgPreviewRow}>
                        {m.voice_note_id && <Ionicons name="mic" size={12} color={COLORS.primary} style={{ marginRight: 3 }} />}
                        <Text style={s.msgPreview} numberOfLines={1}>{m.voice_note_id ? 'Voice note' : m.content}</Text>
                        {unread && <View style={s.unreadDot} />}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <View style={{ height: 80 }} />
        </ScrollView>
      )}

      {canBroadcast && !composeVisible && !selected && (
        <View style={s.fab}>
          {voice.recording && <Text style={s.recTimer}>{Math.floor(voice.durationMs / 1000)}s</Text>}
          <HoldToRecordButton onStart={handleRecordStart} onStop={handleRecordStop} disabled={sending} />
        </View>
      )}

      {/* Message detail modal */}
      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}>
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
                {tab === 'sent'
                  ? `To: ${selected.recipient_label || (selected.recipient_type === 'all' ? 'Everyone' : selected.recipient_type)}`
                  : `From: ${selected.sender_name}`} · {fmtDate(selected.created_at)}
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
      <Modal visible={composeVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeCompose}>
        <SafeAreaView style={s.composeSafe}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={s.composeHeader}>
              <TouchableOpacity onPress={closeCompose}><Ionicons name="close" size={24} color={COLORS.black} /></TouchableOpacity>
              <Text style={s.composeTitle}>New Message</Text>
              <TouchableOpacity
                onPress={sendMessage}
                disabled={sending || voice.recording}
                style={[s.sendBtn, (sending || voice.recording) && s.sendBtnDisabled]}
              >
                {sending ? <ActivityIndicator size="small" color={COLORS.white} /> : <Ionicons name="send" size={18} color={COLORS.white} />}
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1, padding: 16 }} keyboardShouldPersistTaps="handled">
              <View style={s.inputRow}>
                <Text style={s.inputLabel}>TO</Text>
                <TouchableOpacity style={s.recipientBtn} onPress={() => setPickerVisible(true)} activeOpacity={0.7}>
                  <Ionicons name={recipient?.all ? 'people-outline' : 'person-outline'} size={16} color={recipient ? COLORS.black : COLORS.lightMuted} />
                  <Text style={[s.recipientText, !recipient && { color: COLORS.lightMuted }]} numberOfLines={1}>
                    {recipient ? (recipient.all ? 'Everyone' : `${recipient.name || recipient.email}${recipient.role ? ` · ${recipient.role}` : ''}`) : 'Choose a recipient'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
                </TouchableOpacity>
              </View>
              <View style={s.inputRow}>
                <Text style={s.inputLabel}>SUBJECT</Text>
                <TextInput style={s.input} value={subject} onChangeText={setSubject} placeholder="Message subject" placeholderTextColor={COLORS.lightMuted} />
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

              <View style={s.inputRow}>
                <Text style={s.inputLabel}>VOICE NOTE (hold to record)</Text>
                {voice.micError ? <Text style={s.micError}>{voice.micError}</Text> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 }}>
                  <HoldToRecordButton onStart={handleRecordStart} onStop={async () => { await voice.stopRecording(); }} disabled={sending} />
                  {voice.recording && <Text style={s.recTimer}>{Math.floor(voice.durationMs / 1000)}s</Text>}
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

          {/* Recipient picker */}
          <Modal visible={pickerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickerVisible(false)}>
            <SafeAreaView style={s.composeSafe}>
              <View style={s.composeHeader}>
                <TouchableOpacity onPress={() => setPickerVisible(false)}><Ionicons name="close" size={24} color={COLORS.black} /></TouchableOpacity>
                <Text style={s.composeTitle}>Send to</Text>
                <View style={{ width: 36 }} />
              </View>
              <View style={{ padding: 16, paddingBottom: 8 }}>
                <TextInput
                  style={s.input}
                  value={contactSearch}
                  onChangeText={setContactSearch}
                  placeholder="Search by name, email or role"
                  placeholderTextColor={COLORS.lightMuted}
                  autoCapitalize="none"
                />
              </View>
              {contactsLoading ? <ScreenLoader /> : (
                <ScrollView style={{ flex: 1, paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled">
                  <View style={s.list}>
                    {canBroadcast && (
                      <TouchableOpacity style={s.contactRow} onPress={() => { setRecipient(EVERYONE); setPickerVisible(false); }}>
                        <Avatar letter="★" bg={COLORS.primary} size={36} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.contactName}>Everyone</Text>
                          <Text style={s.contactMeta}>Broadcast to all users</Text>
                        </View>
                      </TouchableOpacity>
                    )}
                    {filteredContacts.map(c => (
                      <TouchableOpacity key={c.user_id} style={s.contactRow} onPress={() => { setRecipient(c); setPickerVisible(false); }}>
                        <Avatar letter={(c.name || c.email || '?').charAt(0).toUpperCase()} bg={COLORS.lightBg} color={COLORS.black} size={36} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.contactName} numberOfLines={1}>{c.name || c.email}</Text>
                          <Text style={s.contactMeta} numberOfLines={1}>{c.email}</Text>
                        </View>
                        <Badge text={c.role || ''} variant="muted" />
                      </TouchableOpacity>
                    ))}
                    {filteredContacts.length === 0 && !canBroadcast && (
                      <EmptyState icon={<Ionicons name="people-outline" size={40} color="#DDD" />} text="No contacts found" />
                    )}
                  </View>
                  <View style={{ height: 30 }} />
                </ScrollView>
              )}
            </SafeAreaView>
          </Modal>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  h1: FONTS.h1,
  sub: { ...FONTS.caption, marginTop: 2 },
  composeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', ...SHADOW.sm },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  tabActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  tabText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  tabTextActive: { color: COLORS.white },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', ...SHADOW.sm },
  msgRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  msgBody: { flex: 1 },
  msgTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  msgSender: { fontSize: 13, color: COLORS.black, flex: 1 },
  unreadText: { fontWeight: '700' },
  msgTime: { fontSize: 10, color: COLORS.muted },
  msgSubject: { fontSize: 12, fontWeight: '600', color: COLORS.black, marginTop: 2 },
  msgPreviewRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  msgPreview: { fontSize: 12, color: COLORS.muted, flex: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.primary },
  fab: { position: 'absolute', right: 20, bottom: 24, alignItems: 'center', gap: 6 },
  recTimer: { fontSize: 16, fontWeight: '700', color: COLORS.danger },
  detailSafe: { flex: 1, backgroundColor: COLORS.white },
  detailHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { marginRight: 12 },
  detailTitle: { ...FONTS.h2, flex: 1 },
  detailMeta: { fontSize: 12, color: COLORS.muted, marginBottom: 12 },
  detailContent: { fontSize: 14, color: COLORS.black, lineHeight: 22 },
  voiceSection: { marginTop: 20 },
  voiceLabel: { fontSize: 12, color: COLORS.muted, fontWeight: '600', marginBottom: 8 },
  composeSafe: { flex: 1, backgroundColor: COLORS.white },
  composeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  composeTitle: FONTS.h2,
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: COLORS.lightBg },
  inputRow: { marginBottom: 16 },
  inputLabel: FONTS.small,
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: COLORS.black, marginTop: 6 },
  recipientBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 12, marginTop: 6 },
  recipientText: { flex: 1, fontSize: 14, color: COLORS.black },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  contactName: { fontSize: 13, fontWeight: '600', color: COLORS.black },
  contactMeta: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  discardBtn: { flexDirection: 'row', alignItems: 'center' },
  discardText: { fontSize: 12, color: COLORS.danger },
  micError: { fontSize: 12, color: COLORS.warning, marginTop: 4 },
});

export default MessagesScreen;
