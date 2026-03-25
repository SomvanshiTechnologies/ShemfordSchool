import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { COLORS } from '../../theme/colors';
import { useAuth } from '../../contexts/AuthContext';
import { StatCard, StatGrid } from '../../components/StatCard';
import { ActionButton, ActionGrid } from '../../components/ActionButton';
import { CardOrange, CardDark, SectionTitle, Card, Avatar } from '../../components/UI';
import { ScreenLoader } from '../../components/LoadingSkeleton';

const ParentDashboard = ({ navigation }) => {
  const { user } = useAuth();
  const [children, setChildren] = useState([]);
  const [feeSummary, setFeeSummary] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      client.get('/students').catch(() => ({ data: [] })),
      client.get('/announcements').catch(() => ({ data: [] })),
    ]).then(([s, a]) => {
      setChildren(s.data);
      setAnnouncements(a.data.slice(0, 3));
      if (s.data.length > 0) {
        client.get(`/fees/student/${s.data[0].student_id}`).then(r => setFeeSummary(r.data.summary)).catch(() => {});
      }
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  const child = children[0];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.h1}>{child ? `${child.first_name}'s` : 'My Child'}</Text>
            <Text style={styles.sub}>Parent Dashboard</Text>
          </View>
          <Avatar letter={child?.first_name?.charAt(0) || 'P'} bg={COLORS.primary} />
        </View>

        {feeSummary && feeSummary.total_pending > 0 ? (
          <TouchableOpacity activeOpacity={0.8} onPress={() => navigation.navigate('Fees')}>
            <CardOrange>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.7)' }}>Fees Due</Text>
                  <Text style={{ fontSize: 28, fontWeight: '800', color: COLORS.white, letterSpacing: -0.5 }}>₹{feeSummary.total_pending.toLocaleString()}</Text>
                  <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>{feeSummary.months_pending} month(s) pending</Text>
                </View>
                <TouchableOpacity
                  style={{ backgroundColor: COLORS.black, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  onPress={() => navigation.navigate('Fees')}
                >
                  <Ionicons name="card" size={14} color={COLORS.white} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.white }}>Pay Now</Text>
                </TouchableOpacity>
              </View>
            </CardOrange>
          </TouchableOpacity>
        ) : (
          <CardDark>
            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.muted }}>FEE STATUS</Text>
            <Text style={{ fontSize: 20, fontWeight: '800', color: COLORS.white, marginTop: 4 }}>All Clear</Text>
            <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>No pending fees</Text>
          </CardDark>
        )}

        <StatGrid>
          <StatCard label="Months Paid" value={`${feeSummary?.months_paid || 0}/${feeSummary?.months_total || 0}`} />
          <StatCard label="Total Paid" value={`₹${((feeSummary?.total_paid || 0) / 1000).toFixed(0)}k`} />
        </StatGrid>

        <SectionTitle>Quick Access</SectionTitle>
        <ActionGrid>
          <ActionButton icon={<Ionicons name="card" size={18} color={COLORS.primary} />} label="Fees" onPress={() => navigation.navigate('Fees')} />
          <ActionButton icon={<Ionicons name="calendar" size={18} color={COLORS.primary} />} label="Attendance" onPress={() => navigation.navigate('More')} />
          <ActionButton icon={<Ionicons name="school" size={18} color={COLORS.primary} />} label="Marks" onPress={() => navigation.navigate('More')} />
        </ActionGrid>

        {child && (
          <>
            <SectionTitle>Student Info</SectionTitle>
            <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <Avatar letter={child.first_name?.charAt(0)} bg={COLORS.lightBg} color={COLORS.black} />
              <View>
                <Text style={{ fontWeight: '700', fontSize: 14, color: COLORS.black }}>{child.first_name} {child.last_name}</Text>
                <Text style={{ fontSize: 12, color: COLORS.muted }}>Class {child.class_name}-{child.section} | {child.admission_number}</Text>
              </View>
            </Card>
          </>
        )}

        {announcements.length > 0 && (
          <>
            <SectionTitle>Announcements</SectionTitle>
            <View style={styles.list}>
              {announcements.map((a, i) => (
                <View key={i} style={styles.listItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }}>{a.title}</Text>
                    <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }} numberOfLines={2}>{a.content}</Text>
                  </View>
                </View>
              ))}
            </View>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 24, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  list: { backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
});

export default ParentDashboard;
