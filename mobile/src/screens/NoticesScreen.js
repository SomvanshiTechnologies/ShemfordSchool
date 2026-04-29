/**
 * NoticesScreen — announcements list with inline voice note playback.
 *
 * Each announcement card shows its text content and, if a voice note is
 * attached, a custom audio player row rendered below the text.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { Badge, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { VoiceNotePlayer } from '../components/VoiceNotePlayer';
import { API_URL } from '../config';

const priorityVariant = (p) => {
  if (p === 'urgent') return 'danger';
  if (p === 'high') return 'warning';
  return 'muted';
};

const voiceNoteUrl = (id) => `${API_URL}/media/voice-notes/${id}`;

const NoticesScreen = () => {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/announcements')
      .then(r => setAnnouncements(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

                {/* Inline voice note player — only rendered when voice_note_id is present */}
                {a.voice_note_id ? (
                  <View style={s.voiceWrap}>
                    <View style={s.voiceLabelRow}>
                      <Ionicons name="mic" size={12} color={COLORS.primary} />
                      <Text style={s.voiceLabelText}>Voice note</Text>
                    </View>
                    <VoiceNotePlayer uri={voiceNoteUrl(a.voice_note_id)} />
                  </View>
                ) : null}

                <Text style={s.cardDate}>{a.created_at?.slice(0, 10) || ''}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
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
  cardDate: { fontSize: 10, color: COLORS.lightMuted },
});

export default NoticesScreen;
