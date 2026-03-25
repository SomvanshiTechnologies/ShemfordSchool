import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme/colors';

export const StatCard = ({ label, value, accent }) => (
  <View style={styles.card}>
    <Text style={styles.label}>{label}</Text>
    <Text style={[styles.value, accent && { color: COLORS.primary }]}>{value}</Text>
  </View>
);

export const StatGrid = ({ children }) => (
  <View style={styles.grid}>{children}</View>
);

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  card: {
    flex: 1, minWidth: '45%', backgroundColor: COLORS.white, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  label: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.lightMuted, marginBottom: 4 },
  value: { fontSize: 22, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
});
