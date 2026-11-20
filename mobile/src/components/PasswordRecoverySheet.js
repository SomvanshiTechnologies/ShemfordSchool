import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, Alert, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, SHADOW } from '../theme/colors';
import { Field, Input, Chips, PrimaryButton, SecondaryButton } from './FormKit';
import { errorText, isValidEmail, isIsoDate } from '../utils/students';

const MODES = [
  { value: 'email', label: 'Staff / Parent' },
  { value: 'student', label: 'Student' },
];

// The reset email links to <web>/login?reset_token=XYZ. Accept the whole link
// or just the code.
const tokenFrom = (text) => {
  const t = (text || '').trim();
  const m = /[?&]reset_token=([^&#\s]+)/.exec(t);
  return m ? decodeURIComponent(m[1]) : t;
};

// Password recovery from the login screen. Mirrors the web login page:
//   Staff / parents → POST /auth/forgot-password, then POST /auth/reset-password
//   Students        → POST /auth/student-reset-password (admission no. + date of birth)
const PasswordRecoverySheet = ({ visible, onClose, initialId }) => {
  const [mode, setMode] = useState('email');
  const [step, setStep] = useState('request');   // email mode: 'request' | 'reset'
  const [email, setEmail] = useState('');
  const [resetLink, setResetLink] = useState('');
  const [admission, setAdmission] = useState('');
  const [dob, setDob] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const id = (initialId || '').trim();
    const looksLikeEmail = id.includes('@');
    setMode(id && !looksLikeEmail ? 'student' : 'email');
    setStep('request');
    setEmail(looksLikeEmail ? id : '');
    setAdmission(id && !looksLikeEmail ? id : '');
    setResetLink(''); setDob(''); setPw(''); setPw2(''); setShowPw(false);
  }, [visible, initialId]);

  const checkNewPassword = () => {
    if (pw.length < 8) { Alert.alert('Password too short', 'Use at least 8 characters.'); return false; }
    if (pw !== pw2) { Alert.alert("Passwords don't match", 'Type the same new password twice.'); return false; }
    return true;
  };

  const sendLink = async () => {
    const e = email.trim().toLowerCase();
    if (!isValidEmail(e)) { Alert.alert('Invalid email', 'Enter the email address you sign in with.'); return; }
    setBusy(true);
    try {
      const res = await client.post('/auth/forgot-password', { email: e });
      Alert.alert('Check your email', res.data?.message || 'If that email exists, a reset link has been sent.');
      setStep('reset');
    } catch (err) {
      Alert.alert('Could not send', errorText(err, 'Failed to send the reset email.'));
    } finally {
      setBusy(false);
    }
  };

  const resetWithLink = async () => {
    const token = tokenFrom(resetLink);
    if (!token) { Alert.alert('Missing link', 'Paste the reset link from the email.'); return; }
    if (!checkNewPassword()) return;
    setBusy(true);
    try {
      await client.post('/auth/reset-password', { token, new_password: pw });
      Alert.alert('Password changed', 'Sign in with your new password.', [{ text: 'OK', onPress: onClose }]);
    } catch (err) {
      Alert.alert('Could not reset', errorText(err, 'The link is invalid or has expired.'));
    } finally {
      setBusy(false);
    }
  };

  const resetStudent = async () => {
    if (!admission.trim()) { Alert.alert('Missing field', 'Enter the admission number.'); return; }
    if (!isIsoDate(dob)) { Alert.alert('Invalid date', 'Enter the date of birth as YYYY-MM-DD, e.g. 2012-06-15.'); return; }
    if (!checkNewPassword()) return;
    setBusy(true);
    try {
      await client.post('/auth/student-reset-password', {
        admission_number: admission.trim(), date_of_birth: dob.trim(), new_password: pw,
      });
      Alert.alert('Password changed', 'Sign in with your admission number and new password.', [{ text: 'OK', onPress: onClose }]);
    } catch (err) {
      Alert.alert('Could not reset', errorText(err, 'Failed to reset the password.'));
    } finally {
      setBusy(false);
    }
  };

  const passwordFields = (
    <>
      <Field label="NEW PASSWORD" required hint="At least 8 characters">
        <Input value={pw} onChangeText={setPw} placeholder="New password" secureTextEntry={!showPw} autoCapitalize="none" autoCorrect={false} />
      </Field>
      <Field label="CONFIRM NEW PASSWORD" required>
        <Input value={pw2} onChangeText={setPw2} placeholder="Type it again" secureTextEntry={!showPw} autoCapitalize="none" autoCorrect={false} />
      </Field>
      <TouchableOpacity style={s.showRow} onPress={() => setShowPw(v => !v)}>
        <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={16} color={COLORS.muted} />
        <Text style={s.showText}>{showPw ? 'Hide passwords' : 'Show passwords'}</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => !busy && onClose()}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.overlay}>
          <TouchableOpacity style={s.bg} onPress={() => !busy && onClose()} />
          <View style={s.sheet}>
            <View style={s.handle} />
            <Text style={s.title}>Reset Password</Text>
            <View style={{ marginVertical: 12 }}>
              <Chips options={MODES} value={mode} onChange={setMode} capitalize={false} />
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 480 }}>
              {mode === 'student' ? (
                <>
                  <Text style={s.sub}>Students can reset their own password with their admission number and date of birth.</Text>
                  <Field label="ADMISSION NUMBER" required>
                    <Input value={admission} onChangeText={setAdmission} placeholder="e.g. SHM/2025/00012" autoCapitalize="characters" autoCorrect={false} />
                  </Field>
                  <Field label="DATE OF BIRTH" required>
                    <Input value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
                  </Field>
                  {passwordFields}
                  <PrimaryButton title="Reset Password" icon="key" onPress={resetStudent} loading={busy} />
                </>
              ) : step === 'request' ? (
                <>
                  <Text style={s.sub}>We'll email you a link to set a new password. The link works for 1 hour.</Text>
                  <Field label="EMAIL" required>
                    <Input value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
                  </Field>
                  <PrimaryButton title="Send Reset Link" icon="mail" onPress={sendLink} loading={busy} />
                  <TouchableOpacity style={s.linkBtn} onPress={() => setStep('reset')}>
                    <Text style={s.linkText}>I already have a reset link</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={s.sub}>Open the email, copy the reset link, and paste it here. You can also tap the link to finish on the website.</Text>
                  <Field label="RESET LINK" required>
                    <Input value={resetLink} onChangeText={setResetLink} placeholder="Paste the link from the email" autoCapitalize="none" autoCorrect={false} multiline />
                  </Field>
                  {passwordFields}
                  <PrimaryButton title="Set New Password" icon="key" onPress={resetWithLink} loading={busy} />
                  <SecondaryButton title="Send another link" onPress={() => setStep('request')} disabled={busy} style={{ marginTop: 10 }} />
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, ...SHADOW.md },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.black },
  sub: { fontSize: 12, color: COLORS.muted, marginBottom: 14, lineHeight: 17 },
  showRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  showText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  linkBtn: { alignItems: 'center', paddingVertical: 14 },
  linkText: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
});

export default PasswordRecoverySheet;
