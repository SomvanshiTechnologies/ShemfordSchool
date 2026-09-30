import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';

// Fallback list, mirrors frontend/src/lib/paymentMethods.js's PAYMENT_METHODS_WITH_POS —
// used only if /settings/payment-methods can't be reached.
const FALLBACK_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'online', label: 'Online / UPI' },
  { value: 'split', label: 'Split (Cash + Online)' },
  { value: 'pos_terminal', label: 'POS Terminal (Ezetap)' },
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const todayDMY = () => {
  const [y, m, d] = todayISO().split('-');
  return `${d}-${m}-${y}`;
};
const dmyToIso = (s) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const money = (n) => `Rs.${(Number(n) || 0).toLocaleString('en-IN')}`;

// Mirrors the dashboard's "Collect Payment" dialog (FeesPage.js) for a single
// ledger entry — payment date, optional partial amount, payment method
// (cash/cheque/bank_transfer/online/split/pos_terminal). Selecting POS Terminal
// hands off to onOpenPos instead of posting here, same as the web flow.
const CollectPaymentModal = ({ visible, onClose, studentId, entry, onSuccess, onOpenPos }) => {
  const [methods, setMethods] = useState(FALLBACK_METHODS);
  const [methodOpen, setMethodOpen] = useState(false);
  const [method, setMethod] = useState('cash');
  const [paymentDate, setPaymentDate] = useState(todayDMY());
  const [amount, setAmount] = useState('');
  const [splitCash, setSplitCash] = useState('');
  const [splitOnline, setSplitOnline] = useState('');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMethod('cash');
    setPaymentDate(todayDMY());
    setAmount('');
    setSplitCash('');
    setSplitOnline('');
    setReference('');
    setRemarks('');
    client.get('/settings/payment-methods')
      .then(r => {
        const list = Array.isArray(r.data?.methods) ? r.data.methods : null;
        if (list && list.length) setMethods(list);
      })
      .catch(() => setMethods(FALLBACK_METHODS));
  }, [visible]);

  if (!entry) return null;

  const remaining = Number(entry.remaining_balance || entry.net_amount || entry.total_due || 0);
  const methodLabel = methods.find(m => m.value === method)?.label || method;

  const submit = async () => {
    if (method === 'pos_terminal') {
      onClose();
      onOpenPos?.(entry);
      return;
    }

    const iso = dmyToIso(paymentDate);
    if (paymentDate && !iso) {
      Alert.alert('Invalid date', 'Payment date must be DD-MM-YYYY.');
      return;
    }

    const body = {
      student_id: studentId,
      ledger_ids: [entry.ledger_id],
      payment_method: method,
      ...(iso ? { payment_date: iso } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    };

    if (method === 'split') {
      const cash = parseFloat(splitCash) || 0;
      const online = parseFloat(splitOnline) || 0;
      const total = Math.round((cash + online) * 100) / 100;
      if (total <= 0) { Alert.alert('Missing amount', 'Enter the cash and/or online amount.'); return; }
      if (total > remaining + 0.01) { Alert.alert('Too much', `Cash + Online (${money(total)}) exceeds the remaining balance (${money(remaining)}).`); return; }
      body.split_payments = { cash, online };
      body.amount = total;
      if (reference.trim()) body.transaction_id = reference.trim();
    } else {
      if (method !== 'cash' && reference.trim()) body.transaction_id = reference.trim();
      const partial = parseFloat(amount);
      if (amount && partial > 0) {
        if (partial > remaining + 0.01) { Alert.alert('Too much', `Amount exceeds the remaining balance (${money(remaining)}).`); return; }
        body.amount = partial;
      }
    }

    setSaving(true);
    try {
      const res = await client.post('/fees/pay', body);
      Alert.alert('Payment recorded', res.data?.message || 'Payment collected successfully.');
      onSuccess?.();
      onClose();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Could not record payment.');
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.bg} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>Collect Payment</Text>
          <Text style={s.subtitle}>{entry.description || entry.month || 'Fee'} — 1 entry selected</Text>

          <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
            <Text style={s.label}>PAYMENT DATE</Text>
            <TextInput
              style={s.input}
              value={paymentDate}
              onChangeText={setPaymentDate}
              placeholder="DD-MM-YYYY"
              placeholderTextColor={COLORS.lightMuted}
            />
            <Text style={s.hint}>Back-dated payments allowed within this session.</Text>

            {method !== 'split' && (
              <>
                <Text style={s.label}>AMOUNT TO COLLECT (leave blank to pay in full)</Text>
                <TextInput
                  style={s.input}
                  value={amount}
                  onChangeText={setAmount}
                  placeholder={`Full: ${money(remaining)}`}
                  placeholderTextColor={COLORS.lightMuted}
                  keyboardType="numeric"
                />
                <Text style={s.hint}>Remaining on this entry: {money(remaining)}. Enter a smaller amount to record a partial payment.</Text>
              </>
            )}

            <Text style={s.label}>PAYMENT METHOD</Text>
            <TouchableOpacity style={[s.input, s.dropdown]} onPress={() => setMethodOpen(true)}>
              <Text style={{ fontSize: 14, color: COLORS.black }}>{methodLabel}</Text>
              <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
            </TouchableOpacity>

            {method === 'split' && (
              <View style={s.splitBox}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>CASH AMOUNT</Text>
                  <TextInput style={s.input} value={splitCash} onChangeText={setSplitCash} placeholder="0" placeholderTextColor={COLORS.lightMuted} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>ONLINE AMOUNT</Text>
                  <TextInput style={s.input} value={splitOnline} onChangeText={setSplitOnline} placeholder="0" placeholderTextColor={COLORS.lightMuted} keyboardType="numeric" />
                </View>
              </View>
            )}

            {method === 'split' && (
              <>
                <Text style={s.label}>REFERENCE</Text>
                <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="UPI Ref / UTR / Cheque no." placeholderTextColor={COLORS.lightMuted} />
                <Text style={s.hint}>Collect the online portion separately and enter the reference here. Cash + Online must equal the amount collected.</Text>
              </>
            )}

            {method !== 'cash' && method !== 'split' && method !== 'pos_terminal' && (
              <>
                <Text style={s.label}>REFERENCE (optional)</Text>
                <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="UPI Ref / UTR / Cheque no." placeholderTextColor={COLORS.lightMuted} />
              </>
            )}

            {method === 'pos_terminal' ? (
              <View style={s.posNotice}>
                <Ionicons name="card-outline" size={16} color={COLORS.black} />
                <Text style={s.posNoticeText}>This opens the POS terminal flow for this fee.</Text>
              </View>
            ) : (
              <>
                <Text style={s.label}>REMARKS</Text>
                <TextInput style={[s.input, { minHeight: 60 }]} value={remarks} onChangeText={setRemarks} placeholder="Optional" placeholderTextColor={COLORS.lightMuted} multiline textAlignVertical="top" />
              </>
            )}
          </ScrollView>

          <TouchableOpacity style={s.submitBtn} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name={method === 'pos_terminal' ? 'card' : 'checkmark'} size={16} color={COLORS.white} />}
            <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.white }}>
              {method === 'pos_terminal' ? 'Continue to POS Terminal' : 'Collect Payment'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={methodOpen} transparent animationType="fade" onRequestClose={() => setMethodOpen(false)}>
        <TouchableOpacity style={s.pickerBackdrop} activeOpacity={1} onPress={() => setMethodOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
            <Text style={s.pickerTitle}>Payment method</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {methods.map(m => (
                <TouchableOpacity key={m.value} style={s.pickerRow} onPress={() => { setMethod(m.value); setMethodOpen(false); }}>
                  <Text style={[s.pickerRowText, method === m.value && { fontWeight: '800' }]}>{m.label}</Text>
                  {method === m.value && <Ionicons name="checkmark" size={17} color={COLORS.black} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, ...SHADOW.md },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16 },
  title: { fontWeight: '800', fontSize: 18, color: COLORS.black },
  subtitle: { fontSize: 12, color: COLORS.muted, marginTop: 3, marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: COLORS.black, backgroundColor: COLORS.white },
  hint: { fontSize: 11, color: COLORS.lightMuted, marginTop: 4 },
  dropdown: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  splitBox: { flexDirection: 'row', gap: 10, marginTop: 4, padding: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: '#FED7AA', backgroundColor: '#FFF7ED' },
  posNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.lightBg, borderRadius: RADIUS.md, padding: 12, marginTop: 12 },
  posNoticeText: { fontSize: 12, color: COLORS.black, flex: 1 },
  submitBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, ...SHADOW.sm },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'center', padding: 28 },
  pickerCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 12, ...SHADOW.md },
  pickerTitle: { fontSize: 13, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 8 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12, borderRadius: RADIUS.md },
  pickerRowText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
});

export default CollectPaymentModal;
