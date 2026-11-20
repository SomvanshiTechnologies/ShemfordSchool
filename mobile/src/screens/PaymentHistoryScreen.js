import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { Chips } from '../components/FormKit';
import { rupees, errorText } from '../utils/students';
import { methodLabel, fmtDate } from '../utils/fees';

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: '7 Days' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All' },
];

const isoDay = (d) => d.toISOString().slice(0, 10);
const periodStart = (p) => {
  const now = new Date();
  if (p === 'today') return isoDay(now);
  if (p === 'week') { const d = new Date(now); d.setDate(d.getDate() - 6); return isoDay(d); }
  if (p === 'month') return `${isoDay(now).slice(0, 8)}01`;
  return null;
};

// Payment records hold only the student_id, so names come from the student
// list. Pages through all students (active and inactive, every session).
const loadStudentNames = async () => {
  const map = {};
  for (let page = 1; page <= 15; page++) {
    const res = await client.get('/students', { params: { status: 'all', all_sessions: true, limit: 200, page } });
    const list = Array.isArray(res.data) ? res.data : (res.data?.students || []);
    list.forEach(s => { map[s.student_id] = { name: `${s.first_name || ''} ${s.last_name || ''}`.trim(), adm: s.admission_number, cls: s.class_name, sec: s.section }; });
    const pages = parseInt(res.headers?.['x-total-pages'] || '1', 10);
    if (page >= pages || list.length === 0) break;
  }
  return map;
};

// Every fee payment, newest first (GET /fees/payments, latest 1000).
const PaymentHistoryScreen = () => {
  const navigation = useNavigation();
  const [payments, setPayments] = useState([]);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('month');
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [pay, nm] = await Promise.all([
        client.get('/fees/payments'),
        loadStudentNames().catch(() => ({})),
      ]);
      setPayments(Array.isArray(pay.data) ? pay.data : []);
      setNames(nm);
    } catch (e) {
      setError(errorText(e, 'Failed to load payments.'));
    }
  }, []);

  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const methods = useMemo(() => {
    const seen = [...new Set(payments.map(p => p.payment_method).filter(Boolean))];
    return [{ value: '', label: 'All' }, ...seen.map(m => ({ value: m, label: methodLabel(m) }))];
  }, [payments]);

  const from = periodStart(period);
  const q = search.trim().toLowerCase();
  const shown = payments.filter(p => {
    if (from && String(p.payment_date || '').slice(0, 10) < from) return false;
    if (method && p.payment_method !== method) return false;
    if (q) {
      const st = names[p.student_id] || {};
      const hay = `${p.receipt_number || ''} ${st.name || ''} ${st.adm || ''} ${p.transaction_id || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const total = shown.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={{ paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
    >
      <View style={s.summary}>
        <Text style={s.summaryLabel}>COLLECTED</Text>
        <Text style={s.summaryValue}>{rupees(total)}</Text>
        <Text style={s.summarySub}>{shown.length} payment{shown.length === 1 ? '' : 's'}</Text>
      </View>

      <View style={{ marginBottom: 10 }}><Chips options={PERIODS} value={period} onChange={setPeriod} capitalize={false} /></View>
      {methods.length > 2 && <View style={{ marginBottom: 10 }}><Chips options={methods} value={method} onChange={setMethod} capitalize={false} /></View>}

      <View style={s.searchBox}>
        <Ionicons name="search" size={16} color={COLORS.muted} />
        <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Receipt no., student or reference" placeholderTextColor={COLORS.lightMuted} autoCorrect={false} />
      </View>

      {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 32 }} /> : error ? (
        <View style={s.empty}><Ionicons name="alert-circle-outline" size={30} color={COLORS.danger} /><Text style={s.emptyText}>{error}</Text></View>
      ) : (
        <View style={s.list}>
          {shown.map(p => {
            const st = names[p.student_id] || {};
            return (
              <TouchableOpacity key={p.payment_id} style={s.row} activeOpacity={0.6} onPress={() => navigation.navigate('Receipt', { paymentId: p.payment_id })}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{st.name || p.student_id}</Text>
                  <Text style={s.meta}>{p.receipt_number}{st.cls ? ` · ${st.cls}${st.sec ? `-${st.sec}` : ''}` : ''}</Text>
                  <Text style={s.meta}>{fmtDate(p.payment_date)} · {methodLabel(p.payment_method)}</Text>
                </View>
                <Text style={s.amount}>{rupees(p.amount)}</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.lightMuted} style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            );
          })}
          {shown.length === 0 && (
            <View style={s.empty}><Ionicons name="receipt-outline" size={30} color={COLORS.lightMuted} /><Text style={s.emptyText}>No payments for these filters</Text></View>
          )}
        </View>
      )}
      {payments.length >= 1000 && <Text style={s.foot}>Showing the latest 1,000 payments. Use Fee Reports for older periods.</Text>}
    </ScrollView>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 16 },
  summary: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12, ...SHADOW.sm },
  summaryLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: COLORS.lightMuted },
  summaryValue: { fontSize: 24, fontWeight: '800', color: COLORS.black, marginTop: 2 },
  summarySub: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 14, marginBottom: 12 },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 14, color: COLORS.black },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  name: { fontSize: 13, fontWeight: '600', color: COLORS.black },
  meta: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  amount: { fontSize: 14, fontWeight: '800', color: COLORS.black },
  empty: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  emptyText: { fontSize: 13, color: COLORS.muted, marginTop: 8, textAlign: 'center' },
  foot: { fontSize: 11, color: COLORS.muted, textAlign: 'center', marginTop: 12 },
});

export default PaymentHistoryScreen;
