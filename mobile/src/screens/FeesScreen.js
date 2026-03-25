import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';
import { CardDark, CardOrange, SectionTitle, Badge, Card } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';

const FeesScreen = () => {
  const { user } = useAuth();
  const isParent = user?.role === 'parent';
  const isStudent = user?.role === 'student';
  const isAdminAcc = user?.role === 'admin' || user?.role === 'accountant';

  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [feeData, setFeeData] = useState(null);
  const [dueChart, setDueChart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [payMonths, setPayMonths] = useState(1);
  const [showPay, setShowPay] = useState(false);

  useEffect(() => {
    if (isParent || isStudent) {
      client.get('/students').then(r => {
        setChildren(r.data);
        if (r.data.length > 0) {
          setSelectedChild(r.data[0]);
          return client.get(`/fees/student/${r.data[0].student_id}`);
        }
      }).then(r => { if (r) setFeeData(r.data); }).finally(() => setLoading(false));
    } else {
      client.get('/fees/due-chart').then(r => setDueChart(r.data)).finally(() => setLoading(false));
    }
  }, []);

  const loadFees = (studentId) => {
    setLoading(true);
    client.get(`/fees/student/${studentId}`).then(r => setFeeData(r.data)).finally(() => setLoading(false));
  };

  const payFees = async () => {
    if (!feeData) return;
    setPaying(true);
    const pending = feeData.installments.filter(i => i.status !== 'paid').slice(0, payMonths);
    const amount = pending.reduce((s, i) => s + i.total_due, 0);
    try {
      const res = await client.post('/fees/pay', {
        student_id: selectedChild.student_id, amount, payment_method: 'online',
        remarks: `Mobile payment — ${payMonths} month(s)`
      });
      Alert.alert('Success', res.data.message);
      setShowPay(false);
      loadFees(selectedChild.student_id);
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Payment failed');
    } finally { setPaying(false); }
  };

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  // Admin due chart
  if (isAdminAcc) {
    const totalDue = dueChart.reduce((s, x) => s + x.total_due, 0);
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.h1}>Fee Management</Text>
            <Text style={styles.sub}>{dueChart.length} students with dues</Text>
          </View>
          <CardDark>
            <Text style={styles.darkLabel}>TOTAL PENDING</Text>
            <Text style={styles.darkValue}>₹{totalDue.toLocaleString()}</Text>
          </CardDark>
          <View style={styles.list}>
            {dueChart.map(d => (
              <TouchableOpacity key={d.student_id} style={styles.listItem} onPress={() => { setSelectedChild({ student_id: d.student_id }); loadFees(d.student_id); }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }}>{d.name}</Text>
                  <Text style={{ fontSize: 11, color: COLORS.muted }}>{d.class_name}-{d.section} | {d.months_pending} mo</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontWeight: '700', fontSize: 14, color: COLORS.primary }}>₹{d.total_due.toLocaleString()}</Text>
                  {d.months_overdue > 0 && <Badge text={`${d.months_overdue} overdue`} variant="orange" />}
                </View>
              </TouchableOpacity>
            ))}
            {dueChart.length === 0 && (
              <View style={styles.empty}><Ionicons name="checkmark-circle" size={32} color={COLORS.black} /><Text style={styles.emptyText}>No pending dues</Text></View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Parent/Student view
  const summary = feeData?.summary;
  const installments = feeData?.installments || [];
  const pending = installments.filter(i => i.status !== 'paid');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.h1}>Fees</Text>
          <Text style={styles.sub}>{selectedChild?.first_name} {selectedChild?.last_name}</Text>
        </View>

        {summary && (
          summary.total_pending > 0 ? (
            <CardOrange>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View>
                  <Text style={styles.whiteLabel}>AMOUNT DUE</Text>
                  <Text style={styles.whiteValue}>₹{summary.total_pending.toLocaleString()}</Text>
                  <Text style={styles.whiteSub}>{summary.months_paid}/{summary.months_total} months paid</Text>
                </View>
                {isParent && (
                  <TouchableOpacity style={styles.payBtn} onPress={() => setShowPay(true)}>
                    <Ionicons name="card" size={14} color={COLORS.white} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.white }}>Pay Now</Text>
                  </TouchableOpacity>
                )}
              </View>
            </CardOrange>
          ) : (
            <CardDark>
              <Text style={styles.darkLabel}>ALL PAID</Text>
              <Text style={{ fontSize: 20, fontWeight: '800', color: COLORS.white, marginTop: 4 }}>₹0</Text>
              <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>{summary.months_paid}/{summary.months_total} months paid</Text>
            </CardDark>
          )
        )}

        {summary?.total_overdue > 0 && (
          <Card style={{ borderLeftWidth: 3, borderLeftColor: COLORS.primary, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Ionicons name="warning" size={18} color={COLORS.primary} />
            <View>
              <Text style={{ fontWeight: '700', fontSize: 13, color: COLORS.black }}>Overdue</Text>
              <Text style={{ fontSize: 11, color: COLORS.muted }}>₹{summary.total_overdue.toLocaleString()} overdue — late fees may apply</Text>
            </View>
          </Card>
        )}

        <SectionTitle>Monthly Breakdown</SectionTitle>
        <View style={styles.list}>
          {installments.map(inst => (
            <View key={inst.installment_id} style={styles.listItem}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }}>{inst.month}</Text>
                <Text style={{ fontSize: 11, color: COLORS.muted }}>Due: {inst.due_date}</Text>
                {inst.concession_amount > 0 && <Text style={{ fontSize: 10, color: COLORS.primary }}>Concession: -₹{inst.concession_amount}</Text>}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontWeight: '700', fontSize: 14, color: inst.status === 'paid' ? COLORS.black : COLORS.primary }}>₹{inst.total_due.toLocaleString()}</Text>
                <Badge text={inst.status} variant={inst.status === 'paid' ? 'dark' : inst.status === 'overdue' ? 'orange' : 'muted'} />
              </View>
            </View>
          ))}
        </View>

        {feeData?.payments?.length > 0 && (
          <>
            <SectionTitle>Payment History</SectionTitle>
            <View style={styles.list}>
              {feeData.payments.map(p => (
                <View key={p.payment_id} style={styles.listItem}>
                  <View>
                    <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }}>{p.receipt_number}</Text>
                    <Text style={{ fontSize: 11, color: COLORS.muted }}>{p.payment_date} | {p.payment_method}</Text>
                  </View>
                  <Text style={{ fontWeight: '700', fontSize: 14, color: COLORS.black }}>₹{p.amount.toLocaleString()}</Text>
                </View>
              ))}
            </View>
          </>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Payment Modal */}
      <Modal visible={showPay} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBg} onPress={() => setShowPay(false)} />
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <Text style={{ fontWeight: '800', fontSize: 18, color: COLORS.black, marginBottom: 16 }}>Pay Fees</Text>
            <Text style={{ fontSize: 13, color: COLORS.muted, marginBottom: 12 }}>Select months to pay (oldest first)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {[1, 2, 3, pending.length].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map(n => (
                <TouchableOpacity key={n} style={[styles.chip, payMonths === n && styles.chipActive]} onPress={() => setPayMonths(n)}>
                  <Text style={[styles.chipText, payMonths === n && styles.chipTextActive]}>{n} month{n > 1 ? 's' : ''}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={[styles.amountBox, { marginBottom: 16 }]}>
              <Text style={{ fontSize: 13, color: COLORS.muted }}>Amount</Text>
              <Text style={{ fontWeight: '800', fontSize: 18, color: COLORS.black }}>₹{pending.slice(0, payMonths).reduce((s, i) => s + i.total_due, 0).toLocaleString()}</Text>
            </View>
            <TouchableOpacity style={[styles.payFullBtn]} onPress={payFees} disabled={paying}>
              {paying ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="card" size={18} color={COLORS.white} />}
              <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.white }}>{paying ? 'Processing...' : 'Confirm Payment'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 24, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  darkLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.muted },
  darkValue: { fontSize: 28, fontWeight: '800', color: COLORS.white },
  whiteLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.7)' },
  whiteValue: { fontSize: 28, fontWeight: '800', color: COLORS.white, marginTop: 4 },
  whiteSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  payBtn: { backgroundColor: COLORS.black, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  list: { backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 14, color: COLORS.lightMuted, marginTop: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white, marginRight: 8 },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  chipTextActive: { color: COLORS.white },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: COLORS.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E5E5', alignSelf: 'center', marginBottom: 20 },
  amountBox: { backgroundColor: COLORS.lightBg, borderRadius: 12, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payFullBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});

export default FeesScreen;
