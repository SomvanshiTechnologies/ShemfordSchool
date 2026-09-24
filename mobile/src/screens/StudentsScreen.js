import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { Avatar, Badge, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';

const StudentsScreen = () => {
  const navigation = useNavigation();
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() =>
    client.get('/students', { params: { app_visible: true } })
      .then(r => setStudents(Array.isArray(r.data) ? r.data : []))
      .catch(() => {}), []);

  // Tabs stay mounted, so refetch whenever this tab regains focus — otherwise
  // visibility changes made on the web dashboard don't show until app restart.
  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const filtered = students.filter(s =>
    `${s.first_name} ${s.last_name} ${s.admission_number}`.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        <View style={styles.header}>
          <Text style={styles.h1}>Students</Text>
          <Text style={styles.sub}>{students.length} enrolled</Text>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={COLORS.muted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search students..."
            placeholderTextColor={COLORS.lightMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <View style={styles.list}>
          {filtered.map(s => (
            <TouchableOpacity
              key={s.student_id}
              style={styles.listItem}
              activeOpacity={0.6}
              onPress={() => navigation.navigate('StudentDetail', { student: s })}
            >
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flex: 1 }}>
                <Avatar letter={s.first_name?.charAt(0)} bg={COLORS.lightBg} color={COLORS.black} size={36} />
                <View>
                  <Text style={{ fontWeight: '600', fontSize: 13, color: COLORS.black }}>{s.first_name} {s.last_name}</Text>
                  <Text style={{ fontSize: 11, color: COLORS.muted }}>{s.class_name}-{s.section} | {s.admission_number}</Text>
                </View>
              </View>
              <Badge text={s.fee_status || 'pending'} variant={s.fee_status === 'paid' ? 'dark' : s.fee_status === 'overdue' ? 'orange' : 'muted'} />
              <Ionicons name="chevron-forward" size={16} color={COLORS.lightMuted} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          ))}
          {filtered.length === 0 && <EmptyState icon={<Ionicons name="people-outline" size={48} color="#DDD" />} text="No students found" />}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 24, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  searchWrap: { position: 'relative', marginBottom: 16 },
  searchIcon: { position: 'absolute', left: 14, top: 14, zIndex: 1 },
  searchInput: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, paddingLeft: 38, paddingRight: 16, paddingVertical: 12, fontSize: 14, color: COLORS.black, borderWidth: 1.5, borderColor: COLORS.border, ...SHADOW.sm },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, ...SHADOW.sm },
  listItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
});

export default StudentsScreen;
