import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';
import { Avatar, Badge, Card } from '../components/UI';

const MoreScreen = ({ navigation }) => {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  const menuItems = [
    ...(isAdmin ? [
      { icon: 'bar-chart', label: 'Reports', screen: 'Reports', color: COLORS.primary },
    ] : []),
    { icon: 'notifications', label: 'Notices', screen: 'Notices', color: COLORS.primary },
    { icon: 'chatbubble', label: 'Messages', screen: 'Messages', color: COLORS.black },
    { icon: 'book', label: 'Syllabus', screen: null, color: COLORS.black },
    { icon: 'clipboard', label: 'Issues', screen: null, color: COLORS.muted },
  ];

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.h1}>More</Text>
        </View>

        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <Avatar letter={user?.name?.charAt(0) || 'U'} bg={COLORS.primary} size={48} />
          <View>
            <Text style={{ fontWeight: '700', fontSize: 16, color: COLORS.black }}>{user?.name || user?.email}</Text>
            <View style={{ marginTop: 4 }}>
              <Badge text={user?.role} variant="dark" />
            </View>
          </View>
        </Card>

        <View style={styles.menuGrid}>
          {menuItems.map(item => (
            <TouchableOpacity
              key={item.label}
              style={styles.menuItem}
              onPress={() => {
                if (item.screen) {
                  // Try navigating to tab or stack screen
                  try {
                    navigation.navigate(item.screen);
                  } catch {
                    Alert.alert('Coming Soon', `${item.label} is available on the desktop app`);
                  }
                } else {
                  Alert.alert('Coming Soon', `${item.label} is available on the desktop app`);
                }
              }}
            >
              <View style={styles.menuIcon}>
                <Ionicons name={item.icon} size={18} color={item.color} />
              </View>
              <Text style={styles.menuLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={16} color={COLORS.black} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.black }}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 24, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  menuItem: {
    width: '30%', alignItems: 'center', gap: 8, paddingVertical: 20, paddingHorizontal: 8,
    borderRadius: 14, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border,
  },
  menuIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.lightBg, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { fontSize: 11, fontWeight: '600', color: COLORS.black, textAlign: 'center' },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12, paddingVertical: 14, marginTop: 24,
  },
});

export default MoreScreen;
