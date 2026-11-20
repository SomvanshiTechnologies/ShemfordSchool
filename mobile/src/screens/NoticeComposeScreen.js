import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';
import { FormCard, Field, Input, Chips, PrimaryButton } from '../components/FormKit';
import { useVoiceRecorder, VoiceNotePlayer, HoldToRecordButton } from '../components/VoiceNotePlayer';
import { errorText } from '../utils/students';

// Same categories and audience rules as the web dashboard's announcement
// composer (AnnouncementsPage.js → buildAudiencePayload).
const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'homework', label: 'Homework' },
  { value: 'classwork', label: 'Classwork' },
  { value: 'employees', label: 'Employees', adminOnly: true },
];

const GENERAL_MODES = [
  { value: 'all', label: 'Everyone' },
  { value: 'all_teachers', label: 'All Teachers' },
  { value: 'all_students', label: 'All Students' },
  { value: 'all_parents', label: 'All Parents' },
  { value: 'all_employees', label: 'All Employees' },
  { value: 'specific_class', label: 'One Class' },
  { value: 'specific_person', label: 'One Person' },
];

const HW_AUDIENCES = [
  { value: 'student', label: 'Students' },
  { value: 'parent', label: 'Parents' },
  { value: 'teacher', label: 'Teachers' },
];

const PERSON_ROLES = [
  { value: 'teacher', label: 'Teacher' },
  { value: 'student', label: 'Student' },
  { value: 'staff', label: 'Any Staff' },
];

const STAFF_ROLES = ['admin', 'teacher', 'accountant'];

