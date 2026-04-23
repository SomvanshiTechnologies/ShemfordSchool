import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

  useEffect(() => {
    Promise.all([
      client.get('/students').catch(() => ({ data: [] })),
      client.get('/announcements').catch(() => ({ data: [] })),
      client.get('/attendance', { params: { entity_type: 'student' } }).catch(() => ({ data: [] })),
    ]).then(([s, a, att]) => {
      setStudentInfo(s.data[0] || null);
      setAnnouncements((a.data || []).slice(0, 3));
      setAttendance(att.data || []);
    }).finally(() => setLoading(false));
  }, []);

  const present = attendance.filter(r => r.status === 'present').length;
  const total   = attendance.length;
  const pct     = total > 0 ? Math.round(present / total * 100) : 0;
  const onTrack = pct >= 75;

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.h1}>Hi, {studentInfo?.first_name || 'Student'}</Text>
            <Text style={styles.sub}>
              Class {studentInfo?.class_name}{studentInfo?.section ? ` · ${studentInfo.section}` : ''}
            </Text>
          </View>
          <Avatar letter={studentInfo?.first_name?.charAt(0) || 'S'} bg={COLORS.primary} />
        </View>

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
          <ActionButton icon="document-text-outline" tint="blue"    title="View Marksheet" desc="Check your results"    onPress={() => navigation.navigate('Marks')} />
          <ActionButton icon="calendar-outline"      tint="emerald" title="My Attendance"  desc="Full attendance record" onPress={() => navigation.navigate('Attendance')} />
          <ActionButton icon="book-outline"          tint="cyan"    title="Syllabus"       desc="Access study materials" onPress={() => navigation.navigate('More')} />
        </ActionGrid>

        {announcements.length > 0 && (
          <>
            <SectionTitle>Announcements</SectionTitle>
            <View style={styles.list}>
              {announcements.map((a, i) => (
                <View key={i} style={[styles.listItem, i === announcements.length - 1 && { borderBottomWidth: 0 }]}>
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
