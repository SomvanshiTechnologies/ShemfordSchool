import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TINTS, RADIUS, SHADOW, COLORS } from '../theme/colors';

/**
 * Small square tile: icon above label, no description/chevron — used on the
 * Quick Actions/Management sections of every dashboard and the More menu's
 * Quick Access list, so they all share one compact grid look.
 * Pass `icon` (Ionicons name), `title`, optional `tint`. `desc` is accepted
 * but not shown, so existing callers don't need to change.
 */
export const ActionButton = ({ icon, title, tint = 'orange', onPress, label }) => {
  const t = TINTS[tint] || TINTS.orange;
  const displayTitle = title || label;
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.iconWrap, { backgroundColor: t.bg }]}>
        <Ionicons name={icon} size={18} color={t.fg} />
      </View>
      <Text style={styles.title} numberOfLines={2}>{displayTitle}</Text>
    </TouchableOpacity>
  );
};

export const ActionGrid = ({ children }) => (
  <View style={styles.grid}>{children}</View>
);

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  tile: {
    width: '30%',
    flexGrow: 1,
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  iconWrap: {
    width: 36, height: 36, borderRadius: RADIUS.md,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 11, fontWeight: '700', color: COLORS.black, textAlign: 'center' },
});
