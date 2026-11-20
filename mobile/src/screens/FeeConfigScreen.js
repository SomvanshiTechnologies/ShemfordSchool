import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, Switch, Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import client from '../api/client';
import { COLORS } from '../theme/colors';
import { FormCard, Field, Input, Chips, PrimaryButton, SecondaryButton } from '../components/FormKit';
import { errorText, rupees } from '../utils/students';
import { FEE_FIELDS, FEE_TYPE_LABELS } from '../utils/fees';

const AMOUNT_KEYS = [...FEE_FIELDS.map(f => f.key), 'sibling_admission_discount_amount', 'sibling_tuition_discount_amount'];

const toForm = (cfg, year) => {
  const f = {
    class_name: cfg?.class_name || '',
    stream: cfg?.stream || '',
    due_day: String(cfg?.due_day ?? 10),
    late_fee_enabled: !!cfg?.late_fee_enabled,
    notes: cfg?.notes || '',
    academic_year: cfg?.academic_year || year,
  };
  AMOUNT_KEYS.forEach(k => { f[k] = cfg?.[k] ? String(cfg[k]) : ''; });
  return f;
};

// Add / edit / remove one class's fees. Mirrors the web dashboard's fee
// configuration dialog → POST, PUT and DELETE /fees/components.
const FeeConfigScreen = () => {
  const navigation = useNavigation();
  const { params } = useRoute();
  const existing = params?.config || null;
  const year = params?.year;
  const [classes, setClasses] = useState([]);
  const [form, setForm] = useState(() => toForm(existing, year));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    navigation.setOptions({ headerTitle: existing ? `Class ${existing.class_name} Fees` : 'Add Class Fees' });
    client.get('/classes').then(r => setClasses(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Same rule as the web: stream classes offer their streams, other classes
  // their sections. "All" means the config applies to the whole class.
  const cls = classes.find(c => c.name === form.class_name);
  const groupOptions = cls?.streams?.length ? cls.streams : (cls?.sections || []).map(x => x.section_name);
  const streamChips = [{ value: '', label: 'All' }, ...groupOptions.map(o => ({ value: String(o).toLowerCase(), label: String(o) }))];

  const save = async () => {
    if (!form.class_name) { Alert.alert('Missing field', 'Select a class.'); return; }
    const body = {
      class_name: form.class_name,
      stream: form.stream || null,
      academic_year: form.academic_year,
      late_fee_enabled: form.late_fee_enabled,
      notes: form.notes.trim() || null,
    };
    for (const k of AMOUNT_KEYS) {
      const raw = String(form[k] || '').trim();
      const n = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        const label = FEE_FIELDS.find(f => f.key === k)?.label || 'Sibling discount';
        Alert.alert('Invalid amount', `${label} must be zero or more.`);
        return;
      }
      body[k] = n;
    }
    const day = parseInt(form.due_day, 10);
    if (!(day >= 1 && day <= 28)) { Alert.alert('Invalid due day', 'Due day must be between 1 and 28.'); return; }
    body.due_day = day;

    setSaving(true);
    try {
      if (existing?.config_id) await client.put(`/fees/components/${existing.config_id}`, body);
      else await client.post('/fees/components', body);
      Alert.alert('Saved', 'Fee setup saved.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e) {
      Alert.alert('Could not save', errorText(e, 'Failed to save fee setup.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = () => Alert.alert(
    'Remove fee setup?',
    `Remove the fees for Class ${existing.class_name}${existing.stream ? ` (${existing.stream})` : ''}, ${existing.academic_year}? This can't be undone. Fees already charged to students are not changed.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          setDeleting(true);
          try {
            await client.delete(`/fees/components/${existing.config_id}`);
            navigation.goBack();
          } catch (e) {
            Alert.alert('Could not remove', errorText(e, 'Failed to remove fee setup.'));
          } finally {
            setDeleting(false);
          }
        },
      },
    ],
  );

  const monthly = Number(form.monthly_tuition) || 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <FormCard title={`Academic Year ${form.academic_year}`}>
          <Field label="CLASS" required>
            <Chips options={classes.map(c => c.name)} value={form.class_name} onChange={v => setForm(f => ({ ...f, class_name: v, stream: '' }))} />
          </Field>
          {!!form.class_name && groupOptions.length > 0 && (
            <Field label={cls?.streams?.length ? 'STREAM' : 'SECTION'} hint="All applies these fees to the whole class">
              <Chips options={streamChips} value={form.stream} onChange={v => set('stream', v)} />
            </Field>
          )}
        </FormCard>

        {['one_time', 'yearly', 'monthly'].map(type => (
          <FormCard key={type} title={`${FEE_TYPE_LABELS[type]} Fees`}>
            {FEE_FIELDS.filter(f => f.type === type).map(f => (
              <Field key={f.key} label={f.label.toUpperCase()}>
                <Input value={form[f.key]} onChangeText={v => set(f.key, v)} placeholder="0" keyboardType="decimal-pad" />
              </Field>
            ))}
            {type === 'monthly' && (
              <>
                <View style={s.switchRow}>
                  <Text style={s.switchText}>Charge late fee after the due date</Text>
                  <Switch value={form.late_fee_enabled} onValueChange={v => set('late_fee_enabled', v)} trackColor={{ true: COLORS.primary, false: COLORS.border }} thumbColor={COLORS.white} />
                </View>
                <Field label="DUE DAY OF MONTH" hint="Monthly fees fall due on this day (1–28)">
                  <Input value={form.due_day} onChangeText={v => set('due_day', v)} placeholder="10" keyboardType="number-pad" maxLength={2} />
                </Field>
                {monthly > 0 && <Text style={s.hint}>Tuition for the year: {rupees(monthly * 12)}</Text>}
              </>
            )}
          </FormCard>
        ))}

        <FormCard title="Sibling Discount (₹)">
          <Field label="ON ADMISSION FEE">
            <Input value={form.sibling_admission_discount_amount} onChangeText={v => set('sibling_admission_discount_amount', v)} placeholder="0" keyboardType="decimal-pad" />
          </Field>
          <Field label="ON MONTHLY TUITION">
            <Input value={form.sibling_tuition_discount_amount} onChangeText={v => set('sibling_tuition_discount_amount', v)} placeholder="0" keyboardType="decimal-pad" />
          </Field>
          <Field label="NOTES">
            <Input value={form.notes} onChangeText={v => set('notes', v)} placeholder="Optional" multiline />
          </Field>
        </FormCard>

        <Text style={s.footNote}>Changes apply to new admissions and new fee entries. Fees already charged to students are not changed.</Text>
        <PrimaryButton title="Save Fee Setup" icon="checkmark" onPress={save} loading={saving} disabled={deleting} />
        {!!existing && (
          <SecondaryButton title="Remove Fee Setup" icon="trash-outline" danger onPress={remove} loading={deleting} disabled={saving} style={{ marginTop: 10 }} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  switchText: { flex: 1, fontSize: 13, fontWeight: '600', color: COLORS.black, paddingRight: 10 },
  hint: { fontSize: 11, color: COLORS.muted },
  footNote: { fontSize: 11, color: COLORS.muted, textAlign: 'center', marginBottom: 12 },
});

export default FeeConfigScreen;
