import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import client from '../api/client';
import { API_URL } from '../config';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';
import { SectionTitle, CardDark, Badge, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';

const GRADE = (pct) => {
  if (pct >= 91) return 'A1'; if (pct >= 81) return 'A2'; if (pct >= 71) return 'B1';
  if (pct >= 61) return 'B2'; if (pct >= 51) return 'C1'; if (pct >= 41) return 'C2';
  if (pct >= 33) return 'D'; return 'E';
};
const gradeVariant = (pct) => (pct >= 60 ? 'dark' : pct >= 33 ? 'muted' : 'orange');
const fmt = (v) => (v === undefined || v === null ? '-' : Number.isInteger(v) ? String(v) : Number(v).toFixed(1));
const EXAM_TYPES = ['unit_test', 'term', 'annual'];

// ─── Shared marksheet body (student modal + staff generator) ─────────────────

const MarksheetContent = ({ sheet, subtitle, downloading, onDownload }) => (
  <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
    <View style={styles.sheetSchool}>
      <Text style={styles.sheetSchoolName}>Shemford Futuristic School</Text>
      <Text style={styles.sheetSchoolSub}>{subtitle}</Text>
    </View>
    <View style={styles.sheetStudent}>
      {[
        ['Name', `${sheet.student?.first_name || ''} ${sheet.student?.last_name || ''}`.trim()],
        ['Admission No', sheet.student?.admission_number],
        ['Class', `${sheet.student?.class_name || ''}${sheet.student?.section ? ` - ${sheet.student.section}` : ''}`],
        ['Roll No', sheet.student?.roll_number],
      ].map(([k, v]) => (
        <View key={k} style={styles.sheetKV}>
          <Text style={styles.sheetK}>{k}</Text>
          <Text style={styles.sheetV}>{v || '-'}</Text>
        </View>
      ))}
    </View>
    <View style={styles.list}>
      <View style={[styles.tableRow, styles.tableHead]}>
        <Text style={[styles.th, { flex: 2 }]}>Subject</Text>
        <Text style={styles.th}>Obt</Text>
        <Text style={styles.th}>Max</Text>
        <Text style={styles.th}>%</Text>
        <Text style={styles.th}>Grade</Text>
      </View>
      {Object.entries(sheet.subjects || {}).map(([subject, recs]) => {
        const obt = recs.reduce((a, r) => a + (r.marks_obtained || 0), 0);
        const max = recs.reduce((a, r) => a + (r.max_marks || 0), 0);
        const p = max > 0 ? (obt / max) * 100 : 0;
        return (
          <View key={subject} style={styles.tableRow}>
            <Text style={[styles.td, { flex: 2, fontWeight: '600' }]}>{subject}</Text>
            <Text style={styles.td}>{fmt(obt)}</Text>
            <Text style={styles.td}>{fmt(max)}</Text>
            <Text style={styles.td}>{p.toFixed(0)}</Text>
            <Text style={[styles.td, { fontWeight: '700' }]}>{GRADE(p)}</Text>
          </View>
        );
      })}
      {Object.keys(sheet.subjects || {}).length === 0 && (
        <Text style={[styles.infoText, { padding: 16 }]}>No marks recorded yet.</Text>
      )}
    </View>
    <View style={styles.summaryGrid}>
      {[
        ['Total', `${fmt(sheet.summary?.total_obtained)} / ${fmt(sheet.summary?.total_max)}`],
        ['Percentage', `${sheet.summary?.percentage ?? 0}%`],
        ['Grade', sheet.summary?.grade || '-'],
        ['Result', sheet.summary?.result || '-'],
      ].map(([k, v]) => (
        <View key={k} style={styles.summaryTile}>
          <Text style={styles.summaryK}>{k}</Text>
          <Text style={[styles.summaryV, k === 'Result' && { color: v === 'PASS' ? COLORS.success : COLORS.danger }]}>{v}</Text>
        </View>
      ))}
    </View>
    <TouchableOpacity style={styles.pdfBtn} onPress={onDownload} disabled={downloading}>
      {downloading ? <ActivityIndicator color={COLORS.white} /> : (
        <>
          <Ionicons name="download-outline" size={16} color={COLORS.white} />
          <Text style={styles.pdfBtnText}>Download PDF</Text>
        </>
      )}
    </TouchableOpacity>
  </ScrollView>
);

const downloadMarksheetPdf = async (student, examId, setDownloading) => {
  setDownloading(true);
  try {
    const token = await SecureStore.getItemAsync('auth_token');
    const qs = new URLSearchParams({ academic_year: student.academic_year || '' });
    if (examId) qs.append('exam_id', examId);
    const url = `${API_URL}/marks/marksheet/${student.student_id}/pdf?${qs.toString()}`;
    const target = `${FileSystem.cacheDirectory}marksheet_${student.admission_number?.replace(/[^\w]/g, '_') || student.student_id}.pdf`;
    const res = await FileSystem.downloadAsync(url, target, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status !== 200) throw new Error(`Server returned ${res.status}`);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(res.uri, { mimeType: 'application/pdf', dialogTitle: 'Marksheet', UTI: 'com.adobe.pdf' });
    } else {
      Alert.alert('Downloaded', `Saved to ${res.uri}`);
    }
  } catch (e) {
    Alert.alert('Download failed', e?.message || 'Could not download marksheet.');
  } finally { setDownloading(false); }
};

