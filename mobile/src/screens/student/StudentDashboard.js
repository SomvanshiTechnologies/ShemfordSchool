import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { COLORS } from '../../theme/colors';
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
      setAnnouncements(a.data.slice(0, 3));
      setAttendance(att.data);
    }).finally(() => setLoading(false));
  }, []);

  const present = attendance.filter(r => r.status === 'present').length;
  const total = attendance.length;
  const pct = total > 0 ? Math.round(present / total * 100) : 0;

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.h1}>Hi, {studentInfo?.first_name || 'Student'}</Text>
            <Text style={styles.sub}>Class {studentInfo?.class_name}-{studentInfo?.section}</Text>
          </View>
          <Avatar letter={studentInfo?.first_name?.charAt(0) || 'S'} bg={COLORS.black} />
        </View>

        <CardDark style={{ alignItems: 'center', paddingVertical: 24 }}>
          <View style={styles.ring}>
            <Text style={styles.ringText}>{pct}%</Text>
          </View>
          <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 12 }}>Attendance — {present} of {total} days</Text>
        </CardDark>

        <StatGrid>
          <StatCard label="Present" value={present} />
          <StatCard label="Absent" value={total - present} accent />
        </StatGrid>

        <SectionTitle>Quick Access</SectionTitle>
        <ActionGrid>
          <ActionButton icon={<Ionicons name="school" size={18} color={COLORS.primary} />} label="Marks" onPress={() => navigation.navigate('Marks')} />
          <ActionButton icon={<Ionicons name="calendar" size={18} color={COLORS.primary} />} label="Attendance" onPress={() => navigation.navigate('Attendance')} />
          <ActionButton icon={<Ionicons name="notifications" size={18} color={COLORS.primary} />} label="Notices" onPress={() => navigation.navigate('Notices')} />
        </ActionGrid>

        {announcements.length > 0 && (
          <>
            <SectionTitle>Announcements</SectionTitle>
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
  ring: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  ringText: { fontSize: 18, fontWeight: '800', color: COLORS.white },
  list: { backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
});

export default StudentDashboard;
