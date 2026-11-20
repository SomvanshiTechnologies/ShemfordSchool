import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { Badge } from '../components/UI';
import { Input, SecondaryButton } from '../components/FormKit';
import { useAuth } from '../contexts/AuthContext';
import { errorText } from '../utils/students';

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

const ActionRow = ({ icon, title, sub, onPress, right, danger, busy }) => (
  <TouchableOpacity style={styles.actionRow} onPress={onPress} disabled={!onPress || busy} activeOpacity={onPress ? 0.6 : 1}>
    <Ionicons name={icon} size={20} color={danger ? COLORS.danger : COLORS.black} />
    <View style={{ flex: 1 }}>
      <Text style={[styles.actionTitle, danger && { color: COLORS.danger }]}>{title}</Text>
      {!!sub && <Text style={styles.actionSub}>{sub}</Text>}
    </View>
    {busy ? <ActivityIndicator size="small" color={COLORS.primary} /> : right}
  </TouchableOpacity>
);

const StudentDetailScreen = ({ route }) => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [student, setStudent] = useState(route.params?.student || {});
  const [busy, setBusy] = useState(null);          // 'access' | 'status' | 'password'
  const [pwOpen, setPwOpen] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwResult, setPwResult] = useState(null);

  const id = route.params?.student?.student_id;
  // Refetch on focus so edits made on the Edit screen show straight away.
  // Inactive students return 404 here, so the list data is kept for them.
  const load = useCallback(() => {
    if (!id) return;
    client.get(`/students/${id}`).then(r => setStudent(s => ({ ...s, ...r.data }))).catch(() => {});
  }, [id]);
  useFocusEffect(load);

  const isActive = student.is_active !== false;
  const appAccess = !!student.web_login_enabled;
  const name = `${student.first_name || ''} ${student.last_name || ''}`.trim();

  const toggleAccess = async (next) => {
    setBusy('access');
    try {
      await client.patch(`/students/${id}/web-login`, { web_login_enabled: next });
      setStudent(s => ({ ...s, web_login_enabled: next }));
    } catch (e) {
      Alert.alert('Could not update', errorText(e, 'Failed to update app access.'));
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async (custom) => {
    if (custom && pwInput.trim().length < 6) { Alert.alert('Too short', 'Password must be at least 6 characters.'); return; }
    setBusy('password');
    try {
      const res = await client.post(`/students/${id}/reset-password`, custom ? { password: pwInput.trim() } : {});
      setPwResult(res.data);
      setPwInput('');
      setPwOpen(false);
    } catch (e) {
      Alert.alert('Could not reset', errorText(e, 'Failed to reset password.'));
    } finally {
      setBusy(null);
    }
  };

  const confirmReset = () => Alert.alert(
    'Reset password',
    'Set the password back to the date of birth (DDMMYYYY)?',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Reset', onPress: () => resetPassword(false) }],
  );

  const deactivate = () => Alert.alert(
    'Deactivate student',
    `${name} will be removed from active lists and won't be able to log in. You can reactivate them later.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deactivate', style: 'destructive', onPress: async () => {
          setBusy('status');
          try {
            await client.delete(`/students/${id}`);
            setStudent(s => ({ ...s, is_active: false }));
            setPwResult(null);
            Alert.alert('Deactivated', `${name} has been deactivated.`);
          } catch (e) {
            Alert.alert('Could not deactivate', errorText(e, 'Failed to deactivate student.'));
          } finally {
            setBusy(null);
          }
        },
      },
    ],
  );

  const reactivate = async () => {
    setBusy('status');
    try {
      await client.put(`/students/${id}/reactivate`);
      setStudent(s => ({ ...s, is_active: true }));
      load();
      Alert.alert('Reactivated', `${name} is active again.`);
    } catch (e) {
      Alert.alert('Could not reactivate', errorText(e, 'Failed to reactivate student.'));
    } finally {
      setBusy(null);
    }
  };

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
        {isActive ? <Badge text={fee.text} variant={fee.variant} /> : <Badge text="Inactive" variant="danger" />}
      </View>

      {isAdmin && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Manage</Text>
          {isActive && (
            <>
              <ActionRow
                icon="create-outline"
                title="Edit details"
                sub="Contact, class, parents"
                onPress={() => navigation.navigate('StudentEdit', { student })}
                right={<Ionicons name="chevron-forward" size={16} color={COLORS.lightMuted} />}
              />
              <ActionRow
                icon="phone-portrait-outline"
                title="App access"
                sub={appAccess ? 'Shown in the app and can log in' : 'Hidden from the app and cannot log in'}
                busy={busy === 'access'}
                right={(
                  <Switch
                    value={appAccess}
                    onValueChange={toggleAccess}
                    trackColor={{ true: COLORS.primary, false: COLORS.border }}
                    thumbColor={COLORS.white}
                  />
                )}
              />
              <ActionRow
                icon="key-outline"
                title="Reset password to date of birth"
                sub="Password becomes DDMMYYYY"
                onPress={confirmReset}
                busy={busy === 'password' && !pwOpen}
              />
              <ActionRow
                icon="lock-closed-outline"
                title="Set a custom password"
                onPress={() => { setPwOpen(o => !o); setPwResult(null); }}
                right={<Ionicons name={pwOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.lightMuted} />}
              />
              {pwOpen && (
                <View style={styles.pwBox}>
                  <Input value={pwInput} onChangeText={setPwInput} placeholder="New password (min 6 characters)" autoCapitalize="none" autoCorrect={false} />
                  <SecondaryButton title="Set Password" icon="checkmark" onPress={() => resetPassword(true)} loading={busy === 'password'} style={{ marginTop: 8 }} />
                </View>
              )}
              {!!pwResult && (
                <View style={styles.pwResult}>
                  <Text style={styles.pwResultTitle}>{pwResult.message || 'Password updated'}</Text>
                  <Text style={styles.pwLine} selectable>Login: {student.admission_number || pwResult.email}</Text>
                  <Text style={styles.pwLine} selectable>Password: {pwResult.password}</Text>
                </View>
              )}
            </>
          )}
          {isActive ? (
            <ActionRow icon="person-remove-outline" title="Deactivate student" sub="Can be reactivated later" onPress={deactivate} danger busy={busy === 'status'} />
          ) : (
            <ActionRow icon="person-add-outline" title="Reactivate student" sub="Restores the student and their login" onPress={reactivate} busy={busy === 'status'} />
          )}
        </View>
      )}

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
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.lightBg },
  actionTitle: { fontSize: 14, fontWeight: '600', color: COLORS.black },
  actionSub: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  pwBox: { paddingBottom: 12 },
  pwResult: { backgroundColor: COLORS.lightBg, borderRadius: RADIUS.md, padding: 12, marginBottom: 12 },
  pwResultTitle: { fontSize: 12, fontWeight: '700', color: COLORS.success, marginBottom: 4 },
  pwLine: { fontSize: 13, fontFamily: 'monospace', color: COLORS.black },
});

export default StudentDetailScreen;
