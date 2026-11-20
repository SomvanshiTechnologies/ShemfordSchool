import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Modal, StyleSheet, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { Field, Input, Chips, PrimaryButton, SecondaryButton } from '../components/FormKit';
import { useSession } from '../contexts/SessionContext';
import { errorText, rupees } from '../utils/students';
import { FEE_FIELDS, academicYearOptions, currentAcademicYear, nextAcademicYear } from '../utils/fees';

const sumOf = (cfg, type) => FEE_FIELDS
  .filter(f => f.type === type && f.key !== 'late_fee')
  .reduce((s, f) => s + (Number(cfg[f.key]) || 0), 0);

// Mirrors the web dashboard's Fees → Configuration tab:
// GET /fees/components, POST /fees/components/increase.
// Add / edit / remove happen on the Fee Config screen.
const FeeSetupScreen = () => {
  const navigation = useNavigation();
  const { viewSession, availableSessions } = useSession();
  const [year, setYear] = useState(viewSession || currentAcademicYear());
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showIncrease, setShowIncrease] = useState(false);
  const [percent, setPercent] = useState('10');
  const [applying, setApplying] = useState(false);

  const load = useCallback(() =>
    client.get('/fees/components', { params: { academic_year: year } })
      .then(r => setConfigs(Array.isArray(r.data) ? r.data : []))
      .catch(e => { setConfigs([]); Alert.alert('Could not load', errorText(e, 'Failed to load fee setup.')); }),
  [year]);

  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const applyIncrease = async () => {
    const pct = parseFloat(percent);
    if (!(pct > 0 && pct <= 100)) { Alert.alert('Invalid percent', 'Enter a number from 1 to 100.'); return; }
    setApplying(true);
    try {
      const res = await client.post('/fees/components/increase', { from_year: year, increase_percent: pct });
      setShowIncrease(false);
      Alert.alert('Increase applied', res.data?.message || 'New fee setup created.', [
        { text: 'Stay Here' },
        { text: `View ${res.data?.to_year || 'next year'}`, onPress: () => res.data?.to_year && setYear(res.data.to_year) },
      ]);
    } catch (e) {
      Alert.alert('Could not apply', errorText(e, 'Failed to apply the increase.'));
    } finally {
      setApplying(false);
    }
  };

  const years = academicYearOptions([year, viewSession, ...(availableSessions || [])]);
  const toYear = nextAcademicYear(year);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        <Text style={s.label}>ACADEMIC YEAR</Text>
        <Chips options={years} value={year} onChange={(y) => { setLoading(true); setYear(y); }} capitalize={false} />

        <View style={s.actions}>
          <PrimaryButton
            title="Add Class Fees"
            icon="add"
            onPress={() => navigation.navigate('FeeConfig', { year })}
            style={{ flex: 1, paddingVertical: 12 }}
          />
          <SecondaryButton
            title="Yearly Increase"
            icon="trending-up"
            onPress={() => setShowIncrease(true)}
            disabled={!configs.length}
            style={{ flex: 1, paddingVertical: 12 }}
          />
        </View>

        {loading ? <ScreenLoader /> : (
          <View style={s.list}>
            {configs.map(cfg => (
              <TouchableOpacity key={cfg.config_id} style={s.row} activeOpacity={0.6} onPress={() => navigation.navigate('FeeConfig', { year, config: cfg })}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cls}>Class {cfg.class_name}{cfg.stream ? ` · ${cfg.stream}` : ''}</Text>
                  <Text style={s.meta}>
                    One-time {rupees(sumOf(cfg, 'one_time'))} · Yearly {rupees(sumOf(cfg, 'yearly'))}
                  </Text>
                  <Text style={s.meta}>Due on day {cfg.due_day || 10}{cfg.late_fee_enabled && cfg.late_fee > 0 ? ` · Late fee ${rupees(cfg.late_fee)}/mo` : ''}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.tuition}>{rupees(cfg.monthly_tuition)}</Text>
                  <Text style={s.meta}>per month</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.lightMuted} style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            ))}
            {configs.length === 0 && (
              <View style={s.empty}>
                <Ionicons name="pricetags-outline" size={32} color={COLORS.lightMuted} />
                <Text style={s.emptyText}>No fee setup for {year}</Text>
                <Text style={s.emptySub}>Add class fees here, or apply a yearly increase from the previous year.</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={showIncrease} animationType="slide" transparent onRequestClose={() => setShowIncrease(false)}>
        <View style={s.overlay}>
          <TouchableOpacity style={s.overlayBg} onPress={() => !applying && setShowIncrease(false)} />
          <View style={s.sheet}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>Yearly Fee Increase</Text>
            <Text style={s.sheetSub}>
              Copies every class's fees from {year} into {toYear}, raised by this percentage. Any existing {toYear} setup for the same classes is replaced.
            </Text>
            <Field label="INCREASE (%)" required>
              <Input value={percent} onChangeText={setPercent} keyboardType="decimal-pad" placeholder="10" />
            </Field>
            <PrimaryButton
              title={`Create ${toYear} Fees`}
              icon="trending-up"
              loading={applying}
              onPress={() => Alert.alert('Apply increase?', `Create ${toYear} fees from ${year} with a ${percent || 0}% increase?`, [
                { text: 'Cancel', style: 'cancel' }, { text: 'Apply', onPress: applyIncrease },
              ])}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  label: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.lightMuted, marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 10, marginVertical: 16 },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  cls: { fontSize: 14, fontWeight: '700', color: COLORS.black, textTransform: 'capitalize' },
  meta: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  tuition: { fontSize: 15, fontWeight: '800', color: COLORS.primary },
  empty: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  emptyText: { fontSize: 14, fontWeight: '700', color: COLORS.black, marginTop: 10 },
  emptySub: { fontSize: 12, color: COLORS.muted, marginTop: 4, textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, ...SHADOW.md },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: COLORS.black },
  sheetSub: { fontSize: 12, color: COLORS.muted, marginTop: 6, marginBottom: 16, lineHeight: 17 },
});

export default FeeSetupScreen;
