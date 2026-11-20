import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS } from '../theme/colors';
import { FormCard, Field, Input, Chips, PrimaryButton, SecondaryButton } from '../components/FormKit';
import {
  sectionsFor, streamFor, isTenDigits, isValidEmail, isIsoDate, errorText,
  pickFile, formFile, MULTIPART, MAX_UPLOAD_BYTES, rupees,
} from '../utils/students';

// Mirrors the web dashboard's admission wizard (StudentsPage.js):
//   1 Details → POST /onboarding/start
//   2 Class   → PUT  /onboarding/{id}/class   (returns the fee preview)
//   3 Documents → POST /upload + POST /onboarding/{id}/documents
//   4 Fee & payment → POST /onboarding/{id}/complete + POST /fees/admission-payment
//   5 Done
const STEPS = ['Details', 'Class', 'Documents', 'Payment', 'Done'];

// Same list and order as the web dashboard. None are mandatory.
// The backend accepts PDF for documents and JPG/PNG only for the passport photo.
const DOCUMENTS = [
  { type: 'birth_certificate',    name: 'Birth Certificate' },
  { type: 'aadhaar_card',         name: 'Aadhaar Card' },
  { type: 'passport_photo',       name: 'Passport Photo' },
  { type: 'previous_marksheet',   name: 'Previous Class Marksheet' },
  { type: 'transfer_certificate', name: 'Transfer Certificate (TC)' },
  { type: 'caste_certificate',    name: 'Caste Certificate' },
  { type: 'medical_certificate',  name: 'Medical Fitness Certificate' },
];

// Fallback if /settings/payment-methods can't be reached. POS is excluded here,
// as on the web: the card-machine flow isn't wired into admission.
const FALLBACK_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'online', label: 'Online / UPI' },
  { value: 'split', label: 'Split (Cash + Online)' },
];

const EMPTY_DETAILS = {
  first_name: '', last_name: '', gender: 'male', date_of_birth: '',
  phone: '', email: '', address: '',
  parent_name: '', parent_phone: '', parent_email: '',
  mother_name: '', mother_phone: '', mother_email: '',
  is_sibling: false,
};
const EMPTY_PAYMENT = { method: 'cash', transaction_id: '', remarks: '', partial_amount: '', split_cash: '', split_online: '' };

const StepBar = ({ step }) => (
  <View style={s.stepBar}>
    {STEPS.map((label, i) => {
      const n = i + 1;
      const done = n < step;
      const active = n === step;
      return (
        <View key={label} style={s.stepItem}>
          <View style={[s.stepDot, done && s.stepDotDone, active && s.stepDotActive]}>
            {done
              ? <Ionicons name="checkmark" size={12} color={COLORS.white} />
              : <Text style={[s.stepNum, active && { color: COLORS.white }]}>{n}</Text>}
          </View>
          <Text style={[s.stepLabel, (active || done) && { color: COLORS.black }]} numberOfLines={1}>{label}</Text>
        </View>
      );
    })}
  </View>
);

