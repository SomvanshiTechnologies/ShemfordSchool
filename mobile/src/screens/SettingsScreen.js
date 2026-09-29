import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { Badge } from '../components/UI';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';

// System-generated logins use a synthetic address; hide it so the user can add a real one.
const isSyntheticEmail = (em) => /@(student|staff)\.shemford\.in$/i.test(em || '');

const Field = ({ label, children }) => (
  <View style={s.field}>
    <Text style={s.label}>{label}</Text>
    {children}
  </View>
);

const SettingsScreen = () => {
  const { user, checkAuth, logout } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { activeSession, viewSession, availableSessions, sessions, setViewSession } = useSession() || {};
  const [tab, setTab] = useState('profile');

  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [email, setEmail] = useState(isSyntheticEmail(user?.email) ? '' : (user?.email || ''));
  const [savingProfile, setSavingProfile] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  const [delReq, setDelReq] = useState(null);
  const [delReason, setDelReason] = useState('');
  const [delLoading, setDelLoading] = useState(false);

  useEffect(() => {
    client.get('/account-deletion/my-request')
      .then(r => setDelReq(r.data?.request || null))
      .catch(() => setDelReq(null));
  }, [user?.user_id]);

  const saveProfile = async () => {
    if (!name.trim()) { Alert.alert('Name required', 'Name cannot be empty.'); return; }
    setSavingProfile(true);
    try {
      const payload = { name: name.trim(), phone: phone.trim() || null };
      if (email.trim()) payload.email = email.trim();
      await client.put('/auth/me', payload);
      await checkAuth();
      Alert.alert('Saved', 'Profile updated.');
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to update profile.');
    } finally { setSavingProfile(false); }
  };

  const changePassword = async () => {
    if (pw.next !== pw.confirm) { Alert.alert('Mismatch', 'New passwords do not match.'); return; }
    if (pw.next.length < 8) { Alert.alert('Too short', 'Password must be at least 8 characters.'); return; }
    setSavingPw(true);
    try {
      await client.put('/settings/change-password', { current_password: pw.current, new_password: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      Alert.alert('Password changed', 'Please sign in again with your new password.', [{ text: 'OK', onPress: logout }]);
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to change password.');
    } finally { setSavingPw(false); }
  };

  const requestDeletion = () => {
    Alert.alert(
      'Request account deletion?',
      'Your request is sent to an administrator for approval. Once approved it cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Request', style: 'destructive',
          onPress: async () => {
            setDelLoading(true);
            try {
              const r = await client.post('/account-deletion/request', { reason: delReason.trim() || undefined });
              setDelReq(r.data?.request || null);
              setDelReason('');
              Alert.alert('Request sent', 'An admin will review your deletion request.');
            } catch (e) {
              Alert.alert('Error', e.response?.data?.detail || 'Failed to submit request.');
            } finally { setDelLoading(false); }
          },
        },
      ]
    );
  };

  const cancelDeletion = async () => {
    if (!delReq) return;
    setDelLoading(true);
    try {
      await client.post(`/account-deletion/${delReq.request_id}/cancel`);
      setDelReq(null);
      Alert.alert('Cancelled', 'Deletion request withdrawn.');
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to cancel.');
    } finally { setDelLoading(false); }
  };

  const pendingDeletion = delReq && ['pending', 'approved'].includes(delReq.status);

  const switchSession = (name) => {
    if (name === viewSession) return;
    Alert.alert(
      `View ${name}?`,
      name === activeSession
        ? 'This returns you to the current academic year.'
        : 'You will see data for this past academic year until you switch back.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'View', onPress: () => setViewSession(name) },
      ]
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={s.tabs}>
          {[
            ['profile', 'person-outline', 'Profile'],
            ['password', 'lock-closed-outline', 'Password'],
            ...(isAdmin ? [['session', 'calendar-outline', 'Session']] : []),
          ].map(([key, icon, label]) => (
            <TouchableOpacity key={key} style={[s.tab, tab === key && s.tabActive]} onPress={() => setTab(key)}>
              <Ionicons name={icon} size={15} color={tab === key ? COLORS.black : COLORS.muted} />
              <Text style={[s.tabText, tab === key && s.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'profile' && (
          <>
            <View style={s.card}>
              <Text style={s.cardTitle}>My Profile</Text>
              <Field label="NAME">
                <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={COLORS.lightMuted} />
              </Field>
              <Field label="PHONE">
                <TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder="Phone number" placeholderTextColor={COLORS.lightMuted} keyboardType="phone-pad" />
              </Field>
              <Field label="EMAIL">
                <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder="you@example.com (optional)" placeholderTextColor={COLORS.lightMuted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
              </Field>
              <Field label="ROLE">
                <View style={{ flexDirection: 'row' }}><Badge text={user?.role || 'user'} variant="dark" /></View>
              </Field>
              <Text style={s.hint}>
                Add or update your email to log in with it. You can also log in with your admission/employee ID. Role can't be changed here — contact an admin.
              </Text>
              <TouchableOpacity style={s.primaryBtn} onPress={saveProfile} disabled={savingProfile}>
                {savingProfile ? <ActivityIndicator color={COLORS.white} /> : <Text style={s.primaryBtnText}>Save Profile</Text>}
              </TouchableOpacity>
            </View>

            <View style={[s.card, s.dangerCard]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                <Text style={[s.cardTitle, { color: COLORS.danger, marginBottom: 0 }]}>Delete My Account</Text>
              </View>
              {pendingDeletion ? (
                <>
                  <Text style={s.dangerText}>
                    Your deletion request is <Text style={{ fontWeight: '700' }}>{delReq.status}</Text>. You can withdraw it while it is still pending.
                  </Text>
                  {delReq.status === 'pending' && (
                    <TouchableOpacity style={s.outlineBtn} onPress={cancelDeletion} disabled={delLoading}>
                      {delLoading ? <ActivityIndicator color={COLORS.black} /> : <Text style={s.outlineBtnText}>Withdraw Request</Text>}
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <>
                  <Text style={s.dangerText}>
                    Permanently delete your account and all associated data. Your request is sent to an administrator for approval; once approved it cannot be undone.
                  </Text>
                  <TextInput
                    style={[s.input, { minHeight: 70, marginBottom: 12 }]}
                    value={delReason}
                    onChangeText={setDelReason}
                    placeholder="Reason (optional)"
                    placeholderTextColor={COLORS.lightMuted}
                    multiline
                    textAlignVertical="top"
                  />
                  <TouchableOpacity style={s.dangerBtn} onPress={requestDeletion} disabled={delLoading}>
                    {delLoading ? <ActivityIndicator color={COLORS.white} /> : (
                      <>
                        <Ionicons name="trash-outline" size={16} color={COLORS.white} />
                        <Text style={s.primaryBtnText}>Request Account Deletion</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </>
        )}

        {tab === 'password' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Change Password</Text>
            {[['current', 'CURRENT PASSWORD'], ['next', 'NEW PASSWORD'], ['confirm', 'CONFIRM NEW PASSWORD']].map(([key, label]) => (
              <Field key={key} label={label}>
                <TextInput
                  style={s.input}
                  value={pw[key]}
                  onChangeText={v => setPw(p => ({ ...p, [key]: v }))}
                  secureTextEntry={!showPw}
                  placeholder={key === 'current' ? 'Enter current password' : 'Min 8 characters'}
                  placeholderTextColor={COLORS.lightMuted}
                  autoCapitalize="none"
                />
              </Field>
            ))}
            <TouchableOpacity onPress={() => setShowPw(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={16} color={COLORS.muted} />
              <Text style={{ fontSize: 12, color: COLORS.muted }}>{showPw ? 'Hide' : 'Show'} passwords</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.primaryBtn} onPress={changePassword} disabled={savingPw}>
              {savingPw ? <ActivityIndicator color={COLORS.white} /> : <Text style={s.primaryBtnText}>Update Password</Text>}
            </TouchableOpacity>
          </View>
        )}

        {tab === 'session' && isAdmin && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Academic Year</Text>
            <Text style={s.hint}>
              Choose which academic year's data you're viewing across the app. Your choice is remembered until you switch back.
            </Text>
            {(availableSessions || []).map((name) => {
              const meta = (sessions || []).find(sn => sn.session_name === name);
              const isCurrentView = name === viewSession;
              const isActive = name === activeSession;
              return (
                <TouchableOpacity
                  key={name}
                  style={[s.sessionRow, isCurrentView && s.sessionRowActive]}
                  onPress={() => switchSession(name)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.sessionName}>{name}</Text>
                    {isActive && <Text style={s.sessionSub}>Current year</Text>}
                    {!isActive && meta?.status === 'archived' && <Text style={s.sessionSub}>Previous year</Text>}
                  </View>
                  {isCurrentView && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />}
                </TouchableOpacity>
              );
            })}
            {(availableSessions || []).length === 0 && (
              <Text style={{ fontSize: 13, color: COLORS.lightMuted }}>No sessions found.</Text>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 16 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: COLORS.lightBg, borderColor: COLORS.lightBg },
  tabText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  tabTextActive: { color: COLORS.black },
  card: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
  },
  dangerCard: { borderColor: '#FECACA' },
  cardTitle: { ...FONTS.h2, fontSize: 15, marginBottom: 12 },
  field: { marginBottom: 12 },
  label: { ...FONTS.small, marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: COLORS.black, backgroundColor: COLORS.white,
  },
  hint: { fontSize: 12, color: COLORS.muted, lineHeight: 17, marginBottom: 14 },
  primaryBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, ...SHADOW.sm,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.white },
  outlineBtn: {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.lg, paddingVertical: 12,
    alignItems: 'center', backgroundColor: COLORS.white,
  },
  outlineBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.black },
  dangerBtn: {
    backgroundColor: COLORS.danger, borderRadius: RADIUS.lg, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  dangerText: { fontSize: 13, color: COLORS.black, lineHeight: 19, marginBottom: 12 },
  sessionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: RADIUS.md,
    borderWidth: 1.5, borderColor: COLORS.border, marginBottom: 8,
  },
  sessionRowActive: { borderColor: COLORS.primary, backgroundColor: COLORS.lightBg },
  sessionName: { fontSize: 14, fontWeight: '700', color: COLORS.black },
  sessionSub: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
});

export default SettingsScreen;
