import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import client from '../../api/client';
import { COLORS } from '../../theme/colors';
import { StatCard, StatGrid } from '../../components/StatCard';
import { ActionButton, ActionGrid } from '../../components/ActionButton';
import { CardDark, SectionTitle, Avatar } from '../../components/UI';
import { ScreenLoader } from '../../components/LoadingSkeleton';

const AdminDashboard = ({ navigation }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      client.get('/students').catch(() => ({ data: [] })),
      client.get('/employees').catch(() => ({ data: [] })),
      client.get('/fees/due-chart').catch(() => ({ data: [] })),
      client.get('/reports/financial').catch(() => ({ data: {} })),
    ]).then(([s, e, d, f]) => {
      const due = d.data || [];
      const totalDue = due.reduce((sum, x) => sum + (x.total_due || 0), 0);
      const overdueCount = due.filter(x => (x.months_overdue || 0) > 0).length;
      setStats({
        students:        (s.data || []).length,
        employees:       (e.data || []).length,
        totalDue,
        overdueStudents: overdueCount,
        totalCollection: f.data?.total_collection || 0,
        pending:         f.data?.total_pending   || 0,
      });
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.h1}>Dashboard</Text>
            <Text style={styles.sub}>Admin Overview</Text>
          </View>
          <Avatar letter="A" bg={COLORS.primary} />
        </View>

        <CardDark>
          <Text style={styles.darkLabel}>TOTAL COLLECTION</Text>
          <Text style={styles.darkValue}>₹{(stats.totalCollection || 0).toLocaleString()}</Text>
          <Text style={styles.darkSub}>₹{(stats.pending || 0).toLocaleString()} pending</Text>
        </CardDark>

        <StatGrid>
          <StatCard label="Students"     value={stats.students}        icon="school"        tint="blue" />
          <StatCard label="Staff"        value={stats.employees}       icon="people"        tint="violet" />
          <StatCard label="Overdue"      value={stats.overdueStudents} icon="alert-circle" tint="red" />
          <StatCard label="Pending Dues" value={`₹${Math.round(stats.totalDue / 1000)}k`} icon="cash" tint="orange" />
        </StatGrid>

        <SectionTitle>Quick Actions</SectionTitle>
        <ActionGrid>
          <ActionButton icon="calendar-outline" tint="emerald" title="Mark Attendance" desc="Today's attendance" onPress={() => navigation.navigate('Attendance')} />
          <ActionButton icon="card-outline"     tint="orange"  title="Collect Fees"    desc="Record payments"    onPress={() => navigation.navigate('Fees')} />
          <ActionButton icon="people-outline"   tint="blue"    title="Students"        desc="Manage admissions"  onPress={() => navigation.navigate('Students')} />
        </ActionGrid>

        <SectionTitle>Management</SectionTitle>
        <ActionGrid>
          <ActionButton icon="bar-chart-outline"    tint="purple" title="Reports"       desc="Analytics & exports"      onPress={() => navigation.navigate('Reports')} />
          <ActionButton icon="notifications-outline" tint="amber"  title="Notices"       desc="Announcements"            onPress={() => navigation.navigate('Notices')} />
          <ActionButton icon="ellipsis-horizontal"  tint="slate"  title="More"          desc="Messages, marks, settings" onPress={() => navigation.navigate('More')} />
        </ActionGrid>

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
  darkLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.6)', marginBottom: 6 },
  darkValue: { fontSize: 30, fontWeight: '800', color: COLORS.white, letterSpacing: -0.8 },
  darkSub: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
});

export default AdminDashboard;
