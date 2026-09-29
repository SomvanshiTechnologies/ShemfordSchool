import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { Badge, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';

const PAGE_SIZE = 30;
const TYPE_LABELS = {
  student: 'Student', employee: 'Employee', holiday: 'Holiday',
  announcement: 'Announcement', pos_device: 'POS Device',
};
const summaryOf = (e) => {
  const c = e.changes || {};
  return c.name || c.title || c.date || c.device_id || e.entity_id || '—';
};
const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const AuditTrailScreen = () => {
  const [entries, setEntries] = useState([]);
  const [types, setTypes] = useState(Object.keys(TYPE_LABELS));
  const [typeFilter, setTypeFilter] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [restoring, setRestoring] = useState(null);

  const fetchPage = useCallback((p, append) => {
    const params = { only_non_admin: true, include_restored: true, page: p, limit: PAGE_SIZE };
    if (typeFilter) params.entity_type = typeFilter;
    return client.get('/admin/audit-trail', { params }).then(r => {
      const list = r.data?.entries || [];
      if (Array.isArray(r.data?.restorable_entity_types) && r.data.restorable_entity_types.length) {
        setTypes(r.data.restorable_entity_types);
      }
      setEntries(prev => (append ? [...prev, ...list] : list));
      setTotalPages(parseInt(r.headers['x-total-pages'] || '1', 10) || 1);
      setTotalCount(parseInt(r.headers['x-total-count'] || String(list.length), 10) || list.length);
      setPage(p);
    });
  }, [typeFilter]);

  const reload = useCallback(() => fetchPage(1, false).catch(() => {}), [fetchPage]);

  useEffect(() => { setLoading(true); reload().finally(() => setLoading(false)); }, [reload]);

  const onRefresh = () => { setRefreshing(true); reload().finally(() => setRefreshing(false)); };
  const loadMore = () => {
    if (page >= totalPages || loadingMore) return;
    setLoadingMore(true);
    fetchPage(page + 1, true).catch(() => {}).finally(() => setLoadingMore(false));
  };

  const restore = (e) => {
    Alert.alert(
      'Restore this item?',
      `${TYPE_LABELS[e.entity_type] || e.entity_type}: ${summaryOf(e)} will be reactivated${['student', 'employee'].includes(e.entity_type) ? ' along with its login account' : ''}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: async () => {
            setRestoring(e.log_id);
            try {
              await client.post(`/admin/audit-trail/${e.log_id}/restore`);
              await reload();
            } catch (err) {
              Alert.alert('Error', err.response?.data?.detail || 'Restore failed.');
            } finally { setRestoring(null); }
          },
        },
      ]
    );
  };

  if (loading) return <SafeAreaView style={s.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        <View style={s.header}>
          <Text style={s.h1}>Audit Trails</Text>
          <Text style={s.sub}>
            Track who deleted what and restore items if needed. {totalCount} entr{totalCount === 1 ? 'y' : 'ies'}.
          </Text>
        </View>

        <View style={{ flexDirection: 'row', marginBottom: 16 }}>
          <TouchableOpacity style={[s.filterChip, typeFilter && s.filterChipActive]} onPress={() => setPickerOpen(true)}>
            <Ionicons name="funnel-outline" size={13} color={typeFilter ? COLORS.white : COLORS.muted} />
            <Text style={[s.filterChipText, typeFilter && s.filterChipTextActive]}>
              {typeFilter ? (TYPE_LABELS[typeFilter] || typeFilter) : 'All entity types'}
            </Text>
            <Ionicons name="chevron-down" size={13} color={typeFilter ? COLORS.white : COLORS.muted} />
          </TouchableOpacity>
        </View>

        <View style={s.list}>
          {entries.map(e => (
            <View key={e.log_id} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', fontSize: 13, color: COLORS.black }}>{summaryOf(e)}</Text>
                <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
                  {TYPE_LABELS[e.entity_type] || e.entity_type} · deleted by {e.performed_by_name || e.performed_by || '—'}
                  {e.performed_by_role ? ` (${e.performed_by_role})` : ''}
                </Text>
                <Text style={{ fontSize: 10, color: COLORS.lightMuted, marginTop: 2 }}>{fmtWhen(e.created_at)}</Text>
                <View style={{ flexDirection: 'row', marginTop: 5 }}>
                  <Badge text={e.restored_at ? 'Restored' : 'Deleted'} variant={e.restored_at ? 'dark' : 'orange'} />
                </View>
              </View>
              {!e.restored_at && (restoring === e.log_id ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <TouchableOpacity style={s.restoreBtn} onPress={() => restore(e)}>
                  <Ionicons name="refresh-outline" size={14} color={COLORS.white} />
                  <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.white }}>Restore</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
          {entries.length === 0 && (
            <EmptyState icon={<Ionicons name="shield-checkmark-outline" size={48} color="#DDD" />} text="No matching deletion events" />
          )}
        </View>

        {page < totalPages && (
          <TouchableOpacity style={s.outlineBtn} onPress={loadMore} disabled={loadingMore}>
            {loadingMore ? <ActivityIndicator color={COLORS.black} /> : <Text style={s.outlineBtnText}>Load more</Text>}
          </TouchableOpacity>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={s.pickerBackdrop} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
            <Text style={s.pickerTitle}>Entity type</Text>
            {[{ value: null, label: 'All entity types' }, ...types.map(t => ({ value: t, label: TYPE_LABELS[t] || t }))].map(o => (
              <TouchableOpacity key={String(o.value)} style={s.pickerRow} onPress={() => { setTypeFilter(o.value); setPickerOpen(false); }}>
                <Text style={s.pickerRowText}>{o.label}</Text>
                {typeFilter === o.value && <Ionicons name="checkmark" size={16} color={COLORS.primary} />}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 14 },
  h1: { fontSize: 22, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2, lineHeight: 17 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  filterChipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  filterChipText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  filterChipTextActive: { color: COLORS.white },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 12, ...SHADOW.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg, gap: 10 },
  restoreBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  outlineBtn: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.lg, paddingVertical: 12, alignItems: 'center', backgroundColor: COLORS.white, marginBottom: 8 },
  outlineBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.black },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'center', padding: 28 },
  pickerCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 12, ...SHADOW.md },
  pickerTitle: { fontSize: 13, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 8 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12, borderRadius: RADIUS.md },
  pickerRowText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
});

export default AuditTrailScreen;
