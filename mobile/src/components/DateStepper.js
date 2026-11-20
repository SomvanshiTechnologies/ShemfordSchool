import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { shiftDay, shiftMonth, dayLabel, monthLabel, todayISO, thisMonth } from '../utils/attendance';

// Previous / next stepper for a day (YYYY-MM-DD) or a month (YYYY-MM).
// Future days and months are blocked unless allowFuture is set.
const DateStepper = ({ mode = 'day', value, onChange, allowFuture = false }) => {
  const isDay = mode === 'day';
  const today = isDay ? todayISO() : thisMonth();
  const next = isDay ? shiftDay(value, 1) : shiftMonth(value, 1);
  const canNext = allowFuture || next <= today;
  const label = isDay ? dayLabel(value) : monthLabel(value);
  const atToday = value === today;

  return (
    <View style={s.row}>
      <TouchableOpacity style={s.arrow} onPress={() => onChange(isDay ? shiftDay(value, -1) : shiftMonth(value, -1))} hitSlop={8}>
        <Ionicons name="chevron-back" size={18} color={COLORS.black} />
      </TouchableOpacity>
      <View style={s.center}>
        <Text style={s.label}>{label}</Text>
        {!atToday && (
          <TouchableOpacity onPress={() => onChange(today)}>
            <Text style={s.today}>{isDay ? 'Go to today' : 'This month'}</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity style={[s.arrow, !canNext && { opacity: 0.3 }]} onPress={() => canNext && onChange(next)} disabled={!canNext} hitSlop={8}>
        <Ionicons name="chevron-forward" size={18} color={COLORS.black} />
      </TouchableOpacity>
    </View>
  );
};

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 6, paddingVertical: 6, marginBottom: 12, ...SHADOW.sm,
  },
  arrow: { width: 36, height: 36, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.lightBg },
  center: { flex: 1, alignItems: 'center' },
  label: { fontSize: 14, fontWeight: '700', color: COLORS.black },
  today: { fontSize: 11, fontWeight: '700', color: COLORS.primary, marginTop: 2 },
});

export default DateStepper;
