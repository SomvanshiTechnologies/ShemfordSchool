import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import DateStepper from '../components/DateStepper';
import { PrimaryButton, SecondaryButton } from '../components/FormKit';
import { errorText } from '../utils/students';
import { todayISO, thisMonth, STATUS_STYLE } from '../utils/attendance';

const STATUSES = ['present', 'absent', 'leave', 'half_day'];

// All active employees for the session being viewed (the list endpoint pages).
const loadEmployees = async () => {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const res = await client.get('/employees', { params: { limit: 100, page } });
    const list = Array.isArray(res.data) ? res.data : [];
    all.push(...list);
    const pages = parseInt(res.headers?.['x-total-pages'] || '1', 10);
    if (page >= pages || !list.length) break;
  }
  return all;
};

// Mirrors the web dashboard's Employee Attendance tabs:
//   Mark    → GET /attendance/employees?date, POST /attendance/employee
//   Monthly → GET /attendance/employees?month
// Admin only (the backend rejects other roles).
const StaffAttendanceScreen = () => {
  const [tab, setTab] = useState('mark');
  const [employees, setEmployees] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [loadingEmp, setLoadingEmp] = useState(true);
  const [empError, setEmpError] = useState(null);

  const [date, setDate] = useState(todayISO());
  const [marks, setMarks] = useState({});        // employee_id -> status
  const [saved, setSaved] = useState({});        // what the server has for this date
  const [loadingDay, setLoadingDay] = useState(false);
  const [saving, setSaving] = useState(false);

  const [month, setMonth] = useState(thisMonth());
  const [monthRows, setMonthRows] = useState([]);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadEmployees()
      .then(list => setEmployees(list.filter(e => e.is_active !== false)))
      .catch(e => setEmpError(errorText(e, 'Failed to load employees.')))
      .finally(() => setLoadingEmp(false));
    client.get('/holidays').then(r => setHolidays(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  const loadDay = useCallback(() => {
    setLoadingDay(true);
    return client.get('/attendance/employees', { params: { date } })
      .then(r => {
        const m = {};
        (Array.isArray(r.data) ? r.data : []).forEach(rec => { m[rec.entity_id] = rec.status; });
        setSaved(m);
        setMarks(m);
      })
      .catch(() => { setSaved({}); setMarks({}); })
      .finally(() => setLoadingDay(false));
  }, [date]);

  useEffect(() => { if (tab === 'mark') loadDay(); }, [tab, loadDay]);

  useEffect(() => {
    if (tab !== 'monthly') return;
    setLoadingMonth(true);
    client.get('/attendance/employees', { params: { month } })
      .then(r => {
        const by = {};
        (Array.isArray(r.data) ? r.data : []).forEach(rec => {
          const row = by[rec.entity_id] || (by[rec.entity_id] = { id: rec.entity_id, present: 0, absent: 0, leave: 0, half_day: 0, total: 0 });
          if (row[rec.status] !== undefined) row[rec.status] += 1;
          row.total += 1;
        });
        setMonthRows(Object.values(by));
      })
      .catch(() => setMonthRows([]))
      .finally(() => setLoadingMonth(false));
  }, [tab, month]);

  const holiday = holidays.find(h => h.date === date);
  const isSunday = new Date(`${date}T12:00:00`).getDay() === 0;
  const alreadyMarked = Object.keys(saved).length > 0;
  const dirty = employees.some(e => (marks[e.employee_id] || 'present') !== (saved[e.employee_id] || (alreadyMarked ? undefined : 'present')));

  const setAll = (status) => {
    const m = {};
    employees.forEach(e => { m[e.employee_id] = status; });
    setMarks(m);
  };

  const save = async () => {
    if (!employees.length) return;
    setSaving(true);
    try {
      const records = employees.map(e => ({ employee_id: e.employee_id, status: marks[e.employee_id] || 'present' }));
      const res = await client.post('/attendance/employee', { date, records });
      Alert.alert('Saved', res.data?.message || 'Staff attendance saved.');
      loadDay();
    } catch (e) {
      Alert.alert('Could not save', errorText(e, 'Failed to save staff attendance.'));
    } finally {
      setSaving(false);
    }
  };

  const nameOf = (id) => {
    const e = employees.find(x => x.employee_id === id);
    return e ? `${e.first_name || ''} ${e.last_name || ''}`.trim() : id;
  };

  const q = search.trim().toLowerCase();
  const shownEmployees = q
    ? employees.filter(e => `${e.first_name} ${e.last_name} ${e.designation || ''} ${e.department || ''}`.toLowerCase().includes(q))
    : employees;
  const counts = STATUSES.reduce((acc, st) => ({ ...acc, [st]: employees.filter(e => (marks[e.employee_id] || 'present') === st).length }), {});

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={s.tabs}>
        {[{ k: 'mark', l: 'Mark' }, { k: 'monthly', l: 'Monthly' }].map(t => (
          <TouchableOpacity key={t.k} style={[s.tab, tab === t.k && s.tabActive]} onPress={() => setTab(t.k)}>
            <Text style={[s.tabText, tab === t.k && s.tabTextActive]}>{t.l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        {loadingEmp ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 32 }} /> : empError ? (
          <Text style={s.error}>{empError}</Text>
        ) : tab === 'mark' ? (
          <>
            <DateStepper mode="day" value={date} onChange={setDate} />

            {holiday ? (
              <View style={[s.banner, { backgroundColor: STATUS_STYLE.holiday.bg }]}>
                <Ionicons name="calendar" size={18} color={STATUS_STYLE.holiday.fg} />
                <Text style={[s.bannerText, { color: STATUS_STYLE.holiday.fg }]}>{holiday.name} — holiday, attendance can't be marked.</Text>
              </View>
            ) : (
              <>
                {isSunday && (
                  <View style={[s.banner, { backgroundColor: '#FFFBEB' }]}>
                    <Ionicons name="information-circle-outline" size={18} color={COLORS.warning} />
                    <Text style={[s.bannerText, { color: COLORS.warning }]}>This date is a Sunday.</Text>
                  </View>
                )}
                <View style={s.countRow}>
                  {STATUSES.map(st => (
                    <View key={st} style={[s.countBox, { backgroundColor: STATUS_STYLE[st].bg }]}>
                      <Text style={[s.countNum, { color: STATUS_STYLE[st].fg }]}>{counts[st]}</Text>
                      <Text style={[s.countLabel, { color: STATUS_STYLE[st].fg }]}>{STATUS_STYLE[st].label}</Text>
                    </View>
                  ))}
                </View>
                <Text style={s.hint}>
                  {alreadyMarked ? 'Already marked for this date. Changes overwrite it.' : 'Not marked yet. Anyone you leave unmarked is saved as present.'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <SecondaryButton title="All Present" icon="checkmark-done" onPress={() => setAll('present')} style={{ flex: 1, paddingVertical: 11 }} />
                  <SecondaryButton title="Reset" icon="refresh" onPress={() => setMarks(saved)} disabled={!dirty} style={{ flex: 1, paddingVertical: 11 }} />
                </View>
              </>
            )}

            <View style={s.searchBox}>
              <Ionicons name="search" size={16} color={COLORS.muted} />
              <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Filter staff" placeholderTextColor={COLORS.lightMuted} />
            </View>

            {loadingDay ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} /> : (
              <View style={s.list}>
                {shownEmployees.map(e => {
                  const cur = marks[e.employee_id] || (alreadyMarked ? '' : 'present');
                  return (
                    <View key={e.employee_id} style={s.empRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.name} numberOfLines={1}>{e.first_name} {e.last_name}</Text>
                        <Text style={s.meta} numberOfLines={1}>{e.designation}{e.department ? ` · ${e.department}` : ''}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 5 }}>
                        {STATUSES.map(st => {
                          const on = cur === st;
                          const sty = STATUS_STYLE[st];
                          return (
                            <TouchableOpacity
                              key={st}
                              disabled={!!holiday}
                              style={[s.stBtn, on && { backgroundColor: sty.fg, borderColor: sty.fg }]}
                              onPress={() => setMarks(m => ({ ...m, [e.employee_id]: st }))}
                              accessibilityLabel={`${sty.label} for ${e.first_name}`}
                            >
                              <Text style={[s.stBtnText, on && { color: COLORS.white }]}>{sty.short}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
                {shownEmployees.length === 0 && <Text style={s.empty}>No staff found</Text>}
              </View>
            )}
            {!holiday && employees.length > 0 && (
              <PrimaryButton title={alreadyMarked ? 'Update Attendance' : 'Save Attendance'} icon="checkmark" onPress={save} loading={saving} style={{ marginTop: 14 }} />
            )}
            <Text style={s.legend}>P Present · A Absent · L Leave · H Half day</Text>
          </>
        ) : (
          <>
            <DateStepper mode="month" value={month} onChange={setMonth} />
            {loadingMonth ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} /> : (
              <View style={s.list}>
                {monthRows
                  .map(r => ({ ...r, name: nameOf(r.id) }))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(r => {
                    const pct = r.total ? Math.round(((r.present + r.half_day * 0.5) / r.total) * 100) : 0;
                    return (
                      <View key={r.id} style={s.monthRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.name}>{r.name}</Text>
                          <Text style={s.meta}>P {r.present} · A {r.absent} · L {r.leave} · H {r.half_day} · {r.total} days marked</Text>
                        </View>
                        <Text style={[s.pct, pct < 75 && { color: COLORS.danger }]}>{pct}%</Text>
                      </View>
                    );
                  })}
                {monthRows.length === 0 && <Text style={s.empty}>No staff attendance marked this month</Text>}
              </View>
            )}
            <Text style={s.legend}>Percentage counts a half day as half present.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingHorizontal: 16 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: COLORS.primary },
  tabText: { fontSize: 13, fontWeight: '700', color: COLORS.muted },
  tabTextActive: { color: COLORS.black },
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 14 },
  error: { fontSize: 13, color: COLORS.danger, textAlign: 'center', marginTop: 32 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.md, padding: 12, marginBottom: 12 },
  bannerText: { flex: 1, fontSize: 12, fontWeight: '600' },
  countRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  countBox: { flex: 1, borderRadius: RADIUS.md, paddingVertical: 8, alignItems: 'center' },
  countNum: { fontSize: 18, fontWeight: '800' },
  countLabel: { fontSize: 10, fontWeight: '700' },
  hint: { fontSize: 11, color: COLORS.muted, marginBottom: 10 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 14, marginBottom: 12 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: COLORS.black },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  empRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  name: { fontSize: 13, fontWeight: '600', color: COLORS.black },
  meta: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  stBtn: { width: 32, height: 32, borderRadius: RADIUS.sm, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white },
  stBtnText: { fontSize: 12, fontWeight: '800', color: COLORS.muted },
  pct: { fontSize: 16, fontWeight: '800', color: COLORS.black },
  empty: { fontSize: 13, color: COLORS.muted, textAlign: 'center', paddingVertical: 28 },
  legend: { fontSize: 11, color: COLORS.muted, textAlign: 'center', marginTop: 10 },
});

export default StaffAttendanceScreen;
