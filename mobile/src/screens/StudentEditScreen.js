import React, { useState, useEffect } from 'react';
import { ScrollView, Alert, KeyboardAvoidingView, Platform, Text, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import client from '../api/client';
import { COLORS } from '../theme/colors';
import { FormCard, Field, Input, Chips, PrimaryButton } from '../components/FormKit';
import { sectionsFor, isStreamClass, isTenDigits, isValidEmail, errorText } from '../utils/students';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// For stream classes the web dashboard shows the stream (Science/Humanities) as
// the section, even for older students who still carry a colour section.
const initialSection = (st) =>
  isStreamClass(st.class_name) && st.stream
    ? st.stream.charAt(0).toUpperCase() + st.stream.slice(1).toLowerCase()
    : (st.section || '');

const fromStudent = (st) => ({
  phone: st.phone || '',
  email: st.email || '',
  address: st.address || '',
  roll_number: st.roll_number != null ? String(st.roll_number) : '',
  blood_group: st.blood_group || '',
  emergency_contact: st.emergency_contact || '',
  class_name: st.class_name || '',
  section: initialSection(st),
  stream: st.stream || '',
  father_name: st.father_name || st.parent_name || '',
  father_phone: st.father_phone || st.parent_phone || '',
  father_occupation: st.father_occupation || '',
  mother_name: st.mother_name || '',
  mother_phone: st.mother_phone || '',
  mother_occupation: st.mother_occupation || '',
  parent_email: st.parent_email || '',
});

// Mirrors the web dashboard's Edit Student dialog → PUT /students/{id}.
const StudentEditScreen = () => {
  const navigation = useNavigation();
  const { params } = useRoute();
  const student = params?.student || {};
  const [classes, setClasses] = useState([]);
  const [form, setForm] = useState(() => fromStudent(student));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    client.get('/classes').then(r => setClasses(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    // The list item may not carry every field, so load the full record.
    client.get(`/students/${student.student_id}`).then(r => setForm(fromStudent(r.data))).catch(() => {});
  }, [student.student_id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setSection = (v) => setForm(f => ({ ...f, section: v, ...(isStreamClass(f.class_name) ? { stream: v.toLowerCase() } : {}) }));
  const setClass = (v) => setForm(f => ({ ...f, class_name: v, section: '', ...(isStreamClass(v) ? {} : { stream: '' }) }));

  const save = async () => {
    if (!form.phone.trim()) { Alert.alert('Missing field', 'Phone is required.'); return; }
    if (!isTenDigits(form.phone)) { Alert.alert('Invalid phone', 'Phone must be exactly 10 digits.'); return; }
    if (!form.address.trim()) { Alert.alert('Missing field', 'Address is required.'); return; }
    if (!form.class_name || !form.section) { Alert.alert('Missing field', 'Select a class and a section.'); return; }
    for (const [k, label] of [['father_phone', 'Father phone'], ['mother_phone', 'Mother phone'], ['emergency_contact', 'Emergency contact']]) {
      if (form[k].trim() && !isTenDigits(form[k])) { Alert.alert('Invalid number', `${label} must be 10 digits.`); return; }
    }
    for (const [k, label] of [['email', 'Student email'], ['parent_email', 'Parent email']]) {
      if (form[k].trim() && !isValidEmail(form[k])) { Alert.alert('Invalid email', `${label} is not a valid email address.`); return; }
    }

    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
    if (!isStreamClass(body.class_name)) delete body.stream;

    setSaving(true);
    try {
      await client.put(`/students/${student.student_id}`, body);
      Alert.alert('Saved', 'Student details updated.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e) {
      Alert.alert('Could not save', errorText(e, 'Failed to update student.'));
    } finally {
      setSaving(false);
    }
  };

  const sections = sectionsFor(classes, form.class_name);
  const classMoved = form.class_name !== (student.class_name || '');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <FormCard title={`${student.first_name || ''} ${student.last_name || ''}`.trim() || 'Student'}>
          <Field label="ADMISSION NUMBER" hint="Admission number can't be changed">
            <Input value={student.admission_number || ''} editable={false} />
          </Field>
          <Field label="ROLL NUMBER">
            <Input value={form.roll_number} onChangeText={v => set('roll_number', v)} placeholder="Roll number" keyboardType="number-pad" />
          </Field>
        </FormCard>

        <FormCard title="Class">
          <Field label="CLASS" required>
            <Chips options={classes.map(c => c.name)} value={form.class_name} onChange={setClass} />
          </Field>
          {!!form.class_name && (
            <Field label="SECTION" required>
              <Chips options={sections} value={form.section} onChange={setSection} />
            </Field>
          )}
          {classMoved && (
            <Text style={s.warn}>Changing the class recalculates this student's fees. For yearly promotion, use Upgradation instead.</Text>
          )}
        </FormCard>

        <FormCard title="Contact">
          <Field label="PHONE" required>
            <Input value={form.phone} onChangeText={v => set('phone', v)} placeholder="10-digit number" keyboardType="phone-pad" maxLength={10} />
          </Field>
          <Field label="EMAIL" hint="Also updates the student's login email">
            <Input value={form.email} onChangeText={v => set('email', v)} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" />
          </Field>
          <Field label="ADDRESS" required>
            <Input value={form.address} onChangeText={v => set('address', v)} placeholder="Full address" multiline />
          </Field>
          <Field label="EMERGENCY CONTACT">
            <Input value={form.emergency_contact} onChangeText={v => set('emergency_contact', v)} placeholder="10-digit number" keyboardType="phone-pad" maxLength={10} />
          </Field>
          <Field label="BLOOD GROUP">
            <Chips options={BLOOD_GROUPS} value={form.blood_group} onChange={v => set('blood_group', form.blood_group === v ? '' : v)} capitalize={false} />
          </Field>
        </FormCard>

        <FormCard title="Father / Guardian">
          <Field label="NAME"><Input value={form.father_name} onChangeText={v => set('father_name', v)} placeholder="Name" /></Field>
          <Field label="PHONE"><Input value={form.father_phone} onChangeText={v => set('father_phone', v)} placeholder="10-digit number" keyboardType="phone-pad" maxLength={10} /></Field>
          <Field label="OCCUPATION"><Input value={form.father_occupation} onChangeText={v => set('father_occupation', v)} placeholder="Occupation" /></Field>
          <Field label="PARENT EMAIL"><Input value={form.parent_email} onChangeText={v => set('parent_email', v)} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" /></Field>
        </FormCard>

        <FormCard title="Mother">
          <Field label="NAME"><Input value={form.mother_name} onChangeText={v => set('mother_name', v)} placeholder="Name" /></Field>
          <Field label="PHONE"><Input value={form.mother_phone} onChangeText={v => set('mother_phone', v)} placeholder="10-digit number" keyboardType="phone-pad" maxLength={10} /></Field>
          <Field label="OCCUPATION"><Input value={form.mother_occupation} onChangeText={v => set('mother_occupation', v)} placeholder="Occupation" /></Field>
        </FormCard>

        <PrimaryButton title="Save Changes" icon="checkmark" onPress={save} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 16 },
  warn: { fontSize: 11, color: COLORS.warning, marginTop: -2 },
});

export default StudentEditScreen;
