import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, RefreshControl, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { useSession } from '../contexts/SessionContext';
import { sectionsFor, errorText, rupees } from '../utils/students';
import { DURATIONS, REPORT_FEE_TYPES, REPORT_METHODS, fmtDate, downloadAndSharePdf } from '../utils/fees';

// Mirrors the web dashboard's Fees Reports page:
//   Collection → GET /fees/reports/collection (+ /pdf)
//   Due        → GET /fees/reports/due        (+ /pdf)
// One row per student and fee category, same as the web tables.

const TABS = [
  { key: 'collection', label: 'Collection' },
  { key: 'due', label: 'Due Fees' },
];

const DEFAULTS = {
  collection: { duration: 'this_month', class_name: '', section: '', fee_component: '', payment_method: '' },
  due: { duration: 'all_time', class_name: '', section: '', fee_component: '' },
};

const OptionSheet = ({ visible, title, options, value, onSelect, onClose }) => (
  <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={s.overlay}>
      <TouchableOpacity style={s.overlayBg} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.handle} />
        <Text style={s.sheetTitle}>{title}</Text>
        <ScrollView style={{ maxHeight: 400 }}>
          {options.map(o => (
            <TouchableOpacity key={o.value || '__all__'} style={s.optRow} onPress={() => { onSelect(o.value); onClose(); }}>
              <Text style={[s.optText, value === o.value && { color: COLORS.primary, fontWeight: '800' }]}>{o.label}</Text>
              {value === o.value && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  </Modal>
);

const FilterChip = ({ label, active, onPress, disabled }) => (
  <TouchableOpacity style={[s.fChip, active && s.fChipActive, disabled && { opacity: 0.45 }]} onPress={onPress} disabled={disabled}>
    <Text style={[s.fChipText, active && { color: COLORS.white }]} numberOfLines={1}>{label}</Text>
    <Ionicons name="chevron-down" size={12} color={active ? COLORS.white : COLORS.muted} />
  </TouchableOpacity>
);

const FeeReportsScreen = ({ route }) => {
  const { viewSession } = useSession();
  const [tab, setTab] = useState(route?.params?.tab === 'due' ? 'due' : 'collection');
  const [filters, setFilters] = useState(DEFAULTS);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [classes, setClasses] = useState([]);
  const [picker, setPicker] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    client.get('/classes').then(r => setClasses(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  const f = filters[tab];
  const setF = (k, v) => setFilters(all => ({
    ...all,
    [tab]: { ...all[tab], [k]: v, ...(k === 'class_name' ? { section: '' } : {}) },
  }));

  const params = useCallback(() => {
    const p = { duration: f.duration };
    if (viewSession) p.academic_year = viewSession;
    if (f.class_name) p.class_name = f.class_name;
    if (f.section) p.section = f.section;
    if (f.fee_component) p.fee_component = f.fee_component;
    if (tab === 'collection' && f.payment_method) p.payment_method = f.payment_method;
    return p;
  }, [f, tab, viewSession]);

  const load = useCallback(() => {
    setError(null);
    return client.get(`/fees/reports/${tab}`, { params: params() })
      .then(r => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(e => { setRows([]); setError(errorText(e, 'Failed to load the report.')); });
  }, [tab, params]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const exportPdf = async () => {
    setExporting(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await downloadAndSharePdf(`/fees/reports/${tab}/pdf`, params(), `fees-${tab}-${stamp}.pdf`, viewSession);
    } catch (e) {
      Alert.alert('Export failed', e?.message || 'Could not export the PDF.');
    } finally {
      setExporting(false);
    }
  };

  const q = search.trim().toLowerCase();
  const shown = q
    ? rows.filter(r => `${r.student_name} ${r.admission_number} ${r.mobile} ${r.class_section}`.toLowerCase().includes(q))
    : rows;
  const total = shown.reduce((sum, r) => sum + (Number(tab === 'collection' ? r.total_collected : r.balance) || 0), 0);
  const studentsCount = new Set(shown.map(r => r.admission_number || r.student_name)).size;

  const durationLabel = DURATIONS.find(d => d.value === f.duration)?.label || 'All Time';
  const typeLabel = REPORT_FEE_TYPES.find(t => t.value === f.fee_component)?.label || 'All Types';
  const methodLabelText = REPORT_METHODS.find(m => m.value === f.payment_method)?.label || 'All Methods';
  const sectionOpts = sectionsFor(classes, f.class_name);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={s.tabs}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={[s.tab, tab === t.key && s.tabActive]} onPress={() => { setTab(t.key); setSearch(''); }}>
            <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginBottom: 12 }}>
          <FilterChip label={durationLabel} active={tab === 'collection' ? f.duration !== 'this_month' : f.duration !== 'all_time'} onPress={() => setPicker('duration')} />
          <FilterChip label={f.class_name ? `Class ${f.class_name}` : 'All Classes'} active={!!f.class_name} onPress={() => setPicker('class')} />
          <FilterChip label={f.section || 'All Sections'} active={!!f.section} onPress={() => setPicker('section')} disabled={!f.class_name} />
          <FilterChip label={typeLabel} active={!!f.fee_component} onPress={() => setPicker('type')} />
          {tab === 'collection' && <FilterChip label={methodLabelText} active={!!f.payment_method} onPress={() => setPicker('method')} />}
        </ScrollView>

        <View style={s.summary}>
          <View style={{ flex: 1 }}>
            <Text style={s.summaryLabel}>{tab === 'collection' ? 'COLLECTED' : 'BALANCE DUE'}</Text>
            <Text style={[s.summaryValue, tab === 'due' && { color: COLORS.primary }]}>{rupees(total)}</Text>
            <Text style={s.summarySub}>{studentsCount} student{studentsCount === 1 ? '' : 's'} · {shown.length} row{shown.length === 1 ? '' : 's'}</Text>
          </View>
          <TouchableOpacity style={s.pdfBtn} onPress={exportPdf} disabled={exporting || loading}>
            {exporting ? <ActivityIndicator size="small" color={COLORS.white} /> : <Ionicons name="document-text-outline" size={16} color={COLORS.white} />}
            <Text style={s.pdfBtnText}>PDF</Text>
          </TouchableOpacity>
        </View>

        <View style={s.searchBox}>
          <Ionicons name="search" size={16} color={COLORS.muted} />
          <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Filter by name, admission no. or mobile" placeholderTextColor={COLORS.lightMuted} />
        </View>

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 32 }} />
        ) : error ? (
          <View style={s.empty}><Ionicons name="alert-circle-outline" size={30} color={COLORS.danger} /><Text style={s.emptyText}>{error}</Text></View>
        ) : (
          <View style={s.list}>
            {shown.map((r, i) => (
              <View key={`${r.admission_number}-${r.fee_types}-${i}`} style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{r.student_name}</Text>
                  <Text style={s.meta}>{r.class_section}{r.admission_number ? ` · ${r.admission_number}` : ''}</Text>
                  <Text style={s.meta}>{r.fee_types}{r.mobile ? ` · ${r.mobile}` : ''}</Text>
                  {tab === 'collection'
                    ? <Text style={s.meta}>Last paid {fmtDate(r.last_payment_date)} · {r.payments_count} payment{r.payments_count === 1 ? '' : 's'}</Text>
                    : <Text style={s.meta}>Oldest due {fmtDate(r.oldest_due)} · {r.entries_pending} pending</Text>}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {tab === 'collection' ? (
                    <Text style={s.amount}>{rupees(r.total_collected)}</Text>
                  ) : (
                    <>
                      <Text style={[s.amount, { color: COLORS.primary }]}>{rupees(r.balance)}</Text>
                      {Number(r.paid) > 0 && <Text style={s.meta}>paid {rupees(r.paid)} of {rupees(r.amount)}</Text>}
                    </>
                  )}
                </View>
              </View>
            ))}
            {shown.length === 0 && (
              <View style={s.empty}>
                <Ionicons name={tab === 'collection' ? 'wallet-outline' : 'checkmark-circle-outline'} size={30} color={COLORS.lightMuted} />
                <Text style={s.emptyText}>{tab === 'collection' ? 'No collections for these filters' : 'No dues for these filters'}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <OptionSheet visible={picker === 'duration'} title="Period" options={DURATIONS} value={f.duration} onSelect={v => setF('duration', v)} onClose={() => setPicker(null)} />
      <OptionSheet
        visible={picker === 'class'}
        title="Class"
        options={[{ value: '', label: 'All Classes' }, ...classes.map(c => ({ value: c.name, label: `Class ${c.name}` }))]}
        value={f.class_name}
        onSelect={v => setF('class_name', v)}
        onClose={() => setPicker(null)}
      />
      <OptionSheet
        visible={picker === 'section'}
        title="Section"
        options={[{ value: '', label: 'All Sections' }, ...sectionOpts.map(x => ({ value: x, label: x }))]}
        value={f.section}
        onSelect={v => setF('section', v)}
        onClose={() => setPicker(null)}
      />
      <OptionSheet visible={picker === 'type'} title="Fee type" options={REPORT_FEE_TYPES} value={f.fee_component} onSelect={v => setF('fee_component', v)} onClose={() => setPicker(null)} />
      <OptionSheet visible={picker === 'method'} title="Payment method" options={REPORT_METHODS} value={f.payment_method} onSelect={v => setF('payment_method', v)} onClose={() => setPicker(null)} />
    </View>
  );
};

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingHorizontal: 16 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: COLORS.primary },
  tabText: { fontSize: 13, fontWeight: '700', color: COLORS.muted },
  tabTextActive: { color: COLORS.black },
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 14 },
  fChip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 180, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  fChipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  fChipText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  summary: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12, ...SHADOW.sm },
  summaryLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: COLORS.lightMuted },
  summaryValue: { fontSize: 24, fontWeight: '800', color: COLORS.black, marginTop: 2 },
  summarySub: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.black, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 10 },
  pdfBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.white },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 14, marginBottom: 12 },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 14, color: COLORS.black },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  name: { fontSize: 13, fontWeight: '600', color: COLORS.black },
  meta: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  amount: { fontSize: 14, fontWeight: '800', color: COLORS.black },
  empty: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  emptyText: { fontSize: 13, color: COLORS.muted, marginTop: 8, textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, ...SHADOW.md },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontWeight: '800', fontSize: 16, color: COLORS.black, marginBottom: 12 },
  optRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  optText: { fontSize: 14, color: COLORS.black, fontWeight: '600' },
});

export default FeeReportsScreen;
