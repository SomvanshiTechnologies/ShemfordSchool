import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';

// Plain stat tile — matches the admin dashboard: uppercase label on top,
// bold value below, no icon chip. Shared by every role's dashboard, Reports
// and Attendance so stat tiles look identical everywhere in the app.
export const StatCard = ({ label, value, sub, accent }) => (
  <View style={styles.card}>
    <Text style={styles.label}>{label}</Text>
    <Text style={[styles.value, accent && { color: COLORS.primary }]}>{value}</Text>
    {sub ? <Text style={styles.sub}>{sub}</Text> : null}
  </View>
);

export const StatGrid = ({ children }) => (
  <View style={styles.grid}>{children}</View>
);

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  card: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  label: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, color: COLORS.lightMuted },
  value: { fontSize: 20, fontWeight: '800', color: COLORS.black, marginTop: 5 },
  sub:   { fontSize: 11, color: COLORS.muted, marginTop: 2 },
});
