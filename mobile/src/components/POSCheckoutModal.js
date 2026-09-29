import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';

const MODES = ['ALL', 'UPI', 'CARD', 'CASH', 'BHARATQR', 'CHEQUE'];
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90000; // matches the dashboard's POS flow

// Mirrors frontend/src/components/POSCheckout.jsx — initiate → poll status →
// success/failed, against the same backend endpoints.
const POSCheckoutModal = ({ visible, onClose, studentId, pendingEntries = [], onSuccess }) => {
  const [selectedIds, setSelectedIds] = useState([]);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  const [mode, setMode] = useState('ALL');
  const [phase, setPhase] = useState('select'); // select | initiating | waiting | success | failed
  const [message, setMessage] = useState('');
  const [receiptNumber, setReceiptNumber] = useState(null);
  const pollRef = useRef(null);
  const posOrderIdRef = useRef(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    setPhase('select');
    setMessage('');
    setReceiptNumber(null);
    setSelectedIds(pendingEntries.map(e => e.ledger_id));
    client.get('/payments/pos/devices')
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : [];
        setDevices(list);
        setDeviceId(list[0]?.device_id || null);
      })
      .catch(() => setDevices([]));
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const totalDue = pendingEntries
    .filter(e => selectedIds.includes(e.ledger_id))
    .reduce((s, e) => s + Number(e.net_amount ?? e.total_due ?? 0), 0);

  const toggleEntry = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const pollStatus = useCallback((posOrderId) => {
    elapsedRef.current = 0;
    pollRef.current = setInterval(async () => {
      elapsedRef.current += POLL_INTERVAL_MS;
      try {
        const res = await client.post('/payments/pos/status', { pos_order_id: posOrderId });
        const { status, receipt_number, message: msg } = res.data || {};
        if (status === 'SUCCESS') {
          stopPolling();
          setReceiptNumber(receipt_number);
          setPhase('success');
          onSuccess?.();
        } else if (['FAILED', 'DECLINED', 'ERROR', 'CANCELLED'].includes(status)) {
          stopPolling();
          setMessage(msg || 'Payment failed.');
          setPhase('failed');
        } else if (elapsedRef.current >= POLL_TIMEOUT_MS) {
          stopPolling();
          setMessage('No response from the terminal. Check the device and try again.');
          setPhase('failed');
        } else {
          setMessage(msg || 'Waiting for the customer to complete payment on the terminal…');
        }
      } catch (e) {
        // Transient network hiccup — keep polling until the timeout above.
        if (elapsedRef.current >= POLL_TIMEOUT_MS) {
          stopPolling();
          setMessage('Could not confirm payment status. Check the fee history before retrying.');
          setPhase('failed');
        }
      }
    }, POLL_INTERVAL_MS);
  }, [onSuccess]);

  const initiate = async () => {
    if (!deviceId) { setMessage('No POS terminal registered.'); setPhase('failed'); return; }
    if (selectedIds.length === 0) { setMessage('Select at least one fee to collect.'); setPhase('failed'); return; }
    setPhase('initiating');
    try {
      const res = await client.post('/payments/pos/initiate', {
        student_id: studentId,
        ledger_ids: selectedIds,
        amount_paise: Math.round(totalDue * 100),
        device_id: deviceId,
        mode,
      });
      posOrderIdRef.current = res.data?.pos_order_id;
      setMessage('Sent to terminal — waiting for the customer to pay…');
      setPhase('waiting');
      pollStatus(posOrderIdRef.current);
    } catch (e) {
      setMessage(e.response?.data?.detail || 'Could not start POS payment.');
      setPhase('failed');
    }
  };

  const cancelOrder = async () => {
    stopPolling();
    if (posOrderIdRef.current) {
      client.post('/payments/pos/cancel', { pos_order_id: posOrderIdRef.current }).catch(() => {});
    }
    onClose?.();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.bg} onPress={phase === 'waiting' ? undefined : onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Collect via POS Terminal</Text>

          {phase === 'select' && (
            <ScrollView style={{ maxHeight: 380 }}>
              <Text style={styles.label}>Fees to collect</Text>
              {pendingEntries.map(e => {
                const checked = selectedIds.includes(e.ledger_id);
                return (
                  <TouchableOpacity key={e.ledger_id} style={styles.entryRow} onPress={() => toggleEntry(e.ledger_id)}>
                    <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={20} color={checked ? COLORS.primary : COLORS.lightMuted} />
                    <Text style={styles.entryLabel} numberOfLines={1}>{e.description || e.month || 'Fee'}</Text>
                    <Text style={styles.entryAmount}>₹{Number(e.net_amount ?? e.total_due ?? 0).toLocaleString()}</Text>
                  </TouchableOpacity>
                );
              })}
              {pendingEntries.length === 0 && <Text style={styles.hint}>No pending fees for this student.</Text>}

              <Text style={[styles.label, { marginTop: 16 }]}>Terminal</Text>
              <View style={styles.chipRow}>
                {devices.map(d => (
                  <TouchableOpacity
                    key={d.device_id}
                    style={[styles.chip, deviceId === d.device_id && styles.chipActive]}
                    onPress={() => setDeviceId(d.device_id)}
                  >
                    <Text style={[styles.chipText, deviceId === d.device_id && styles.chipTextActive]}>
                      {d.label || d.device_id}
                    </Text>
                  </TouchableOpacity>
                ))}
                {devices.length === 0 && <Text style={styles.hint}>No POS terminals registered.</Text>}
              </View>

              <Text style={[styles.label, { marginTop: 16 }]}>Payment mode</Text>
              <View style={styles.chipRow}>
                {MODES.map(m => (
                  <TouchableOpacity key={m} style={[styles.chip, mode === m && styles.chipActive]} onPress={() => setMode(m)}>
                    <Text style={[styles.chipText, mode === m && styles.chipTextActive]}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.totalBox}>
                <Text style={{ fontSize: 13, color: COLORS.muted }}>Amount to charge</Text>
                <Text style={{ fontWeight: '800', fontSize: 18, color: COLORS.black }}>₹{totalDue.toLocaleString()}</Text>
              </View>

              <TouchableOpacity style={styles.primaryBtn} onPress={initiate} disabled={totalDue <= 0}>
                <Ionicons name="card" size={16} color={COLORS.white} />
                <Text style={styles.primaryBtnText}>Charge ₹{totalDue.toLocaleString()}</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {(phase === 'initiating' || phase === 'waiting') && (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.waitingText}>{message || 'Sending to terminal…'}</Text>
              <Text style={styles.hint}>Do not close this screen.</Text>
              <TouchableOpacity style={styles.outlineBtn} onPress={cancelOrder}>
                <Text style={styles.outlineBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}

          {phase === 'success' && (
            <View style={styles.centerBox}>
              <Ionicons name="checkmark-circle" size={56} color={COLORS.success} />
              <Text style={styles.successText}>Payment received</Text>
              {!!receiptNumber && <Text style={styles.hint}>Receipt: {receiptNumber}</Text>}
              <TouchableOpacity style={styles.primaryBtn} onPress={onClose}>
                <Text style={styles.primaryBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}

          {phase === 'failed' && (
            <View style={styles.centerBox}>
              <Ionicons name="close-circle" size={56} color={COLORS.danger} />
              <Text style={styles.failText}>{message || 'Payment failed'}</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setPhase('select')}>
                <Text style={styles.primaryBtnText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.outlineBtn} onPress={onClose}>
                <Text style={styles.outlineBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, ...SHADOW.md },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16 },
  title: { fontWeight: '800', fontSize: 18, color: COLORS.black, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  entryLabel: { flex: 1, fontSize: 13, color: COLORS.black, fontWeight: '600' },
  entryAmount: { fontSize: 13, fontWeight: '700', color: COLORS.black },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  chipTextActive: { color: COLORS.white },
  totalBox: { backgroundColor: COLORS.lightBg, borderRadius: RADIUS.lg, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 16 },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, ...SHADOW.sm },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.white },
  outlineBtn: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.lg, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  outlineBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.black },
  centerBox: { alignItems: 'center', paddingVertical: 20 },
  waitingText: { fontSize: 14, fontWeight: '600', color: COLORS.black, marginTop: 14, textAlign: 'center' },
  successText: { fontSize: 16, fontWeight: '800', color: COLORS.black, marginTop: 12 },
  failText: { fontSize: 14, fontWeight: '600', color: COLORS.black, marginTop: 12, textAlign: 'center' },
  hint: { fontSize: 12, color: COLORS.lightMuted, marginTop: 6, textAlign: 'center' },
});

export default POSCheckoutModal;
