import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { Badge, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const daysLeft = (iso) => {
  if (!iso) return null;
  const ms = new Date(iso) - new Date();
  return Math.ceil(ms / 86400000);
};

const ReasonModal = ({ visible, title, submitLabel, onSubmit, onClose }) => {
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
              <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.white }}>{submitLabel}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const RequestRow = ({ req, children }) => (
  <View style={s.row}>
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Text style={{ fontWeight: '700', fontSize: 13, color: COLORS.black }}>{req.user_name || req.user_id}</Text>
        <Badge text={req.user_role || 'user'} variant="muted" />
      </View>
      <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }} numberOfLines={1}>{req.user_email || '—'}</Text>
      {!!req.reason && <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 2, fontStyle: 'italic' }} numberOfLines={2}>"{req.reason}"</Text>}
      <Text style={{ fontSize: 10, color: COLORS.lightMuted, marginTop: 3 }}>Requested {fmtDate(req.requested_at)}</Text>
    </View>
    {children}
  </View>
);

const DeletionRequestsScreen = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null); // {req, kind: 'reject'|'reject-revoke'}

  const load = useCallback(() =>
    client.get('/account-deletion/requests')
      .then(r => setRequests(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRequests([])), []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const act = async (req, path, body, confirmTitle, confirmMsg, destructive) => {
    const run = async () => {
      setActing(req.request_id);
      try {
        await client.post(`/account-deletion/${req.request_id}/${path}`, body || {});
        await load();
      } catch (e) {
        Alert.alert('Error', e.response?.data?.detail || 'Action failed.');
      } finally { setActing(null); }
    };
    if (confirmTitle) {
      Alert.alert(confirmTitle, confirmMsg, [
        { text: 'Cancel', style: 'cancel' },
        { text: destructive ? 'Delete' : 'Confirm', style: destructive ? 'destructive' : 'default', onPress: run },
      ]);
    } else run();
  };

  const submitReject = async (reason) => {
    const { req, kind } = rejectTarget;
    setRejectTarget(null);
    setActing(req.request_id);
    try {
      await client.post(`/account-deletion/${req.request_id}/${kind}`, reason ? { reason } : {});
      await load();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Action failed.');
    } finally { setActing(null); }
  };

  if (loading) return <SafeAreaView style={s.safe}><ScreenLoader /></SafeAreaView>;

  const revokePending = requests.filter(r => r.status === 'revoke_pending');
  const approved = requests.filter(r => r.status === 'approved');
  const pending = requests.filter(r => r.status === 'pending');

  const Section = ({ title, items, renderActions, emptyText }) => (
    <>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.list}>
        {items.map(req => (
          <RequestRow key={req.request_id} req={req}>
            {acting === req.request_id
              ? <ActivityIndicator size="small" color={COLORS.primary} />
              : renderActions(req)}
          </RequestRow>
        ))}
        {items.length === 0 && (
          <View style={{ paddingVertical: 22, alignItems: 'center' }}>
            <Ionicons name="shield-checkmark-outline" size={30} color="#DDD" />
            <Text style={{ fontSize: 12, color: COLORS.lightMuted, marginTop: 6 }}>{emptyText}</Text>
          </View>
        )}
      </View>
    </>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        <View style={s.header}>
          <Text style={s.h1}>Account Deletion Requests</Text>
          <Text style={s.sub}>Approving permanently deletes the account and all its data.</Text>
        </View>

        <Section
          title="ACCOUNT RESTORATION REQUESTS"
          items={revokePending}
          emptyText="No restoration requests"
          renderActions={(req) => (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[s.iconBtn, { backgroundColor: '#ECFDF5' }]}
                onPress={() => act(req, 'approve-revoke', null, 'Restore this account?', `${req.user_name} will be reactivated and the deletion cancelled.`)}
              >
                <Ionicons name="checkmark" size={18} color={COLORS.success} />
              </TouchableOpacity>
              <TouchableOpacity style={[s.iconBtn, { backgroundColor: '#FEF2F2' }]} onPress={() => setRejectTarget({ req, kind: 'reject-revoke' })}>
                <Ionicons name="close" size={18} color={COLORS.danger} />
              </TouchableOpacity>
            </View>
          )}
        />

        <Section
          title="SCHEDULED FOR DELETION"
          items={approved}
          emptyText="Nothing scheduled"
          renderActions={(req) => {
            const dl = daysLeft(req.final_deletion_at);
            const expired = dl !== null && dl <= 0;
            return (
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                {dl !== null && (
                  <Badge text={expired ? 'Window over' : `${dl}d left`} variant={expired ? 'orange' : 'muted'} />
                )}
                <TouchableOpacity
                  style={[s.iconBtn, { backgroundColor: '#FEF2F2' }]}
                  onPress={() => act(
                    req, 'execute', { force: !expired },
                    'Permanently delete this account?',
                    `${req.user_name}'s account and ALL their data will be erased. This cannot be undone.`,
                    true
                  )}
                >
                  <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
            );
          }}
        />

        <Section
          title="PENDING DELETION REQUESTS"
          items={pending}
          emptyText="No pending deletion requests"
          renderActions={(req) => (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[s.iconBtn, { backgroundColor: '#ECFDF5' }]}
                onPress={() => act(
                  req, 'approve', null,
                  'Approve deletion?',
                  `${req.user_name}'s account will be scheduled for permanent deletion in 30 days.`
                )}
              >
                <Ionicons name="checkmark" size={18} color={COLORS.success} />
              </TouchableOpacity>
              <TouchableOpacity style={[s.iconBtn, { backgroundColor: '#FEF2F2' }]} onPress={() => setRejectTarget({ req, kind: 'reject' })}>
                <Ionicons name="close" size={18} color={COLORS.danger} />
              </TouchableOpacity>
            </View>
          )}
        />
        <View style={{ height: 20 }} />
      </ScrollView>

      <ReasonModal
        visible={!!rejectTarget}
        title={rejectTarget?.kind === 'reject-revoke' ? 'Reject restoration request' : 'Reject deletion request'}
        submitLabel="Reject"
        onSubmit={submitReject}
        onClose={() => setRejectTarget(null)}
      />
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 14 },
  h1: { fontSize: 22, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2, lineHeight: 17 },
  sectionTitle: { ...FONTS.small, marginBottom: 8, marginTop: 6 },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, ...SHADOW.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg, gap: 10 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  formInput: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: COLORS.black, backgroundColor: COLORS.white, marginBottom: 12 },
  dangerBtn: { backgroundColor: COLORS.danger, borderRadius: RADIUS.lg, paddingVertical: 12, alignItems: 'center' },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'center', padding: 28 },
  pickerCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 12, ...SHADOW.md },
  pickerTitle: { fontSize: 13, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 8 },
});

export default DeletionRequestsScreen;
