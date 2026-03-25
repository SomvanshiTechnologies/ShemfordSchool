import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme/colors';

export const SectionTitle = ({ children }) => (
  <Text style={styles.section}>{children}</Text>
);

export const CardDark = ({ children, style }) => (
  <View style={[styles.cardDark, style]}>{children}</View>
);

export const CardOrange = ({ children, style }) => (
  <View style={[styles.cardOrange, style]}>{children}</View>
);

export const Card = ({ children, style }) => (
  <View style={[styles.card, style]}>{children}</View>
);

export const Badge = ({ text, variant = 'muted' }) => {
  const bgMap = { dark: COLORS.black, orange: COLORS.primary, muted: COLORS.lightBg };
  const colorMap = { dark: COLORS.white, orange: COLORS.white, muted: COLORS.muted };
  return (
    <View style={[styles.badge, { backgroundColor: bgMap[variant] || COLORS.lightBg }]}>
      <Text style={[styles.badgeText, { color: colorMap[variant] || COLORS.muted }]}>{text}</Text>
    </View>
  );
};

export const ListItem = ({ left, right, onPress }) => (
  <View style={styles.listItem}>
    <View style={{ flex: 1 }}>{left}</View>
    {right && <View>{right}</View>}
  </View>
);

export const EmptyState = ({ icon, text }) => (
  <View style={styles.empty}>
    {icon}
    <Text style={styles.emptyText}>{text}</Text>
  </View>
);

export const Avatar = ({ letter, bg = COLORS.primary, color = COLORS.white, size = 40 }) => (
  <View style={[styles.avatar, { width: size, height: size, backgroundColor: bg }]}>
    <Text style={[styles.avatarText, { color, fontSize: size * 0.4 }]}>{letter}</Text>
  </View>
);

const styles = StyleSheet.create({
  section: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.muted, marginTop: 20, marginBottom: 10 },
  cardDark: { backgroundColor: COLORS.black, borderRadius: 14, padding: 16, marginBottom: 12 },
  cardOrange: { backgroundColor: COLORS.primary, borderRadius: 14, padding: 16, marginBottom: 12 },
  card: { backgroundColor: COLORS.white, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 14, color: COLORS.lightMuted, marginTop: 12 },
  avatar: { borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800' },
});
