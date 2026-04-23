import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TINTS, RADIUS, SHADOW } from '../theme/colors';

/**
 * Web-style action row: [icon tile] [title / desc] [chevron]
 * Pass `icon` (Ionicons name), `title`, optional `desc`, optional `tint`.
 */
export const ActionButton = ({ icon, title, desc, tint = 'orange', onPress, label }) => {
  const t = TINTS[tint] || TINTS.orange;
  const displayTitle = title || label;
  return (
    <TouchableOpacity style={styles.btn} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.iconWrap, { backgroundColor: t.bg }]}>
        <Ionicons name={icon} size={18} color={t.fg} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>{displayTitle}</Text>
        {desc ? <Text style={styles.desc} numberOfLines={1}>{desc}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={COLORS.lightMuted} />
    </TouchableOpacity>
  );
};

export const ActionGrid = ({ children }) => (
  <View style={styles.grid}>{children}</View>
);

const styles = StyleSheet.create({
  grid: { gap: 10, marginBottom: 20 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: RADIUS.md,
    alignItems: 'center', justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  title: { fontSize: 14, fontWeight: '700', color: COLORS.black },
  desc:  { fontSize: 12, color: COLORS.muted, marginTop: 2 },
});
