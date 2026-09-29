import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { Badge } from '../components/UI';

const feeBadge = (status) => {
  if (status === 'paid') return { text: 'Paid', variant: 'dark' };
  if (status === 'overdue') return { text: 'Overdue', variant: 'danger' };
  if (status === 'partial') return { text: 'Partial', variant: 'muted' };
  return { text: 'Pending', variant: 'warning' };
};

const Field = ({ label, value, full, capitalize }) => (
  <View style={[styles.field, full && styles.fieldFull]}>
    <Text style={styles.label}>{label}</Text>
    <Text style={[styles.value, capitalize && { textTransform: 'capitalize' }]}>{value || '-'}</Text>
  </View>
);

const StudentDetailScreen = ({ route }) => {
  const [student, setStudent] = useState(route.params?.student || {});

  useEffect(() => {
    const id = route.params?.student?.student_id;
    if (!id) return;
    client.get(`/students/${id}`).then(r => setStudent(s => ({ ...s, ...r.data }))).catch(() => {});
  }, [route.params?.student?.student_id]);

  const fee = feeBadge(student.fee_status);
  const classLabel = student.class_name
    ? `Class ${student.class_name} - ${student.section || ''}${student.stream ? ` (${student.stream})` : ''}`
    : '-';

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="school-outline" size={30} color={COLORS.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{student.first_name} {student.last_name}</Text>
          <Text style={styles.admLabel}>
            Admission No: <Text style={styles.adm} selectable>{student.admission_number}</Text>
          </Text>
        </View>
        <Badge text={fee.text} variant={fee.variant} />
      </View>

      <View style={styles.card}>
        <View style={styles.grid}>
          <Field label="Class" value={classLabel} />
          <Field label="Academic Year" value={student.academic_year} />
          <Field label="Roll Number" value={student.roll_number} />
          <Field label="Gender" value={student.gender} capitalize />
          <Field label="Date of Birth" value={student.date_of_birth} />
          <Field label="Email" value={student.email} />
          <Field label="Phone" value={student.phone} />
          <Field label="Address" value={student.address} full />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Parent / Guardian</Text>

        <Text style={styles.subhead}>Father</Text>
        <View style={styles.grid}>
          <Field label="Name" value={student.father_name || student.parent_name} />
          <Field label="Phone" value={student.father_phone || student.parent_phone} />
          <Field label="Occupation" value={student.father_occupation} />
        </View>

        <Text style={styles.subhead}>Mother</Text>
        <View style={styles.grid}>
          <Field label="Name" value={student.mother_name} />
          <Field label="Phone" value={student.mother_phone} />
          <Field label="Occupation" value={student.mother_occupation} />
        </View>

        <View style={styles.divider} />
        <View style={styles.grid}>
          <Field label="Parent Email" value={student.parent_email} full />
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 16 },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: COLORS.lightBg, borderRadius: RADIUS.xl, padding: 16, marginBottom: 12,
  },
  heroIcon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.white,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  name: { fontSize: 18, fontWeight: '800', color: COLORS.black, letterSpacing: -0.3 },
  admLabel: { fontSize: 12, color: COLORS.muted, marginTop: 4 },
  adm: { fontFamily: 'monospace', fontWeight: '700', color: COLORS.black },
  card: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  field: { width: '50%', paddingRight: 8 },
  fieldFull: { width: '100%' },
  label: { fontSize: 11, color: COLORS.muted, marginBottom: 2 },
  value: { fontSize: 14, fontWeight: '600', color: COLORS.black },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.black, marginBottom: 12 },
  subhead: {
    fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8,
    color: COLORS.lightMuted, marginTop: 4, marginBottom: 8,
  },
  divider: { height: 1, backgroundColor: COLORS.lightBg, marginVertical: 14 },
});

export default StudentDetailScreen;
