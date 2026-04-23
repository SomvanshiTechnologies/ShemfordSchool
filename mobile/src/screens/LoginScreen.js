import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';

const LoginScreen = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPw = password || '';
    if (!cleanEmail || !cleanPw) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      await login(cleanEmail, cleanPw);
    } catch (e) {
      // Distinguish server-rejected creds from unreachable backend so the
      // user knows what to fix instead of staring at "Invalid credentials".
      if (!e.response) {
        Alert.alert(
          'Cannot reach server',
          'The app could not reach the backend. Check that your phone and PC are on the same Wi-Fi, and that port 8000 is allowed through the firewall.'
        );
      } else if (e.response.status === 401) {
        Alert.alert('Invalid email or password', 'Please check your credentials and try again.');
      } else if (e.response.status === 429) {
        Alert.alert('Too many attempts', 'Please wait a minute and try again.');
      } else {
        Alert.alert('Login failed', e.response?.data?.detail || `Server returned ${e.response.status}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>SF</Text>
          </View>
          <Text style={styles.title}>Shemford</Text>
          <Text style={styles.subtitle}>Futuristic School</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>EMAIL</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={18} color={COLORS.lightMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="you@shemford.edu"
              placeholderTextColor={COLORS.lightMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <Text style={[styles.label, { marginTop: 16 }]}>PASSWORD</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={COLORS.lightMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              placeholderTextColor={COLORS.lightMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
            />
            <TouchableOpacity onPress={() => setShowPw(v => !v)} style={styles.eyeBtn} hitSlop={8}>
              <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.lightMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.btn} onPress={handleLogin} disabled={loading} activeOpacity={0.85}>
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.btnText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>School Management System</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  header: { alignItems: 'center', marginBottom: 40 },
  logo: {
    width: 72, height: 72, borderRadius: 22, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
    ...SHADOW.md,
  },
  logoText: { fontSize: 26, fontWeight: '800', color: COLORS.white, letterSpacing: -0.5 },
  title:    { fontSize: 30, fontWeight: '800', color: COLORS.black, letterSpacing: -0.6 },
  subtitle: { fontSize: 14, color: COLORS.muted, marginTop: 4 },
  form: { marginBottom: 32 },
  label: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.lightMuted, marginBottom: 8 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: 14, ...SHADOW.sm,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: COLORS.black },
  eyeBtn: { paddingHorizontal: 4, paddingVertical: 6 },
  btn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingVertical: 16,
    alignItems: 'center', marginTop: 24, ...SHADOW.md,
  },
  btnText: { fontSize: 16, fontWeight: '700', color: COLORS.white, letterSpacing: 0.2 },
  footer: { textAlign: 'center', fontSize: 12, color: COLORS.lightMuted },
});

export default LoginScreen;
