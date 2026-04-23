import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { COLORS, RADIUS, SHADOW } from '../../theme/colors';
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
      setChildren(s.data || []);
      setAnnouncements((a.data || []).slice(0, 3));
      if ((s.data || []).length > 0) {
        client.get(`/fees/student/${s.data[0].student_id}`)
              .then(r => setFeeSummary(r.data.summary))
              .catch(() => {});
      }
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  const child = children[0];
  const pendingAmt = feeSummary?.total_pending || 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.h1}>{child ? `${child.first_name}'s Parent` : 'My Child'}</Text>
            <Text style={styles.sub}>Parent Dashboard</Text>
          </View>
          <Avatar letter={child?.first_name?.charAt(0) || 'P'} bg={COLORS.primary} />
        </View>

        {pendingAmt > 0 ? (
          <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate('Fees')}>
            <CardOrange>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orangeLabel}>FEES DUE</Text>
                  <Text style={styles.orangeValue}>₹{pendingAmt.toLocaleString()}</Text>
                  <Text style={styles.orangeSub}>{feeSummary?.months_pending || 0} month(s) pending</Text>
                </View>
                <TouchableOpacity
                  style={styles.payBtn}
                  onPress={() => navigation.navigate('Fees')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="card" size={14} color={COLORS.white} />
                  <Text style={styles.payBtnText}>Pay Now</Text>
                </TouchableOpacity>
              </View>
            </CardOrange>
          </TouchableOpacity>
        ) : (
          <CardDark>
            <Text style={styles.darkLabel}>FEE STATUS</Text>
            <Text style={styles.darkValue}>All Clear</Text>
            <Text style={styles.darkSub}>No pending fees</Text>
          </CardDark>
        )}

        <StatGrid>
          <StatCard
            label="Months Paid"
            value={`${feeSummary?.months_paid || 0}/${feeSummary?.months_total || 0}`}
            icon="checkmark-done"
            tint="emerald"
          />
          <StatCard
            label="Total Paid"
            value={`₹${((feeSummary?.total_paid || 0) / 1000).toFixed(0)}k`}
            icon="wallet"
            tint="orange"
          />
        </StatGrid>

        <SectionTitle>Quick Access</SectionTitle>
        <ActionGrid>
          <ActionButton icon="card-outline"         tint="orange"  title="View Fees"    desc="Check fee status"      onPress={() => navigation.navigate('Fees')} />
          <ActionButton icon="calendar-outline"     tint="emerald" title="Attendance"   desc="Child's attendance"    onPress={() => navigation.navigate('More')} />
          <ActionButton icon="document-text-outline" tint="blue"    title="Marks"        desc="View report card"      onPress={() => navigation.navigate('More')} />
          <ActionButton icon="alert-circle-outline" tint="red"     title="Raise Issue"  desc="Report a concern"      onPress={() => navigation.navigate('More')} />
        </ActionGrid>

        {child && (
          <>
            <SectionTitle>Student Info</SectionTitle>
            <Card style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
              <Avatar letter={child.first_name?.charAt(0)} bg={COLORS.lightBg} color={COLORS.black} />
              <View style={{ flex: 1 }}>
                <Text style={styles.childName}>{child.first_name} {child.last_name}</Text>
                <Text style={styles.childMeta}>
                  Class {child.class_name}{child.section ? `-${child.section}` : ''} · {child.admission_number}
                </Text>
              </View>
            </Card>
          </>
        )}

        {announcements.length > 0 && (
          <>
            <SectionTitle>Announcements</SectionTitle>
            <View style={styles.list}>
              {announcements.map((a, i) => (
                <View key={i} style={[styles.listItem, i === announcements.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={styles.noticeTitle}>{a.title}</Text>
                  <Text style={styles.noticeBody} numberOfLines={2}>{a.content}</Text>
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
  h1: { fontSize: 26, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  orangeLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.8)' },
  orangeValue: { fontSize: 30, fontWeight: '800', color: COLORS.white, letterSpacing: -0.8, marginTop: 4 },
  orangeSub:   { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  darkLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.6)' },
  darkValue: { fontSize: 22, fontWeight: '800', color: COLORS.white, marginTop: 4, letterSpacing: -0.5 },
  darkSub:   { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  payBtn: {
    backgroundColor: COLORS.black, borderRadius: RADIUS.md, paddingVertical: 11, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  payBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.white },
  childName: { fontWeight: '700', fontSize: 15, color: COLORS.black },
  childMeta: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  list: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, ...SHADOW.sm,
  },
  listItem: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  noticeTitle: { fontWeight: '700', fontSize: 14, color: COLORS.black },
  noticeBody:  { fontSize: 12, color: COLORS.muted, marginTop: 4, lineHeight: 17 },
});

export default ParentDashboard;
