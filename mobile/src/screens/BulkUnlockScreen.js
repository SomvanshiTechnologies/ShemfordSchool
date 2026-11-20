import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { Field, Input, Chips, PrimaryButton, SecondaryButton } from '../components/FormKit';
import { errorText } from '../utils/students';
import { todayISO, isISODate, dayLabel } from '../utils/attendance';

const emptyRow = () => ({ key: Math.random().toString(36).slice(2), class_name: '', section: '', date: todayISO() });

// Unlock several submitted attendance sessions at once so teachers can
// correct them. Mirrors the web dashboard's Bulk Unlock tab →
// POST /attendance/bulk-unlock. Admin only.
const BulkUnlockScreen = () => {
  const [classes, setClasses] = useState([]);
  const [rows, setRows] = useState([emptyRow()]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get('/classes').then(r => setClasses(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  const update = (key, patch) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key) => setRows(rs => (rs.length > 1 ? rs.filter(r => r.key !== key) : rs));
  // A new row copies the previous row's class and section, since admins
  // usually unlock several days for the same class.
  const addRow = () => setRows(rs => {
    const last = rs[rs.length - 1];
    return [...rs, { ...emptyRow(), class_name: last?.class_name || '', section: last?.section || '' }];
  });

  const complete = rows.filter(r => r.class_name && r.section && isISODate(r.date));

  const submit = async () => {
    const bad = rows.find(r => (r.class_name || r.section) && !isISODate(r.date));
    if (bad) { Alert.alert('Invalid date', 'Enter dates as YYYY-MM-DD.'); return; }
    if (!complete.length) { Alert.alert('Nothing to unlock', 'Fill in class, section and date for at least one row.'); return; }
    setBusy(true);
    try {
      const res = await client.post('/attendance/bulk-unlock', {
        sessions: complete.map(({ class_name, section, date }) => ({ class_name, section, date: date.trim() })),
      });
      Alert.alert('Unlocked', res.data?.message || 'Attendance unlocked.');
      setRows([emptyRow()]);
    } catch (e) {
      Alert.alert('Could not unlock', errorText(e, 'Bulk unlock failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={s.intro}>Unlocked sessions can be edited and submitted again by the class teacher.</Text>

        {rows.map((r, i) => {
          const sections = (classes.find(c => c.name === r.class_name)?.sections || []).map(x => x.section_name);
          return (
            <View key={r.key} style={s.card}>
              <View style={s.cardHead}>
                <Text style={s.cardTitle}>Session {i + 1}</Text>
                {rows.length > 1 && (
                  <TouchableOpacity onPress={() => removeRow(r.key)} hitSlop={10} accessibilityLabel={`Remove session ${i + 1}`}>
                    <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                  </TouchableOpacity>
                )}
              </View>
              <Field label="CLASS" required>
                <Chips options={classes.map(c => c.name)} value={r.class_name} onChange={v => update(r.key, { class_name: v, section: '' })} />
              </Field>
              {!!r.class_name && (
                <Field label="SECTION" required>
                  <Chips options={sections} value={r.section} onChange={v => update(r.key, { section: v })} />
                </Field>
              )}
              <Field label="DATE" required hint={isISODate(r.date) ? dayLabel(r.date) : 'Format: YYYY-MM-DD'}>
                <Input value={r.date} onChangeText={v => update(r.key, { date: v })} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
              </Field>
            </View>
          );
        })}

        <SecondaryButton title="Add Another Session" icon="add" onPress={addRow} style={{ marginBottom: 12 }} />
        <PrimaryButton
          title={complete.length ? `Unlock ${complete.length} Session${complete.length === 1 ? '' : 's'}` : 'Unlock'}
          icon="lock-open-outline"
          loading={busy}
          disabled={!complete.length}
          onPress={() => Alert.alert('Unlock attendance?', `Unlock ${complete.length} submitted session${complete.length === 1 ? '' : 's'}?`, [
            { text: 'Cancel', style: 'cancel' }, { text: 'Unlock', onPress: submit },
          ])}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 16 },
  intro: { fontSize: 12, color: COLORS.muted, marginBottom: 12, lineHeight: 17 },
  card: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: COLORS.black },
});

export default BulkUnlockScreen;
