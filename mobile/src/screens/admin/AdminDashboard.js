import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { COLORS, RADIUS, SHADOW } from '../../theme/colors';
import { CardDark, SectionTitle, Avatar } from '../../components/UI';
import { ScreenLoader } from '../../components/LoadingSkeleton';
import { useAuth } from '../../contexts/AuthContext';
import { useSession } from '../../contexts/SessionContext';

const rs = (n) => `Rs.${(Number(n) || 0).toLocaleString('en-IN')}`;

const StatTile = ({ label, value, accent, onPress }) => (
  <TouchableOpacity style={styles.statTile} onPress={onPress} disabled={!onPress} activeOpacity={0.75}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={[styles.statValue, accent && { color: COLORS.primary }]}>{value}</Text>
  </TouchableOpacity>
);

// Same wording as the web dashboard's Recent Activity widget.
const ACTION_LABELS = { create: 'created', update: 'updated', delete: 'deleted', insert: 'added', deactivate: 'removed', reactivate: 'reactivated' };
const activityText = (log) => {
  const actor = log.performed_by_name || (log.performed_by ? `${String(log.performed_by).slice(0, 8)}…` : 'System');
  const verb = ACTION_LABELS[log.action?.toLowerCase()] || (log.action ? log.action.replace(/_/g, ' ') : 'modified');
  const entity = log.entity_type ? log.entity_type.replace(/_/g, ' ') : 'record';
  return { actor, verb, entity };
};
const activityTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

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
  const [alerts, setAlerts] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Same sources as the web dashboard: server-side counts (not paged lists),
  // the financial summary, students below 75% attendance and the latest
  // audit-log entries. All are scoped to the academic year being viewed.
  const load = useCallback(() => Promise.all([
    client.get('/reports/dashboard').catch(() => ({ data: {} })),
    client.get('/reports/financial').catch(() => ({ data: {} })),
    client.get('/attendance/alerts', { params: { threshold: 75 } }).catch(() => ({ data: null })),
    client.get('/audit-logs', { params: { limit: 5 } }).catch(() => ({ data: [] })),
  ]).then(([d, f, a, l]) => {
    const st = d.data || {};
    setStats({
      students:        st.total_students || 0,
      employees:       st.total_employees || 0,
      overdueStudents: st.fee_overdue_count || 0,
      openIssues:      st.open_issues || 0,
      presentToday:    st.today_present || 0,
      totalCollection: f.data?.total_collection || 0,
      pending:         f.data?.total_pending || 0,
    });
    setAlerts(a.data || null);
    setActivity(Array.isArray(l.data) ? l.data : []);
  }), []);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load, session.viewSession]);

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  const sessionLabel = session.viewSession
    ? `${session.viewSession}${session.viewSession === session.activeSession ? ' (current)' : ''}`
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
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
          <StatTile label="STUDENTS" value={stats.students} onPress={() => navigation.navigate('Students')} />
          <StatTile label="STAFF" value={stats.employees} onPress={() => navigation.navigate('Employees')} />
          <StatTile label="PRESENT TODAY" value={stats.presentToday} onPress={() => navigation.navigate('Attendance')} />
          <StatTile label="FEE OVERDUE" value={stats.overdueStudents} accent onPress={() => navigation.navigate('Fees')} />
          <StatTile label="OPEN ISSUES" value={stats.openIssues} accent={stats.openIssues > 0} onPress={() => navigation.navigate('Issues')} />
          <StatTile label="PENDING DUES" value={`Rs.${Math.round(stats.pending / 1000)}k`} onPress={() => navigation.navigate('Fees')} />
        </View>

        {alerts && (
          <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={() => navigation.navigate('AttendanceAlerts')}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Attendance Alerts</Text>
                <Text style={styles.cardSub}>{alerts.total_flagged || 0} student{alerts.total_flagged === 1 ? '' : 's'} below 75%</Text>
              </View>
              <Ionicons name="warning-outline" size={20} color={alerts.total_flagged ? COLORS.warning : COLORS.success} />
            </View>
            {(alerts.alerts || []).slice(0, 3).map(a => (
              <View key={a.student_id} style={styles.alertRow}>
                <Text style={styles.alertName} numberOfLines={1}>{a.student_name}</Text>
                <Text style={[styles.alertPct, { color: a.attendance_percentage < 60 ? COLORS.danger : COLORS.warning }]}>{Math.round(a.attendance_percentage)}%</Text>
              </View>
            ))}
            {(alerts.total_flagged || 0) > 3 && <Text style={styles.more}>View {alerts.total_flagged - 3} more</Text>}
          </TouchableOpacity>
        )}

        {activity.length > 0 && (
          <>
            <View style={styles.sectionRow}>
              <SectionTitle>Recent Activity</SectionTitle>
              <TouchableOpacity onPress={() => navigation.navigate('AuditTrail')}><Text style={styles.more}>View all</Text></TouchableOpacity>
            </View>
            <View style={styles.activityList}>
              {activity.map((log, i) => {
                const { actor, verb, entity } = activityText(log);
                return (
                  <View key={log.log_id || i} style={[styles.activityRow, i === activity.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={styles.activityIcon}><Ionicons name="pulse-outline" size={15} color={COLORS.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activityText}>
                        <Text style={{ fontWeight: '700', color: COLORS.black }}>{actor}</Text> {verb} <Text style={{ textTransform: 'capitalize', color: COLORS.black }}>{entity}</Text>
                      </Text>
                      <Text style={styles.activityTime}>{activityTime(log.created_at)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}

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
  card: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border,
    padding: 14, marginTop: 6, marginBottom: 6, ...SHADOW.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: COLORS.black },
  cardSub: { fontSize: 12, color: COLORS.muted, marginTop: 1 },
  alertRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, borderTopWidth: 1, borderTopColor: COLORS.lightBg },
  alertName: { flex: 1, fontSize: 13, color: COLORS.black, marginRight: 10 },
  alertPct: { fontSize: 12, fontWeight: '800' },
  more: { fontSize: 12, fontWeight: '700', color: COLORS.primary, marginTop: 6 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activityList: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: 6, overflow: 'hidden', ...SHADOW.sm },
  activityRow: { flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  activityIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  activityText: { fontSize: 13, color: COLORS.muted },
  activityTime: { fontSize: 11, color: COLORS.lightMuted, marginTop: 2 },
});

export default AdminDashboard;
