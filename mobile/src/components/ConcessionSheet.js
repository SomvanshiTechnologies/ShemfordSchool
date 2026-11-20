import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, Alert, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW } from '../theme/colors';
import { Field, Input, Chips, PrimaryButton } from './FormKit';
import StudentSearch from './StudentSearch';
import { errorText } from '../utils/students';

const QUICK_PERCENTS = ['10', '25', '50', '100'];

// Grant a percentage concession on a student's unpaid fees.
// Mirrors the web dashboard's concession dialog → POST /fees/concession.
// Pass `student` ({ student_id, name }) to fix the student, or leave it out
// to pick one with the search box.
const ConcessionSheet = ({ visible, onClose, student, onDone }) => {
  const [picked, setPicked] = useState(null);
  const [percent, setPercent] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPicked(student || null);
    setPercent('');
    setReason('');
  }, [visible, student]);

  const apply = async () => {
    if (!picked) { Alert.alert('Select a student', 'Search for the student first.'); return; }
    const pct = parseFloat(percent);
    if (!(pct > 0 && pct <= 100)) { Alert.alert('Invalid percent', 'Enter a concession from 1 to 100%.'); return; }
    setSaving(true);
    try {
      const res = await client.post('/fees/concession', {
        student_id: picked.student_id,
        concession_percent: pct,
        reason: reason.trim() || 'Scholarship/Concession',
      });
      Alert.alert('Concession applied', res.data?.message || 'Concession applied.');
      onDone?.();
      onClose();
    } catch (e) {
      Alert.alert('Could not apply', errorText(e, 'Failed to apply concession.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => !saving && onClose()}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.overlay}>
          <TouchableOpacity style={s.bg} onPress={() => !saving && onClose()} />
          <View style={s.sheet}>
            <View style={s.handle} />
            <Text style={s.title}>Grant Concession</Text>
            <Text style={s.sub}>Reduces every unpaid fee entry by this percentage. Paid entries are not changed. An existing sibling discount is kept and the concession is added on top.</Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
              {picked ? (
                <View style={s.picked}>
                  <Ionicons name="person-circle-outline" size={22} color={COLORS.black} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.pickedName}>{picked.name}</Text>
                    {!!(picked.class_name || picked.admission_number) && (
                      <Text style={s.pickedSub}>{picked.class_name}{picked.section ? `-${picked.section}` : ''}{picked.admission_number ? ` · ${picked.admission_number}` : ''}</Text>
                    )}
                  </View>
                  {!student && (
                    <TouchableOpacity onPress={() => setPicked(null)}><Text style={s.change}>Change</Text></TouchableOpacity>
                  )}
                </View>
              ) : (
                <StudentSearch onSelect={setPicked} />
              )}
              <Field label="CONCESSION (%)" required>
                <Chips options={QUICK_PERCENTS.map(p => ({ value: p, label: `${p}%` }))} value={percent} onChange={setPercent} />
                <Input value={percent} onChangeText={setPercent} placeholder="Or type a percentage" keyboardType="decimal-pad" style={{ marginTop: 8 }} />
              </Field>
              <Field label="REASON">
                <Input value={reason} onChangeText={setReason} placeholder="Scholarship/Concession" />
              </Field>
              <PrimaryButton title="Apply Concession" icon="pricetag" onPress={apply} loading={saving} />
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, ...SHADOW.md },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.black },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 6, marginBottom: 14, lineHeight: 17 },
  picked: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.lightBg, borderRadius: RADIUS.md, padding: 12, marginBottom: 12 },
  pickedName: { fontSize: 14, fontWeight: '700', color: COLORS.black },
  pickedSub: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  change: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
});

export default ConcessionSheet;
