import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { COLORS, RADIUS, SHADOW } from '../../theme/colors';
import { CardDark, SectionTitle, Avatar } from '../../components/UI';
import { ScreenLoader } from '../../components/LoadingSkeleton';
import { useAuth } from '../../contexts/AuthContext';
import { useSession } from '../../contexts/SessionContext';

const rs = (n) => `Rs.${(Number(n) || 0).toLocaleString('en-IN')}`;

const StatTile = ({ label, value, accent }) => (
  <View style={styles.statTile}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={[styles.statValue, accent && { color: COLORS.primary }]}>{value}</Text>
  </View>
);

const Tile = ({ icon, label, onPress }) => (
  <TouchableOpacity style={styles.tile} onPress={onPress} activeOpacity={0.75}>
    <Ionicons name={icon} size={22} color={COLORS.primary} />
    <Text style={styles.tileLabel}>{label}</Text>
  </TouchableOpacity>
);

const AdminDashboard = ({ navigation }) => {
  const { user } = useAuth();
  const session = useSession() || {};
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      client.get('/students', { params: { app_visible: true } }).catch(() => ({ data: [] })),
      client.get('/employees').catch(() => ({ data: [] })),
      client.get('/fees/due-chart').catch(() => ({ data: [] })),
      client.get('/reports/financial').catch(() => ({ data: {} })),
    ]).then(([s, e, d, f]) => {
      const students = Array.isArray(s.data) ? s.data : (s.data?.students || []);
      const due = d.data || [];
      const totalDue = due.reduce((sum, x) => sum + (x.total_due || 0), 0);
      const overdueCount = due.filter(x => (x.months_overdue || 0) > 0).length;
      setStats({
        students:        students.length,
        employees:       (e.data || []).length,
        totalDue,
        overdueStudents: overdueCount,
        totalCollection: f.data?.total_collection || 0,
        pending:         f.data?.total_pending   || 0,
      });
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  const sessionLabel = session.viewSession
    ? `${session.viewSession}${session.viewSession === session.activeSession ? ' (current)' : ''}`
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {sessionLabel && (
          <View style={styles.sessionRow}>
            <TouchableOpacity style={styles.sessionPill} onPress={() => navigation.navigate('Settings')} activeOpacity={0.8}>
              <Ionicons name="calendar-outline" size={13} color={COLORS.black} />
              <Text style={styles.sessionPillText}>{sessionLabel}</Text>
              <Ionicons name="chevron-down" size={13} color={COLORS.muted} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
              <Ionicons name="settings-outline" size={18} color={COLORS.muted} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.header}>
          <View>
            <Text style={styles.h1}>Dashboard</Text>
            <Text style={styles.sub}>Admin Overview</Text>
          </View>
          <Avatar letter={user?.name?.charAt(0) || 'A'} bg={COLORS.primary} />
        </View>

        <CardDark>
          <Text style={styles.darkLabel}>TOTAL COLLECTION</Text>
          <Text style={styles.darkValue}>{rs(stats.totalCollection)}</Text>
          <Text style={styles.darkSub}>{rs(stats.pending)} pending</Text>
        </CardDark>

        <View style={styles.statGrid}>
          <StatTile label="STUDENTS" value={stats.students} />
          <StatTile label="STAFF" value={stats.employees} />
          <StatTile label="OVERDUE" value={stats.overdueStudents} accent />
          <StatTile label="PENDING DUES" value={`Rs.${Math.round(stats.totalDue / 1000)}k`} />
        </View>

        <SectionTitle>Quick Actions</SectionTitle>
        <View style={styles.tileRow}>
          <Tile icon="calendar-outline" label="Attendance" onPress={() => navigation.navigate('Attendance')} />
          <Tile icon="card-outline"     label="Fees"       onPress={() => navigation.navigate('Fees')} />
          <Tile icon="people-outline"   label="Students"   onPress={() => navigation.navigate('Students')} />
        </View>

        <SectionTitle>Management</SectionTitle>
        <View style={styles.tileRow}>
          <Tile icon="school-outline"        label="Marks"   onPress={() => navigation.navigate('Marks')} />
          <Tile icon="bar-chart-outline"     label="Reports" onPress={() => navigation.navigate('Reports')} />
          <Tile icon="notifications-outline" label="Notices" onPress={() => navigation.navigate('Notices')} />
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  sessionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 10,
  },
  sessionPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, ...SHADOW.sm,
  },
  sessionPillText: { fontSize: 12, fontWeight: '700', color: COLORS.black },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 26, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  darkLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.6)', marginBottom: 6 },
  darkValue: { fontSize: 30, fontWeight: '800', color: COLORS.white, letterSpacing: -0.8 },
  darkSub: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12, marginBottom: 6 },
  statTile: {
    width: '47%', flexGrow: 1, backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: 13, ...SHADOW.sm,
  },
  statLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, color: COLORS.lightMuted },
  statValue: { fontSize: 20, fontWeight: '800', color: COLORS.black, marginTop: 5 },
  tileRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  tile: {
    flex: 1, backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, alignItems: 'center',
    justifyContent: 'center', paddingVertical: 18, gap: 8, ...SHADOW.sm,
  },
  tileLabel: { fontSize: 12, fontWeight: '700', color: COLORS.black },
});

export default AdminDashboard;
