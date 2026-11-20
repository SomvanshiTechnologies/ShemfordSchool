import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, RefreshControl, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { PrimaryButton } from '../components/FormKit';
import ConcessionSheet from '../components/ConcessionSheet';
import { rupees } from '../utils/students';

// Students with a concession on any fee entry (GET /fees/concessions),
// plus granting a new one. Mirrors the web dashboard's Concessions section.
const ConcessionsScreen = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [showGrant, setShowGrant] = useState(false);

  const load = useCallback(() =>
    client.get('/fees/concessions')
      .then(r => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([])),
  []);

  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const q = search.trim().toLowerCase();
  const shown = rows
    .filter(r => !q || `${r.student_name} ${r.admission_number || ''} ${r.class_name} ${r.reason || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (b.total_concession || 0) - (a.total_concession || 0));
  const total = shown.reduce((s, r) => s + (Number(r.total_concession) || 0), 0);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        <PrimaryButton title="Grant Concession" icon="add" onPress={() => setShowGrant(true)} style={{ marginBottom: 14 }} />

        <View style={s.summary}>
          <View>
            <Text style={s.summaryLabel}>STUDENTS</Text>
            <Text style={s.summaryValue}>{shown.length}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.summaryLabel}>TOTAL CONCESSION</Text>
            <Text style={[s.summaryValue, { color: COLORS.primary }]}>{rupees(total)}</Text>
          </View>
        </View>

        <View style={s.searchBox}>
          <Ionicons name="search" size={16} color={COLORS.muted} />
          <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Filter by name, class or reason" placeholderTextColor={COLORS.lightMuted} />
        </View>

        {loading ? <ScreenLoader /> : (
          <View style={s.list}>
            {shown.map(r => (
              <View key={r.student_id} style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{r.student_name}</Text>
                  <Text style={s.meta}>{r.class_name}{r.section ? `-${r.section}` : ''}{r.admission_number ? ` · ${r.admission_number}` : ''}</Text>
                  {!!r.reason && <Text style={s.reason} numberOfLines={2}>{r.reason}</Text>}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.amount}>−{rupees(r.total_concession)}</Text>
                  <Text style={s.meta}>{r.entries} entr{r.entries === 1 ? 'y' : 'ies'}</Text>
                </View>
              </View>
            ))}
            {shown.length === 0 && (
              <View style={s.empty}>
                <Ionicons name="pricetags-outline" size={30} color={COLORS.lightMuted} />
                <Text style={s.emptyText}>{rows.length ? 'No matches' : 'No concessions yet'}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <ConcessionSheet visible={showGrant} onClose={() => setShowGrant(false)} onDone={load} />
    </View>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  summary: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  summaryLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: COLORS.lightMuted },
  summaryValue: { fontSize: 20, fontWeight: '800', color: COLORS.black, marginTop: 2 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 14, marginBottom: 12 },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 14, color: COLORS.black },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  name: { fontSize: 13, fontWeight: '600', color: COLORS.black },
  meta: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  reason: { fontSize: 11, color: COLORS.black, marginTop: 3 },
  amount: { fontSize: 14, fontWeight: '800', color: COLORS.success },
  empty: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 13, color: COLORS.muted, marginTop: 8 },
});

export default ConcessionsScreen;