const NewAdmissionScreen = () => {
  const navigation = useNavigation();
  const scrollRef = useRef(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [classes, setClasses] = useState([]);
  const [methods, setMethods] = useState(FALLBACK_METHODS);

  const [onbId, setOnbId] = useState(null);
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [errors, setErrors] = useState({});
  const [classData, setClassData] = useState({ class_name: '', section: '' });
  const [feeData, setFeeData] = useState(null);
  const [docs, setDocs] = useState({});          // { doc_type: { file_name } }
  const [docBusy, setDocBusy] = useState({});    // { doc_type: true }
  const [payment, setPayment] = useState(EMPTY_PAYMENT);
  const [result, setResult] = useState(null);

  useEffect(() => {
    client.get('/classes')
      .then(r => setClasses(Array.isArray(r.data) ? r.data : []))
      .catch(() => setClasses([]));
    client.get('/settings/payment-methods')
      .then(r => {
        const list = Array.isArray(r.data?.methods) ? r.data.methods.filter(m => m.value !== 'pos_terminal') : null;
        if (list && list.length) setMethods(list);
      })
      .catch(() => {});
  }, []);

  const goTo = (n) => { setStep(n); scrollRef.current?.scrollTo({ y: 0, animated: false }); };
  const setD = (k, v) => { setDetails(d => ({ ...d, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: undefined })); };
  const setP = (k, v) => setPayment(p => ({ ...p, [k]: v }));

  const startOver = () => {
    setOnbId(null); setDetails(EMPTY_DETAILS); setErrors({}); setClassData({ class_name: '', section: '' });
    setFeeData(null); setDocs({}); setDocBusy({}); setPayment(EMPTY_PAYMENT); setResult(null); goTo(1);
  };

  // ── Step 1: student details ──────────────────────────────────────────────
  const submitDetails = async () => {
    const d = details;
    const e = {};
    if (!d.first_name.trim()) e.first_name = 'First name is required';
    if (!d.last_name.trim()) e.last_name = 'Last name is required';
    if (!d.gender) e.gender = 'Gender is required';
    if (!d.date_of_birth.trim()) e.date_of_birth = 'Date of birth is required';
    else if (!isIsoDate(d.date_of_birth)) e.date_of_birth = 'Use YYYY-MM-DD, e.g. 2019-06-15';
    if (!d.phone.trim()) e.phone = 'Phone is required';
    else if (!isTenDigits(d.phone)) e.phone = 'Phone must be exactly 10 digits';
    if (d.email.trim() && !isValidEmail(d.email)) e.email = 'Enter a valid email address';
    if (!d.address.trim()) e.address = 'Address is required';
    if (d.parent_phone.trim() && !isTenDigits(d.parent_phone)) e.parent_phone = 'Must be 10 digits';
    if (d.mother_phone.trim() && !isTenDigits(d.mother_phone)) e.mother_phone = 'Must be 10 digits';
    if (d.parent_email.trim() && !isValidEmail(d.parent_email)) e.parent_email = 'Enter a valid email address';
    if (d.mother_email.trim() && !isValidEmail(d.mother_email)) e.mother_email = 'Enter a valid email address';
    setErrors(e);
    if (Object.keys(e).length) { Alert.alert('Check the form', 'Please fix the highlighted fields.'); return; }

    setLoading(true);
    try {
      const payload = {};
      Object.entries(d).forEach(([k, v]) => {
        const val = typeof v === 'string' ? v.trim() : v;
        if (val !== '') payload[k] = val;   // the backend rejects "" for email fields
      });
      const res = await client.post('/onboarding/start', payload);
      setOnbId(res.data.onboarding_id);
      goTo(2);
    } catch (err) {
      const ve = err.response?.data?.detail?.validation_errors;
      if (ve) setErrors(ve);
      Alert.alert('Could not start admission', errorText(err, 'Failed to start admission.'));
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: class & section ──────────────────────────────────────────────
  const submitClass = async () => {
    if (!classData.class_name || !classData.section) { Alert.alert('Missing field', 'Select a class and a section.'); return; }
    setLoading(true);
    try {
      const res = await client.put(`/onboarding/${onbId}/class`, {
        class_name: classData.class_name,
        section: classData.section,
        stream: streamFor(classData.class_name, classData.section),
      });
      setFeeData(res.data);
      goTo(3);
    } catch (err) {
      Alert.alert('Could not set class', errorText(err, 'Failed to set class.'));
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: documents ────────────────────────────────────────────────────
  const uploadDoc = async (doc) => {
    const isPhoto = doc.type === 'passport_photo';
    let file;
    try {
      file = await pickFile(isPhoto ? ['image/jpeg', 'image/png'] : ['application/pdf']);
    } catch {
      Alert.alert('Error', 'Could not open the file picker.');
      return;
    }
    if (!file) return;
    if (file.size && file.size > MAX_UPLOAD_BYTES) { Alert.alert('File too large', 'Maximum size is 5 MB.'); return; }
    const lower = file.name.toLowerCase();
    if (isPhoto && !/\.(jpe?g|png)$/.test(lower) && !/image\/(jpeg|png)/.test(file.type)) {
      Alert.alert('Wrong file type', 'Passport photo must be a JPG or PNG image.'); return;
    }
    if (!isPhoto && !lower.endsWith('.pdf') && file.type !== 'application/pdf') {
      Alert.alert('Wrong file type', 'Documents must be PDF files.'); return;
    }

    setDocBusy(b => ({ ...b, [doc.type]: true }));
    try {
      const fd = new FormData();
      fd.append('file', formFile(file));
      const up = await client.post(`/upload?doc_type=${doc.type}`, fd, MULTIPART);
      const { file_url, file_name } = up.data;
      await client.post(`/onboarding/${onbId}/documents`, {
        document_type: doc.type, document_name: doc.name, file_url, file_name,
      });
      setDocs(d => ({ ...d, [doc.type]: { file_name: file_name || file.name } }));
    } catch (err) {
      Alert.alert('Upload failed', errorText(err, `Could not upload ${doc.name}.`));
    } finally {
      setDocBusy(b => ({ ...b, [doc.type]: false }));
    }
  };

  // ── Step 4: confirm admission and collect the admission fee ──────────────
  const totalDue = Number(feeData?.admission_time_fee || 0);
  const hasFee = totalDue > 0 || (feeData?.fee_breakdown || []).length > 0;

  const buildPaymentPayload = (studentId) => {
    const body = {
      student_id: studentId,
      payment_method: payment.method,
      remarks: payment.remarks.trim() || 'Collected at admission',
    };
    if (payment.transaction_id.trim()) body.transaction_id = payment.transaction_id.trim();
    const partial = parseFloat(payment.partial_amount);
    if (payment.partial_amount && partial > 0 && partial < totalDue) body.amount = partial;
    if (payment.method === 'split') {
      const cash = parseFloat(payment.split_cash) || 0;
      const online = parseFloat(payment.split_online) || 0;
      body.split_payments = { cash, online };
      if (!body.amount && cash + online < totalDue) body.amount = cash + online;
    }
    return body;
  };

  const validatePayment = () => {
    if (!hasFee) return true;
    if (payment.partial_amount) {
      const partial = parseFloat(payment.partial_amount);
      if (!(partial > 0)) { Alert.alert('Invalid amount', 'Enter a positive amount, or leave it blank to collect the full fee.'); return false; }
      if (partial > totalDue) { Alert.alert('Invalid amount', `Amount can't be more than ${rupees(totalDue)}.`); return false; }
    }
    if (payment.method === 'split') {
      const cash = parseFloat(payment.split_cash) || 0;
      const online = parseFloat(payment.split_online) || 0;
      if (cash <= 0 && online <= 0) { Alert.alert('Split payment', 'Enter at least one split amount.'); return false; }
    }
    return true;
  };

  const completeAdmission = async () => {
    if (!validatePayment()) return;
    setLoading(true);
    try {
      const res = await client.post(`/onboarding/${onbId}/complete`, { admin_override: false });
      const admission = res.data;
      let receiptNumber = null;
      let paymentId = null;
      let paymentError = null;
      if (admission.admission_time_fee > 0 || hasFee) {
        try {
          const pay = await client.post('/fees/admission-payment', buildPaymentPayload(admission.student_id));
          receiptNumber = pay.data.receipt_number;
          paymentId = pay.data.payment?.payment_id || pay.data.payment_id;
        } catch (err) {
          // Admission succeeded; only the payment failed. Same handling as the web.
          paymentError = errorText(err, 'Payment recording failed.');
        }
      }
      setResult({ ...admission, receipt_number: receiptNumber, payment_id: paymentId, payment_error: paymentError });
      goTo(5);
    } catch (err) {
      Alert.alert('Admission failed', errorText(err, 'Failed to complete admission.'));
    } finally {
      setLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const sections = sectionsFor(classes, classData.class_name);
  const uploadedCount = Object.keys(docs).length;
  const methodNeedsRef = payment.method !== 'cash' && payment.method !== 'split';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} style={s.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <StepBar step={step} />

        {step === 1 && (
          <>
            <FormCard title="Student Details">
              <Field label="FIRST NAME" required error={errors.first_name}>
                <Input value={details.first_name} onChangeText={v => setD('first_name', v)} placeholder="First name" error={errors.first_name} />
              </Field>
              <Field label="LAST NAME" required error={errors.last_name}>
                <Input value={details.last_name} onChangeText={v => setD('last_name', v)} placeholder="Last name" error={errors.last_name} />
              </Field>
              <Field label="GENDER" required error={errors.gender}>
                <Chips options={['male', 'female', 'other']} value={details.gender} onChange={v => setD('gender', v)} />
              </Field>
              <Field label="DATE OF BIRTH" required error={errors.date_of_birth} hint="Also the student's first login password">
                <Input value={details.date_of_birth} onChangeText={v => setD('date_of_birth', v)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" error={errors.date_of_birth} />
              </Field>
              <Field label="PHONE" required error={errors.phone}>
                <Input value={details.phone} onChangeText={v => setD('phone', v)} placeholder="10-digit mobile number" keyboardType="phone-pad" maxLength={10} error={errors.phone} />
              </Field>
              <Field label="EMAIL" error={errors.email}>
                <Input value={details.email} onChangeText={v => setD('email', v)} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" error={errors.email} />
              </Field>
              <Field label="ADDRESS" required error={errors.address}>
                <Input value={details.address} onChangeText={v => setD('address', v)} placeholder="Full address" multiline error={errors.address} />
              </Field>
            </FormCard>

            <FormCard title="Father / Guardian (optional)">
              <Field label="NAME"><Input value={details.parent_name} onChangeText={v => setD('parent_name', v)} placeholder="Father or guardian name" /></Field>
              <Field label="PHONE" error={errors.parent_phone}>
                <Input value={details.parent_phone} onChangeText={v => setD('parent_phone', v)} placeholder="10-digit number" keyboardType="phone-pad" maxLength={10} error={errors.parent_phone} />
              </Field>
              <Field label="EMAIL" error={errors.parent_email} hint="A parent login is created for this email">
                <Input value={details.parent_email} onChangeText={v => setD('parent_email', v)} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" error={errors.parent_email} />
              </Field>
            </FormCard>

            <FormCard title="Mother (optional)">
              <Field label="NAME"><Input value={details.mother_name} onChangeText={v => setD('mother_name', v)} placeholder="Mother's name" /></Field>
              <Field label="PHONE" error={errors.mother_phone}>
                <Input value={details.mother_phone} onChangeText={v => setD('mother_phone', v)} placeholder="10-digit number" keyboardType="phone-pad" maxLength={10} error={errors.mother_phone} />
              </Field>
              <Field label="EMAIL" error={errors.mother_email}>
                <Input value={details.mother_email} onChangeText={v => setD('mother_email', v)} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" error={errors.mother_email} />
              </Field>
            </FormCard>

            <FormCard>
              <View style={s.switchRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={s.switchTitle}>Sibling already studying here</Text>
                  <Text style={s.switchSub}>Applies the sibling discount on the admission fee</Text>
                </View>
                <Switch
                  value={details.is_sibling}
                  onValueChange={v => setD('is_sibling', v)}
                  trackColor={{ true: COLORS.primary, false: COLORS.border }}
                  thumbColor={COLORS.white}
                />
              </View>
            </FormCard>

            <PrimaryButton title="Continue" icon="arrow-forward" onPress={submitDetails} loading={loading} />
          </>
        )}

        {step === 2 && (
          <>
            <FormCard title="Class Placement">
              <Text style={s.note}>{details.first_name} {details.last_name}</Text>
              <Field label="CLASS" required>
                <Chips options={classes.map(c => c.name)} value={classData.class_name} onChange={v => setClassData({ class_name: v, section: '' })} />
              </Field>
              {!!classData.class_name && (
                <Field label="SECTION" required>
                  {sections.length
                    ? <Chips options={sections} value={classData.section} onChange={v => setClassData(c => ({ ...c, section: v }))} />
                    : <Text style={s.note}>No sections set up for this class.</Text>}
                </Field>
              )}
            </FormCard>
            <PrimaryButton title="Show Fees & Continue" icon="arrow-forward" onPress={submitClass} loading={loading} />
            <Text style={s.footNote}>Student details are saved. To change them, start over.</Text>
            <SecondaryButton title="Start Over" icon="refresh" onPress={() => Alert.alert('Start over?', 'The details entered so far will be discarded.', [
              { text: 'Cancel', style: 'cancel' }, { text: 'Start Over', style: 'destructive', onPress: startOver },
            ])} style={{ marginTop: 10 }} />
          </>
        )}

        {step === 3 && (
          <>
            <FormCard title="Documents">
              <Text style={[s.note, { marginBottom: 8 }]}>All documents are optional. Upload PDFs; the passport photo must be JPG or PNG. Max 5 MB each.</Text>
              {DOCUMENTS.map(doc => {
                const up = docs[doc.type];
                const busy = docBusy[doc.type];
                return (
                  <View key={doc.type} style={s.docRow}>
                    <Ionicons
                      name={up ? 'checkmark-circle' : (doc.type === 'passport_photo' ? 'image-outline' : 'document-text-outline')}
                      size={22}
                      color={up ? COLORS.success : COLORS.lightMuted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={s.docName}>{doc.name}</Text>
                      <Text style={s.docSub} numberOfLines={1}>{up ? up.file_name : (doc.type === 'passport_photo' ? 'JPG or PNG' : 'PDF')}</Text>
                    </View>
                    <TouchableOpacity style={s.docBtn} onPress={() => uploadDoc(doc)} disabled={busy}>
                      {busy
                        ? <ActivityIndicator size="small" color={COLORS.primary} />
                        : <Text style={s.docBtnText}>{up ? 'Replace' : 'Upload'}</Text>}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </FormCard>
            <PrimaryButton title={uploadedCount ? 'Continue' : 'Skip Documents'} icon="arrow-forward" onPress={() => goTo(4)} />
            <SecondaryButton title="Back" icon="arrow-back" onPress={() => goTo(2)} style={{ marginTop: 10 }} />
          </>
        )}

        {step === 4 && (
          <>
            <FormCard title="Fee Preview">
              <Text style={s.note}>{details.first_name} {details.last_name} · Class {classData.class_name} - {classData.section}</Text>
              {(feeData?.fee_breakdown || []).map((f, i) => (
                <View key={`${f.fee_component}-${i}`} style={s.feeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.feeLabel}>{f.label}</Text>
                    {Number(f.discount_amount) > 0 && <Text style={s.feeDiscount}>Discount −{rupees(f.discount_amount)}</Text>}
                  </View>
                  <Text style={s.feeAmount}>{rupees(f.net_amount)}</Text>
                </View>
              ))}
              <View style={[s.feeRow, s.feeTotalRow]}>
                <Text style={s.feeTotalLabel}>Due at admission</Text>
                <Text style={s.feeTotal}>{rupees(totalDue)}</Text>
              </View>
              {!!feeData?.total_annual_fee && (
                <Text style={[s.note, { marginTop: 6 }]}>Total annual fee: {rupees(feeData.total_annual_fee)}</Text>
              )}
            </FormCard>

            {hasFee && (
              <FormCard title="Collect Payment">
                <Field label="PAYMENT METHOD" required>
                  <Chips options={methods} value={payment.method} onChange={v => setP('method', v)} capitalize={false} />
                </Field>
                {payment.method === 'split' ? (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Field label="CASH"><Input value={payment.split_cash} onChangeText={v => setP('split_cash', v)} placeholder="0" keyboardType="decimal-pad" /></Field>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label="ONLINE"><Input value={payment.split_online} onChangeText={v => setP('split_online', v)} placeholder="0" keyboardType="decimal-pad" /></Field>
                    </View>
                  </View>
                ) : (
                  <Field label="AMOUNT" hint={`Leave blank to collect the full ${rupees(totalDue)}`}>
                    <Input value={payment.partial_amount} onChangeText={v => setP('partial_amount', v)} placeholder={String(totalDue)} keyboardType="decimal-pad" />
                  </Field>
                )}
                {methodNeedsRef && (
                  <Field label="TRANSACTION / CHEQUE REFERENCE">
                    <Input value={payment.transaction_id} onChangeText={v => setP('transaction_id', v)} placeholder="Optional" autoCapitalize="characters" />
                  </Field>
                )}
                <Field label="REMARKS">
                  <Input value={payment.remarks} onChangeText={v => setP('remarks', v)} placeholder="Collected at admission" />
                </Field>
              </FormCard>
            )}

            <PrimaryButton
              title={hasFee ? 'Confirm Admission & Collect' : 'Confirm Admission'}
              icon="checkmark-circle"
              onPress={() => Alert.alert(
                'Confirm admission',
                `Admit ${details.first_name} ${details.last_name} to Class ${classData.class_name} - ${classData.section}?`,
                [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: completeAdmission }],
              )}
              loading={loading}
            />
            <SecondaryButton title="Back" icon="arrow-back" onPress={() => goTo(3)} disabled={loading} style={{ marginTop: 10 }} />
          </>
        )}

        {step === 5 && result && (
          <>
            <View style={s.successHero}>
              <Ionicons name="checkmark-circle" size={52} color={COLORS.success} />
              <Text style={s.successTitle}>Student admitted</Text>
              <Text style={s.successSub}>{details.first_name} {details.last_name} · Class {classData.class_name} - {classData.section}</Text>
              <Text style={s.admNo} selectable>{result.admission_number}</Text>
            </View>

            {!!result.payment_error && (
              <View style={s.warnBox}>
                <Ionicons name="warning-outline" size={18} color={COLORS.warning} />
                <Text style={s.warnText}>Admission done, but the payment was not recorded: {result.payment_error} Collect it from the Fees tab.</Text>
              </View>
            )}

            {(result.student_account || result.parent_account) && (
              <FormCard title="Login Details">
                <Text style={[s.note, { marginBottom: 8 }]}>Share these with the family. They are shown only once.</Text>
                {!!result.student_account && (
                  <View style={s.credBox}>
                    <Text style={s.credRole}>STUDENT</Text>
                    <Text style={s.credLine} selectable>Login: {result.admission_number || result.student_account.email}</Text>
                    <Text style={s.credLine} selectable>Password: {result.student_account.temp_password}</Text>
                  </View>
                )}
                {!!result.parent_account && (
                  <View style={s.credBox}>
                    <Text style={s.credRole}>PARENT</Text>
                    <Text style={s.credLine} selectable>Email: {result.parent_account.email}</Text>
                    <Text style={s.credLine} selectable>Password: {result.parent_account.temp_password}</Text>
                  </View>
                )}
              </FormCard>
            )}

            {!!result.payment_id && (
              <PrimaryButton
                title={`View Receipt${result.receipt_number ? ` · ${result.receipt_number}` : ''}`}
                icon="receipt-outline"
                onPress={() => navigation.navigate('Receipt', { paymentId: result.payment_id })}
                style={{ marginBottom: 10 }}
              />
            )}
            <SecondaryButton title="Admit Another Student" icon="person-add-outline" onPress={startOver} style={{ marginBottom: 10 }} />
            <SecondaryButton title="Done" onPress={() => navigation.goBack()} />
            <Text style={s.footNote}>The student shows in this app's list once app access is turned on.</Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 12 },
  stepBar: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, paddingHorizontal: 2 },
  stepItem: { alignItems: 'center', flex: 1 },
  stepDot: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  stepDotActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  stepDotDone: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  stepNum: { fontSize: 11, fontWeight: '700', color: COLORS.muted },
  stepLabel: { fontSize: 10, fontWeight: '600', color: COLORS.lightMuted },
  note: { fontSize: 12, color: COLORS.muted, marginBottom: 12 },
  footNote: { fontSize: 11, color: COLORS.muted, textAlign: 'center', marginTop: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  switchTitle: { fontSize: 14, fontWeight: '700', color: COLORS.black },
  switchSub: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  docName: { fontSize: 13, fontWeight: '600', color: COLORS.black },
  docSub: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  docBtn: { minWidth: 76, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.primary, alignItems: 'center' },
  docBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  feeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  feeLabel: { fontSize: 13, color: COLORS.black, fontWeight: '600' },
  feeDiscount: { fontSize: 11, color: COLORS.success, marginTop: 1 },
  feeAmount: { fontSize: 13, fontWeight: '700', color: COLORS.black },
  feeTotalRow: { borderBottomWidth: 0, marginTop: 4 },
  feeTotalLabel: { flex: 1, fontSize: 14, fontWeight: '800', color: COLORS.black },
  feeTotal: { fontSize: 16, fontWeight: '800', color: COLORS.primary },
  successHero: { alignItems: 'center', backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 20, marginBottom: 14, borderWidth: 1, borderColor: COLORS.border },
  successTitle: { fontSize: 18, fontWeight: '800', color: COLORS.black, marginTop: 8 },
  successSub: { fontSize: 12, color: COLORS.muted, marginTop: 4, textAlign: 'center' },
  admNo: { fontFamily: 'monospace', fontSize: 15, fontWeight: '700', color: COLORS.black, marginTop: 10 },
  warnBox: { flexDirection: 'row', gap: 8, backgroundColor: '#FFFBEB', borderRadius: RADIUS.md, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#FDE68A' },
  warnText: { flex: 1, fontSize: 12, color: '#92400E' },
  credBox: { backgroundColor: COLORS.lightBg, borderRadius: RADIUS.md, padding: 12, marginBottom: 8 },
  credRole: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: COLORS.muted, marginBottom: 4 },
  credLine: { fontSize: 13, fontFamily: 'monospace', color: COLORS.black },
});

export default NewAdmissionScreen;
