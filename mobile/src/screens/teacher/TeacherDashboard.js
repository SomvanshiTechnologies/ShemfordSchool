import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { COLORS } from '../../theme/colors';
import { ActionButton, ActionGrid } from '../../components/ActionButton';
import { CardOrange, SectionTitle, Badge, Avatar } from '../../components/UI';
import { ScreenLoader } from '../../components/LoadingSkeleton';

const TeacherDashboard = ({ navigation }) => {
  const [classes, setClasses] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      client.get('/classes').catch(() => ({ data: [] })),
      client.get('/announcements').catch(() => ({ data: [] })),
    ]).then(([c, a]) => {
      setClasses(c.data);
      setAnnouncements(a.data.slice(0, 3));
    }).finally(() => setLoading(false));
  }, []);

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.h1}>Good Morning</Text>
            <Text style={styles.sub}>{today}</Text>
          </View>
          <Avatar letter="T" bg={COLORS.black} />
        </View>

        <CardOrange>
          <Text style={{ fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.7)' }}>TODAY'S TASKS</Text>
          <Text style={{ fontSize: 20, fontWeight: '800', color: COLORS.white, marginTop: 4 }}>Mark Attendance</Text>
          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>{classes.length} classes assigned</Text>
          <TouchableOpacity
            style={{ backgroundColor: COLORS.black, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}
            onPress={() => navigation.navigate('Attendance')}
          >
            <Ionicons name="calendar" size={14} color={COLORS.white} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.white }}>Start Now</Text>
          </TouchableOpacity>
        </CardOrange>

        <SectionTitle>Quick Actions</SectionTitle>
        <ActionGrid>
          <ActionButton icon={<Ionicons name="calendar" size={18} color={COLORS.primary} />} label="Attendance" onPress={() => navigation.navigate('Attendance')} />
          <ActionButton icon={<Ionicons name="school" size={18} color={COLORS.primary} />} label="Marks" onPress={() => navigation.navigate('Marks')} />
          <ActionButton icon={<Ionicons name="chatbubble" size={18} color={COLORS.primary} />} label="Messages" onPress={() => navigation.navigate('Messages')} />
        </ActionGrid>

        <SectionTitle>My Classes</SectionTitle>
        <View style={styles.list}>
          {classes.slice(0, 5).map(cls => (
            <View key={cls.name} style={styles.listItem}>
              <View>
                <Text style={{ fontWeight: '700', fontSize: 14, color: COLORS.black }}>{cls.display_name || cls.name}</Text>
                <Text style={{ fontSize: 12, color: COLORS.muted }}>{(cls.sections || []).length} section(s)</Text>
              </View>
              <Badge text={(cls.sections || []).map(s => typeof s === 'string' ? s : s.section_name).join(', ')} variant="muted" />
            </View>
          ))}
        </View>

        {announcements.length > 0 && (
          <>
            <SectionTitle>Recent Notices</SectionTitle>
            <View style={styles.list}>
              {announcements.map((a, i) => (
                <View key={i} style={styles.listItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }}>{a.title}</Text>
                    <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }} numberOfLines={2}>{a.content}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 24, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  list: { backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
});

export default TeacherDashboard;
