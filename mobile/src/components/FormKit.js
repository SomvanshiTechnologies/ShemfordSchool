import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';

// Shared form building blocks for the student admin screens. Styling matches
// the original New Admission screen so all forms look the same.

export const FormCard = ({ title, children, style }) => (
  <View style={[fk.card, style]}>
    {!!title && <Text style={fk.cardTitle}>{title}</Text>}
    {children}
  </View>
);

export const Field = ({ label, required, error, hint, children }) => (
  <View style={fk.field}>
    <Text style={fk.label}>{label}{required ? <Text style={{ color: COLORS.danger }}> *</Text> : null}</Text>
    {children}
    {!!error && <Text style={fk.error}>{error}</Text>}
    {!error && !!hint && <Text style={fk.hint}>{hint}</Text>}
  </View>
);

export const Input = ({ style, error, multiline, editable = true, ...props }) => (
  <TextInput
    style={[fk.input, multiline && { minHeight: 64 }, error && { borderColor: COLORS.danger }, !editable && fk.inputDisabled, style]}
    placeholderTextColor={COLORS.lightMuted}
    multiline={multiline}
    textAlignVertical={multiline ? 'top' : 'center'}
    editable={editable}
    {...props}
  />
);

// options: array of strings, or { value, label } objects.
export const Chips = ({ options, value, onChange, capitalize = true }) => (
  <View style={fk.chipRow}>
    {options.map(o => {
      const v = typeof o === 'string' ? o : o.value;
      const label = typeof o === 'string' ? o : o.label;
      const active = value === v;
      return (
        <TouchableOpacity key={String(v)} style={[fk.chip, active && fk.chipActive]} onPress={() => onChange(v)}>
          <Text style={[fk.chipText, active && fk.chipTextActive, !capitalize && { textTransform: 'none' }]}>{label}</Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

export const PrimaryButton = ({ title, icon, onPress, loading, disabled, style }) => (
  <TouchableOpacity
    style={[fk.primaryBtn, (disabled || loading) && { opacity: 0.6 }, style]}
    onPress={onPress}
    disabled={disabled || loading}
    activeOpacity={0.85}
  >
    {loading ? <ActivityIndicator color={COLORS.white} /> : (
      <>
        {!!icon && <Ionicons name={icon} size={16} color={COLORS.white} />}
        <Text style={fk.primaryBtnText}>{title}</Text>
      </>
    )}
  </TouchableOpacity>
);

export const SecondaryButton = ({ title, icon, onPress, loading, disabled, danger, style }) => (
  <TouchableOpacity
    style={[fk.secondaryBtn, danger && { borderColor: '#FECACA' }, (disabled || loading) && { opacity: 0.6 }, style]}
    onPress={onPress}
    disabled={disabled || loading}
    activeOpacity={0.85}
  >
    {loading ? <ActivityIndicator color={danger ? COLORS.danger : COLORS.black} /> : (
      <>
        {!!icon && <Ionicons name={icon} size={16} color={danger ? COLORS.danger : COLORS.black} />}
        <Text style={[fk.secondaryBtnText, danger && { color: COLORS.danger }]}>{title}</Text>
      </>
    )}
  </TouchableOpacity>
);

export const fk = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm,
  },
  cardTitle: { ...FONTS.h2, fontSize: 15, marginBottom: 12 },
  field: { marginBottom: 12 },
  label: { ...FONTS.small, marginBottom: 6 },
  error: { fontSize: 11, color: COLORS.danger, marginTop: 4 },
  hint: { fontSize: 11, color: COLORS.muted, marginTop: 4 },
  input: {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: COLORS.black, backgroundColor: COLORS.white,
  },
  inputDisabled: { backgroundColor: COLORS.lightBg, color: COLORS.muted },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 12, fontWeight: '600', color: COLORS.muted, textTransform: 'capitalize' },
  chipTextActive: { color: COLORS.white },
  primaryBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, ...SHADOW.sm,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.white },
  secondaryBtn: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg, paddingVertical: 14, borderWidth: 1.5, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.black },
});
