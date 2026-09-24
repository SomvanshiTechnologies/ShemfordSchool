import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import client from '../api/client';
import { API_URL } from '../config';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { ScreenLoader } from '../components/LoadingSkeleton';

const dmy = (iso) => {
  if (!iso || typeof iso !== 'string' || iso.length < 10) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
};

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Row = ({ label, value, style }) => (
  <View style={[styles.infoRow, style]}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value || '—'}</Text>
  </View>
);

const ReceiptScreen = ({ route }) => {
  const paymentId = route.params?.paymentId;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!paymentId) { setLoading(false); setError('No payment selected'); return; }
    client.get(`/fees/receipt/${paymentId}/details`)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.detail || 'Could not load receipt'))
      .finally(() => setLoading(false));
  }, [paymentId]);

  const downloadPdf = useCallback(async () => {
    if (!paymentId) return;
    setDownloading(true);
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      const url = `${API_URL}/fees/receipt/${paymentId}/pdf`;
      const target = `${FileSystem.cacheDirectory}receipt_${paymentId}.pdf`;
      const res = await FileSystem.downloadAsync(url, target, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status !== 200) throw new Error(`Server returned ${res.status}`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(res.uri, { mimeType: 'application/pdf', dialogTitle: 'Fee Receipt', UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('Downloaded', `Saved to ${res.uri}`);
      }
    } catch (e) {
      Alert.alert('Download failed', e?.message || 'Could not download receipt.');
    } finally {
      setDownloading(false);
    }
  }, [paymentId]);

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  if (error || !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><Text style={styles.errorText}>{error || 'Receipt not found'}</Text></View>
      </SafeAreaView>
    );
  }

  const items = data.items || [];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.downloadBtn} onPress={downloadPdf} disabled={downloading}>
          {downloading ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <Ionicons name="download-outline" size={16} color={COLORS.white} />
          )}
          <Text style={styles.downloadBtnText}>{downloading ? 'Preparing…' : 'Download Receipt'}</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          {/* Payment ID / Date */}
          <View style={styles.topRow}>
            <Text style={styles.topText}>Payment ID: {data.payment_id}</Text>
            <Text style={styles.topText}>Date: {dmy(data.generated_date)}</Text>
          </View>

          {/* School header */}
          <View style={styles.schoolHeader}>
            <Text style={styles.schoolName}>{data.school_name}</Text>
            {!!data.school_address && <Text style={styles.schoolLine}>{data.school_address}</Text>}
            {!!data.school_phone && <Text style={styles.schoolLine}>Call : {data.school_phone}</Text>}
          </View>

          {/* Title bar */}
          <View style={styles.titleBar}>
            <Text style={styles.titleText}>Fee Receipt</Text>
          </View>

          {/* Student info */}
          <View style={styles.infoBlock}>
            <Row label="Student Name" value={data.student_name} />
            <Row label="Father Name" value={data.father_name} />
            <Row label="Class" value={data.class_name} />
            <Row label="Sec" value={data.section} />
            <Row label="Session" value={data.session} />
            <Row label="Admission No" value={data.admission_number} />
          </View>

          {/* Fee items table */}
          <View style={styles.table}>
            <View style={[styles.tr, styles.thRow]}>
              <Text style={[styles.th, { flex: 2.4 }]}>Fees Type</Text>
              <Text style={[styles.th, styles.tCenter, { flex: 1 }]}>Code</Text>
              <Text style={[styles.th, styles.tRight, { flex: 1.1 }]}>Amount</Text>
              <Text style={[styles.th, styles.tRight, { flex: 0.9 }]}>Fine</Text>
              <Text style={[styles.th, styles.tRight, { flex: 1.1 }]}>Disc.</Text>
              <Text style={[styles.th, styles.tRight, { flex: 1.2 }]}>Total</Text>
            </View>
            {items.map((it, idx) => (
              <View key={idx} style={styles.tr}>
                <Text style={[styles.td, { flex: 2.4 }]}>{it.fees_type}</Text>
                <Text style={[styles.td, styles.tCenter, { flex: 1 }]}>{it.fees_code}</Text>
                <Text style={[styles.td, styles.tRight, { flex: 1.1 }]}>{Number(it.amount).toFixed(2)}</Text>
                <Text style={[styles.td, styles.tRight, { flex: 0.9 }]}>{Number(it.fine).toFixed(2)}</Text>
                <Text style={[styles.td, styles.tRight, { flex: 1.1 }]}>{Number(it.discount).toFixed(2)}</Text>
                <Text style={[styles.td, styles.tRight, { flex: 1.2 }]}>{Number(it.total).toFixed(2)}</Text>
              </View>
            ))}
          </View>

          {/* Payment meta */}
          <View style={styles.infoBlock}>
            <Row label="Payment Date" value={dmy(data.payment_date)} />
            <Row label="Collected By" value={data.collected_by_code ? `${data.collected_by} (${data.collected_by_code})` : data.collected_by} />
          </View>

          {/* Totals */}
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Grand Total</Text>
              <Text style={styles.totalValue}>{money(data.grand_total)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Paid</Text>
              <Text style={styles.totalValue}>{money(data.paid)}</Text>
            </View>
          </View>

          <Text style={styles.words}>In Words : {data.in_words}</Text>

          <View style={styles.modeRow}>
            <Text style={styles.modeText}>Payment Mode : {data.payment_mode}</Text>
            <View style={styles.statusPill}><Text style={styles.statusText}>{data.status}</Text></View>
          </View>

          {!!data.remarks && <Text style={styles.remarks}>Remarks: {data.remarks}</Text>}

          <View style={styles.divider} />
          <Text style={styles.disclaimer}>This receipt is computer generated hence no signature is required.</Text>
          <Text style={styles.poweredBy}>Powered By EduFox</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 14, color: COLORS.muted },
  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.black, borderRadius: RADIUS.lg, paddingVertical: 13,
    marginBottom: 14, ...SHADOW.sm,
  },
  downloadBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 13 },
  card: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl, borderWidth: 1,
    borderColor: COLORS.border, padding: 16, ...SHADOW.sm,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  topText: { fontSize: 11, color: COLORS.muted, fontWeight: '600' },
  schoolHeader: { alignItems: 'center', marginBottom: 12 },
  schoolName: { fontSize: 17, fontWeight: '800', color: COLORS.primary, textAlign: 'center' },
  schoolLine: { fontSize: 11, color: COLORS.muted, textAlign: 'center', marginTop: 2 },
  titleBar: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingVertical: 8,
    alignItems: 'center', marginBottom: 14,
  },
  titleText: { color: COLORS.white, fontWeight: '800', fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase' },
  infoBlock: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    overflow: 'hidden', marginBottom: 14,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8,
    paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg,
  },
  infoLabel: { fontSize: 12, fontWeight: '700', color: COLORS.black },
  infoValue: { fontSize: 12, color: COLORS.muted, flexShrink: 1, textAlign: 'right' },
  table: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, overflow: 'hidden', marginBottom: 14 },
  tr: {
    flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: COLORS.lightBg,
  },
  thRow: { backgroundColor: COLORS.primary },
  th: { fontSize: 10, fontWeight: '800', color: COLORS.white },
  td: { fontSize: 10.5, color: COLORS.black },
  tCenter: { textAlign: 'center' },
  tRight: { textAlign: 'right' },
  totalsBox: {
    backgroundColor: COLORS.lightBg, borderRadius: RADIUS.md, padding: 12, marginBottom: 10,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalLabel: { fontSize: 13, fontWeight: '700', color: COLORS.black },
  totalValue: { fontSize: 14, fontWeight: '800', color: COLORS.black },
  words: { fontSize: 11, fontWeight: '600', color: COLORS.black, textAlign: 'center', marginBottom: 10 },
  modeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modeText: { fontSize: 12, fontWeight: '600', color: COLORS.black },
  statusPill: { backgroundColor: COLORS.success, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '800', color: COLORS.white },
  remarks: { fontSize: 11, color: COLORS.muted, marginBottom: 10 },
  divider: { height: 1, backgroundColor: COLORS.border, marginBottom: 10 },
  disclaimer: { fontSize: 9.5, color: COLORS.lightMuted, textAlign: 'center' },
  poweredBy: { fontSize: 9.5, color: COLORS.lightMuted, textAlign: 'center', marginTop: 4, fontWeight: '600' },
});

export default ReceiptScreen;
