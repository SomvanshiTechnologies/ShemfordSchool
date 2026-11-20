import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';
import { SectionTitle, CardDark, CardOrange, Badge } from '../components/UI';
import { StatCard, StatGrid } from '../components/StatCard';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { useNavigation } from '@react-navigation/native';
import { STATUS_STYLE, dayLabel } from '../utils/attendance';

// Attendance tools for staff. Each opens a stack screen.
const TOOLS = [
  { screen: 'StaffAttendance', icon: 'id-card-outline', title: 'Staff', roles: ['admin'] },
  { screen: 'Holidays', icon: 'calendar-outline', title: 'Holidays', roles: ['admin', 'teacher'] },
  { screen: 'AttendanceAlerts', icon: 'warning-outline', title: 'Low Attendance', roles: ['admin', 'teacher'] },
  { screen: 'BulkUnlock', icon: 'lock-open-outline', title: 'Bulk Unlock', roles: ['admin'] },
];

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Month grid coloured by attendance status, like the web parent page.
const MonthCalendar = ({ month, records, holidays }) => {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const byDate = {};
  (holidays || []).forEach(h => { if (h.date?.startsWith(month)) byDate[h.date] = 'holiday'; });
  (records || []).forEach(r => { byDate[r.date] = r.status; });
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return (
    <View style={styles.calCard}>
      <View style={styles.calRow}>
        {WEEKDAYS.map((d, i) => <Text key={i} style={styles.calHead}>{d}</Text>)}
      </View>
      <View style={styles.calGrid}>
        {cells.map((d, i) => {
          if (!d) return <View key={i} style={styles.calCell} />;
          const iso = `${month}-${String(d).padStart(2, '0')}`;
          const st = STATUS_STYLE[byDate[iso]];
          return (
            <View key={i} style={styles.calCell}>
              <View style={[styles.calDay, st && { backgroundColor: st.bg }]}>
                <Text style={[styles.calDayText, st && { color: st.fg, fontWeight: '800' }]}>{d}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.calLegend}>
        {['present', 'absent', 'leave', 'holiday'].map(k => (
          <View key={k} style={styles.calLegendItem}>
            <View style={[styles.calDot, { backgroundColor: STATUS_STYLE[k].fg }]} />
            <Text style={styles.calLegendText}>{STATUS_STYLE[k].label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const AttendanceScreen = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isParent = user?.role === 'parent';
  const isStudentOrParent = user?.role === 'student' || user?.role === 'parent';

  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [attData, setAttData] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState(null);
  const [selClass, setSelClass] = useState('');
  const [selSection, setSelSection] = useState('');
  const [selDate] = useState(new Date().toISOString().split('T')[0]);
  const [myRecords, setMyRecords] = useState([]);
  const [myLoading, setMyLoading] = useState(true);
  // Month filter for student/parent: '' = all time, else 'YYYY-MM'. Defaults to this month (matches web).
  const thisMonthKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const [selMonth, setSelMonth] = useState(thisMonthKey());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthLabel = (key) => {
    if (!key) return 'All time';
    const [y, m] = key.split('-');
    return `${MONTHS_LONG[parseInt(m, 10) - 1]}, ${y}`;
  };
  const openPicker = () => { setPickerYear(selMonth ? parseInt(selMonth.split('-')[0], 10) : new Date().getFullYear()); setPickerOpen(true); };
  // Parents pick a child; students see themselves. The summary endpoint gives
  // the same detail as the web parent page (counts, percentage, daily records).
  const [kids, setKids] = useState([]);
  const [selKid, setSelKid] = useState(null);
  const [summary, setSummary] = useState(null);
  const [holidays, setHolidays] = useState([]);

  useEffect(() => {
    if (!isStudentOrParent) return;
    client.get('/students', { params: { app_visible: true } })
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : (r.data?.students || []);
        setKids(list);
        setSelKid(list[0] || null);
        if (!list.length) setMyLoading(false);
      })
      .catch(() => setMyLoading(false));
    client.get('/holidays').then(r => setHolidays(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (isStudentOrParent) {
      if (!selKid) return;
      setMyLoading(true);
      const params = selMonth ? { month: selMonth } : {};
      client.get(`/attendance/summary/${selKid.student_id}`, { params })
        .then(r => { setSummary(r.data || null); setMyRecords(Array.isArray(r.data?.records) ? r.data.records : []); })
        .catch(() => { setSummary(null); setMyRecords([]); })
        .finally(() => setMyLoading(false));
    } else {
      client.get('/classes').then(r => setClasses(r.data)).finally(() => setMyLoading(false));
    }
  }, [selMonth, selKid]);

  useEffect(() => {
    if (selClass && selSection && !isStudentOrParent) {
      setLoading(true);
      Promise.all([
        client.get('/students', { params: { class_name: selClass, section: selSection, app_visible: true } }),
        client.get('/attendance', { params: { entity_type: 'student', date: selDate, class_name: selClass, section: selSection } }),
        client.get('/attendance/session-status', { params: { class_name: selClass, section: selSection, date: selDate } }),
      ]).then(([s, a, sess]) => {
        setStudents(s.data);
        setSession(sess.data);
        const m = {};
        a.data.forEach(r => { m[r.entity_id] = r.status; });
        setAttData(m);
      }).finally(() => setLoading(false));
    }
  }, [selClass, selSection, selDate]);

  const isLocked = session?.is_locked && session?.submitted;
  const isHoliday = session?.is_holiday;
  const canEdit = (!isLocked && !isHoliday) || isAdmin;

  const markAll = (status) => {
    const n = {};
    students.forEach(s => { n[s.student_id] = status; });
    setAttData(n);
  };

  const submitAttendance = async () => {
    setSaving(true);
    try {
      const records = students.map(s => ({
        entity_type: 'student', entity_id: s.student_id, date: selDate,
        status: attData[s.student_id] || 'absent', class_name: selClass, section: selSection,
      }));
      const res = await client.post('/attendance', { class_name: selClass, section: selSection, date: selDate, records });
      Alert.alert('Success', `Attendance submitted${res.data.parents_notified > 0 ? `. ${res.data.parents_notified} parent(s) notified` : ''}`);
      setSession({ submitted: true, is_locked: true });
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to submit');
    } finally { setSaving(false); }
  };

  const unlock = async () => {
    try {
      await client.post('/attendance/unlock', { class_name: selClass, section: selSection, date: selDate });
      Alert.alert('Success', 'Unlocked');
      setSession({ ...session, is_locked: false });
    } catch { Alert.alert('Error', 'Failed to unlock'); }
  };

  if (myLoading && !isStudentOrParent) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  // Student/Parent view
  if (isStudentOrParent) {
    const present = summary?.present ?? myRecords.filter(r => r.status === 'present').length;
    const absent = summary?.absent ?? myRecords.filter(r => r.status === 'absent').length;
    const leave = summary?.leave ?? myRecords.filter(r => r.status === 'leave').length;
    const total = summary?.total ?? myRecords.length;
    const pct = summary?.percentage ?? (total > 0 ? Math.round(present / total * 100) : 0);
    const sorted = [...myRecords].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const absentDates = sorted.filter(r => r.status === 'absent');
    // Consecutive present days needed to reach 75%: (present + n) / (total + n) >= 0.75
    const daysTo75 = Math.max(0, Math.ceil(3 * total - 4 * present));
    const kidName = selKid ? `${selKid.first_name || ''} ${selKid.last_name || ''}`.trim() : '';
    const fmtDay = (iso) => {
      const d = new Date(iso);
      return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    };

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.h1}>{isParent ? "Children's Attendance" : 'My Attendance'}</Text>
            <Text style={styles.sub}>{kidName ? `${kidName}${selKid?.class_name ? ` · ${selKid.class_name}-${selKid.section}` : ''}` : 'View your attendance records'}</Text>
          </View>

          {isParent && kids.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {kids.map(k => (
                <TouchableOpacity key={k.student_id} style={[styles.chip, selKid?.student_id === k.student_id && styles.chipActive]} onPress={() => setSelKid(k)}>
                  <Text style={[styles.chipText, selKid?.student_id === k.student_id && styles.chipTextActive]}>{k.first_name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity style={styles.monthBtn} onPress={openPicker} activeOpacity={0.8}>
            <Text style={styles.monthBtnText}>{monthLabel(selMonth)}</Text>
            <Ionicons name="calendar-outline" size={18} color={COLORS.black} />
          </TouchableOpacity>

          <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
            <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={() => setPickerOpen(false)}>
              <TouchableOpacity activeOpacity={1} style={styles.pickerCard} onPress={() => {}}>
                <View style={styles.pickerYearRow}>
                  <TouchableOpacity onPress={() => setPickerYear(y => y - 1)} hitSlop={10}><Ionicons name="chevron-back" size={20} color={COLORS.black} /></TouchableOpacity>
                  <Text style={styles.pickerYear}>{pickerYear}</Text>
                  <TouchableOpacity onPress={() => setPickerYear(y => y + 1)} hitSlop={10}><Ionicons name="chevron-forward" size={20} color={COLORS.black} /></TouchableOpacity>
                </View>
                <View style={styles.pickerGrid}>
                  {MONTHS.map((m, i) => {
                    const key = `${pickerYear}-${String(i + 1).padStart(2, '0')}`;
                    const active = selMonth === key;
                    return (
                      <TouchableOpacity key={m} style={[styles.pickerCell, active && styles.pickerCellActive]} onPress={() => { setSelMonth(key); setPickerOpen(false); }}>
                        <Text style={[styles.pickerCellText, active && styles.pickerCellTextActive]}>{m}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.pickerFooter}>
                  <TouchableOpacity onPress={() => { setSelMonth(''); setPickerOpen(false); }}><Text style={styles.pickerLink}>Clear</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => { setSelMonth(thisMonthKey()); setPickerOpen(false); }}><Text style={styles.pickerLink}>This month</Text></TouchableOpacity>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>

          {myLoading ? <ScreenLoader /> : (
            <>
              <StatGrid>
                <StatCard label="Total" value={total} />
                <StatCard label="Present" value={present} />
                <StatCard label="Absent" value={absent} accent />
                <StatCard label="Percentage" value={`${pct}%`} />
              </StatGrid>
              {leave > 0 && <Text style={[styles.sub, { marginBottom: 10 }]}>{leave} on leave</Text>}

              {total > 0 && pct < 75 && (
                <View style={styles.warnCard}>
                  <Ionicons name="warning" size={18} color={COLORS.danger} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.warnTitle}>Attendance below 75%</Text>
                    <Text style={styles.warnText}>
                      {daysTo75 > 0
                        ? `${daysTo75} more present day${daysTo75 === 1 ? '' : 's'} in a row needed to reach 75%${selMonth ? ' for this month' : ''}.`
                        : 'Keep attending to stay above 75%.'}
                    </Text>
                  </View>
                </View>
              )}

              {!!selMonth && (
                <>
                  <SectionTitle>Calendar</SectionTitle>
                  <MonthCalendar month={selMonth} records={myRecords} holidays={holidays} />
                </>
              )}

              {absentDates.length > 0 && (
                <>
                  <SectionTitle>Absent Days · {absentDates.length}</SectionTitle>
                  <View style={styles.absentWrap}>
                    {absentDates.map((r, i) => (
                      <View key={`${r.date}-${i}`} style={styles.absentChip}>
                        <Text style={styles.absentChipText}>{dayLabel(r.date)}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              <SectionTitle>All Records</SectionTitle>
              <View style={styles.list}>
                {sorted.map((r, i) => (
                  <View key={r.attendance_id || `${r.date}-${i}`} style={styles.listItem}>
                    <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }}>{fmtDay(r.date)}</Text>
                    <Badge text={r.status} variant={r.status === 'present' ? 'dark' : r.status === 'absent' ? 'orange' : 'muted'} />
                  </View>
                ))}
                {sorted.length === 0 && (
                  <View style={styles.empty}><Ionicons name="calendar-outline" size={48} color="#DDD" /><Text style={styles.emptyText}>No records for this period</Text></View>
                )}
              </View>
            </>
          )}
          <View style={{ height: 20 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Teacher/Admin view
  const sections = classes.find(c => c.name === selClass)?.sections || [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.h1}>Attendance</Text>
          <Text style={styles.sub}>{selDate}</Text>
        </View>

        <View style={styles.toolRow}>
          {TOOLS.filter(tl => tl.roles.includes(user?.role)).map(tl => (
            <TouchableOpacity key={tl.screen} style={styles.tool} activeOpacity={0.7} onPress={() => navigation.navigate(tl.screen)}>
              <Ionicons name={tl.icon} size={18} color={COLORS.primary} />
              <Text style={styles.toolText} numberOfLines={1}>{tl.title}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <SectionTitle>Select Class</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          {classes.map(c => (
            <TouchableOpacity
              key={c.name}
              style={[styles.chip, selClass === c.name && styles.chipActive]}
              onPress={() => { setSelClass(c.name); setSelSection(''); setSession(null); }}
            >
              <Text style={[styles.chipText, selClass === c.name && styles.chipTextActive]}>{c.display_name || c.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {selClass && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {sections.map(s => {
              const n = typeof s === 'string' ? s : s.section_name;
              return (
                <TouchableOpacity key={n} style={[styles.chip, selSection === n && styles.chipActive]} onPress={() => setSelSection(n)}>
                  <Text style={[styles.chipText, selSection === n && styles.chipTextActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {isHoliday && (
          <CardOrange style={{ alignItems: 'center' }}>
            <Ionicons name="calendar" size={20} color={COLORS.white} />
            <Text style={{ fontWeight: '700', color: COLORS.white, marginTop: 8 }}>{session?.holiday_name}</Text>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>Holiday — attendance blocked</Text>
          </CardOrange>
        )}

        {isLocked && !isHoliday && (
          <CardDark style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Ionicons name="lock-closed" size={18} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: COLORS.white, fontSize: 13 }}>Submitted & Locked</Text>
              {!isAdmin && <Text style={{ fontSize: 11, color: COLORS.muted }}>Contact admin to edit</Text>}
            </View>
            {isAdmin && (
              <TouchableOpacity style={styles.unlockBtn} onPress={unlock}>
                <Ionicons name="lock-open" size={14} color={COLORS.white} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.white }}>Unlock</Text>
              </TouchableOpacity>
            )}
          </CardDark>
        )}

        {canEdit && students.length > 0 && !isHoliday && (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <TouchableOpacity style={[styles.actionBtn, { borderWidth: 1.5, borderColor: COLORS.border, flex: 1 }]} onPress={() => markAll('present')}>
              <Ionicons name="checkmark-circle" size={14} color={COLORS.black} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.black }}>All Present</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.primary, flex: 1 }]} onPress={submitAttendance} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color={COLORS.white} /> : <Ionicons name="checkmark" size={14} color={COLORS.white} />}
              <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.white }}>Submit & Lock</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading ? <ScreenLoader /> : students.length === 0 && selClass && selSection ? (
          <View style={styles.empty}><Text style={styles.emptyText}>No students found</Text></View>
        ) : (
          <View style={styles.list}>
            {students.map(s => {
              const status = attData[s.student_id] || '';
              return (
                <View key={s.student_id} style={styles.attRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }} numberOfLines={1}>{s.first_name} {s.last_name}</Text>
                    <Text style={{ fontSize: 10, color: COLORS.muted }}>{s.roll_number || s.admission_number}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      style={[styles.attBtn, status === 'present' && styles.attBtnPresent]}
                      onPress={() => canEdit && setAttData(p => ({ ...p, [s.student_id]: 'present' }))}
                      disabled={!canEdit}
                    >
                      <Ionicons name="checkmark-circle" size={16} color={status === 'present' ? COLORS.white : COLORS.muted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.attBtn, status === 'absent' && styles.attBtnAbsent]}
                      onPress={() => canEdit && setAttData(p => ({ ...p, [s.student_id]: 'absent' }))}
                      disabled={!canEdit}
                    >
                      <Ionicons name="close-circle" size={16} color={status === 'absent' ? COLORS.white : COLORS.muted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.attBtn, status === 'leave' && styles.attBtnLeave]}
                      onPress={() => canEdit && setAttData(p => ({ ...p, [s.student_id]: 'leave' }))}
                      disabled={!canEdit}
                    >
                      <Ionicons name="time" size={16} color={status === 'leave' ? COLORS.warning : COLORS.muted} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 24, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white, marginRight: 8 },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  chipTextActive: { color: COLORS.white },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, ...SHADOW.sm },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  attRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  attBtn: { width: 38, height: 38, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  attBtnPresent: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  attBtnAbsent: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
  attBtnLeave: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: RADIUS.md },
  unlockBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 14, color: COLORS.lightMuted, marginTop: 12 },
  monthBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.lg,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14, ...SHADOW.sm,
  },
  monthBtnText: { fontSize: 15, fontWeight: '600', color: COLORS.black },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'center', padding: 28 },
  pickerCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, ...SHADOW.md },
  pickerYearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.lightBg, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
  pickerYear: { fontSize: 15, fontWeight: '700', color: COLORS.black },
  pickerGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  pickerCell: { width: '25%', paddingVertical: 12, alignItems: 'center', borderRadius: RADIUS.md },
  pickerCellActive: { backgroundColor: '#2563EB' },
  pickerCellText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
  pickerCellTextActive: { color: COLORS.white },
  pickerFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 4 },
  pickerLink: { fontSize: 14, fontWeight: '600', color: '#2563EB' },
  toolRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tool: { flex: 1, alignItems: 'center', gap: 4, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 12, paddingHorizontal: 4, ...SHADOW.sm },
  toolText: { fontSize: 11, fontWeight: '700', color: COLORS.black },
  warnCard: { flexDirection: 'row', gap: 10, backgroundColor: '#FEF2F2', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: '#FECACA', padding: 12, marginBottom: 14 },
  warnTitle: { fontSize: 13, fontWeight: '800', color: COLORS.danger },
  warnText: { fontSize: 12, color: '#991B1B', marginTop: 2 },
  calCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, padding: 12, marginBottom: 16, ...SHADOW.sm },
  calRow: { flexDirection: 'row' },
  calHead: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 11, fontWeight: '700', color: COLORS.lightMuted, paddingBottom: 6 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  calDay: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  calDayText: { fontSize: 13, color: COLORS.black },
  calLegend: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  calLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  calDot: { width: 8, height: 8, borderRadius: 4 },
  calLegendText: { fontSize: 11, color: COLORS.muted },
  absentWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  absentChip: { backgroundColor: '#FEF2F2', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  absentChipText: { fontSize: 11, fontWeight: '600', color: COLORS.danger },
});

export default AttendanceScreen;
