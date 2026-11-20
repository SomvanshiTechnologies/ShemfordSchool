import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import client from '../api/client';
import { COLORS, RADIUS } from '../theme/colors';
import { FormCard, Field, Chips, PrimaryButton, SecondaryButton } from '../components/FormKit';
import { sectionsFor, streamFor, errorText, pickFile, formFile, MULTIPART } from '../utils/students';

// Mirrors the web dashboard's CSV import wizard (StudentsPage.js):
//   1 Choose class, section and file → POST /students/csv-preview (nothing is saved)
//   2 Review valid / invalid rows     → POST /students/csv-import (valid rows only)
//   3 Result

// Same columns and sample row as the web dashboard's template download.
const TEMPLATE_HEADERS = [
  'admission_no', 'roll_no', 'first_name', 'middlename', 'last_name', 'gender', 'date_of_birth', 'admission_date',
  'mobile_no', 'email',
  'father_name', 'father_phone', 'father_occupation',
  'mother_name', 'mother_phone', 'mother_occupation',
  'guardian_is', 'guardian_name', 'guardian_relation', 'guardian_email', 'guardian_phone', 'guardian_occupation', 'guardian_address',
  'current_address', 'permanent_address',
  'national_identification_no', 'local_identification_no',
  'bank_account_no', 'bank_name', 'ifsc_code',
  'category', 'religion', 'caste', 'rte', 'previous_school', 'note',
].join(',');
const TEMPLATE_SAMPLE = [
  'SHM/2025/TEST01,1,Ananya,,Sharma,female,2012-06-15,2025-04-01',
  '9876543210,ananya@email.com',
  'Rajesh Sharma,9876543211,Business',
  'Priya Sharma,9876543212,Homemaker',
  ',,,,,,',
  '123 MG Road,123 MG Road',
  '123456789012,LOC001',
  'ACC001,SBI,SBIN0001234',
  'General,Hindu,Sharma,No,Delhi Public School,Transfer student',
].join(',');

const MAX_ROWS_SHOWN = 200;

const Stat = ({ label, value, color }) => (
  <View style={s.stat}>
    <Text style={[s.statValue, color && { color }]}>{value}</Text>
    <Text style={s.statLabel}>{label}</Text>
  </View>
);