// ─── Student / Parent view ────────────────────────────────────────────────────

const StudentMarks = ({ isParent }) => {
  const [children, setChildren] = useState([]);
  const [me, setMe] = useState(null);
  const [exams, setExams] = useState([]);
  const [selExam, setSelExam] = useState(null);
  const [marks, setMarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [marksLoading, setMarksLoading] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [examPickerOpen, setExamPickerOpen] = useState(false);

  useEffect(() => {
    client.get('/students', { params: { app_visible: true } })
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : (r.data?.students || []);
        setChildren(list);
        setMe(list[0] || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!me) { setExams([]); return; }
    client.get('/exams', { params: { class_name: me.class_name } })
      .then(r => setExams(Array.isArray(r.data) ? r.data : []))
      .catch(() => setExams([]));
    setSelExam(null);
    setMarks([]);
  }, [me?.student_id]);

  useEffect(() => {
    if (!me || !selExam) return;
    setMarksLoading(true);
    client.get('/marks', { params: { exam_id: selExam.exam_id, student_id: me.student_id } })
      .then(r => setMarks((Array.isArray(r.data) ? r.data : []).filter(m => m.student_id === me.student_id)))
      .catch(() => setMarks([]))
      .finally(() => setMarksLoading(false));
  }, [selExam?.exam_id, me?.student_id]);

  const openMarksheet = useCallback(async () => {
    if (!me) return;
    setSheetOpen(true);
    setSheetLoading(true);
    try {
      const params = { academic_year: me.academic_year };
      if (selExam) params.exam_id = selExam.exam_id;
      const r = await client.get(`/marks/marksheet/${me.student_id}`, { params });
      setSheet(r.data);
    } catch (e) {
      setSheet(null);
      Alert.alert('Error', e.response?.data?.detail || 'Could not load marksheet.');
    } finally { setSheetLoading(false); }
  }, [me, selExam]);

  if (loading) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  const subjects = selExam?.subjects || [];
  const byName = {};
  marks.forEach(m => { byName[m.subject] = m; });
  let totalObt = 0, totalMax = 0;
  subjects.forEach(sj => {
    const m = byName[sj.subject];
    if (m && typeof m.marks_obtained === 'number') { totalObt += m.marks_obtained; totalMax += (m.max_marks ?? sj.max_marks ?? 0); }
  });
  const pct = totalMax > 0 ? (totalObt / totalMax) * 100 : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <View>
            <Text style={styles.h1}>My Marks</Text>
            <Text style={styles.sub}>{me ? `Class ${me.class_name}${me.section ? ` - ${me.section}` : ''} · ${me.academic_year || ''}` : 'No student linked'}</Text>
          </View>
          {me && (
            <TouchableOpacity style={styles.sheetBtn} onPress={openMarksheet} activeOpacity={0.85}>
              <Ionicons name="document-text-outline" size={16} color={COLORS.black} />
              <Text style={styles.sheetBtnText}>Marksheet</Text>
            </TouchableOpacity>
          )}
        </View>

        {isParent && children.length > 1 && (
          <>
            <SectionTitle>Child</SectionTitle>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
              {children.map(c => (
                <TouchableOpacity key={c.student_id} style={[styles.chip, me?.student_id === c.student_id && styles.chipActive]} onPress={() => setMe(c)}>
                  <Text style={[styles.chipText, me?.student_id === c.student_id && styles.chipTextActive]}>{c.first_name} {c.last_name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {!me ? (
          <EmptyState icon={<Ionicons name="school-outline" size={48} color="#DDD" />} text="No student record linked to this account" />
        ) : (
          <>
            <View style={styles.selectCard}>
              <Text style={styles.selectLabel}>Select Exam</Text>
              <TouchableOpacity
                style={[styles.dropdown, exams.length === 0 && { opacity: 0.6 }]}
                onPress={() => exams.length > 0 && setExamPickerOpen(true)}
                activeOpacity={0.8}
              >
                <Text style={[styles.dropdownText, !selExam && { color: COLORS.muted }]} numberOfLines={1}>
                  {selExam ? `${selExam.name} — ${selExam.class_name}` : (exams.length === 0 ? 'No published exams yet' : 'Choose an exam')}
                </Text>
                <Ionicons name="chevron-down" size={18} color={COLORS.primary} />
              </TouchableOpacity>
            </View>

            <Modal visible={examPickerOpen} transparent animationType="fade" onRequestClose={() => setExamPickerOpen(false)}>
              <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={() => setExamPickerOpen(false)}>
                <TouchableOpacity activeOpacity={1} style={styles.pickerCard} onPress={() => {}}>
                  <Text style={styles.pickerTitle}>Choose an exam</Text>
                  <ScrollView style={{ maxHeight: 360 }}>
                    {exams.map(e => {
                      const active = selExam?.exam_id === e.exam_id;
                      return (
                        <TouchableOpacity key={e.exam_id} style={[styles.pickerRow, active && styles.pickerRowActive]} onPress={() => { setSelExam(e); setExamPickerOpen(false); }}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.pickerRowText, active && { color: COLORS.white }]}>{e.name} — {e.class_name}</Text>
                            {(e.exam_type || e.start_date) ? (
                              <Text style={[styles.pickerRowMeta, active && { color: 'rgba(255,255,255,0.7)' }]}>
                                {[e.exam_type, e.start_date].filter(Boolean).join(' · ')}
                              </Text>
                            ) : null}
                          </View>
                          {active && <Ionicons name="checkmark" size={18} color={COLORS.white} />}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>

            {!selExam && exams.length > 0 && (
              <View style={styles.infoBox}><Text style={styles.infoText}>Choose an exam to see your marks.</Text></View>
            )}

            {selExam && (marksLoading ? <ScreenLoader /> : (
              subjects.length === 0 || marks.length === 0 ? (
                <EmptyState icon={<Ionicons name="school-outline" size={48} color="#DDD" />} text="Marks not entered for this exam yet" />
              ) : (
                <>
                  <View style={styles.list}>
                    <View style={[styles.tableRow, styles.tableHead]}>
                      <Text style={[styles.th, { flex: 2 }]}>Subject</Text>
                      <Text style={styles.th}>Marks</Text>
                      <Text style={styles.th}>Max</Text>
                      <Text style={styles.th}>Grade</Text>
                    </View>
                    {subjects.map(sj => {
                      const m = byName[sj.subject];
                      const max = m?.max_marks ?? sj.max_marks;
                      const p = m && max ? (m.marks_obtained / max) * 100 : null;
                      return (
                        <View key={sj.subject} style={styles.tableRow}>
                          <Text style={[styles.td, { flex: 2, fontWeight: '600' }]}>{sj.subject}</Text>
                          <Text style={styles.td}>{fmt(m?.marks_obtained)}</Text>
                          <Text style={styles.td}>{fmt(max)}</Text>
                          <View style={{ flex: 1, alignItems: 'center' }}>
                            {p === null ? <Text style={styles.td}>-</Text> : <Badge text={m.grade || GRADE(p)} variant={gradeVariant(p)} />}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                  <CardDark style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View>
                      <Text style={styles.darkLabel}>Total</Text>
                      <Text style={styles.darkValue}>{fmt(totalObt)} / {fmt(totalMax)}</Text>
                    </View>
                    <View>
                      <Text style={styles.darkLabel}>Percentage</Text>
                      <Text style={styles.darkValue}>{pct.toFixed(1)}%</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.darkLabel}>Grade</Text>
                      <Text style={[styles.darkValue, { color: COLORS.primary }]}>{GRADE(pct)}</Text>
                    </View>
                  </CardDark>
                </>
              )
            ))}
          </>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>

      <Modal visible={sheetOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheetOpen(false)}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setSheetOpen(false)}><Ionicons name="close" size={24} color={COLORS.black} /></TouchableOpacity>
            <Text style={styles.modalTitle}>Marksheet</Text>
            <View style={{ width: 36 }} />
          </View>
          {sheetLoading ? <ScreenLoader /> : !sheet ? (
            <EmptyState icon={<Ionicons name="document-outline" size={48} color="#DDD" />} text="Marksheet unavailable" />
          ) : (
            <MarksheetContent
              sheet={sheet}
              subtitle={`${selExam ? selExam.name : 'Annual Marksheet'} · ${sheet.academic_year || me?.academic_year || ''}`}
              downloading={downloading}
              onDownload={() => downloadMarksheetPdf(me, selExam?.exam_id, setDownloading)}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

// ─── Create Exam modal (admin) ────────────────────────────────────────────────

const CreateExamModal = ({ visible, onClose, classes, subjects, defaultYear, onCreated }) => {
  const [name, setName] = useState('');
  const [examType, setExamType] = useState('unit_test');
  const [className, setClassName] = useState('');
  const [year, setYear] = useState(defaultYear || '');
  const [rows, setRows] = useState([{ subject: '', max_marks: '100' }]);
  const [subjectPickerRow, setSubjectPickerRow] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(''); setExamType('unit_test'); setClassName('');
      setYear(defaultYear || ''); setRows([{ subject: '', max_marks: '100' }]);
    }
  }, [visible, defaultYear]);

  const setRow = (i, patch) => setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    if (!name.trim()) { Alert.alert('Missing field', 'Exam name is required.'); return; }
    if (!className) { Alert.alert('Missing field', 'Choose a class.'); return; }
    const subjectRows = rows.filter(r => r.subject && Number(r.max_marks) > 0);
    if (subjectRows.length === 0) { Alert.alert('Missing field', 'Add at least one subject with max marks.'); return; }
    setSaving(true);
    try {
      await client.post('/exams', {
        name: name.trim(),
        exam_type: examType,
        class_name: className,
        academic_year: year.trim(),
        subjects: subjectRows.map(r => ({ subject: r.subject, max_marks: Number(r.max_marks) })),
      });
      onCreated?.();
      onClose();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Could not create exam.');
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={COLORS.black} /></TouchableOpacity>
          <Text style={styles.modalTitle}>Create Exam</Text>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.formLabel}>EXAM NAME *</Text>
          <TextInput style={styles.formInput} value={name} onChangeText={setName} placeholder="e.g. Unit Test 1" placeholderTextColor={COLORS.lightMuted} />

          <Text style={styles.formLabel}>EXAM TYPE *</Text>
          <View style={styles.chipWrapRow}>
            {EXAM_TYPES.map(t => (
              <TouchableOpacity key={t} style={[styles.chip, examType === t && styles.chipActive, { marginRight: 0 }]} onPress={() => setExamType(t)}>
                <Text style={[styles.chipText, examType === t && styles.chipTextActive]}>{t.replace('_', ' ')}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.formLabel}>CLASS *</Text>
          <View style={styles.chipWrapRow}>
            {classes.map(c => (
              <TouchableOpacity key={c.name} style={[styles.chip, className === c.name && styles.chipActive, { marginRight: 0 }]} onPress={() => setClassName(c.name)}>
                <Text style={[styles.chipText, className === c.name && styles.chipTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.formLabel}>ACADEMIC YEAR</Text>
          <TextInput style={styles.formInput} value={year} onChangeText={setYear} placeholder="e.g. 2026-2027" placeholderTextColor={COLORS.lightMuted} />

          <Text style={styles.formLabel}>SUBJECTS *</Text>
          {rows.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <TouchableOpacity style={[styles.formInput, { flex: 2, marginBottom: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]} onPress={() => setSubjectPickerRow(i)}>
                <Text style={{ fontSize: 14, color: r.subject ? COLORS.black : COLORS.lightMuted }}>{r.subject || 'Choose subject'}</Text>
                <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
              </TouchableOpacity>
              <TextInput
                style={[styles.formInput, { flex: 1, marginBottom: 0, textAlign: 'center' }]}
                value={String(r.max_marks)}
                onChangeText={v => setRow(i, { max_marks: v })}
                keyboardType="numeric"
                placeholder="Max"
                placeholderTextColor={COLORS.lightMuted}
              />
              <TouchableOpacity onPress={() => setRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs)}>
                <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={styles.addRowBtn} onPress={() => setRows(rs => [...rs, { subject: '', max_marks: '100' }])}>
            <Ionicons name="add" size={16} color={COLORS.black} />
            <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.black }}>Add Subject</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.saveBtn, { marginTop: 20 }]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="checkmark" size={16} color={COLORS.white} />}
            <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.white }}>Create Exam</Text>
          </TouchableOpacity>
        </ScrollView>

        <Modal visible={subjectPickerRow !== null} transparent animationType="fade" onRequestClose={() => setSubjectPickerRow(null)}>
          <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={() => setSubjectPickerRow(null)}>
            <TouchableOpacity activeOpacity={1} style={styles.pickerCard} onPress={() => {}}>
              <Text style={styles.pickerTitle}>Choose subject</Text>
              <ScrollView style={{ maxHeight: 400 }}>
                {subjects.map(sj => (
                  <TouchableOpacity key={sj} style={styles.pickerRow} onPress={() => { setRow(subjectPickerRow, { subject: sj }); setSubjectPickerRow(null); }}>
                    <Text style={styles.pickerRowText}>{sj}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
};

// ─── Staff marksheet generator ────────────────────────────────────────────────

const StaffMarksheetModal = ({ visible, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [student, setStudent] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const debRef = useRef(null);

  useEffect(() => {
    if (visible) { setQuery(''); setResults([]); setStudent(null); setSheet(null); }
  }, [visible]);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!query.trim()) { setResults([]); return; }
    debRef.current = setTimeout(() => {
      client.get('/students', { params: { search: query.trim(), limit: 30 } })
        .then(r => setResults(Array.isArray(r.data) ? r.data : (r.data?.students || [])))
        .catch(() => setResults([]));
    }, 350);
    return () => debRef.current && clearTimeout(debRef.current);
  }, [query]);

  const generate = async (s) => {
    setStudent(s);
    setLoading(true);
    try {
      const r = await client.get(`/marks/marksheet/${s.student_id}`, { params: { academic_year: s.academic_year } });
      setSheet(r.data);
    } catch (e) {
      setSheet(null);
      Alert.alert('Error', e.response?.data?.detail || 'Could not load marksheet.');
    } finally { setLoading(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={student ? () => { setStudent(null); setSheet(null); } : onClose}>
            <Ionicons name={student ? 'arrow-back' : 'close'} size={24} color={COLORS.black} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Marksheet</Text>
          <View style={{ width: 36 }} />
        </View>

        {!student ? (
          <View style={{ flex: 1, padding: 16 }}>
            <TextInput
              style={styles.formInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search student by name or admission number..."
              placeholderTextColor={COLORS.lightMuted}
              autoFocus
            />
            <ScrollView keyboardShouldPersistTaps="handled">
              {results.map(s => (
                <TouchableOpacity key={s.student_id} style={styles.resultRow} onPress={() => generate(s)}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', fontSize: 14, color: COLORS.black }}>{s.first_name} {s.last_name}</Text>
                    <Text style={{ fontSize: 11, color: COLORS.muted }}>{s.class_name}-{s.section} | {s.admission_number}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.lightMuted} />
                </TouchableOpacity>
              ))}
              {query.trim().length > 0 && results.length === 0 && (
                <Text style={[styles.infoText, { paddingTop: 16, textAlign: 'center' }]}>No students found.</Text>
              )}
            </ScrollView>
          </View>
        ) : loading ? <ScreenLoader /> : !sheet ? (
          <EmptyState icon={<Ionicons name="document-outline" size={48} color="#DDD" />} text="Marksheet unavailable" />
        ) : (
          <MarksheetContent
            sheet={sheet}
            subtitle={`Annual Marksheet · ${sheet.academic_year || student.academic_year || ''}`}
            downloading={downloading}
            onDownload={() => downloadMarksheetPdf(student, null, setDownloading)}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
};

// ─── Teacher / Admin view ─────────────────────────────────────────────────────

const StaffMarks = ({ isAdmin }) => {
  const session = useSession() || {};
  const [tab, setTab] = useState(isAdmin ? 'exams' : 'entry');
  const [exams, setExams] = useState([]);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [selExam, setSelExam] = useState(null);
  const [selSection, setSelSection] = useState('');
  const [students, setStudents] = useState([]);
  const [marks, setMarks] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [acting, setActing] = useState(null); // exam_id currently locking/publishing

  const loadExams = useCallback(() =>
    client.get('/exams')
      .then(r => setExams(Array.isArray(r.data) ? r.data : []))
      .catch(() => {}), []);

  useEffect(() => {
    Promise.all([
      loadExams(),
      client.get('/classes').then(r => setClasses(Array.isArray(r.data) ? r.data : [])).catch(() => {}),
      client.get('/subjects').then(r => setSubjects(Array.isArray(r.data) ? r.data : [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [loadExams]);

  useEffect(() => {
    if (selExam && selSection) {
      setLoading(true);
      Promise.all([
        client.get('/students', { params: { class_name: selExam.class_name, section: selSection, app_visible: true } }),
        client.get('/marks', { params: { exam_id: selExam.exam_id, class_name: selExam.class_name, section: selSection } }),
      ]).then(([s, m]) => {
        setStudents(Array.isArray(s.data) ? s.data : (s.data?.students || []));
        const map = {};
        (Array.isArray(m.data) ? m.data : []).forEach(mk => {
          if (!map[mk.student_id]) map[mk.student_id] = {};
          map[mk.student_id][mk.subject] = mk.marks_obtained;
        });
        setMarks(map);
      }).finally(() => setLoading(false));
    }
  }, [selExam, selSection]);

  const saveMarks = async () => {
    setSaving(true);
    try {
      const records = [];
      students.forEach(s => {
        (selExam.subjects || []).forEach(subj => {
          const val = marks[s.student_id]?.[subj.subject];
          if (val !== undefined && val !== '') {
            records.push({ student_id: s.student_id, subject: subj.subject, marks_obtained: parseFloat(val), max_marks: subj.max_marks, section: selSection });
          }
        });
      });
      const res = await client.post('/marks', { exam_id: selExam.exam_id, records });
      Alert.alert('Success', `${res.data.success} marks saved${res.data.failed ? `, ${res.data.failed} failed` : ''}`);
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to save');
    } finally { setSaving(false); }
  };

  const toggleLock = async (exam) => {
    setActing(exam.exam_id);
    try {
      await client.post(`/exams/${exam.exam_id}/${exam.is_locked ? 'unlock' : 'lock'}`);
      await loadExams();
      if (selExam?.exam_id === exam.exam_id) setSelExam(e => ({ ...e, is_locked: !exam.is_locked }));
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Action failed.');
    } finally { setActing(null); }
  };

  const publish = (exam) => {
    Alert.alert(
      'Publish exam?',
      `Marks for "${exam.name}" become visible to students and parents. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish',
          onPress: async () => {
            setActing(exam.exam_id);
            try {
              await client.post(`/exams/${exam.exam_id}/publish`);
              await loadExams();
            } catch (e) {
              Alert.alert('Error', e.response?.data?.detail || 'Publish failed.');
            } finally { setActing(null); }
          },
        },
      ]
    );
  };

  if (loading && !selExam) return <SafeAreaView style={styles.safe}><ScreenLoader /></SafeAreaView>;

  const examSections = selExam ? (classes.find(c => c.name === selExam.class_name)?.sections || []) : [];
  const TABS = isAdmin
    ? [['exams', 'Exams'], ['entry', 'Marks Entry'], ['view', 'View Marks']]
    : [['entry', 'Marks Entry']];

  const renderPickers = () => (
    <>
      <SectionTitle>Select Exam</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {exams.map(e => (
          <TouchableOpacity key={e.exam_id} style={[styles.chip, selExam?.exam_id === e.exam_id && styles.chipActive]} onPress={() => { setSelExam(e); setSelSection(''); }}>
            <Text style={[styles.chipText, selExam?.exam_id === e.exam_id && styles.chipTextActive]}>
              {e.name} {e.is_locked ? '(Locked)' : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {selExam && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          {examSections.map(s => {
            const n = typeof s === 'string' ? s : s.section_name;
            return (
              <TouchableOpacity key={n} style={[styles.chip, selSection === n && styles.chipActive]} onPress={() => setSelSection(n)}>
                <Text style={[styles.chipText, selSection === n && styles.chipTextActive]}>{n}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }]}>
          <View>
            <Text style={styles.h1}>Marks & Grades</Text>
            <Text style={styles.sub}>{exams.length} exams defined</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={styles.sheetBtn} onPress={() => setSheetOpen(true)}>
              <Ionicons name="document-text-outline" size={15} color={COLORS.black} />
              <Text style={styles.sheetBtnText}>Marksheet</Text>
            </TouchableOpacity>
            {isAdmin && (
              <TouchableOpacity style={styles.createBtn} onPress={() => setCreateOpen(true)}>
                <Ionicons name="add" size={15} color={COLORS.white} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.white }}>Create Exam</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {TABS.length > 1 && (
          <View style={styles.tabBar}>
            {TABS.map(([key, label]) => (
              <TouchableOpacity key={key} style={[styles.tabItem, tab === key && styles.tabItemActive]} onPress={() => setTab(key)}>
                <Text style={[styles.tabItemText, tab === key && styles.tabItemTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {tab === 'exams' && isAdmin && (
          <View style={styles.list}>
            {exams.map(e => (
              <View key={e.exam_id} style={styles.examRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 14, color: COLORS.black }}>{e.name}</Text>
                  <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
                    {(e.exam_type || '').replace('_', ' ')} · {e.class_name} · {(e.subjects || []).map(sj => sj.subject).join(', ')}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                    {e.is_locked && <Badge text="Locked" variant="orange" />}
                    <Badge text={e.is_published ? 'Published' : 'Draft'} variant={e.is_published ? 'dark' : 'muted'} />
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 8 }}>
                  {acting === e.exam_id ? <ActivityIndicator size="small" color={COLORS.primary} /> : (
                    <>
                      <TouchableOpacity style={styles.examAction} onPress={() => toggleLock(e)}>
                        <Ionicons name={e.is_locked ? 'lock-open-outline' : 'lock-closed-outline'} size={14} color={COLORS.black} />
                        <Text style={styles.examActionText}>{e.is_locked ? 'Unlock' : 'Lock'}</Text>
                      </TouchableOpacity>
                      {!e.is_published && (
                        <TouchableOpacity style={[styles.examAction, { backgroundColor: COLORS.black, borderColor: COLORS.black }]} onPress={() => publish(e)}>
                          <Ionicons name="megaphone-outline" size={14} color={COLORS.white} />
                          <Text style={[styles.examActionText, { color: COLORS.white }]}>Publish</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </View>
              </View>
            ))}
            {exams.length === 0 && <EmptyState icon={<Ionicons name="school-outline" size={48} color="#DDD" />} text="No exams defined yet" />}
          </View>
        )}

        {tab === 'entry' && (
          <>
            {renderPickers()}
            {selExam?.is_locked && (
              <CardDark style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="lock-closed" size={16} color={COLORS.primary} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.white }}>
                  Exam locked — {isAdmin ? 'unlock it from the Exams tab' : 'contact admin'}
                </Text>
              </CardDark>
            )}
            {selExam && selSection && !loading && (
              <>
                {!selExam.is_locked && (
                  <TouchableOpacity style={styles.saveBtn} onPress={saveMarks} disabled={saving}>
                    {saving ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="save" size={16} color={COLORS.white} />}
                    <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.white }}>Save Marks</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.list}>
                  {students.map(s => {
                    const sm = marks[s.student_id] || {};
                    return (
                      <View key={s.student_id} style={{ paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg }}>
                        <Text style={{ fontWeight: '700', fontSize: 13, color: COLORS.black, marginBottom: 8 }}>{s.first_name} {s.last_name}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {(selExam.subjects || []).map(subj => (
                            <View key={subj.subject} style={{ flex: 1, minWidth: 80 }}>
                              <Text style={{ fontSize: 10, fontWeight: '600', color: COLORS.muted, marginBottom: 4 }}>{subj.subject}</Text>
                              <TextInput
                                style={styles.marksInput}
                                placeholder={`/${subj.max_marks}`}
                                placeholderTextColor={COLORS.lightMuted}
                                value={sm[subj.subject]?.toString() ?? ''}
                                onChangeText={v => setMarks(p => ({ ...p, [s.student_id]: { ...(p[s.student_id] || {}), [subj.subject]: v } }))}
                                keyboardType="numeric"
                                editable={!selExam.is_locked}
                              />
                            </View>
                          ))}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
            {loading && selExam && selSection && <ScreenLoader />}
          </>
        )}

        {tab === 'view' && isAdmin && (
          <>
            {renderPickers()}
            {selExam && selSection && !loading && (
              <View style={styles.list}>
                {students.map(s => {
                  const sm = marks[s.student_id] || {};
                  let obt = 0, max = 0;
                  (selExam.subjects || []).forEach(subj => {
                    const v = sm[subj.subject];
                    if (typeof v === 'number') { obt += v; max += subj.max_marks || 0; }
                  });
                  const p = max > 0 ? (obt / max) * 100 : null;
                  return (
                    <View key={s.student_id} style={{ paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ fontWeight: '700', fontSize: 13, color: COLORS.black }}>{s.first_name} {s.last_name}</Text>
                        {p === null ? <Text style={{ fontSize: 12, color: COLORS.lightMuted }}>No marks</Text> : <Badge text={GRADE(p)} variant={gradeVariant(p)} />}
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                        {(selExam.subjects || []).map(subj => (
                          <Text key={subj.subject} style={{ fontSize: 11, color: COLORS.muted }}>
                            {subj.subject}: <Text style={{ fontWeight: '700', color: COLORS.black }}>{fmt(sm[subj.subject])}</Text>/{subj.max_marks}
                          </Text>
                        ))}
                      </View>
                      {p !== null && (
                        <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }}>
                          Total: <Text style={{ fontWeight: '700', color: COLORS.black }}>{fmt(obt)}/{fmt(max)}</Text> · {p.toFixed(1)}%
                        </Text>
                      )}
                    </View>
                  );
                })}
                {students.length === 0 && <EmptyState icon={<Ionicons name="people-outline" size={48} color="#DDD" />} text="No students" />}
              </View>
            )}
            {loading && selExam && selSection && <ScreenLoader />}
            {!(selExam && selSection) && (
              <View style={styles.infoBox}><Text style={styles.infoText}>Pick an exam and section to view marks.</Text></View>
            )}
          </>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>

      <CreateExamModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        classes={classes}
        subjects={subjects}
        defaultYear={session.viewSession || session.activeSession || ''}
        onCreated={loadExams}
      />
      <StaffMarksheetModal visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </SafeAreaView>
  );
};

const MarksScreen = () => {
  const { user } = useAuth();
  const role = user?.role;
  if (role === 'student' || role === 'parent') return <StudentMarks isParent={role === 'parent'} />;
  return <StaffMarks isAdmin={role === 'admin'} />;
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 22, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white, marginRight: 8 },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  chipTextActive: { color: COLORS.white },
  chipWrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 16, ...SHADOW.sm },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16, ...SHADOW.sm },
  marksInput: { backgroundColor: COLORS.white, borderRadius: RADIUS.md, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, textAlign: 'center', borderWidth: 1.5, borderColor: COLORS.border },
  sheetBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.lg, paddingHorizontal: 12, paddingVertical: 9, ...SHADOW.sm },
  sheetBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.black },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.black, borderRadius: RADIUS.lg, paddingHorizontal: 12, paddingVertical: 9, ...SHADOW.sm },
  tabBar: { flexDirection: 'row', backgroundColor: COLORS.lightBg, borderRadius: RADIUS.lg, padding: 4, marginBottom: 16 },
  tabItem: { flex: 1, paddingVertical: 9, borderRadius: RADIUS.md, alignItems: 'center' },
  tabItemActive: { backgroundColor: COLORS.white, ...SHADOW.sm },
  tabItemText: { fontSize: 12, fontWeight: '700', color: COLORS.muted },
  tabItemTextActive: { color: COLORS.black },
  examRow: { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg, gap: 10 },
  examAction: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: COLORS.white },
  examActionText: { fontSize: 11, fontWeight: '700', color: COLORS.black },
  formLabel: { ...FONTS.small, marginBottom: 6, marginTop: 4 },
  formInput: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: COLORS.black, backgroundColor: COLORS.white, marginBottom: 14 },
  addRowBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: COLORS.border, borderStyle: 'dashed', borderRadius: RADIUS.md, paddingVertical: 11, backgroundColor: COLORS.white },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  infoBox: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 12 },
  infoText: { fontSize: 13, color: COLORS.muted },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  tableHead: { backgroundColor: COLORS.lightBg },
  th: { flex: 1, ...FONTS.small, textAlign: 'center' },
  td: { flex: 1, fontSize: 13, color: COLORS.black, textAlign: 'center' },
  darkLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 0.6 },
  darkValue: { fontSize: 18, fontWeight: '800', color: COLORS.white, marginTop: 4 },
  modalSafe: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.white },
  modalTitle: { ...FONTS.h2, flex: 1, textAlign: 'center' },
  sheetSchool: { alignItems: 'center', marginBottom: 14 },
  sheetSchoolName: { fontSize: 18, fontWeight: '800', color: COLORS.primary, letterSpacing: -0.3 },
  sheetSchoolSub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  sheetStudent: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 12, ...SHADOW.sm },
  sheetKV: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  sheetK: { fontSize: 12, color: COLORS.muted },
  sheetV: { fontSize: 13, fontWeight: '600', color: COLORS.black },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  summaryTile: { width: '47%', flexGrow: 1, backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: 12 },
  summaryK: { ...FONTS.small },
  summaryV: { fontSize: 16, fontWeight: '800', color: COLORS.black, marginTop: 4 },
  pdfBtn: { backgroundColor: COLORS.black, borderRadius: RADIUS.lg, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  pdfBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.white },
  selectCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 12, ...SHADOW.sm },
  selectLabel: { fontSize: 14, fontWeight: '700', color: COLORS.black, marginBottom: 8 },
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 12 },
  dropdownText: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.black, marginRight: 8 },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'center', padding: 28 },
  pickerCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 12, ...SHADOW.md },
  pickerTitle: { fontSize: 13, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 8 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderRadius: RADIUS.md },
  pickerRowActive: { backgroundColor: COLORS.black },
  pickerRowText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
  pickerRowMeta: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
});

export default MarksScreen;
