import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS } from '../theme/colors';
import { Avatar, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';

const MessagesScreen = () => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/messages').then(r => setMessages(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.h1}>Messages</Text>
          <Text style={styles.sub}>{messages.length} conversations</Text>
        </View>
        {messages.length === 0 ? (
          <EmptyState icon={<Ionicons name="chatbubble-outline" size={48} color="#DDD" />} text="No messages yet" />
        ) : (
          <View style={styles.list}>
            {messages.map((m, i) => (
              <View key={i} style={styles.listItem}>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flex: 1 }}>
                  <Avatar letter={m.sender_name?.charAt(0) || 'M'} bg={COLORS.lightBg} color={COLORS.black} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }}>{m.sender_name || m.sender_id}</Text>
                    <Text style={{ fontSize: 11, color: COLORS.muted }} numberOfLines={1}>{m.content}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 10, color: COLORS.muted }}>{m.created_at?.slice(0, 10)}</Text>
              </View>
            ))}
          </View>
        )}
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
  list: { backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
});

export default MessagesScreen;