const StudentImportScreen = () => {
  const navigation = useNavigation();
  const [step, setStep] = useState(1);
  const [classes, setClasses] = useState([]);
  const [className, setClassName] = useState('');
  const [section, setSection] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [filter, setFilter] = useState('all');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get('/classes').then(r => setClasses(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  const reset = () => {
    setStep(1); setClassName(''); setSection(''); setFile(null);
    setPreview(null); setFilter('all'); setResult(null);
  };

  const shareTemplate = async () => {
    try {
      const uri = `${FileSystem.cacheDirectory}students_import_template.csv`;
      await FileSystem.writeAsStringAsync(uri, `${TEMPLATE_HEADERS}\n${TEMPLATE_SAMPLE}\n`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Student import template', UTI: 'public.comma-separated-values-text' });
      } else {
        Alert.alert('Not available', 'Sharing is not available on this device.');
      }
    } catch {
      Alert.alert('Error', 'Could not create the template file.');
    }
  };

  const chooseFile = async () => {
    try {
      // Android reports CSV files under several MIME types, so accept any file
      // and check the extension instead.
      const f = await pickFile('*/*');
      if (!f) return;
      if (!f.name.toLowerCase().endsWith('.csv')) { Alert.alert('Wrong file type', 'Please choose a .csv file.'); return; }
      setFile({ ...f, type: 'text/csv' });
    } catch {
      Alert.alert('Error', 'Could not open the file picker.');
    }
  };

  const runPreview = async () => {
    if (!className || !section) { Alert.alert('Missing field', 'Select a class and a section.'); return; }
    if (!file) { Alert.alert('Missing file', 'Choose a CSV file first.'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', formFile(file));
      fd.append('class_name', className);
      fd.append('section', section);
      const stream = streamFor(className, section);
      if (stream) fd.append('stream', stream);
      const res = await client.post('/students/csv-preview', fd, MULTIPART);
      setPreview(res.data);
      setFilter(res.data.invalid > 0 ? 'invalid' : 'all');
      setStep(2);
    } catch (e) {
      Alert.alert('Could not read file', errorText(e, 'Failed to parse the CSV file.'));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    const validCount = (preview?.rows || []).filter(r => r.status === 'valid').length;
    if (!validCount) { Alert.alert('Nothing to import', 'There are no valid rows.'); return; }
    setBusy(true);
    try {
      const res = await client.post('/students/csv-import', {
        class_name: preview.class_name,
        section: preview.section,
        stream: preview.stream,
        rows: preview.rows,
      });
      setResult(res.data);
      setStep(3);
    } catch (e) {
      Alert.alert('Import failed', errorText(e, 'Failed to import students.'));
    } finally {
      setBusy(false);
    }
  };

  const sections = sectionsFor(classes, className);
  const rows = (preview?.rows || []).filter(r => filter === 'all' || r.status === filter);

  return (
    <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {step === 1 && (
        <>
          <FormCard title="Import Students from CSV">
            <Text style={s.note}>Every student in the file is added to the class and section you choose here. Dates must be YYYY-MM-DD. Each student's date of birth becomes their first password.</Text>
            <SecondaryButton title="Get Template CSV" icon="download-outline" onPress={shareTemplate} />
          </FormCard>

          <FormCard title="Class">
            <Field label="CLASS" required>
              <Chips options={classes.map(c => c.name)} value={className} onChange={v => { setClassName(v); setSection(''); }} />
            </Field>
            {!!className && (
              <Field label="SECTION" required>
                <Chips options={sections} value={section} onChange={setSection} />
              </Field>
            )}
          </FormCard>

          <FormCard title="File">
            <TouchableOpacity style={s.fileBox} onPress={chooseFile} activeOpacity={0.7}>
              <Ionicons name={file ? 'document-text' : 'cloud-upload-outline'} size={28} color={file ? COLORS.primary : COLORS.lightMuted} />
              <Text style={s.fileName} numberOfLines={1}>{file ? file.name : 'Tap to choose a CSV file'}</Text>
              {!!file && <Text style={s.fileChange}>Tap to change</Text>}
            </TouchableOpacity>
          </FormCard>

          <PrimaryButton title="Check File" icon="search" onPress={runPreview} loading={busy} disabled={!file || !className || !section} />
          <Text style={s.footNote}>Checking doesn't save anything.</Text>
        </>
      )}

      {step === 2 && preview && (
        <>
          <FormCard title={`Class ${preview.class_name} - ${preview.section}`}>
            <View style={s.statRow}>
              <Stat label="Rows" value={preview.total} />
              <Stat label="Valid" value={preview.valid} color={COLORS.success} />
              <Stat label="Invalid" value={preview.invalid} color={preview.invalid ? COLORS.danger : undefined} />
            </View>
            <Chips
              options={[{ value: 'all', label: 'All' }, { value: 'valid', label: 'Valid' }, { value: 'invalid', label: 'Invalid' }]}
              value={filter}
              onChange={setFilter}
            />
          </FormCard>

          <View style={s.list}>
            {rows.slice(0, MAX_ROWS_SHOWN).map(r => {
              const ok = r.status === 'valid';
              const d = r.data || {};
              const title = (ok ? `${d.first_name || ''} ${d.last_name || ''}`.trim() : r.preview?.name) || `Row ${r.row_number}`;
              const admNo = d._admission_no_override;
              return (
                <View key={r.row_number} style={s.row}>
                  <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={18} color={ok ? COLORS.success : COLORS.danger} style={{ marginTop: 1 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{title}</Text>
                    {ok ? (
                      <Text style={s.rowSub}>Row {r.row_number}{admNo ? ` · ${admNo}` : ''}{d.date_of_birth ? ` · DOB ${d.date_of_birth}` : ''}</Text>
                    ) : (
                      [<Text key="row" style={s.rowSub}>Row {r.row_number}</Text>].concat((r.errors || []).map((err, i) => (
                        <Text key={i} style={s.rowError}>• {typeof err === 'string' ? err : (err?.message || err?.error || JSON.stringify(err))}</Text>
                      )))
                    )}
                  </View>
                </View>
              );
            })}
            {rows.length === 0 && <Text style={[s.note, { padding: 16, marginBottom: 0 }]}>No rows in this view.</Text>}
            {rows.length > MAX_ROWS_SHOWN && (
              <Text style={[s.note, { padding: 16, marginBottom: 0 }]}>Showing the first {MAX_ROWS_SHOWN} of {rows.length} rows.</Text>
            )}
          </View>

          <PrimaryButton
            title={preview.valid ? `Import ${preview.valid} Valid Student${preview.valid === 1 ? '' : 's'}` : 'No Valid Rows'}
            icon="cloud-upload"
            disabled={!preview.can_import}
            loading={busy}
            onPress={() => Alert.alert(
              'Import students',
              `Add ${preview.valid} student${preview.valid === 1 ? '' : 's'} to Class ${preview.class_name} - ${preview.section}?${preview.invalid ? `\n\n${preview.invalid} invalid row${preview.invalid === 1 ? ' is' : 's are'} skipped.` : ''}`,
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Import', onPress: runImport }],
            )}
          />
          <SecondaryButton title="Back" icon="arrow-back" onPress={() => setStep(1)} disabled={busy} style={{ marginTop: 10 }} />
        </>
      )}

      {step === 3 && result && (
        <>
          <FormCard title="Import Complete">
            <View style={s.statRow}>
              <Stat label="Added" value={result.success || 0} color={COLORS.success} />
              <Stat label="Failed" value={result.failed || 0} color={result.failed ? COLORS.danger : undefined} />
              <Stat label="Skipped" value={result.skipped || 0} />
            </View>
            {(result.errors || []).map((e, i) => (
              <Text key={i} style={s.rowError}>• Row {e.row}: {e.error}</Text>
            ))}
            {(result.success || 0) > 0 && (
              <Text style={[s.note, { marginTop: 10, marginBottom: 0 }]}>New students show in this app's list once app access is turned on.</Text>
            )}
          </FormCard>
          <PrimaryButton title="Done" icon="checkmark" onPress={() => navigation.goBack()} />
          <SecondaryButton title="Import Another File" icon="refresh" onPress={reset} style={{ marginTop: 10 }} />
        </>
      )}
    </ScrollView>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 16 },
  note: { fontSize: 12, color: COLORS.muted, marginBottom: 12, lineHeight: 17 },
  footNote: { fontSize: 11, color: COLORS.muted, textAlign: 'center', marginTop: 10 },
  fileBox: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 22, borderRadius: RADIUS.md,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.border, backgroundColor: COLORS.lightBg,
  },
  fileName: { fontSize: 13, fontWeight: '600', color: COLORS.black, marginTop: 8, paddingHorizontal: 12 },
  fileChange: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  statRow: { flexDirection: 'row', marginBottom: 14 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '800', color: COLORS.black },
  statLabel: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, marginBottom: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  rowTitle: { fontSize: 13, fontWeight: '600', color: COLORS.black },
  rowSub: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  rowError: { fontSize: 11, color: COLORS.danger, marginTop: 2 },
});

export default StudentImportScreen;
