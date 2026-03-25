import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
      const totalDue = d.data.reduce((sum, x) => sum + (x.total_due || 0), 0);
      const overdueCount = d.data.filter(x => x.months_overdue > 0).length;
      setStats({
        students: s.data.length,
        employees: e.data.length,
        totalDue,
        overdueStudents: overdueCount,
        totalCollection: f.data.total_collection || 0,
        pending: f.data.total_pending || 0,
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
          <StatCard label="Students" value={stats.students} />
          <StatCard label="Staff" value={stats.employees} />
          <StatCard label="Overdue" value={stats.overdueStudents} accent />
          <StatCard label="Pending Dues" value={`₹${Math.round(stats.totalDue / 1000)}k`} />
        </StatGrid>

        <SectionTitle>Quick Actions</SectionTitle>
        <ActionGrid>
          <ActionButton icon={<Ionicons name="calendar" size={18} color={COLORS.primary} />} label="Attendance" onPress={() => navigation.navigate('Attendance')} />
          <ActionButton icon={<Ionicons name="card" size={18} color={COLORS.primary} />} label="Fees" onPress={() => navigation.navigate('Fees')} />
          <ActionButton icon={<Ionicons name="people" size={18} color={COLORS.primary} />} label="Students" onPress={() => navigation.navigate('Students')} />
        </ActionGrid>

        <SectionTitle>Management</SectionTitle>
        <View style={styles.menuGrid}>
          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Reports')}>
            <View style={styles.menuIcon}><Ionicons name="bar-chart" size={18} color={COLORS.primary} /></View>
            <Text style={styles.menuLabel}>Reports</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('More')}>
            <View style={styles.menuIcon}><Ionicons name="notifications" size={18} color={COLORS.primary} /></View>
            <Text style={styles.menuLabel}>Notices</Text>
          </TouchableOpacity>
        </View>
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
  darkLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.muted, marginBottom: 4 },
  darkValue: { fontSize: 28, fontWeight: '800', color: COLORS.white, letterSpacing: -0.5 },
  darkSub: { fontSize: 12, color: COLORS.muted, marginTop: 4 },
  menuGrid: { flexDirection: 'row', gap: 12 },
  menuItem: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 20, borderRadius: 14, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border },
  menuIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.lightBg, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { fontSize: 11, fontWeight: '600', color: COLORS.black },
});

export default AdminDashboard;
