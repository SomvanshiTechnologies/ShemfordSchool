import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';

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
  const bgMap = {
    dark: COLORS.black, orange: COLORS.primary, muted: COLORS.lightBg,
    success: '#ECFDF5', danger: '#FEF2F2', warning: '#FFFBEB',
  };
  const colorMap = {
    dark: COLORS.white, orange: COLORS.white, muted: COLORS.muted,
    success: COLORS.success, danger: COLORS.danger, warning: COLORS.warning,
  };
  return (
    <View style={[styles.badge, { backgroundColor: bgMap[variant] || COLORS.lightBg }]}>
      <Text style={[styles.badgeText, { color: colorMap[variant] || COLORS.muted }]}>{text}</Text>
    </View>
  );
};

export const ListItem = ({ left, right }) => (
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

export const Avatar = ({ letter, bg = COLORS.primary, color = COLORS.white, size = 44 }) => (
  <View style={[styles.avatar, { width: size, height: size, backgroundColor: bg, borderRadius: size * 0.28 }]}>
    <Text style={[styles.avatarText, { color, fontSize: size * 0.4 }]}>{letter}</Text>
  </View>
);

const styles = StyleSheet.create({
  section: {
    fontSize: 13, fontWeight: '700', color: COLORS.black, letterSpacing: -0.2,
    marginTop: 20, marginBottom: 12,
  },
  cardDark: {
    backgroundColor: COLORS.black, borderRadius: RADIUS.xl, padding: 20, marginBottom: 16,
    ...SHADOW.md,
  },
  cardOrange: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.xl, padding: 20, marginBottom: 16,
    ...SHADOW.md,
  },
  card: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  listItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg,
  },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 14, color: COLORS.lightMuted, marginTop: 12 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800' },
});
