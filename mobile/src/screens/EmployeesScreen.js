import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { Badge, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { useAuth } from '../contexts/AuthContext';

const PAGE_SIZE = 30;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const genEmployeeId = () =>
  `EMP${new Date().getFullYear()}${Array.from({ length: 6 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')}`;

const Field = ({ label, required, children }) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={s.formLabel}>{label}{required ? <Text style={{ color: COLORS.danger }}> *</Text> : null}</Text>
    {children}
  </View>
);

const KV = ({ k, v }) => (
  <View style={s.kvRow}>
    <Text style={s.kvK}>{k}</Text>
    <Text style={s.kvV}>{v || '—'}</Text>
  </View>
);

const OptionPicker = ({ visible, title, options, onSelect, onClose }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity style={s.pickerBackdrop} activeOpacity={1} onPress={onClose}>
      <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
        <Text style={s.pickerTitle}>{title}</Text>
        <ScrollView style={{ maxHeight: 400 }}>
          {options.map(o => (
            <TouchableOpacity key={o.value ?? '__all__'} style={s.pickerRow} onPress={() => { onSelect(o.value); onClose(); }}>
              <Text style={s.pickerRowText}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </TouchableOpacity>
    </TouchableOpacity>
  </Modal>
);

// ─── Add / Edit employee form (mirrors the dashboard dialog) ─────────────────

const EmployeeFormModal = ({ visible, mode, initial, departments, onClose, onSaved }) => {
  const empty = {
    employee_id: '', first_name: '', last_name: '', email: '', phone: '',
    date_of_birth: '', gender: 'male', department: '', designation: '',
    salary: '', address: '', bank_account_number: '', bank_ifsc: '',
    bank_name: '', bank_account_holder: '',
  };
  const [form, setForm] = useState(empty);
  const [deptOpen, setDeptOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPwInput('');
    if (mode === 'edit' && initial) {
      setForm({
        employee_id: initial.employee_id || '',
        first_name: initial.first_name || '',
        last_name: initial.last_name || '',
        email: initial.email || '',
        phone: initial.phone || '',
        date_of_birth: initial.date_of_birth || '',
        gender: initial.gender || 'male',
        department: initial.department || '',
        designation: initial.designation || '',
        salary: String(initial.monthly_salary || initial.salary || ''),
        address: initial.address || '',
        bank_account_number: initial.bank_account_number || '',
        bank_ifsc: initial.bank_ifsc || '',
        bank_name: initial.bank_name || '',
        bank_account_holder: initial.bank_account_holder || '',
      });
    } else {
      setForm({ ...empty, employee_id: genEmployeeId() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode, initial]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    const req = [['first_name', 'First name'], ['last_name', 'Last name'], ['email', 'Email'], ['department', 'Department'], ['designation', 'Designation']];
    for (const [k, label] of req) {
      if (!String(form[k] || '').trim()) { Alert.alert('Missing field', `${label} is required.`); return; }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { Alert.alert('Invalid email', 'Enter a valid email address.'); return; }
    if (form.phone && !/^\d{10}$/.test(form.phone)) { Alert.alert('Invalid phone', 'Phone must be exactly 10 digits.'); return; }
    if (mode === 'add') {
      // The backend requires salary and full bank details on create.
      if (!(parseFloat(form.salary) > 0)) { Alert.alert('Missing field', 'Monthly salary must be greater than 0.'); return; }
      if (!/^\d{8,18}$/.test(form.bank_account_number)) { Alert.alert('Invalid bank account', 'Account number must be 8–18 digits.'); return; }
      if (!IFSC_RE.test(form.bank_ifsc.toUpperCase())) { Alert.alert('Invalid IFSC', 'IFSC must look like SBIN0001234.'); return; }
      if (!form.bank_account_holder.trim()) { Alert.alert('Missing field', 'Account holder name is required.'); return; }
    } else if (form.bank_ifsc && !IFSC_RE.test(form.bank_ifsc.toUpperCase())) {
      Alert.alert('Invalid IFSC', 'IFSC must look like SBIN0001234.'); return;
    }

    const payload = {
      employee_id: form.employee_id.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      gender: form.gender,
      department: form.department,
      designation: form.designation.trim(),
      ...(form.phone ? { phone: form.phone } : {}),
      ...(form.date_of_birth ? { date_of_birth: form.date_of_birth.trim() } : {}),
      ...(form.address.trim() ? { address: form.address.trim() } : {}),
      ...(form.salary ? { salary: parseFloat(form.salary) } : {}),
    };
    if (form.bank_account_number) {
      payload.bank_account_number = form.bank_account_number;
      payload.bank_ifsc = form.bank_ifsc.toUpperCase();
      payload.bank_name = form.bank_name.trim();
      payload.bank_account_holder = form.bank_account_holder.trim();
    }

    setSaving(true);
    try {
      if (mode === 'edit') {
        await client.put(`/employees/${initial.employee_id}`, payload);
        Alert.alert('Saved', 'Employee updated.');
      } else {
        const res = await client.post('/employees', payload);
        const temp = res.data?.linked_account?.temp_password;
        Alert.alert('Employee added', temp
          ? `Login account created.\nEmail: ${res.data.linked_account.email}\nTemp password: ${temp}\n\nShare it with the employee — it won't be shown again.`
          : 'Employee added successfully.');
      }
      onSaved?.();
      onClose();
    } catch (e) {
      const msg = e.response?.data?.detail || (e.response?.status >= 500
        ? 'Server error — the employee may still have been created. Pull to refresh the list before retrying.'
        : 'Could not save employee.');
      Alert.alert('Error', typeof msg === 'string' ? msg : 'Could not save employee.');
    } finally { setSaving(false); }
  };

  const resetPassword = async (generate) => {
    if (!generate && pwInput.length < 6) { Alert.alert('Too short', 'Password must be at least 6 characters.'); return; }
    setPwBusy(true);
    try {
      const res = await client.post(`/employees/${initial.employee_id}/reset-password`, generate ? {} : { password: pwInput });
      Alert.alert('Password reset', `New password: ${res.data.password}\nLogin email: ${res.data.email}\n\nShare it with the employee.`);
      setPwInput('');
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Password reset failed.');
    } finally { setPwBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modalSafe}>
        <View style={s.modalHeader}>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={COLORS.black} /></TouchableOpacity>
          <Text style={s.modalTitle}>{mode === 'edit' ? 'Edit Employee' : 'Add Employee'}</Text>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Field label="EMPLOYEE ID">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[s.formInput, { flex: 1, marginBottom: 0 }]} value={form.employee_id} onChangeText={v => set('employee_id', v)} autoCapitalize="characters" />
              {mode === 'add' && (
                <TouchableOpacity style={s.regenBtn} onPress={() => set('employee_id', genEmployeeId())}>
                  <Ionicons name="refresh" size={18} color={COLORS.black} />
                </TouchableOpacity>
              )}
            </View>
          </Field>
          <Field label="FIRST NAME" required>
            <TextInput style={s.formInput0} value={form.first_name} onChangeText={v => set('first_name', v)} placeholder="First name" placeholderTextColor={COLORS.lightMuted} />
          </Field>
          <Field label="LAST NAME" required>
            <TextInput style={s.formInput0} value={form.last_name} onChangeText={v => set('last_name', v)} placeholder="Last name" placeholderTextColor={COLORS.lightMuted} />
          </Field>
          <Field label="EMAIL" required>
            <TextInput style={s.formInput0} value={form.email} onChangeText={v => set('email', v)} placeholder="name@shemford.edu" placeholderTextColor={COLORS.lightMuted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
          </Field>
          <Field label="PHONE">
            <TextInput style={s.formInput0} value={form.phone} onChangeText={v => set('phone', v.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit number" placeholderTextColor={COLORS.lightMuted} keyboardType="phone-pad" />
          </Field>
          <Field label="DEPARTMENT" required>
            <TouchableOpacity style={[s.formInput0, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]} onPress={() => setDeptOpen(true)}>
              <Text style={{ fontSize: 14, color: form.department ? COLORS.black : COLORS.lightMuted }}>{form.department || 'Choose department'}</Text>
              <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
            </TouchableOpacity>
          </Field>
          <Field label="DESIGNATION" required>
            <TextInput style={s.formInput0} value={form.designation} onChangeText={v => set('designation', v)} placeholder="e.g. TGT Science" placeholderTextColor={COLORS.lightMuted} />
          </Field>
          <Field label="GENDER" required>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {['male', 'female', 'other'].map(g => (
                <TouchableOpacity key={g} style={[s.chip, form.gender === g && s.chipActive]} onPress={() => set('gender', g)}>
                  <Text style={[s.chipText, form.gender === g && s.chipTextActive]}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>
          <Field label="DATE OF BIRTH">
            <TextInput style={s.formInput0} value={form.date_of_birth} onChangeText={v => set('date_of_birth', v)} placeholder="YYYY-MM-DD" placeholderTextColor={COLORS.lightMuted} />
          </Field>
          <Field label={mode === 'add' ? 'MONTHLY SALARY' : 'MONTHLY SALARY'} required={mode === 'add'}>
            <TextInput style={s.formInput0} value={form.salary} onChangeText={v => set('salary', v)} placeholder="e.g. 25000" placeholderTextColor={COLORS.lightMuted} keyboardType="numeric" />
          </Field>
          <Field label="ADDRESS">
            <TextInput style={[s.formInput0, { minHeight: 60 }]} value={form.address} onChangeText={v => set('address', v)} placeholder="Address" placeholderTextColor={COLORS.lightMuted} multiline textAlignVertical="top" />
          </Field>

          <Text style={[s.sectionHead, { marginTop: 6 }]}>Bank Details {mode === 'add' ? '(required)' : ''}</Text>
          <Field label="ACCOUNT NUMBER" required={mode === 'add'}>
            <TextInput style={s.formInput0} value={form.bank_account_number} onChangeText={v => set('bank_account_number', v.replace(/\D/g, '').slice(0, 18))} placeholder="8–18 digits" placeholderTextColor={COLORS.lightMuted} keyboardType="numeric" />
          </Field>
          <Field label="IFSC" required={mode === 'add'}>
            <TextInput style={s.formInput0} value={form.bank_ifsc} onChangeText={v => set('bank_ifsc', v.toUpperCase().slice(0, 11))} placeholder="e.g. SBIN0001234" placeholderTextColor={COLORS.lightMuted} autoCapitalize="characters" />
          </Field>
          <Field label="BANK NAME">
            <TextInput style={s.formInput0} value={form.bank_name} onChangeText={v => set('bank_name', v)} placeholder="Bank name" placeholderTextColor={COLORS.lightMuted} />
          </Field>
          <Field label="ACCOUNT HOLDER" required={mode === 'add'}>
            <TextInput style={s.formInput0} value={form.bank_account_holder} onChangeText={v => set('bank_account_holder', v)} placeholder="Name on the account" placeholderTextColor={COLORS.lightMuted} />
          </Field>

          {mode === 'edit' && (
            <>
              <Text style={s.sectionHead}>Password Management</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <TextInput
                  style={[s.formInput, { flex: 1, marginBottom: 0 }]}
                  value={pwInput}
                  onChangeText={setPwInput}
                  placeholder="New password (min 6 chars)"
                  placeholderTextColor={COLORS.lightMuted}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={s.pwBtn} onPress={() => resetPassword(false)} disabled={pwBusy}>
                  {pwBusy ? <ActivityIndicator size="small" color={COLORS.white} /> : <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.white }}>Set</Text>}
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={s.outlineBtn} onPress={() => resetPassword(true)} disabled={pwBusy}>
                <Text style={s.outlineBtnText}>Generate (uses Employee ID)</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={[s.saveBtn, { marginTop: 20 }]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="checkmark" size={16} color={COLORS.white} />}
            <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.white }}>{mode === 'edit' ? 'Save Changes' : 'Add Employee'}</Text>
          </TouchableOpacity>
        </ScrollView>

        <OptionPicker
          visible={deptOpen}
          title="Department"
          options={departments.map(d => ({ value: d, label: d }))}
          onSelect={v => set('department', v)}
          onClose={() => setDeptOpen(false)}
        />
      </SafeAreaView>
    </Modal>
  );
};

// ─── Read-only employee details ──────────────────────────────────────────────

const EmployeeViewModal = ({ emp, onClose, onLinked }) => {
  const [linking, setLinking] = useState(false);

  const linkAccount = async () => {
    setLinking(true);
    try {
      const res = await client.post(`/employees/${emp.employee_id}/link-user`);
      Alert.alert('User Account Created',
        `Email: ${res.data.email}${res.data.temp_password ? `\nTemp password: ${res.data.temp_password}\n\nShare it with the employee — it won't be shown again.` : ''}`);
      onLinked?.();
      onClose();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Could not link account.');
    } finally { setLinking(false); }
  };

  return (
    <Modal visible={!!emp} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modalSafe}>
        <View style={s.modalHeader}>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={COLORS.black} /></TouchableOpacity>
          <Text style={s.modalTitle}>Employee Details</Text>
          <View style={{ width: 36 }} />
        </View>
        {emp && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <View style={s.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Text style={{ fontSize: 17, fontWeight: '800', color: COLORS.black }}>{emp.first_name} {emp.last_name}</Text>
                <Badge text={emp.is_active ? 'Active' : 'Inactive'} variant={emp.is_active ? 'dark' : 'orange'} />
              </View>
              <KV k="Employee ID" v={emp.employee_id} />
              <KV k="Department" v={emp.department} />
              <KV k="Designation" v={emp.designation} />
              <KV k="Email" v={emp.email} />
              <KV k="Phone" v={emp.phone} />
              <KV k="Joining Date" v={emp.joining_date} />
              <KV k="Monthly Salary" v={emp.monthly_salary || emp.salary ? `Rs. ${Number(emp.monthly_salary || emp.salary).toLocaleString('en-IN')}` : null} />
            </View>

            <View style={s.card}>
              <Text style={s.sectionHead}>User Account</Text>
              {emp.user_id ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Badge text="Linked" variant="dark" />
                  <Text style={{ fontSize: 11, color: COLORS.muted }}>{emp.user_id}</Text>
                </View>
              ) : (
                <TouchableOpacity style={s.saveBtn} onPress={linkAccount} disabled={linking}>
                  {linking ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="link" size={16} color={COLORS.white} />}
                  <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.white }}>Link Account</Text>
                </TouchableOpacity>
              )}
            </View>

            {(emp.bank_account_number || emp.bank_ifsc || emp.bank_name || emp.bank_account_holder) && (
              <View style={s.card}>
                <Text style={s.sectionHead}>Bank Account Details</Text>
                <KV k="Account Number" v={emp.bank_account_number} />
                <KV k="IFSC" v={emp.bank_ifsc} />
                <KV k="Bank" v={emp.bank_name} />
                <KV k="Account Holder" v={emp.bank_account_holder} />
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
};

// ─── Main screen ─────────────────────────────────────────────────────────────

const EmployeesScreen = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState(null);
  const [statusActive, setStatusActive] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [picker, setPicker] = useState(null); // 'dept' | 'status'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [form, setForm] = useState(null);     // {mode, initial}
  const [viewEmp, setViewEmp] = useState(null);

  const fetchPage = useCallback((p, append) => {
    const params = { is_active: statusActive, page: p, limit: PAGE_SIZE };
    if (dept) params.department = dept;
    return client.get('/employees', { params }).then(r => {
      const list = Array.isArray(r.data) ? r.data : [];
      setEmployees(prev => (append ? [...prev, ...list] : list));
      setTotalPages(parseInt(r.headers['x-total-pages'] || '1', 10) || 1);
      setTotalCount(parseInt(r.headers['x-total-count'] || String(list.length), 10) || list.length);
      setPage(p);
    });
  }, [dept, statusActive]);

  const reload = useCallback(() => fetchPage(1, false).catch(() => {}), [fetchPage]);

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => {
    client.get('/departments')
      .then(r => setDepartments(Array.isArray(r.data) ? r.data : []))
      .catch(() => setDepartments([]));
  }, []);

  const onRefresh = () => { setRefreshing(true); reload().finally(() => setRefreshing(false)); };
  const loadMore = () => {
    if (page >= totalPages || loadingMore) return;
    setLoadingMore(true);
    fetchPage(page + 1, true).catch(() => {}).finally(() => setLoadingMore(false));
  };

  const deactivate = (emp) => {
    Alert.alert(
      'Deactivate employee?',
      `${emp.first_name} ${emp.last_name}'s user account will be revoked. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate', style: 'destructive',
          onPress: async () => {
            try {
              await client.put(`/employees/${emp.employee_id}`, { is_active: false });
              reload();
            } catch (e) {
              Alert.alert('Error', e.response?.data?.detail || 'Deactivation failed.');
            }
          },
        },
      ]
    );
  };

  const filtered = employees.filter(e =>
    `${e.first_name} ${e.last_name} ${e.employee_id}`.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <SafeAreaView style={s.safe}><ScreenLoader /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        <View style={[s.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }]}>
          <View>
            <Text style={s.h1}>Employees</Text>
            <Text style={s.sub}>Showing {filtered.length} of {totalCount} employees</Text>
          </View>
          {isAdmin && (
            <TouchableOpacity style={s.addBtn} onPress={() => setForm({ mode: 'add' })}>
              <Ionicons name="add" size={15} color={COLORS.white} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.white }}>Add Employee</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={s.noticeBox}>
          <Ionicons name="warning-outline" size={15} color={COLORS.warning} />
          <Text style={s.noticeText}>Employees cannot be deleted. They can only be deactivated for record keeping.</Text>
        </View>

        <View style={s.searchWrap}>
          <Ionicons name="search" size={16} color={COLORS.muted} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search by name or employee ID..."
            placeholderTextColor={COLORS.lightMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          <TouchableOpacity style={[s.filterChip, dept && s.filterChipActive]} onPress={() => setPicker('dept')}>
            <Ionicons name="funnel-outline" size={13} color={dept ? COLORS.white : COLORS.muted} />
            <Text style={[s.filterChipText, dept && s.filterChipTextActive]}>{dept || 'All Departments'}</Text>
            <Ionicons name="chevron-down" size={13} color={dept ? COLORS.white : COLORS.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.filterChip, !statusActive && s.filterChipActive]} onPress={() => setPicker('status')}>
            <Text style={[s.filterChipText, !statusActive && s.filterChipTextActive]}>{statusActive ? 'Active' : 'Inactive'}</Text>
            <Ionicons name="chevron-down" size={13} color={!statusActive ? COLORS.white : COLORS.muted} />
          </TouchableOpacity>
        </View>

        <View style={s.list}>
          {filtered.map(e => (
            <View key={e.employee_id} style={s.empRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', fontSize: 14, color: COLORS.black }}>{e.first_name} {e.last_name}</Text>
                <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>{e.employee_id} · {e.department} · {e.designation}</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                  <Badge text={e.is_active ? 'Active' : 'Inactive'} variant={e.is_active ? 'dark' : 'orange'} />
                  <Badge text={e.user_id ? 'Linked' : 'No account'} variant={e.user_id ? 'muted' : 'orange'} />
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 8 }}>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity onPress={() => setViewEmp(e)}>
                    <Ionicons name="eye-outline" size={20} color={COLORS.muted} />
                  </TouchableOpacity>
                  {isAdmin && (
                    <TouchableOpacity onPress={() => setForm({ mode: 'edit', initial: e })}>
                      <Ionicons name="create-outline" size={20} color={COLORS.muted} />
                    </TouchableOpacity>
                  )}
                </View>
                {isAdmin && e.is_active && (
                  <TouchableOpacity onPress={() => deactivate(e)}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.danger }}>Deactivate</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
          {filtered.length === 0 && <EmptyState icon={<Ionicons name="people-outline" size={48} color="#DDD" />} text="No employees found" />}
        </View>

        {page < totalPages && (
          <TouchableOpacity style={s.outlineBtn} onPress={loadMore} disabled={loadingMore}>
            {loadingMore ? <ActivityIndicator color={COLORS.black} /> : <Text style={s.outlineBtnText}>Load more</Text>}
          </TouchableOpacity>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>

      <OptionPicker
        visible={picker === 'dept'}
        title="Department"
        options={[{ value: null, label: 'All Departments' }, ...departments.map(d => ({ value: d, label: d }))]}
        onSelect={setDept}
        onClose={() => setPicker(null)}
      />
      <OptionPicker
        visible={picker === 'status'}
        title="Status"
        options={[{ value: true, label: 'Active' }, { value: false, label: 'Inactive' }]}
        onSelect={setStatusActive}
        onClose={() => setPicker(null)}
      />

      <EmployeeFormModal
        visible={!!form}
        mode={form?.mode}
        initial={form?.initial}
        departments={departments}
        onClose={() => setForm(null)}
        onSaved={reload}
      />
      <EmployeeViewModal emp={viewEmp} onClose={() => setViewEmp(null)} onLinked={reload} />
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 12 },
  h1: { fontSize: 22, fontWeight: '800', color: COLORS.black, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingHorizontal: 12, paddingVertical: 9, ...SHADOW.sm },
  noticeBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, padding: 12, marginBottom: 12 },
  noticeText: { flex: 1, fontSize: 11, color: COLORS.muted },
  searchWrap: { position: 'relative', marginBottom: 12 },
  searchIcon: { position: 'absolute', left: 14, top: 14, zIndex: 1 },
  searchInput: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, paddingLeft: 38, paddingRight: 16, paddingVertical: 12, fontSize: 14, color: COLORS.black, borderWidth: 1.5, borderColor: COLORS.border, ...SHADOW.sm },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  filterChipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  filterChipText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  filterChipTextActive: { color: COLORS.white },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 12, ...SHADOW.sm },
  empRow: { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg, gap: 10 },
  card: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  sectionHead: { fontSize: 13, fontWeight: '800', color: COLORS.black, marginBottom: 10, marginTop: 4 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  kvK: { fontSize: 12, color: COLORS.muted },
  kvV: { fontSize: 13, fontWeight: '600', color: COLORS.black, flexShrink: 1, textAlign: 'right' },
  modalSafe: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.white },
  modalTitle: { ...FONTS.h2, flex: 1, textAlign: 'center', fontSize: 16 },
  formLabel: { ...FONTS.small, marginBottom: 6 },
  formInput: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: COLORS.black, backgroundColor: COLORS.white, marginBottom: 14 },
  formInput0: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: COLORS.black, backgroundColor: COLORS.white },
  regenBtn: { width: 46, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  chipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  chipText: { fontSize: 12, fontWeight: '600', color: COLORS.muted, textTransform: 'capitalize' },
  chipTextActive: { color: COLORS.white },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...SHADOW.sm },
  outlineBtn: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.lg, paddingVertical: 12, alignItems: 'center', backgroundColor: COLORS.white, marginBottom: 8 },
  outlineBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.black },
  pwBtn: { backgroundColor: COLORS.black, borderRadius: RADIUS.md, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'center', padding: 28 },
  pickerCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 12, ...SHADOW.md },
  pickerTitle: { fontSize: 13, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 8 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderRadius: RADIUS.md },
  pickerRowText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
});

export default EmployeesScreen;
