import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme/colors';

export const ActionButton = ({ icon, label, onPress }) => (
  <TouchableOpacity style={styles.btn} onPress={onPress} activeOpacity={0.7}>
    <View style={styles.iconWrap}>{icon}</View>
    <Text style={styles.label}>{label}</Text>
  </TouchableOpacity>
);

export const ActionGrid = ({ children }) => (
  <View style={styles.grid}>{children}</View>
);

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  btn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 16, paddingHorizontal: 8, borderRadius: 14,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border,
  },
  iconWrap: {
    width: 28, height: 28, borderRadius: 10, backgroundColor: COLORS.lightBg,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { fontSize: 11, fontWeight: '600', color: COLORS.black },
});
