import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { Chips } from '../components/FormKit';
import { errorText } from '../utils/students';

const THRESHOLDS = ['60', '65', '70', '75', '80', '85', '90'];

// Students whose attendance this session is below a threshold.
// Mirrors the web dashboard's Alerts tab → GET /attendance/alerts.
const AttendanceAlertsScreen = () => {
  const navigation = useNavigation();
  const [threshold, setThreshold] = useState('75');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [classFilter, setClassFilter] = useState('');

  const load = useCallback(() => {
    setError(null);
    return client.get('/attendance/alerts', { params: { threshold: parseFloat(threshold) } })
      .then(r => setData(r.data || null))
      .catch(e => { setData(null); setError(errorText(e, 'Failed to load alerts.')); });
  }, [threshold]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);
  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const alerts = data?.alerts || [];
  const classes = [...new Set(alerts.map(a => a.class_name))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const shown = classFilter ? alerts.filter(a => a.class_name === classFilter) : alerts;

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
    >
      <Text style={s.label}>SHOW STUDENTS BELOW</Text>
      <Chips options={THRESHOLDS.map(t => ({ value: t, label: `${t}%` }))} value={threshold} onChange={v => { setThreshold(v); setClassFilter(''); }} />

      <View style={s.summary}>
        <Ionicons name="warning-outline" size={22} color={alerts.length ? COLORS.danger : COLORS.success} />
        <View style={{ flex: 1 }}>
          <Text style={s.summaryValue}>{loading ? '…' : alerts.length} student{alerts.length === 1 ? '' : 's'}</Text>
          <Text style={s.summarySub}>below {threshold}% attendance this session</Text>
        </View>
      </View>

      {classes.length > 1 && (
        <View style={{ marginBottom: 12 }}>
          <Chips options={[{ value: '', label: 'All' }, ...classes.map(c => ({ value: c, label: `Class ${c}` }))]} value={classFilter} onChange={setClassFilter} capitalize={false} />
        </View>
      )}

      {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 24 }} /> : error ? (
        <Text style={s.error}>{error}</Text>
      ) : (
        <View style={s.list}>
          {shown.map(a => (
            <TouchableOpacity
              key={a.student_id}
              style={s.row}
              activeOpacity={0.6}
              onPress={() => {
                const [first, ...rest] = (a.student_name || '').split(' ');
                navigation.navigate('StudentDetail', { student: { student_id: a.student_id, first_name: first, last_name: rest.join(' '), class_name: a.class_name, section: a.section, admission_number: a.admission_number } });
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{a.student_name}</Text>
                <Text style={s.meta}>{a.class_name}-{a.section} · {a.admission_number}</Text>
                <Text style={s.meta}>Present {a.present_days} of {a.total_days} · Absent {a.absent_days}</Text>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: `${Math.min(100, a.attendance_percentage)}%` }]} />
                  <View style={[s.barMark, { left: `${Math.min(100, Number(threshold))}%` }]} />
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', marginLeft: 10 }}>
                <Text style={s.pct}>{a.attendance_percentage}%</Text>
                <Text style={s.short}>−{a.shortfall}%</Text>
              </View>
            </TouchableOpacity>
          ))}
          {shown.length === 0 && (
            <View style={s.empty}>
              <Ionicons name="checkmark-circle-outline" size={30} color={COLORS.success} />
              <Text style={s.emptyText}>No students below {threshold}%</Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 16 },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: COLORS.lightMuted, marginBottom: 8 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginVertical: 14, ...SHADOW.sm },
  summaryValue: { fontSize: 18, fontWeight: '800', color: COLORS.black },
  summarySub: { fontSize: 12, color: COLORS.muted, marginTop: 1 },
  error: { fontSize: 13, color: COLORS.danger, textAlign: 'center', marginTop: 24 },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  name: { fontSize: 13, fontWeight: '600', color: COLORS.black },
  meta: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  barTrack: { height: 5, borderRadius: 3, backgroundColor: COLORS.lightBg, marginTop: 7, overflow: 'visible' },
  barFill: { height: 5, borderRadius: 3, backgroundColor: COLORS.danger },
  barMark: { position: 'absolute', top: -2, width: 2, height: 9, backgroundColor: COLORS.black },
  pct: { fontSize: 17, fontWeight: '800', color: COLORS.danger },
  short: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  empty: { alignItems: 'center', paddingVertical: 28 },
  emptyText: { fontSize: 13, color: COLORS.muted, marginTop: 8 },
});

export default AttendanceAlertsScreen;
