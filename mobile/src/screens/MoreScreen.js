import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';
import { Avatar, Badge, Card, SectionTitle } from '../components/UI';
import { ActionButton, ActionGrid } from '../components/ActionButton';

const MoreScreen = ({ navigation }) => {
  const { user, logout } = useAuth();
  const role = user?.role;
  const isAdmin   = role === 'admin';
  const isTeacher = role === 'teacher';
  const isParent  = role === 'parent';
  const isStudent = role === 'student';

  // Items that can actually be navigated to. Items without a screen fall back to
  // a "Coming Soon" alert. Keys in `screen` are resolved either to a tab in the
  // current role's tabs OR a root-stack screen (see AppNavigator).
  const items = [
    ...(isAdmin ? [
      { icon: 'bar-chart-outline',    tint: 'purple',  title: 'Reports',  desc: 'Analytics & exports',   screen: 'Reports' },
    ] : []),
    ...((isParent || isStudent) ? [] : [
      { icon: 'notifications-outline', tint: 'amber',  title: 'Notices',  desc: 'School announcements',  screen: 'Notices' },
    ]),
    ...((isStudent) ? [] : [
      { icon: 'chatbubble-outline',   tint: 'blue',    title: 'Messages', desc: 'Parent communication',  screen: 'Messages' },
    ]),
    { icon: 'book-outline',           tint: 'cyan',    title: 'Syllabus', desc: 'Study materials',       screen: null },
    { icon: 'alert-circle-outline',   tint: 'red',     title: 'Issues',   desc: 'Report a concern',      screen: null },
  ];

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  const go = (item) => {
    if (!item.screen) {
      Alert.alert('Coming Soon', `${item.title} is available on the desktop app.`);
      return;
    }
    try {
      navigation.navigate(item.screen);
    } catch (e) {
      Alert.alert('Unavailable', `${item.title} cannot be opened right now.`);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.h1}>More</Text>
        </View>

        <Card style={styles.profileCard}>
          <Avatar letter={user?.name?.charAt(0) || 'U'} bg={COLORS.primary} size={52} />
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{user?.name || user?.email}</Text>
            <Text style={styles.profileEmail} numberOfLines={1}>{user?.email}</Text>
            <View style={{ marginTop: 6, flexDirection: 'row' }}>
              <Badge text={role || 'user'} variant="dark" />
            </View>
          </View>
        </Card>

        <SectionTitle>Quick Access</SectionTitle>
        <ActionGrid>
          {items.map(item => (
            <ActionButton
              key={item.title}
              icon={item.icon}
              tint={item.tint}
              title={item.title}
              desc={item.desc}
              onPress={() => go(item)}
            />
          ))}
        </ActionGrid>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.danger} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Shemford School · v1.0</Text>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 26, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginBottom: 8,
  },
  profileName:  { fontWeight: '700', fontSize: 16, color: COLORS.black },
  profileEmail: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.lg,
    paddingVertical: 14, marginTop: 16, backgroundColor: COLORS.white,
    ...SHADOW.sm,
  },
  logoutText: { fontSize: 14, fontWeight: '700', color: COLORS.danger },
  version: { fontSize: 11, color: COLORS.lightMuted, textAlign: 'center', marginTop: 20 },
});

export default MoreScreen;
