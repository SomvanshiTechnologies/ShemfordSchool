import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TINTS, RADIUS, SHADOW } from '../theme/colors';

export const StatCard = ({ label, value, icon, tint, sub, accent }) => {
  const effectiveTint = tint || (accent ? 'red' : 'orange');
  const t = TINTS[effectiveTint] || TINTS.orange;
  return (
    <View style={styles.card}>
      {icon != null && (
        <View style={[styles.iconWrap, { backgroundColor: t.bg }]}>
          <Ionicons name={icon} size={18} color={t.fg} />
        </View>
      )}
      <Text style={[styles.value, accent && { color: COLORS.danger }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
};

export const StatGrid = ({ children }) => (
  <View style={styles.grid}>{children}</View>
);

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  card: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: RADIUS.md,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  value: { fontSize: 22, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5, lineHeight: 26 },
  label: { fontSize: 13, color: COLORS.muted, marginTop: 4 },
  sub:   { fontSize: 11, color: COLORS.lightMuted, marginTop: 2 },
});
