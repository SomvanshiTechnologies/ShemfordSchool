import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, RefreshControl, ActivityIndicator, Alert, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { useSession } from '../contexts/SessionContext';
import { Field, Input, PrimaryButton, SecondaryButton } from '../components/FormKit';
import { errorText } from '../utils/students';
import { isISODate, dayLabel } from '../utils/attendance';

const STATUS = {
  active:   { label: 'Current', bg: '#ECFDF5', fg: '#059669' },
  upcoming: { label: 'Upcoming', bg: '#EFF6FF', fg: '#2563EB' },
  archived: { label: 'Ended', bg: '#F1F5F9', fg: '#64748B' },
};

const nextName = (sessions) => {
  const starts = sessions.map(s => parseInt(String(s.session_name).split('-')[0], 10)).filter(Number.isFinite);
  const now = new Date();
  const base = starts.length ? Math.max(...starts) + 1 : (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1);
  return `${base}-${base + 1}`;
};

// Academic year management (admin). Mirrors the web dashboard's session
// controls: GET/POST /sessions, PUT /sessions/{id},
// POST /sessions/{id}/activate and /sessions/{id}/archive.
const AcademicYearsScreen = () => {
  const { viewSession, setViewSession, reload } = useSession();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null);          // session_id being changed
  const [form, setForm] = useState(null);          // { mode: 'create'|'edit', session?, name, start, end }
  const [saving, setSaving] = useState(false);

  const load = useCallback(() =>
    client.get('/sessions')
      .then(r => setSessions(Array.isArray(r.data) ? r.data : []))
      .catch(e => Alert.alert('Could not load', errorText(e, 'Failed to load academic years.'))),
  []);

  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));
  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const afterChange = async () => { await load(); await reload?.(); };

  const run = async (sess, fn, success) => {
    setBusy(sess.session_id);
    try {
      await fn();
      await afterChange();
      if (success) Alert.alert('Done', success);
    } catch (e) {
      Alert.alert('Could not update', errorText(e, 'The academic year could not be updated.'));
    } finally {
      setBusy(null);
    }
  };

  const activate = (sess) => Alert.alert(
    `Make ${sess.session_name} the current year?`,
    'New admissions, attendance, fees and notices will go into this year for everyone. The current year stops being current.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Make Current',
        onPress: () => run(sess, async () => {
          await client.post(`/sessions/${sess.session_id}/activate`);
          await setViewSession?.(sess.session_name);
        }, `${sess.session_name} is now the current academic year.`),
      },
    ],
  );

  const archive = (sess, archived) => Alert.alert(
    archived ? `End ${sess.session_name}?` : `Reopen ${sess.session_name}?`,
    archived
      ? `${sess.session_name} becomes read-only.${sess.is_active ? ' There will be no current year until you make another year current.' : ''}`
      : `${sess.session_name} can be edited again.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: archived ? 'End Year' : 'Reopen',
        style: archived ? 'destructive' : 'default',
        onPress: () => run(sess, () => client.post(`/sessions/${sess.session_id}/archive`, { archived }), archived ? `${sess.session_name} has ended.` : `${sess.session_name} reopened.`),
      },
    ],
  );

  const openCreate = () => {
    const name = nextName(sessions);
    const sy = parseInt(name.split('-')[0], 10);
    setForm({ mode: 'create', name, start: `${sy}-04-01`, end: `${sy + 1}-03-31` });
  };

  const openEdit = (sess) => setForm({ mode: 'edit', session: sess, name: sess.session_name, start: sess.start_date || '', end: sess.end_date || '' });

  const save = async () => {
    const name = form.name.trim();
    const m = /^(\d{4})-(\d{4})$/.exec(name);
    if (!m || Number(m[2]) !== Number(m[1]) + 1) { Alert.alert('Invalid name', 'Use two consecutive years, e.g. 2026-2027.'); return; }
    if (!isISODate(form.start) || !isISODate(form.end)) { Alert.alert('Invalid dates', 'Enter dates as YYYY-MM-DD.'); return; }
    if (form.end <= form.start) { Alert.alert('Invalid dates', 'The end date must be after the start date.'); return; }
    setSaving(true);
    try {
      if (form.mode === 'create') {
        await client.post('/sessions', { session_name: name, start_date: form.start, end_date: form.end });
      } else {
        await client.put(`/sessions/${form.session.session_id}`, { start_date: form.start, end_date: form.end });
      }
      setForm(null);
      await afterChange();
    } catch (e) {
      Alert.alert('Could not save', errorText(e, 'Failed to save the academic year.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        <Text style={s.intro}>
          The current year is where new data goes. Ended years are read-only. To start a new year, end the current one, create the new year, then make it current.
        </Text>
        <PrimaryButton title="New Academic Year" icon="add" onPress={openCreate} style={{ marginBottom: 14 }} />

        {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 24 }} /> : sessions.map(sess => {
          const st = STATUS[sess.is_active ? 'active' : sess.status] || STATUS.archived;
          const viewing = sess.session_name === viewSession;
          const isBusy = busy === sess.session_id;
          return (
            <View key={sess.session_id} style={[s.card, viewing && s.cardViewing]}>
              <View style={s.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{sess.session_name}</Text>
                  <Text style={s.dates}>{dayLabel(sess.start_date)} – {dayLabel(sess.end_date)}</Text>
                </View>
                <View style={[s.badge, { backgroundColor: st.bg }]}><Text style={[s.badgeText, { color: st.fg }]}>{st.label}</Text></View>
              </View>
              {viewing && (
                <View style={s.viewingRow}>
                  <Ionicons name="eye" size={13} color={COLORS.primary} />
                  <Text style={s.viewingText}>You are viewing this year</Text>
                </View>
              )}
              {isBusy ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 12 }} /> : (
                <View style={s.actions}>
                  {!viewing && (
                    <TouchableOpacity style={s.action} onPress={() => setViewSession?.(sess.session_name)}>
                      <Ionicons name="eye-outline" size={14} color={COLORS.black} /><Text style={s.actionText}>View</Text>
                    </TouchableOpacity>
                  )}
                  {!sess.is_active && sess.status !== 'archived' && (
                    <TouchableOpacity style={s.action} onPress={() => activate(sess)}>
                      <Ionicons name="checkmark-circle-outline" size={14} color={COLORS.success} /><Text style={[s.actionText, { color: COLORS.success }]}>Make Current</Text>
                    </TouchableOpacity>
                  )}
                  {sess.status === 'archived' && !sess.is_active ? (
                    <TouchableOpacity style={s.action} onPress={() => archive(sess, false)}>
                      <Ionicons name="lock-open-outline" size={14} color={COLORS.black} /><Text style={s.actionText}>Reopen</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={s.action} onPress={() => archive(sess, true)}>
                      <Ionicons name="archive-outline" size={14} color={COLORS.danger} /><Text style={[s.actionText, { color: COLORS.danger }]}>End Year</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.action} onPress={() => openEdit(sess)}>
                    <Ionicons name="create-outline" size={14} color={COLORS.black} /><Text style={s.actionText}>Dates</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={!!form} animationType="slide" transparent onRequestClose={() => !saving && setForm(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.overlay}>
            <TouchableOpacity style={s.overlayBg} onPress={() => !saving && setForm(null)} />
            {!!form && (
              <View style={s.sheet}>
                <View style={s.handle} />
                <Text style={s.sheetTitle}>{form.mode === 'create' ? 'New Academic Year' : `Edit ${form.name}`}</Text>
                {form.mode === 'create' && (
                  <Field label="NAME" required hint="Two consecutive years, e.g. 2026-2027">
                    <Input value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} placeholder="2026-2027" keyboardType="numbers-and-punctuation" maxLength={9} />
                  </Field>
                )}
                <Field label="START DATE" required hint={isISODate(form.start) ? dayLabel(form.start) : 'YYYY-MM-DD'}>
                  <Input value={form.start} onChangeText={v => setForm(f => ({ ...f, start: v }))} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
                </Field>
                <Field label="END DATE" required hint={isISODate(form.end) ? dayLabel(form.end) : 'YYYY-MM-DD'}>
                  <Input value={form.end} onChangeText={v => setForm(f => ({ ...f, end: v }))} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
                </Field>
                {form.mode === 'create' && <Text style={s.note}>A new year starts as upcoming. A future year can only be created after the current year has ended.</Text>}
                <PrimaryButton title={form.mode === 'create' ? 'Create Year' : 'Save Dates'} icon="checkmark" onPress={save} loading={saving} />
                <SecondaryButton title="Cancel" onPress={() => setForm(null)} disabled={saving} style={{ marginTop: 10 }} />
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  intro: { fontSize: 12, color: COLORS.muted, marginBottom: 12, lineHeight: 17 },
  card: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  cardViewing: { borderColor: COLORS.primary, borderWidth: 1.5 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  name: { fontSize: 17, fontWeight: '800', color: COLORS.black },
  dates: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  viewingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  viewingText: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border },
  actionText: { fontSize: 12, fontWeight: '700', color: COLORS.black },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, ...SHADOW.md },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: COLORS.black, marginBottom: 14 },
  note: { fontSize: 11, color: COLORS.muted, marginBottom: 12 },
});

export default AcademicYearsScreen;
