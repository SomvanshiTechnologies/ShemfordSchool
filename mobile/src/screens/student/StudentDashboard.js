import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { COLORS, RADIUS, SHADOW } from '../../theme/colors';
import { useAuth } from '../../contexts/AuthContext';
import { StatCard, StatGrid } from '../../components/StatCard';
import { ActionButton, ActionGrid } from '../../components/ActionButton';
import { CardDark, SectionTitle, Avatar } from '../../components/UI';
import { ScreenLoader } from '../../components/LoadingSkeleton';

const StudentDashboard = ({ navigation }) => {
  const { user } = useAuth();
  const [studentInfo, setStudentInfo] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => Promise.all([
    client.get('/students', { params: { app_visible: true } }).catch(() => ({ data: [] })),
    client.get('/announcements').catch(() => ({ data: [] })),
    client.get('/attendance', { params: { entity_type: 'student' } }).catch(() => ({ data: [] })),
  ]).then(([s, a, att]) => {
    const list = Array.isArray(s.data) ? s.data : (s.data?.students || []);
    setStudentInfo(list[0] || null);
    setAnnouncements((a.data || []).slice(0, 3));
    setAttendance(Array.isArray(att.data) ? att.data : []);
  }), []);

  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));
  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const present = attendance.filter(r => r.status === 'present').length;
  const total   = attendance.length;
  const pct     = total > 0 ? Math.round(present / total * 100) : 0;
  const onTrack = pct >= 75;

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.h1}>Hi, {studentInfo?.first_name || user?.name?.split(' ')[0] || 'Student'}</Text>
            <Text style={styles.sub}>
              {studentInfo ? `Class ${studentInfo.class_name}${studentInfo.section ? ` · ${studentInfo.section}` : ''}` : 'Student'}
            </Text>
          </View>
          <Avatar letter={(studentInfo?.first_name || user?.name || 'S').charAt(0)} bg={COLORS.primary} />
        </View>

        {!studentInfo && (
          <View style={[styles.banner, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
            <Ionicons name="alert-circle-outline" size={18} color={COLORS.warning} />
            <Text style={[styles.bannerText, { color: '#92400E' }]}>
              Your login isn't linked to a student record yet. Please contact the school office.
            </Text>
          </View>
        )}

        {studentInfo?.app_locked && (
          <View style={[styles.banner, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
            <Ionicons name="lock-closed-outline" size={18} color={COLORS.danger} />
            <Text style={[styles.bannerText, { color: '#991B1B' }]}>
              Some features are restricted because of pending fees. Please contact the school office.
            </Text>
          </View>
        )}

        {studentInfo && (
          <View style={styles.infoCard}>
            {[
              ['Admission No', studentInfo.admission_number],
              ['Roll No', studentInfo.roll_number],
              ['Section', studentInfo.section],
              ['Academic Year', studentInfo.academic_year],
            ].map(([k, v]) => (
              <View key={k} style={styles.infoCell}>
                <Text style={styles.infoK}>{k}</Text>
                <Text style={styles.infoV} numberOfLines={1}>{v || '-'}</Text>
              </View>
            ))}
          </View>
        )}

        <CardDark style={{ alignItems: 'center', paddingVertical: 28 }}>
          <View style={[styles.ring, { borderColor: onTrack ? COLORS.success : COLORS.primary }]}>
            <Text style={styles.ringText}>{pct}%</Text>
          </View>
          <Text style={styles.darkLabel}>Attendance · {present} of {total} days</Text>
          <View style={[styles.pill, { backgroundColor: onTrack ? 'rgba(16,185,129,0.15)' : 'rgba(232,138,26,0.18)' }]}>
            <Text style={[styles.pillText, { color: onTrack ? '#34D399' : '#FCD34D' }]}>
              {onTrack ? 'On Track' : 'Below 75%'}
            </Text>
          </View>
        </CardDark>

        <StatGrid>
          <StatCard label="Present" value={present}         icon="checkmark-circle" tint="emerald" />
          <StatCard label="Absent"  value={total - present} icon="close-circle"      tint="red" />
        </StatGrid>

        <SectionTitle>Quick Access</SectionTitle>
        <ActionGrid>
          <ActionButton icon="calendar-outline"      tint="emerald" title="My Attendance" desc="Monthly record"       onPress={() => navigation.navigate('Attendance')} />
          <ActionButton icon="school-outline"        tint="blue"    title="My Marks"      desc="Exams & marksheet"    onPress={() => navigation.navigate('Marks')} />
          <ActionButton icon="card-outline"          tint="orange"  title="My Fees"       desc="Dues & payments"      onPress={() => navigation.navigate('Fees')} />
          <ActionButton icon="book-outline"          tint="cyan"    title="Syllabus"      desc="Study materials"      onPress={() => navigation.navigate('Syllabus')} />
          <ActionButton icon="notifications-outline" tint="amber"   title="Announcements" desc="School notices"       onPress={() => navigation.navigate('Notices')} />
          <ActionButton icon="chatbubble-outline"    tint="violet"  title="Messages"      desc="Contact teachers"     onPress={() => navigation.navigate('Messages')} />
          <ActionButton icon="alert-circle-outline"  tint="red"     title="Issues"        desc="Report a concern"     onPress={() => navigation.navigate('Issues')} />
          <ActionButton icon="settings-outline"      tint="slate"   title="Settings"      desc="Profile & password"   onPress={() => navigation.navigate('Settings')} />
        </ActionGrid>

        {announcements.length > 0 && (
          <>
            <SectionTitle>Announcements</SectionTitle>
            <View style={styles.list}>
              {announcements.map((a, i) => (
                <View key={a.announcement_id || i} style={[styles.listItem, i === announcements.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={styles.noticeTitle}>{a.title}</Text>
                  <Text style={styles.noticeBody} numberOfLines={2}>{a.content}</Text>
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
  h1: { fontSize: 26, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: RADIUS.lg, padding: 12, marginBottom: 12 },
  bannerText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  infoCard: {
    flexDirection: 'row', flexWrap: 'wrap', backgroundColor: COLORS.white, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 16, rowGap: 12, ...SHADOW.sm,
  },
  infoCell: { width: '50%' },
  infoK: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, color: COLORS.lightMuted },
  infoV: { fontSize: 14, fontWeight: '700', color: COLORS.black, marginTop: 2 },
  ring: { width: 96, height: 96, borderRadius: 48, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  ringText: { fontSize: 22, fontWeight: '800', color: COLORS.white, letterSpacing: -0.5 },
  darkLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 14 },
  pill: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  list: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, ...SHADOW.sm,
  },
  listItem: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  noticeTitle: { fontWeight: '700', fontSize: 14, color: COLORS.black },
  noticeBody:  { fontSize: 12, color: COLORS.muted, marginTop: 4, lineHeight: 17 },
});

export default StudentDashboard;