const NoticeComposeScreen = () => {
  const navigation = useNavigation();
  const { params } = useRoute();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const voice = useVoiceRecorder();

  const [category, setCategory] = useState(params?.category && (params.category !== 'employees' || isAdmin) ? params.category : 'general');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState('normal');
  const [mode, setMode] = useState('all');                 // general
  const [classValue, setClassValue] = useState('');        // specific class / homework class
  const [audiences, setAudiences] = useState([]);          // homework / classwork
  const [deptMode, setDeptMode] = useState('all');          // employees
  const [dept, setDept] = useState('');
  const [personRole, setPersonRole] = useState('teacher');
  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [person, setPerson] = useState(null);
  const [classes, setClasses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [posting, setPosting] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    client.get('/classes').then(r => setClasses(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    if (isAdmin) client.get('/employees/departments').then(r => setDepartments(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    return () => clearTimeout(timer.current);
  }, []);

  const searchPeople = (q, role = personRole) => {
    setPersonQuery(q);
    clearTimeout(timer.current);
    if (!q.trim()) { setPersonResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await client.get('/users/search', { params: { q: q.trim(), ...(role === 'staff' ? {} : { role }) } });
        const list = Array.isArray(res.data) ? res.data : [];
        setPersonResults(role === 'staff' ? list.filter(u => STAFF_ROLES.includes(u.role)) : list);
      } catch {
        setPersonResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  };

  const toggleAudience = (a) => setAudiences(cur => (cur.includes(a) ? cur.filter(x => x !== a) : [...cur, a]));

  // Returns { target_type, target_value, target_audiences } or null if incomplete.
  const audiencePayload = () => {
    if (category === 'employees') {
      if (deptMode === 'department') return dept ? { target_type: 'department', target_value: dept, target_audiences: ['employee'] } : null;
      return { target_type: 'audience', target_value: null, target_audiences: ['employee'] };
    }
    if (category === 'general') {
      switch (mode) {
        case 'all_teachers': return { target_type: 'audience', target_value: null, target_audiences: ['teacher'] };
        case 'all_students': return { target_type: 'audience', target_value: null, target_audiences: ['student'] };
        case 'all_parents': return { target_type: 'audience', target_value: null, target_audiences: ['parent'] };
        case 'all_employees': return { target_type: 'audience', target_value: null, target_audiences: ['employee'] };
        case 'specific_class': return classValue ? { target_type: 'class', target_value: classValue, target_audiences: null } : null;
        case 'specific_person': return person ? { target_type: 'user', target_value: person.user_id, target_audiences: null } : null;
        default: return { target_type: 'all', target_value: null, target_audiences: null };
      }
    }
    // Homework / classwork: chosen audiences, optionally limited to one class.
    if (classValue) return { target_type: 'class', target_value: classValue, target_audiences: audiences.length ? audiences : null };
    if (!audiences.length || audiences.length === HW_AUDIENCES.length) return { target_type: 'all', target_value: null, target_audiences: null };
    return { target_type: 'audience', target_value: null, target_audiences: audiences };
  };

  const post = async () => {
    if (voice.recording) { Alert.alert('Still recording', 'Release the mic button to finish the voice note.'); return; }
    if (!title.trim()) { Alert.alert('Missing title', 'Give the notice a title.'); return; }
    if (!content.trim() && !voice.uri) { Alert.alert('Empty notice', 'Write a message or record a voice note.'); return; }
    const target = audiencePayload();
    if (!target) { Alert.alert('Choose who sees it', 'Pick the class, department or person for this notice.'); return; }

    setPosting(true);
    try {
      const res = await client.post('/announcements', {
        title: title.trim(),
        content: content.trim() || '🎤 Voice note',
        priority,
        announcement_type: category,
        ...target,
      });
      const annId = res.data?.announcement_id;
      let voiceFailed = false;
      if (voice.uri && annId) {
        try {
          const fd = new FormData();
          // m4a recordings are MPEG-4 audio; the server accepts audio/mp4.
          fd.append('file', { uri: voice.uri, name: 'voice_note.m4a', type: 'audio/mp4' });
          if (voice.durationMs) fd.append('duration_seconds', String(voice.durationMs / 1000));
          await client.post(`/announcements/${annId}/voice-note`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch {
          voiceFailed = true;
        }
      }
      voice.reset();
      Alert.alert(
        voiceFailed ? 'Posted without voice note' : 'Notice posted',
        voiceFailed ? 'The notice was posted, but the voice note failed to upload.' : 'Everyone in the audience can now see it.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e) {
      Alert.alert('Could not post', errorText(e, 'Failed to post the notice.'));
    } finally {
      setPosting(false);
    }
  };

  const categories = CATEGORIES.filter(c => !c.adminOnly || isAdmin);
  const seconds = Math.round((voice.durationMs || 0) / 1000);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <FormCard title="Notice">
          <Field label="CATEGORY">
            <Chips options={categories} value={category} onChange={v => { setCategory(v); setClassValue(''); setMode('all'); setPerson(null); }} capitalize={false} />
          </Field>
          <Field label="TITLE" required>
            <Input value={title} onChangeText={setTitle} placeholder={category === 'homework' ? 'e.g. Maths homework — Chapter 4' : 'Notice title'} />
          </Field>
          <Field label="MESSAGE">
            <Input value={content} onChangeText={setContent} placeholder="Write the notice" multiline style={{ minHeight: 120 }} />
          </Field>
          <Field label="PRIORITY">
            <Chips options={['normal', 'high', 'urgent']} value={priority} onChange={setPriority} />
          </Field>
        </FormCard>

        <FormCard title="Who sees it">
          {category === 'general' && (
            <>
              <Chips options={GENERAL_MODES} value={mode} onChange={v => { setMode(v); setPerson(null); }} capitalize={false} />
              {mode === 'specific_class' && (
                <View style={{ marginTop: 12 }}>
                  <Field label="CLASS" required><Chips options={classes.map(c => c.name)} value={classValue} onChange={setClassValue} /></Field>
                </View>
              )}
              {mode === 'specific_person' && (
                <View style={{ marginTop: 12 }}>
                  {person ? (
                    <View style={s.picked}>
                      <Ionicons name="person-circle-outline" size={22} color={COLORS.black} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.pickedName}>{person.name}</Text>
                        <Text style={s.pickedSub}>{person.role}{person.class_name ? ` · ${person.class_name}-${person.section}` : ''}{person.email ? ` · ${person.email}` : ''}</Text>
                      </View>
                      <TouchableOpacity onPress={() => setPerson(null)}><Text style={s.change}>Change</Text></TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <Chips options={PERSON_ROLES} value={personRole} onChange={v => { setPersonRole(v); searchPeople(personQuery, v); }} capitalize={false} />
                      <View style={s.searchBox}>
                        <Ionicons name="search" size={16} color={COLORS.muted} />
                        <TextInput style={s.searchInput} value={personQuery} onChangeText={q => searchPeople(q)} placeholder="Search by name or email" placeholderTextColor={COLORS.lightMuted} autoCorrect={false} />
                        {searching && <ActivityIndicator size="small" color={COLORS.primary} />}
                      </View>
                      {personResults.map(u => (
                        <TouchableOpacity key={u.user_id} style={s.resultRow} onPress={() => { setPerson(u); setPersonResults([]); setPersonQuery(''); }}>
                          <Text style={s.pickedName}>{u.name}</Text>
                          <Text style={s.pickedSub}>{u.role}{u.class_name ? ` · ${u.class_name}-${u.section}` : ''}{u.email ? ` · ${u.email}` : ''}</Text>
                        </TouchableOpacity>
                      ))}
                      {!!personQuery.trim() && !searching && personResults.length === 0 && <Text style={s.none}>No matches</Text>}
                    </>
                  )}
                </View>
              )}
            </>
          )}

          {(category === 'homework' || category === 'classwork') && (
            <>
              <Field label="AUDIENCE" hint="None selected means everyone">
                <View style={s.checkRow}>
                  {HW_AUDIENCES.map(a => {
                    const on = audiences.includes(a.value);
                    return (
                      <TouchableOpacity key={a.value} style={[s.check, on && s.checkOn]} onPress={() => toggleAudience(a.value)}>
                        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={16} color={on ? COLORS.white : COLORS.muted} />
                        <Text style={[s.checkText, on && { color: COLORS.white }]}>{a.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Field>
              <Field label="CLASS (OPTIONAL)" hint="Tap the selected class again to clear it">
                <Chips options={classes.map(c => c.name)} value={classValue} onChange={v => setClassValue(cur => (cur === v ? '' : v))} />
              </Field>
            </>
          )}

          {category === 'employees' && (
            <>
              <Chips options={[{ value: 'all', label: 'All Employees' }, { value: 'department', label: 'One Department' }]} value={deptMode} onChange={setDeptMode} capitalize={false} />
              {deptMode === 'department' && (
                <View style={{ marginTop: 12 }}>
                  <Field label="DEPARTMENT" required>
                    {departments.length
                      ? <Chips options={departments} value={dept} onChange={setDept} capitalize={false} />
                      : <Text style={s.none}>No departments found</Text>}
                  </Field>
                </View>
              )}
            </>
          )}
        </FormCard>

        <FormCard title="Voice Note (optional)">
          {voice.uri ? (
            <>
              <VoiceNotePlayer uri={voice.uri} />
              <TouchableOpacity style={s.discard} onPress={voice.reset}>
                <Ionicons name="trash-outline" size={14} color={COLORS.danger} />
                <Text style={s.discardText}>Discard recording</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={s.recordRow}>
              <HoldToRecordButton onStart={voice.startRecording} onStop={voice.stopRecording} disabled={posting} />
              <Text style={s.recordHint}>{voice.recording ? `Recording… ${seconds}s — release to stop` : 'Press and hold the mic to record'}</Text>
            </View>
          )}
          {!!voice.micError && <Text style={s.micError}>{voice.micError}</Text>}
        </FormCard>

        <PrimaryButton title="Post Notice" icon="send" onPress={post} loading={posting} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 16 },
  picked: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.lightBg, borderRadius: RADIUS.md, padding: 12 },
  pickedName: { fontSize: 14, fontWeight: '700', color: COLORS.black },
  pickedSub: { fontSize: 11, color: COLORS.muted, marginTop: 1, textTransform: 'capitalize' },
  change: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 12, marginTop: 10 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: COLORS.black },
  resultRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  none: { fontSize: 12, color: COLORS.muted, paddingVertical: 10 },
  checkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border },
  checkOn: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  checkText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  recordHint: { flex: 1, fontSize: 12, color: COLORS.muted },
  discard: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  discardText: { fontSize: 12, fontWeight: '700', color: COLORS.danger },
  micError: { fontSize: 11, color: COLORS.danger, marginTop: 8 },
});

export default NoticeComposeScreen;
