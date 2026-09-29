import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { Badge, EmptyState, CardDark } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { useSession } from '../contexts/SessionContext';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const feeStatusVariant = (st) => (st === 'paid' || st === 'no_fee' ? 'dark' : st === 'overdue' ? 'orange' : 'muted');

// ─── Reason prompt (reject flows) ────────────────────────────────────────────

const ReasonModal = ({ visible, title, onSubmit, onClose }) => {
  const [reason, setReason] = useState('');
  useEffect(() => { if (visible) setReason(''); }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={s.pickerBackdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
          <Text style={s.pickerTitle}>{title}</Text>
          <View style={{ padding: 8 }}>
            <TextInput
              style={[s.formInput, { minHeight: 70 }]}
              value={reason}
              onChangeText={setReason}
              placeholder="Reason (optional)"
              placeholderTextColor={COLORS.lightMuted}
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity style={s.dangerBtn} onPress={() => onSubmit(reason.trim())}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.white }}>Reject</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

// ─── Tab 1: Upgrade Student ──────────────────────────────────────────────────

const UpgradeTab = ({ classes, sessions, onDone }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [student, setStudent] = useState(null);
  const [dues, setDues] = useState(null);
  const [toClass, setToClass] = useState('');
  const [toSection, setToSection] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const debRef = useRef(null);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!query.trim()) { setResults([]); return; }
    debRef.current = setTimeout(() => {
      client.get('/students', { params: { search: query.trim(), limit: 20, name_only: true } })
        .then(r => setResults(Array.isArray(r.data) ? r.data : (r.data?.students || [])))
        .catch(() => setResults([]));
    }, 300);
    return () => debRef.current && clearTimeout(debRef.current);
  }, [query]);

  const sortedClasses = classes; // already sort_order sorted by backend
  const curIdx = student ? sortedClasses.findIndex(c => c.name === student.class_name) : -1;
  const laterClasses = curIdx >= 0 ? sortedClasses.slice(curIdx + 1) : sortedClasses;
  const targetCls = sortedClasses.find(c => c.name === toClass);
  const sectionOptions = targetCls
    ? (targetCls.has_streams ? (targetCls.streams || []) : (targetCls.sections || []).map(sc => sc.section_name))
    : [];

  // Next configured session after the student's current year, like the dashboard.
  const nextYear = (() => {
    if (!student) return '';
    const names = (sessions || []).map(x => x.session_name).sort();
    const idx = names.indexOf(student.academic_year);
    return idx >= 0 && idx + 1 < names.length ? names[idx + 1] : (names[names.length - 1] || '');
  })();

  const pick = async (st) => {
    setStudent(st);
    setResults([]);
    setQuery('');
    setNotes('');
    setToClass('');
    setToSection('');
    setDues(null);
    if (st.fee_status === 'pending' || st.fee_status === 'overdue') {
      try {
        const r = await client.get(`/fees/ledger/${st.student_id}`);
        const led = r.data?.ledger || {};
        const all = [...(led.one_time || []), ...(led.yearly || []), ...(led.monthly || [])];
        const pending = all.filter(e => ['pending', 'overdue', 'partially_paid'].includes(e.status));
        const total = pending.reduce((a, e) => a + Number(e.remaining_balance || e.net_amount || 0), 0);
        setDues({ count: pending.length, total });
      } catch { setDues(null); }
    }
  };

  const doUpgrade = async ({ collectFee }) => {
    if (!toClass || !toSection) { Alert.alert('Missing field', 'Choose the new class and section.'); return; }
    setBusy(true);
    try {
      const body = {
        to_class: toClass,
        ...(targetCls?.has_streams ? { to_section: toSection, to_stream: toSection } : { to_section: toSection }),
        ...(nextYear ? { academic_year: nextYear } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      if (collectFee) {
        // Mirror the dashboard's "Collect Fee & Upgrade": create the fee entry,
        // pay it in full (cash), then upgrade with the fee marked pre-paid.
        const fe = await client.post(`/students/${student.student_id}/upgrade/create-fee-entry`, {
          to_class: body.to_class, to_section: body.to_section,
          ...(body.to_stream ? { to_stream: body.to_stream } : {}),
          ...(body.academic_year ? { academic_year: body.academic_year } : {}),
        });
        if (fe.data?.ledger_id) {
          const pay = await client.post(`/students/${student.student_id}/upgrade/pay-fee`, { payment_method: 'cash' });
          Alert.alert('Fee collected', `${money(pay.data.amount)} received. Receipt: ${pay.data.receipt_number}`);
        }
        body.upgradation_fee_pre_paid = true;
      } else {
        body.force_upgrade = true;
      }
      const res = await client.post(`/students/${student.student_id}/upgrade`, body);
      Alert.alert(
        res.data.auto_approved ? 'Upgraded' : 'Sent for approval',
        res.data.message || (res.data.auto_approved ? 'Student upgraded successfully.' : 'Upgrade is pending approval.')
      );
      setStudent(null);
      onDone?.();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Upgrade failed.');
    } finally { setBusy(false); }
  };

  const graduate = () => {
    Alert.alert('Graduate student?', `${student.first_name} ${student.last_name} will be marked as passed out and deactivated.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Graduate', style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await client.post(`/students/${student.student_id}/graduate`, {});
            Alert.alert('Done', 'Student graduated.');
            setStudent(null);
            onDone?.();
          } catch (e) {
            Alert.alert('Error', e.response?.data?.detail || 'Graduation failed.');
          } finally { setBusy(false); }
        },
      },
    ]);
  };

  return (
    <View>
      <Text style={s.stepTitle}>Step 1 — Select Student</Text>
      <TextInput
        style={s.formInput}
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name or admission number..."
        placeholderTextColor={COLORS.lightMuted}
      />
      {results.map(st => (
        <TouchableOpacity key={st.student_id} style={s.resultRow} onPress={() => pick(st)}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', fontSize: 14, color: COLORS.black }}>{st.first_name} {st.last_name}</Text>
            <Text style={{ fontSize: 11, color: COLORS.muted }}>{st.class_name}-{st.section} | {st.admission_number} | {st.academic_year}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.lightMuted} />
        </TouchableOpacity>
      ))}

      {student && (
        <View style={s.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.black }}>{student.first_name} {student.last_name}</Text>
            <Badge text={student.fee_status || 'pending'} variant={student.fee_status === 'paid' ? 'dark' : 'orange'} />
          </View>
          <Text style={{ fontSize: 12, color: COLORS.muted, marginBottom: 12 }}>
            {student.class_name}-{student.section} · {student.academic_year} · {student.admission_number}
          </Text>

          {dues && dues.total > 0 && (
            <CardDark style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.white }}>Fees pending — {money(dues.total)}</Text>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
                {dues.count} unpaid entries. Collect dues first, or send for approval to let an admin decide.
              </Text>
            </CardDark>
          )}

          {['12th', '12', 'Class 12'].includes(student.class_name) ? (
            <TouchableOpacity style={s.saveBtn} onPress={graduate} disabled={busy}>
              {busy ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="school" size={16} color={COLORS.white} />}
              <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.white }}>Graduate (Pass Out)</Text>
            </TouchableOpacity>
          ) : (
            <>
              <Text style={s.formLabel}>NEW CLASS *</Text>
              <View style={s.chipWrap}>
                {laterClasses.map(c => (
                  <TouchableOpacity key={c.name} style={[s.chip, toClass === c.name && s.chipActive]} onPress={() => { setToClass(c.name); setToSection(''); }}>
                    <Text style={[s.chipText, toClass === c.name && s.chipTextActive]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {!!toClass && (
                <>
                  <Text style={s.formLabel}>{targetCls?.has_streams ? 'STREAM *' : 'NEW SECTION *'}</Text>
                  <View style={s.chipWrap}>
                    {sectionOptions.map(n => (
                      <TouchableOpacity key={n} style={[s.chip, toSection === n && s.chipActive]} onPress={() => setToSection(n)}>
                        <Text style={[s.chipText, toSection === n && s.chipTextActive]}>{n}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <Text style={s.formLabel}>ACADEMIC YEAR</Text>
              <View style={[s.formInput, { backgroundColor: COLORS.lightBg }]}>
                <Text style={{ fontSize: 14, color: COLORS.black }}>{nextYear || 'Active session'}</Text>
              </View>
              <Text style={s.formLabel}>NOTES</Text>
              <TextInput style={s.formInput} value={notes} onChangeText={setNotes} placeholder="Optional notes" placeholderTextColor={COLORS.lightMuted} />

              <TouchableOpacity style={s.saveBtn} onPress={() => doUpgrade({ collectFee: true })} disabled={busy}>
                {busy ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="cash-outline" size={16} color={COLORS.white} />}
                <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.white }}>Collect Fee & Upgrade</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.outlineBtn} onPress={() => doUpgrade({ collectFee: false })} disabled={busy}>
                <Text style={s.outlineBtnText}>Send for Approval (skip fee)</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
};

// ─── Tabs 2 & 3: History / Recently Upgraded ─────────────────────────────────

const HistoryTab = ({ approvedOnly, refreshKey, onChanged }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);

  const load = useCallback(() => {
    const params = approvedOnly ? { status: 'approved', limit: 500 } : { limit: 500 };
    return client.get('/upgradation/history', { params })
      .then(r => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([]));
  }, [approvedOnly]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load, refreshKey]);

  const approve = (rec) => {
    Alert.alert('Approve upgrade?', `${rec.student_name}: ${rec.from_class} → ${rec.to_class}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          setActing(rec.upgradation_id);
          try {
            await client.post(`/upgradation/${rec.upgradation_id}/approve`);
            await load();
            onChanged?.();
          } catch (e) {
            Alert.alert('Error', e.response?.data?.detail || 'Approve failed.');
          } finally { setActing(null); }
        },
      },
    ]);
  };

  const collectFee = (rec) => {
    Alert.alert('Collect upgradation fee?', `${money(rec.upgradation_fee)} from ${rec.student_name} (cash).`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Collect',
        onPress: async () => {
          setActing(rec.upgradation_id);
          try {
            const r = await client.post(`/students/${rec.student_id}/upgrade/pay-fee`, { payment_method: 'cash' });
            Alert.alert('Collected', `${money(r.data.amount)} received. Receipt: ${r.data.receipt_number}`);
            await load();
          } catch (e) {
            Alert.alert('Error', e.response?.data?.detail || 'Collection failed.');
          } finally { setActing(null); }
        },
      },
    ]);
  };

  const reject = async (reason) => {
    const rec = rejectTarget;
    setRejectTarget(null);
    setActing(rec.upgradation_id);
    try {
      await client.post(`/upgradation/${rec.upgradation_id}/reject`, reason ? { reason } : {});
      await load();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Reject failed.');
    } finally { setActing(null); }
  };

  if (loading) return <ScreenLoader />;

  return (
    <View style={s.list}>
      {rows.map(rec => {
        const feePaid = rec.upgradation_fee_status === 'paid' || rec.upgradation_fee_status === 'no_fee' || !rec.upgradation_fee;
        return (
          <View key={rec.upgradation_id} style={s.histRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', fontSize: 13, color: COLORS.black }}>{rec.student_name}</Text>
              <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
                {rec.from_class}-{rec.from_section} → {rec.to_class}-{rec.to_section} · {rec.academic_year}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                <Badge
                  text={rec.status}
                  variant={rec.status === 'approved' ? 'dark' : rec.status === 'rejected' ? 'orange' : 'muted'}
                />
                {!!rec.upgradation_fee && (
                  <Badge text={`Fee ${rec.upgradation_fee_status || 'pending'}`} variant={feeStatusVariant(rec.upgradation_fee_status)} />
                )}
              </View>
              {approvedOnly && rec.approved_at && (
                <Text style={{ fontSize: 10, color: COLORS.lightMuted, marginTop: 3 }}>Upgraded on {String(rec.approved_at).slice(0, 10)}</Text>
              )}
            </View>
            {!approvedOnly && rec.status === 'pending_approval' && (
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                {acting === rec.upgradation_id ? <ActivityIndicator size="small" color={COLORS.primary} /> : (
                  <>
                    {!feePaid && (
                      <TouchableOpacity style={s.miniBtn} onPress={() => collectFee(rec)}>
                        <Text style={s.miniBtnText}>Collect Fee</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[s.miniBtn, { backgroundColor: feePaid ? COLORS.black : COLORS.lightBg, borderColor: feePaid ? COLORS.black : COLORS.border }]}
                      onPress={() => feePaid && approve(rec)}
                      disabled={!feePaid}
                    >
                      <Text style={[s.miniBtnText, { color: feePaid ? COLORS.white : COLORS.lightMuted }]}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.miniBtn, { borderColor: '#FECACA' }]} onPress={() => setRejectTarget(rec)}>
                      <Text style={[s.miniBtnText, { color: COLORS.danger }]}>Reject</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </View>
        );
      })}
      {rows.length === 0 && <EmptyState icon={<Ionicons name="arrow-up-circle-outline" size={48} color="#DDD" />} text={approvedOnly ? 'No upgrades yet' : 'No upgradation records'} />}
      <ReasonModal
        visible={!!rejectTarget}
        title={`Reject upgrade — ${rejectTarget?.student_name || ''}`}
        onSubmit={reject}
        onClose={() => setRejectTarget(null)}
      />
    </View>
  );
};

// ─── Main screen ─────────────────────────────────────────────────────────────

const UpgradationScreen = () => {
  const session = useSession() || {};
  const [tab, setTab] = useState('upgrade');
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    client.get('/classes')
      .then(r => setClasses(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <SafeAreaView style={s.safe}><ScreenLoader /></SafeAreaView>;

  const TABS = [['upgrade', 'Upgrade'], ['history', 'History'], ['recent', 'Recently Upgraded']];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setRefreshKey(k => k + 1); setTimeout(() => setRefreshing(false), 400); }} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        <View style={s.header}>
          <Text style={s.h1}>Class Upgradation</Text>
          <Text style={s.sub}>Promote students to new class / academic year</Text>
        </View>

        <View style={s.tabBar}>
          {TABS.map(([key, label]) => (
            <TouchableOpacity key={key} style={[s.tabItem, tab === key && s.tabItemActive]} onPress={() => setTab(key)}>
              <Text style={[s.tabItemText, tab === key && s.tabItemTextActive]} numberOfLines={1}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'upgrade' && <UpgradeTab classes={classes} sessions={session.sessions} onDone={() => setRefreshKey(k => k + 1)} />}
        {tab === 'history' && <HistoryTab approvedOnly={false} refreshKey={refreshKey} onChanged={() => setRefreshKey(k => k + 1)} />}
        {tab === 'recent' && <HistoryTab approvedOnly refreshKey={refreshKey} />}
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 14 },
  h1: { fontSize: 22, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  tabBar: { flexDirection: 'row', backgroundColor: COLORS.lightBg, borderRadius: RADIUS.lg, padding: 4, marginBottom: 16 },
  tabItem: { flex: 1, paddingVertical: 9, borderRadius: RADIUS.md, alignItems: 'center' },
  tabItemActive: { backgroundColor: COLORS.white, ...SHADOW.sm },
  tabItemText: { fontSize: 11, fontWeight: '700', color: COLORS.muted },
  tabItemTextActive: { color: COLORS.black },
  stepTitle: { fontSize: 14, fontWeight: '800', color: COLORS.black, marginBottom: 10 },
  formLabel: { ...FONTS.small, marginBottom: 6, marginTop: 4 },
  formInput: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: COLORS.black, backgroundColor: COLORS.white, marginBottom: 12 },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  card: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, marginTop: 8, marginBottom: 14, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  chipTextActive: { color: COLORS.white },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6, ...SHADOW.sm },
  outlineBtn: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.lg, paddingVertical: 12, alignItems: 'center', backgroundColor: COLORS.white, marginTop: 10 },
  outlineBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.black },
  dangerBtn: { backgroundColor: COLORS.danger, borderRadius: RADIUS.lg, paddingVertical: 12, alignItems: 'center' },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, ...SHADOW.sm },
  histRow: { flexDirection: 'row', paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg, gap: 10 },
  miniBtn: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: COLORS.white },
  miniBtnText: { fontSize: 11, fontWeight: '700', color: COLORS.black },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'center', padding: 28 },
  pickerCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 12, ...SHADOW.md },
  pickerTitle: { fontSize: 13, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 8 },
});

export default UpgradationScreen;
