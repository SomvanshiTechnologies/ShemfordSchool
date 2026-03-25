import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS } from '../theme/colors';
import { CardDark, SectionTitle, EmptyState } from '../components/UI';
import { StatCard, StatGrid } from '../components/StatCard';
import { ScreenLoader } from '../components/LoadingSkeleton';

const ReportsScreen = () => {
  const [activeTab, setActiveTab] = useState('financial');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchReport = (type) => {
    setActiveTab(type);
    setLoading(true);
    const endpoints = { financial: '/reports/financial', attendance: '/reports/attendance', academic: '/reports/academic' };
    client.get(endpoints[type]).then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  };

  useEffect(() => { fetchReport('financial'); }, []);

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
                      <Text style={{ fontWeight: '700', color: COLORS.black }}>₹{amt.toLocaleString()}</Text>
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
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white, marginRight: 8 },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  chipTextActive: { color: COLORS.white },
  list: { backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
});

export default ReportsScreen;
