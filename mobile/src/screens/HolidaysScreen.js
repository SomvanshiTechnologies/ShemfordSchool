import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, RefreshControl, ActivityIndicator, Alert, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';
import { Field, Input, Chips, PrimaryButton } from '../components/FormKit';
import { errorText } from '../utils/students';
import { todayISO, isISODate, dayLabel, STATUS_STYLE } from '../utils/attendance';

// Same options as the web dashboard's holiday dialog.
const TYPES = [
  { value: 'public', label: 'Public' },
  { value: 'school', label: 'School' },
  { value: 'optional', label: 'Optional' },
];
const TYPE_LABEL = { public: 'Public holiday', school: 'School holiday', optional: 'Optional holiday' };

// Holiday calendar for the session being viewed (GET /holidays).
// Admins can add (POST /holidays) and remove (DELETE /holidays/{id}).
const HolidaysScreen = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ date: '', name: '', type: 'public' });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(() =>
    client.get('/holidays')
      .then(r => setHolidays(Array.isArray(r.data) ? r.data : []))
      .catch(() => setHolidays([])),
  []);

  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));
  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const add = async () => {
    const date = form.date.trim();
    const name = form.name.trim();
    if (!isISODate(date)) { Alert.alert('Invalid date', 'Enter the date as YYYY-MM-DD, e.g. 2026-01-26.'); return; }
    if (!name) { Alert.alert('Missing name', 'Enter the holiday name.'); return; }
    setSaving(true);
    try {
      const res = await client.post('/holidays', { date, name, type: form.type });
      setShowAdd(false);
      setForm({ date: '', name: '', type: 'public' });
      await load();
      Alert.alert('Holiday added', res.data?.message || `${name} added.`);
    } catch (e) {
      Alert.alert('Could not add', errorText(e, 'Failed to add holiday.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = (h) => Alert.alert(
    'Remove holiday?',
    `Remove ${h.name} on ${dayLabel(h.date)}? Attendance can then be marked on that day.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          setRemoving(h.holiday_id);
          try {
            await client.delete(`/holidays/${h.holiday_id}`);
            await load();
          } catch (e) {
            Alert.alert('Could not remove', errorText(e, 'Failed to remove holiday.'));
          } finally {
            setRemoving(null);
          }
        },
      },
    ],
  );

  const today = todayISO();
  const upcoming = holidays.filter(h => h.date >= today);
  const past = holidays.filter(h => h.date < today).reverse();

  const Row = ({ h }) => {
    const d = new Date(`${h.date}T12:00:00`);
    return (
      <View style={s.row}>
        <View style={s.dateBox}>
          <Text style={s.dateMonth}>{d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()}</Text>
          <Text style={s.dateDay}>{d.getDate()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{h.name}</Text>
          <Text style={s.meta}>{d.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric' })} · {TYPE_LABEL[h.type] || h.type}</Text>
        </View>
        {isAdmin && (
          removing === h.holiday_id
            ? <ActivityIndicator size="small" color={COLORS.danger} />
            : (
              <TouchableOpacity onPress={() => remove(h)} hitSlop={10} accessibilityLabel={`Remove ${h.name}`}>
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
              </TouchableOpacity>
            )
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        {isAdmin && <PrimaryButton title="Add Holiday" icon="add" onPress={() => { setForm({ date: today, name: '', type: 'public' }); setShowAdd(true); }} style={{ marginBottom: 14 }} />}

        {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 32 }} /> : (
          <>
            <Text style={s.section}>UPCOMING · {upcoming.length}</Text>
            <View style={s.list}>
              {upcoming.map(h => <Row key={h.holiday_id} h={h} />)}
              {upcoming.length === 0 && <Text style={s.empty}>No upcoming holidays this session</Text>}
            </View>

            {past.length > 0 && (
              <>
                <TouchableOpacity style={s.pastToggle} onPress={() => setShowPast(v => !v)}>
                  <Text style={s.section}>PAST · {past.length}</Text>
                  <Ionicons name={showPast ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.muted} />
                </TouchableOpacity>
                {showPast && <View style={s.list}>{past.map(h => <Row key={h.holiday_id} h={h} />)}</View>}
              </>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={showAdd} animationType="slide" transparent onRequestClose={() => !saving && setShowAdd(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.overlay}>
            <TouchableOpacity style={s.overlayBg} onPress={() => !saving && setShowAdd(false)} />
            <View style={s.sheet}>
              <View style={s.handle} />
              <Text style={s.sheetTitle}>Add Holiday</Text>
              <Field label="DATE" required hint={isISODate(form.date) ? dayLabel(form.date) : 'Format: YYYY-MM-DD'}>
                <Input value={form.date} onChangeText={v => setForm(f => ({ ...f, date: v }))} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
              </Field>
              <Field label="NAME" required>
                <Input value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} placeholder="e.g. Republic Day" />
              </Field>
              <Field label="TYPE">
                <Chips options={TYPES} value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))} />
              </Field>
              <Text style={s.note}>Attendance can't be marked on a holiday, for students or staff.</Text>
              <PrimaryButton title="Add Holiday" icon="calendar" onPress={add} loading={saving} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  section: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: COLORS.lightMuted, marginBottom: 8 },
  pastToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  dateBox: { width: 46, borderRadius: RADIUS.md, backgroundColor: STATUS_STYLE.holiday.bg, alignItems: 'center', paddingVertical: 6 },
  dateMonth: { fontSize: 9, fontWeight: '800', color: STATUS_STYLE.holiday.fg, letterSpacing: 0.6 },
  dateDay: { fontSize: 18, fontWeight: '800', color: STATUS_STYLE.holiday.fg },
  name: { fontSize: 14, fontWeight: '700', color: COLORS.black },
  meta: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  empty: { fontSize: 13, color: COLORS.muted, textAlign: 'center', paddingVertical: 24 },
  note: { fontSize: 11, color: COLORS.muted, marginBottom: 12 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, ...SHADOW.md },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: COLORS.black, marginBottom: 14 },
});

export default HolidaysScreen;
