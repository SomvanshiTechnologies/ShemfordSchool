import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import client from '../api/client';
import { API_URL } from '../config';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { CardDark, SectionTitle, EmptyState } from '../components/UI';
import { StatCard, StatGrid } from '../components/StatCard';
import { ScreenLoader } from '../components/LoadingSkeleton';

const ReportsScreen = () => {
  const [activeTab, setActiveTab] = useState('financial');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(null); // 'pdf' | 'excel' | null

  const fetchReport = (type) => {
    setActiveTab(type);
    setLoading(true);
    const endpoints = { financial: '/reports/financial', attendance: '/reports/attendance', academic: '/reports/academic' };
    client.get(endpoints[type]).then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  };

  useEffect(() => { fetchReport('financial'); }, []);

  const downloadReport = async (format) => {
    setDownloading(format);
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      if (!token) {
        Alert.alert('Not signed in', 'Please log in again.');
        return;
      }
      const ext = format === 'excel' ? 'xlsx' : 'pdf';
      const filename = `${activeTab}_report.${ext}`;
      const target = `${FileSystem.cacheDirectory}${filename}`;
      const url = `${API_URL}/reports/${activeTab}/export?format=${format}`;

      const res = await FileSystem.downloadAsync(url, target, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status !== 200) {
        throw new Error(`Server returned ${res.status}`);
      }

      const mimeType = format === 'excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf';

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(res.uri, {
          mimeType,
          dialogTitle: `Save ${activeTab} report`,
          UTI: format === 'excel' ? 'org.openxmlformats.spreadsheetml.sheet' : 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Downloaded', `Saved to ${res.uri}`);
      }
    } catch (e) {
      Alert.alert('Download failed', e?.message || 'Could not download report.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.h1}>Reports</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
          {['financial', 'attendance', 'academic'].map(tab => (
            <TouchableOpacity key={tab} style={[styles.chip, activeTab === tab && styles.chipActive]} onPress={() => fetchReport(tab)}>
              <Text style={[styles.chipText, activeTab === tab && styles.chipTextActive]}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {!loading && data && (
          <View style={styles.downloadRow}>
            <TouchableOpacity
              style={[styles.dlBtn, downloading === 'pdf' && styles.dlBtnDisabled]}
              onPress={() => downloadReport('pdf')}
              disabled={!!downloading}
            >
              {downloading === 'pdf'
                ? <ActivityIndicator size="small" color={COLORS.white} />
                : <Ionicons name="document-text" size={16} color={COLORS.white} />}
              <Text style={styles.dlBtnText}>{downloading === 'pdf' ? 'Preparing…' : 'Download PDF'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dlBtnAlt, downloading === 'excel' && styles.dlBtnDisabled]}
              onPress={() => downloadReport('excel')}
              disabled={!!downloading}
            >
              {downloading === 'excel'
                ? <ActivityIndicator size="small" color={COLORS.black} />
                : <Ionicons name="grid" size={16} color={COLORS.black} />}
              <Text style={styles.dlBtnTextAlt}>{downloading === 'excel' ? 'Preparing…' : 'Download Excel'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading ? <ScreenLoader /> : !data ? (
          <EmptyState icon={<Ionicons name="bar-chart-outline" size={48} color="#DDD" />} text="No data" />
        ) : activeTab === 'financial' ? (
          <>
            <CardDark>
              <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.muted }}>TOTAL COLLECTION</Text>
              <Text style={{ fontSize: 28, fontWeight: '800', color: COLORS.white }}>₹{(data.total_collection || 0).toLocaleString()}</Text>
            </CardDark>
            <StatGrid>
              <StatCard label="Pending" value={`₹${Math.round((data.total_pending || 0) / 1000)}k`} accent />
              <StatCard label="Transactions" value={data.transaction_count || 0} />
            </StatGrid>
            {data.by_method && Object.keys(data.by_method).length > 0 && (
              <>
                <SectionTitle>By Method</SectionTitle>
                <View style={styles.list}>
                  {Object.entries(data.by_method).map(([m, amt]) => (
                    <View key={m} style={styles.listItem}>
                      <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black, textTransform: 'capitalize' }}>{m}</Text>
                      <Text style={{ fontWeight: '700', color: COLORS.black }}>₹{(Number(amt) || 0).toLocaleString()}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        ) : activeTab === 'attendance' ? (
          <StatGrid>
            <StatCard label="Total" value={data.total_records || 0} />
            <StatCard label="Present" value={data.present || 0} />
            <StatCard label="Absent" value={data.absent || 0} accent />
            <StatCard label="Attendance %" value={`${data.percentage || 0}%`} />
          </StatGrid>
        ) : (
          <StatGrid>
            <StatCard label="Students" value={data.total_students || 0} />
            <StatCard label="Class Average" value={`${data.class_average || 0}%`} />
          </StatGrid>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 24, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white, marginRight: 8 },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  chipTextActive: { color: COLORS.white },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, ...SHADOW.sm },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },

  downloadRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  dlBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
    paddingVertical: 11, ...SHADOW.sm,
  },
  dlBtnAlt: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: COLORS.white, borderRadius: RADIUS.md,
    paddingVertical: 11, borderWidth: 1.5, borderColor: COLORS.border, ...SHADOW.sm,
  },
  dlBtnDisabled: { opacity: 0.7 },
  dlBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.white },
  dlBtnTextAlt: { fontSize: 13, fontWeight: '700', color: COLORS.black },
});

export default ReportsScreen;
