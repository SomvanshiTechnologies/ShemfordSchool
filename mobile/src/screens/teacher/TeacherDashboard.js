import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { COLORS, RADIUS, SHADOW } from '../../theme/colors';
import { StatCard, StatGrid } from '../../components/StatCard';
import { ActionButton, ActionGrid } from '../../components/ActionButton';
import { CardOrange, SectionTitle, Badge, Avatar } from '../../components/UI';
import { ScreenLoader } from '../../components/LoadingSkeleton';

const TeacherDashboard = ({ navigation }) => {
  const [classes, setClasses] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      client.get('/classes').catch(() => ({ data: [] })),
      client.get('/announcements').catch(() => ({ data: [] })),
    ]).then(([c, a]) => {
      setClasses(c.data || []);
      setAnnouncements((a.data || []).slice(0, 3));
    }).finally(() => setLoading(false));
  }, []);

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
  const totalSections = classes.reduce((n, c) => n + ((c.sections || []).length), 0);

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.h1}>Good Morning</Text>
            <Text style={styles.sub}>{today}</Text>
          </View>
          <Avatar letter="T" bg={COLORS.primary} />
        </View>

        <CardOrange>
          <Text style={styles.orangeLabel}>TODAY'S TASK</Text>
          <Text style={styles.orangeValue}>Mark Attendance</Text>
          <Text style={styles.orangeSub}>{classes.length} classes · {totalSections} sections assigned</Text>
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={() => navigation.navigate('Attendance')}
            activeOpacity={0.85}
          >
            <Ionicons name="calendar" size={14} color={COLORS.white} />
            <Text style={styles.ctaBtnText}>Start Now</Text>
          </TouchableOpacity>
        </CardOrange>

        <StatGrid>
          <StatCard label="My Classes" value={classes.length}  icon="school"   tint="blue" />
          <StatCard label="Sections"   value={totalSections}   icon="grid"     tint="violet" />
        </StatGrid>

        <SectionTitle>Quick Actions</SectionTitle>
        <ActionGrid>
          <ActionButton icon="calendar-outline"    tint="emerald" title="Mark Attendance" desc="Today's attendance"      onPress={() => navigation.navigate('Attendance')} />
          <ActionButton icon="create-outline"      tint="purple"  title="Enter Marks"     desc="Update student marks"    onPress={() => navigation.navigate('Marks')} />
          <ActionButton icon="chatbubble-outline"  tint="blue"    title="Messages"        desc="Parent communication"    onPress={() => navigation.navigate('Messages')} />
        </ActionGrid>

        <SectionTitle>My Classes</SectionTitle>
        <View style={styles.list}>
          {classes.slice(0, 6).map((cls, i) => (
            <View key={cls.class_id || cls.name} style={[styles.listItem, i === Math.min(classes.length, 6) - 1 && { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.classTitle}>{cls.display_name || cls.name}</Text>
                <Text style={styles.classMeta}>{(cls.sections || []).length} section(s)</Text>
              </View>
              <Badge
                text={(cls.sections || []).map(s => (typeof s === 'string' ? s : s.section_name)).slice(0, 3).join(', ')}
                variant="muted"
              />
            </View>
          ))}
        </View>

        {announcements.length > 0 && (
          <>
            <SectionTitle>Recent Notices</SectionTitle>
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
  orangeValue: { fontSize: 24, fontWeight: '800', color: COLORS.white, marginTop: 4, letterSpacing: -0.5 },
  orangeSub:   { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  ctaBtn: {
    backgroundColor: COLORS.black, borderRadius: RADIUS.md, paddingVertical: 11, paddingHorizontal: 16,
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14,
  },
  ctaBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.white },
  list: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, ...SHADOW.sm,
  },
  listItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg,
  },
  classTitle: { fontWeight: '700', fontSize: 14, color: COLORS.black },
  classMeta:  { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  noticeTitle: { fontWeight: '700', fontSize: 14, color: COLORS.black },
  noticeBody:  { fontSize: 12, color: COLORS.muted, marginTop: 4, lineHeight: 17 },
});

export default TeacherDashboard;
