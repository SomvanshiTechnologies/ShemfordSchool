import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';

const Field = ({ label, required, children }) => (
  <View style={s.field}>
    <Text style={s.label}>{label}{required ? <Text style={{ color: COLORS.danger }}> *</Text> : null}</Text>
    {children}
  </View>
);

const Chips = ({ options, value, onChange }) => (
  <View style={s.chipRow}>
    {options.map(o => (
      <TouchableOpacity key={o} style={[s.chip, value === o && s.chipActive]} onPress={() => onChange(o)}>
        <Text style={[s.chipText, value === o && s.chipTextActive]}>{o}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

// Mirrors the dashboard's New Admission dialog — same POST /students endpoint,
// same class/section/stream rules (stream only for 11th/12th).
const NewAdmissionScreen = () => {
  const navigation = useNavigation();
  const [classes, setClasses] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: '', last_name: '', gender: '', date_of_birth: '',
    class_name: '', section: '', stream: '',
    parent_name: '', parent_phone: '', phone: '', address: '',
  });

  useEffect(() => {
    client.get('/classes')
      .then(r => setClasses(Array.isArray(r.data) ? r.data : []))
      .catch(() => setClasses([]));
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const selectedClass = classes.find(c => c.name === form.class_name);
  const sections = (selectedClass?.sections || []).map(sn => sn.section_name);
  const needsStream = !!selectedClass?.has_streams;
  const streams = selectedClass?.streams || ['science', 'humanities'];

  const submit = async () => {
    const required = [
      ['first_name', 'First name'], ['last_name', 'Last name'], ['gender', 'Gender'],
      ['date_of_birth', 'Date of birth'], ['class_name', 'Class'], ['section', 'Section'],
    ];
    for (const [k, label] of required) {
      if (!String(form[k] || '').trim()) { Alert.alert('Missing field', `${label} is required.`); return; }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date_of_birth.trim())) {
      Alert.alert('Invalid date', 'Date of birth must be in YYYY-MM-DD format, e.g. 2019-06-15.');
      return;
    }
    if (needsStream && !form.stream) {
      Alert.alert('Missing field', `Stream is required for ${form.class_name}.`);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        gender: form.gender,
        date_of_birth: form.date_of_birth.trim(),
        class_name: form.class_name,
        section: form.section,
        ...(needsStream ? { stream: form.stream } : {}),
        ...(form.parent_name.trim() ? { parent_name: form.parent_name.trim() } : {}),
        ...(form.parent_phone.trim() ? { parent_phone: form.parent_phone.trim() } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.address.trim() ? { address: form.address.trim() } : {}),
      };
      const res = await client.post('/students', payload);
      const adm = res.data?.admission_number || res.data?.student?.admission_number || '';
      Alert.alert(
        'Admission created',
        `${form.first_name} ${form.last_name} admitted${adm ? ` — Admission No. ${adm}` : ''}.\n\nNote: the student appears in this app's list once ticked in the dashboard's Students table.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      const detail = e.response?.data?.detail;
      const msg = typeof detail === 'string'
        ? detail
        : detail?.validation_errors
          ? Object.values(detail.validation_errors).join('\n')
          : 'Could not create admission.';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.cardTitle}>Student Details</Text>
          <Field label="FIRST NAME" required>
            <TextInput style={s.input} value={form.first_name} onChangeText={v => set('first_name', v)} placeholder="First name" placeholderTextColor={COLORS.lightMuted} />
          </Field>
          <Field label="LAST NAME" required>
            <TextInput style={s.input} value={form.last_name} onChangeText={v => set('last_name', v)} placeholder="Last name" placeholderTextColor={COLORS.lightMuted} />
          </Field>
          <Field label="GENDER" required>
            <Chips options={['male', 'female']} value={form.gender} onChange={v => set('gender', v)} />
          </Field>
          <Field label="DATE OF BIRTH" required>
            <TextInput style={s.input} value={form.date_of_birth} onChangeText={v => set('date_of_birth', v)} placeholder="YYYY-MM-DD" placeholderTextColor={COLORS.lightMuted} keyboardType="numbers-and-punctuation" />
          </Field>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Class Placement</Text>
          <Field label="CLASS" required>
            <Chips
              options={classes.map(c => c.name)}
              value={form.class_name}
              onChange={v => setForm(f => ({ ...f, class_name: v, section: '', stream: '' }))}
            />
          </Field>
          {!!form.class_name && (
            <Field label="SECTION" required>
              <Chips options={sections} value={form.section} onChange={v => set('section', v)} />
            </Field>
          )}
          {needsStream && (
            <Field label="STREAM" required>
              <Chips options={streams} value={form.stream} onChange={v => set('stream', v)} />
            </Field>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Parent / Contact (optional)</Text>
          <Field label="FATHER / GUARDIAN NAME">
            <TextInput style={s.input} value={form.parent_name} onChangeText={v => set('parent_name', v)} placeholder="Parent name" placeholderTextColor={COLORS.lightMuted} />
          </Field>
          <Field label="PARENT PHONE">
            <TextInput style={s.input} value={form.parent_phone} onChangeText={v => set('parent_phone', v)} placeholder="Phone number" placeholderTextColor={COLORS.lightMuted} keyboardType="phone-pad" />
          </Field>
          <Field label="STUDENT PHONE">
            <TextInput style={s.input} value={form.phone} onChangeText={v => set('phone', v)} placeholder="Phone number" placeholderTextColor={COLORS.lightMuted} keyboardType="phone-pad" />
          </Field>
          <Field label="ADDRESS">
            <TextInput style={[s.input, { minHeight: 64 }]} value={form.address} onChangeText={v => set('address', v)} placeholder="Address" placeholderTextColor={COLORS.lightMuted} multiline textAlignVertical="top" />
          </Field>
        </View>

        <TouchableOpacity style={s.primaryBtn} onPress={submit} disabled={saving}>
          {saving ? <ActivityIndicator color={COLORS.white} /> : (
            <>
              <Ionicons name="person-add" size={16} color={COLORS.white} />
              <Text style={s.primaryBtnText}>Create Admission</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 16 },
  card: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
  },
  cardTitle: { ...FONTS.h2, fontSize: 15, marginBottom: 12 },
  field: { marginBottom: 12 },
  label: { ...FONTS.small, marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: COLORS.black, backgroundColor: COLORS.white,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 12, fontWeight: '600', color: COLORS.muted, textTransform: 'capitalize' },
  chipTextActive: { color: COLORS.white },
  primaryBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginBottom: 20, ...SHADOW.sm,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.white },
});

export default NewAdmissionScreen;
