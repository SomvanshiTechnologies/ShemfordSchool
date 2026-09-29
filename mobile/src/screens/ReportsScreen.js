import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import client from '../api/client';
import { API_URL } from '../config';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { CardDark, SectionTitle, EmptyState } from '../components/UI';
import { StatCard, StatGrid } from '../components/StatCard';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { useSession } from '../contexts/SessionContext';

const iso = (d) => d.toISOString().slice(0, 10);
// Same as the dashboard's quick filters: start = today minus N calendar months.
const monthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return iso(d);
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const monthLabel = (ym) => {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return isNaN(d) ? ym : d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};

const ReportsScreen = () => {
  const session = useSession() || {};
  const [activeTab, setActiveTab] = useState('financial');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [classes, setClasses] = useState([]);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [singleDate, setSingleDate] = useState('');   // attendance only
  const [className, setClassName] = useState('');     // attendance + academic
  const [section, setSection] = useState('');         // academic only
  const [quick, setQuick] = useState(null);           // 1 | 3 | 6 | null

  useEffect(() => {
    client.get('/classes')
      .then(r => setClasses(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, []);

  const buildParams = useCallback(() => {
    const p = {};
    if (session.viewSession) p.academic_year = session.viewSession;
    if (activeTab === 'financial') {
      if (startDate && endDate) { p.start_date = startDate; p.end_date = endDate; }
    } else if (activeTab === 'attendance') {
      if (className) p.class_name = className;
      if (singleDate) p.date = singleDate;
      else if (startDate && endDate) { p.start_date = startDate; p.end_date = endDate; }
    } else {
      if (className) p.class_name = className;
      if (section) p.section = section;
    }
    return p;
  }, [activeTab, startDate, endDate, singleDate, className, section, session.viewSession]);

  const generate = useCallback((tab = activeTab, params = null) => {
    if (tab === 'academic' && !className && !params?.class_name) {
      Alert.alert('Class required', 'Pick a class to generate the academic report.');
      return;
    }
    for (const [v, label] of [[startDate, 'Start date'], [endDate, 'End date'], [singleDate, 'Date']]) {
      if (v && !DATE_RE.test(v)) { Alert.alert('Invalid date', `${label} must be YYYY-MM-DD.`); return; }
    }
    setLoading(true);
    client.get(`/reports/${tab}`, { params: params || buildParams() })
      .then(r => setData(r.data))
      .catch(e => {
        setData(null);
        Alert.alert('Error', e.response?.data?.detail || 'Could not load report.');
      })
      .finally(() => setLoading(false));
  }, [activeTab, buildParams, className, startDate, endDate, singleDate]);

  const switchTab = (tab) => {
    setActiveTab(tab);
    setData(null);
    setQuick(null);
    setStartDate(''); setEndDate(''); setSingleDate('');
    setClassName(''); setSection('');
    if (tab !== 'academic') {
      const p = {};
      if (session.viewSession) p.academic_year = session.viewSession;
      setLoading(true);
      client.get(`/reports/${tab}`, { params: p })
        .then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
    }
  };

  useEffect(() => { switchTab('financial'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyQuick = (n) => {
    setQuick(n);
    setSingleDate('');
    const s = monthsAgo(n);
    const e = iso(new Date());
    setStartDate(s);
    setEndDate(e);
    const p = { start_date: s, end_date: e };
    if (session.viewSession) p.academic_year = session.viewSession;
    if (activeTab === 'attendance' && className) p.class_name = className;
    generate(activeTab, p);
  };

  const clearFilters = () => {
    setQuick(null); setStartDate(''); setEndDate(''); setSingleDate('');
    const p = {};
    if (session.viewSession) p.academic_year = session.viewSession;
    if (activeTab === 'attendance' && className) p.class_name = className;
    generate(activeTab, p);
  };

  const downloadReport = async (format) => {
    setDownloading(format);
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      if (!token) { Alert.alert('Not signed in', 'Please log in again.'); return; }
      const ext = format === 'excel' ? 'xlsx' : 'pdf';
      const qs = new URLSearchParams({ format, ...buildParams() });
      const target = `${FileSystem.cacheDirectory}${activeTab}_report.${ext}`;
      const res = await FileSystem.downloadAsync(
        `${API_URL}/reports/${activeTab}/export?${qs.toString()}`,
        target,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.status !== 200) throw new Error(`Server returned ${res.status}`);
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
    } finally { setDownloading(null); }
  };

  const targetCls = classes.find(c => c.name === className);
  const sectionNames = (targetCls?.sections || []).map(sc => (typeof sc === 'string' ? sc : sc.section_name));
  const byMethod = data?.by_payment_method || {};
  const byMonth = data?.by_month || {};
  const results = data?.student_results || {};

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.h1}>Reports</Text>
          <Text style={styles.sub}>Financial, academic and attendance analytics</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
          {['financial', 'attendance', 'academic'].map(tab => (
            <TouchableOpacity key={tab} style={[styles.chip, activeTab === tab && styles.chipActive]} onPress={() => switchTab(tab)}>
              <Text style={[styles.chipText, activeTab === tab && styles.chipTextActive]}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Filters card */}
        <View style={styles.filterCard}>
          {activeTab !== 'academic' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <Ionicons name="time-outline" size={15} color={COLORS.muted} />
              <Text style={{ fontSize: 12, color: COLORS.muted, fontWeight: '600' }}>Quick filter:</Text>
              {[1, 3, 6].map(n => (
                <TouchableOpacity key={n} style={[styles.quickChip, quick === n && styles.quickChipActive]} onPress={() => applyQuick(n)}>
                  <Text style={[styles.quickChipText, quick === n && { color: COLORS.white }]}>Last {n}M</Text>
                </TouchableOpacity>
              ))}
              {(startDate || endDate || singleDate) && (
                <TouchableOpacity onPress={clearFilters}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.primary }}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {(activeTab === 'attendance' || activeTab === 'academic') && (
            <>
              <Text style={styles.formLabel}>{activeTab === 'academic' ? 'CLASS *' : 'CLASS'}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {classes.map(c => (
                  <TouchableOpacity
                    key={c.name}
                    style={[styles.chip, className === c.name && styles.chipActive]}
                    onPress={() => { setClassName(className === c.name ? '' : c.name); setSection(''); }}
                  >
                    <Text style={[styles.chipText, className === c.name && styles.chipTextActive]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {activeTab === 'academic' && !!className && sectionNames.length > 0 && (
            <>
              <Text style={styles.formLabel}>SECTION</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {sectionNames.map(n => (
                  <TouchableOpacity key={n} style={[styles.chip, section === n && styles.chipActive]} onPress={() => setSection(section === n ? '' : n)}>
                    <Text style={[styles.chipText, section === n && styles.chipTextActive]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {activeTab === 'attendance' && (
            <>
              <Text style={styles.formLabel}>SINGLE DATE (or use a range below)</Text>
              <TextInput
                style={styles.formInput}
                value={singleDate}
                onChangeText={v => { setSingleDate(v); if (v) { setStartDate(''); setEndDate(''); setQuick(null); } }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={COLORS.lightMuted}
              />
            </>
          )}

          {activeTab !== 'academic' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>START DATE</Text>
                <TextInput
                  style={styles.formInput}
                  value={startDate}
                  onChangeText={v => { setStartDate(v); setQuick(null); if (v) setSingleDate(''); }}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={COLORS.lightMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>END DATE</Text>
                <TextInput
                  style={styles.formInput}
                  value={endDate}
                  onChangeText={v => { setEndDate(v); setQuick(null); if (v) setSingleDate(''); }}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={COLORS.lightMuted}
                />
              </View>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <TouchableOpacity style={styles.generateBtn} onPress={() => generate()} disabled={loading}>
              {loading ? <ActivityIndicator size="small" color={COLORS.white} /> : <Ionicons name="stats-chart" size={15} color={COLORS.white} />}
              <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.white }}>Generate Report</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.exportBtn, downloading === 'pdf' && { opacity: 0.7 }]}
              onPress={() => downloadReport('pdf')}
              disabled={!!downloading}
            >
              {downloading === 'pdf' ? <ActivityIndicator size="small" color={COLORS.black} /> : <Ionicons name="download-outline" size={15} color={COLORS.black} />}
              <Text style={styles.exportBtnText}>PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.exportBtn, downloading === 'excel' && { opacity: 0.7 }]}
              onPress={() => downloadReport('excel')}
              disabled={!!downloading}
            >
              {downloading === 'excel' ? <ActivityIndicator size="small" color={COLORS.black} /> : <Ionicons name="grid-outline" size={15} color={COLORS.black} />}
              <Text style={styles.exportBtnText}>Excel</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? <ScreenLoader /> : !data ? (
          <EmptyState
            icon={<Ionicons name="bar-chart-outline" size={48} color="#DDD" />}
            text={activeTab === 'academic' ? 'Pick a class and generate the report' : 'No data'}
          />
        ) : activeTab === 'financial' ? (
          <>
            <CardDark>
              <Text style={styles.darkLabel}>TOTAL COLLECTION</Text>
              <Text style={{ fontSize: 28, fontWeight: '800', color: COLORS.white }}>₹{(data.total_collection || 0).toLocaleString('en-IN')}</Text>
            </CardDark>
            <StatGrid>
              <StatCard label="Pending" value={`₹${Math.round((data.total_pending || 0) / 1000)}k`} accent />
              <StatCard label="Transactions" value={data.transaction_count || 0} />
            </StatGrid>
            {Object.keys(byMethod).length > 0 && (
              <>
                <SectionTitle>By Payment Method</SectionTitle>
                <View style={styles.list}>
                  {Object.entries(byMethod).map(([m, amt]) => (
                    <View key={m} style={styles.listItem}>
                      <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black, textTransform: 'capitalize' }}>{m.replace('_', ' ')}</Text>
                      <Text style={{ fontWeight: '700', color: COLORS.black }}>₹{(Number(amt) || 0).toLocaleString('en-IN')}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
            {Object.keys(byMonth).length > 0 && (
              <>
                <SectionTitle>Monthly Trend</SectionTitle>
                <View style={styles.list}>
                  {Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([ym, amt]) => (
                    <View key={ym} style={styles.listItem}>
                      <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }}>{monthLabel(ym)}</Text>
                      <Text style={{ fontWeight: '700', color: COLORS.black }}>₹{(Number(amt) || 0).toLocaleString('en-IN')}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
            {(data.transaction_count || 0) === 0 && (
              <Text style={styles.emptyHint}>No transactions in this period.</Text>
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
          <>
            <StatGrid>
              <StatCard label="Students" value={data.student_count || 0} />
              <StatCard label="Class Average" value={`${data.class_average || 0}%`} accent />
            </StatGrid>
            {Object.keys(results).length > 0 && (
              <>
                <SectionTitle>Student Results</SectionTitle>
                <View style={styles.list}>
                  {Object.entries(results).map(([sid, r]) => (
                    <View key={sid} style={styles.listItem}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }}>{r.student_name || sid}</Text>
                        <Text style={{ fontSize: 11, color: COLORS.muted }}>{r.total_obtained}/{r.total_max}</Text>
                      </View>
                      <Text style={{ fontWeight: '700', color: COLORS.black }}>{r.percentage}% · {r.grade}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 14 },
  h1: { fontSize: 24, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white, marginRight: 8 },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  chipTextActive: { color: COLORS.white },
  filterCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 16, ...SHADOW.sm },
  quickChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  quickChipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  quickChipText: { fontSize: 11, fontWeight: '700', color: COLORS.muted },
  formLabel: { ...FONTS.small, marginBottom: 6 },
  formInput: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: COLORS.black, backgroundColor: COLORS.white, marginBottom: 10 },
  generateBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 11, ...SHADOW.sm },
  exportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: COLORS.white, borderRadius: RADIUS.md, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1.5, borderColor: COLORS.border },
  exportBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.black },
  darkLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.muted },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, ...SHADOW.sm },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  emptyHint: { fontSize: 12, color: COLORS.lightMuted, textAlign: 'center', marginBottom: 16 },
});

export default ReportsScreen;
