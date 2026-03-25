import React from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { COLORS } from '../theme/colors';

export const Skeleton = ({ width, height, style }) => (
  <View style={[styles.skeleton, { width, height }, style]} />
);

export const ScreenLoader = () => (
  <View style={styles.container}>
    <Skeleton width="60%" height={24} style={{ marginBottom: 6 }} />
    <Skeleton width="40%" height={14} style={{ marginBottom: 20 }} />
    <Skeleton width="100%" height={100} style={{ borderRadius: 14, marginBottom: 12 }} />
    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
      <Skeleton width="48%" height={80} style={{ borderRadius: 14 }} />
      <Skeleton width="48%" height={80} style={{ borderRadius: 14 }} />
    </View>
    <Skeleton width="100%" height={60} style={{ borderRadius: 14, marginBottom: 8 }} />
    <Skeleton width="100%" height={60} style={{ borderRadius: 14, marginBottom: 8 }} />
    <Skeleton width="100%" height={60} style={{ borderRadius: 14 }} />
  </View>
);

const styles = StyleSheet.create({
  container: { padding: 16 },
  skeleton: {
    backgroundColor: '#F0F0F0', borderRadius: 8, overflow: 'hidden',
  },
});
