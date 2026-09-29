import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { COLORS, RADIUS, SHADOW, FONTS } from '../theme/colors';
import { Avatar, Badge, EmptyState } from '../components/UI';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { useAuth } from '../contexts/AuthContext';

const PAGE_SIZE = 30;
const ROLES = ['admin', 'teacher', 'student', 'parent', 'accountant'];
const roleVariant = (r) => (r === 'admin' ? 'orange' : r === 'teacher' ? 'dark' : 'muted');
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const OptionPicker = ({ visible, title, options, onSelect, onClose }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity style={s.pickerBackdrop} activeOpacity={1} onPress={onClose}>
      <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
        <Text style={s.pickerTitle}>{title}</Text>
        <ScrollView style={{ maxHeight: 400 }}>
          {options.map(o => (
            <TouchableOpacity key={String(o.value)} style={s.pickerRow} onPress={() => { onSelect(o.value); onClose(); }}>
              <Text style={[s.pickerRowText, o.capitalize !== false && { textTransform: 'capitalize' }]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </TouchableOpacity>
    </TouchableOpacity>
  </Modal>
);

// ─── Create User (mirrors the dashboard dialog) ──────────────────────────────

const CreateUserModal = ({ visible, onClose, onSaved }) => {
  const [form, setForm] = useState({ name: '', email: '', role: 'teacher', phone: '', password: '' });
  const [roleOpen, setRoleOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setForm({ name: '', email: '', role: 'teacher', phone: '', password: '' });
  }, [visible]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { Alert.alert('Missing field', 'Full name is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { Alert.alert('Invalid email', 'Enter a valid email address.'); return; }
    if (form.phone && !/^\d{10}$/.test(form.phone)) { Alert.alert('Invalid phone', 'Phone must be exactly 10 digits.'); return; }
    if (form.password.length < 8) { Alert.alert('Weak password', 'Password must be at least 8 characters.'); return; }
    setSaving(true);
    try {
      await client.post('/auth/create-user', {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        password: form.password,
        ...(form.phone ? { phone: form.phone } : {}),
      });
      Alert.alert('User created', `${form.name.trim()} can now log in with ${form.email.trim()}.`);
      onSaved?.();
      onClose();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Could not create user.');
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modalSafe}>
        <View style={s.modalHeader}>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={COLORS.black} /></TouchableOpacity>
          <Text style={s.modalTitle}>Create User</Text>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={s.formLabel}>FULL NAME *</Text>
          <TextInput style={s.formInput} value={form.name} onChangeText={v => set('name', v)} placeholder="Full name" placeholderTextColor={COLORS.lightMuted} />
          <Text style={s.formLabel}>EMAIL *</Text>
          <TextInput style={s.formInput} value={form.email} onChangeText={v => set('email', v)} placeholder="name@example.com" placeholderTextColor={COLORS.lightMuted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
          <Text style={s.formLabel}>ROLE *</Text>
          <TouchableOpacity style={[s.formInput, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]} onPress={() => setRoleOpen(true)}>
            <Text style={{ fontSize: 14, color: COLORS.black, textTransform: 'capitalize' }}>{form.role}</Text>
            <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
          </TouchableOpacity>
          <Text style={s.formLabel}>PHONE</Text>
          <TextInput style={s.formInput} value={form.phone} onChangeText={v => set('phone', v.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit number (optional)" placeholderTextColor={COLORS.lightMuted} keyboardType="phone-pad" />
          <Text style={s.formLabel}>PASSWORD *</Text>
          <TextInput style={s.formInput} value={form.password} onChangeText={v => set('password', v)} placeholder="Min 8 characters" placeholderTextColor={COLORS.lightMuted} autoCapitalize="none" secureTextEntry />

          <TouchableOpacity style={[s.saveBtn, { marginTop: 12 }]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="person-add" size={16} color={COLORS.white} />}
            <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.white }}>Create User</Text>
          </TouchableOpacity>
        </ScrollView>
        <OptionPicker
          visible={roleOpen}
          title="Role"
          options={ROLES.map(r => ({ value: r, label: r }))}
          onSelect={v => set('role', v)}
          onClose={() => setRoleOpen(false)}
        />
      </SafeAreaView>
    </Modal>
  );
};

// ─── Reset password sheet ─────────────────────────────────────────────────────

const PasswordModal = ({ target, onClose }) => {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => { if (target) { setPw(''); setResult(null); } }, [target]);

  const reset = async (generate) => {
    if (!generate && pw.length < 6) { Alert.alert('Too short', 'Password must be at least 6 characters.'); return; }
    setBusy(true);
    try {
      const res = await client.post(`/users/${target.user_id}/reset-password`, generate ? {} : { password: pw });
      setResult(res.data);
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Password reset failed.');
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={s.pickerBackdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
          <Text style={s.pickerTitle}>Set password — {target?.name}</Text>
          {result ? (
            <View style={{ padding: 8 }}>
              <Text style={{ fontSize: 12, color: COLORS.muted, marginBottom: 6 }}>New password:</Text>
              <Text selectable style={s.codeBox}>{result.password}</Text>
              <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 8 }}>
                Login: {result.email}. Share it securely — it won't be shown again. The user must sign in again.
              </Text>
              <TouchableOpacity style={[s.saveBtn, { marginTop: 14 }]} onPress={onClose}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.white }}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ padding: 8 }}>
              <TextInput
                style={s.formInput}
                value={pw}
                onChangeText={setPw}
                placeholder="Min 6 chars — leave blank to auto-generate"
                placeholderTextColor={COLORS.lightMuted}
                autoCapitalize="none"
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={[s.outlineBtn, { flex: 1, marginBottom: 0 }]} onPress={() => reset(true)} disabled={busy}>
                  {busy ? <ActivityIndicator color={COLORS.black} /> : <Text style={s.outlineBtnText}>Generate</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[s.saveBtn, { flex: 1 }]} onPress={() => reset(false)} disabled={busy || pw.length < 6}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.white }}>Set Password</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

// ─── Main screen ─────────────────────────────────────────────────────────────

const UsersScreen = () => {
  const { user: me } = useAuth();

  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [role, setRole] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [picker, setPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pwTarget, setPwTarget] = useState(null);
  const [roleTarget, setRoleTarget] = useState(null);
  const debRef = useRef(null);

  // Mirror the dashboard's 350ms debounced server-side search.
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => setDebounced(search.trim()), 350);
    return () => debRef.current && clearTimeout(debRef.current);
  }, [search]);

  const fetchPage = useCallback((p, append) => {
    const params = { page: p, limit: PAGE_SIZE };
    if (role) params.role = role;
    if (debounced) params.search = debounced;
    return client.get('/users', { params }).then(r => {
      const list = Array.isArray(r.data) ? r.data : [];
      setUsers(prev => {
        if (!append) return list;
        const seen = new Set(prev.map(u => u.user_id));
        return [...prev, ...list.filter(u => !seen.has(u.user_id))];
      });
      setTotalPages(parseInt(r.headers['x-total-pages'] || '1', 10) || 1);
      setTotalCount(parseInt(r.headers['x-total-count'] || String(list.length), 10) || list.length);
      setPage(p);
    });
  }, [role, debounced]);

  const reload = useCallback(() => fetchPage(1, false).catch(() => {}), [fetchPage]);

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [reload]);

  const onRefresh = () => { setRefreshing(true); reload().finally(() => setRefreshing(false)); };
  const loadMore = () => {
    if (page >= totalPages || loadingMore) return;
    setLoadingMore(true);
    fetchPage(page + 1, true).catch(() => {}).finally(() => setLoadingMore(false));
  };

  const toggleActive = (u) => {
    const deactivating = u.is_active;
    const doIt = async () => {
      setTogglingId(u.user_id);
      try {
        await client.put(`/users/${u.user_id}`, { is_active: !u.is_active });
        setUsers(prev => prev.map(x => (x.user_id === u.user_id ? { ...x, is_active: !u.is_active } : x)));
      } catch (e) {
        Alert.alert('Error', e.response?.data?.detail || 'Update failed.');
      } finally { setTogglingId(null); }
    };
    if (deactivating) {
      // The dashboard has no confirm here; a stray tap on a phone is easier, so ask.
      Alert.alert('Deactivate user?', `${u.name} will no longer be able to log in.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Deactivate', style: 'destructive', onPress: doIt },
      ]);
    } else {
      doIt();
    }
  };

  const changeRole = async (u, newRole) => {
    if (newRole === u.role) return;
    try {
      await client.put(`/users/${u.user_id}/role`, { role: newRole });
      setUsers(prev => prev.map(x => (x.user_id === u.user_id ? { ...x, role: newRole } : x)));
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Role update failed.');
    }
  };

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
            <Text style={s.h1}>User Management</Text>
            <Text style={s.sub}>Showing {users.length} of {totalCount} users</Text>
          </View>
          <TouchableOpacity style={s.addBtn} onPress={() => setCreateOpen(true)}>
            <Ionicons name="person-add" size={14} color={COLORS.white} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.white }}>Create User</Text>
          </TouchableOpacity>
        </View>

        <View style={s.searchWrap}>
          <Ionicons name="search" size={16} color={COLORS.muted} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search by name or email..."
            placeholderTextColor={COLORS.lightMuted}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
        </View>

        <View style={{ flexDirection: 'row', marginBottom: 16 }}>
          <TouchableOpacity style={[s.filterChip, role && s.filterChipActive]} onPress={() => setPicker(true)}>
            <Ionicons name="shield-outline" size={13} color={role ? COLORS.white : COLORS.muted} />
            <Text style={[s.filterChipText, role && s.filterChipTextActive, { textTransform: role ? 'capitalize' : 'none' }]}>{role || 'All Roles'}</Text>
            <Ionicons name="chevron-down" size={13} color={role ? COLORS.white : COLORS.muted} />
          </TouchableOpacity>
        </View>

        <View style={s.list}>
          {users.map(u => {
            const isSelf = u.user_id === me?.user_id;
            return (
              <View key={u.user_id} style={s.userRow}>
                <Avatar letter={u.name?.charAt(0) || 'U'} bg={COLORS.lightBg} color={COLORS.black} size={38} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ fontWeight: '700', fontSize: 14, color: COLORS.black }}>{u.name}{isSelf ? ' (you)' : ''}</Text>
                  <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 1 }} numberOfLines={1}>{u.email}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 5, alignItems: 'center' }}>
                    <Badge text={u.role} variant={roleVariant(u.role)} />
                    <Badge text={u.is_active ? 'Active' : 'Inactive'} variant={u.is_active ? 'dark' : 'orange'} />
                    <Text style={{ fontSize: 10, color: COLORS.lightMuted }}>{fmtDate(u.created_at)}</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    {!isSelf && (
                      <TouchableOpacity onPress={() => setRoleTarget(u)}>
                        <Ionicons name="create-outline" size={19} color={COLORS.muted} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => setPwTarget(u)}>
                      <Ionicons name="key-outline" size={19} color={COLORS.muted} />
                    </TouchableOpacity>
                    {!isSelf && (togglingId === u.user_id ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <TouchableOpacity onPress={() => toggleActive(u)}>
                        <Ionicons
                          name={u.is_active ? 'person-remove-outline' : 'person-add-outline'}
                          size={19}
                          color={u.is_active ? COLORS.danger : COLORS.success}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            );
          })}
          {users.length === 0 && <EmptyState icon={<Ionicons name="people-outline" size={48} color="#DDD" />} text="No users found" />}
        </View>

        {page < totalPages && (
          <TouchableOpacity style={s.outlineBtn} onPress={loadMore} disabled={loadingMore}>
            {loadingMore ? <ActivityIndicator color={COLORS.black} /> : <Text style={s.outlineBtnText}>Load more</Text>}
          </TouchableOpacity>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>

      <OptionPicker
        visible={picker}
        title="Filter by role"
        options={[{ value: null, label: 'All Roles', capitalize: false }, ...ROLES.map(r => ({ value: r, label: r }))]}
        onSelect={setRole}
        onClose={() => setPicker(false)}
      />
      <OptionPicker
        visible={!!roleTarget}
        title={`Change role — ${roleTarget?.name || ''}`}
        options={ROLES.map(r => ({ value: r, label: r + (roleTarget?.role === r ? ' (current)' : '') }))}
        onSelect={(v) => roleTarget && changeRole(roleTarget, v)}
        onClose={() => setRoleTarget(null)}
      />
      <CreateUserModal visible={createOpen} onClose={() => setCreateOpen(false)} onSaved={reload} />
      <PasswordModal target={pwTarget} onClose={() => setPwTarget(null)} />
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
  searchWrap: { position: 'relative', marginBottom: 12 },
  searchIcon: { position: 'absolute', left: 14, top: 14, zIndex: 1 },
  searchInput: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, paddingLeft: 38, paddingRight: 16, paddingVertical: 12, fontSize: 14, color: COLORS.black, borderWidth: 1.5, borderColor: COLORS.border, ...SHADOW.sm },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  filterChipActive: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  filterChipText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  filterChipTextActive: { color: COLORS.white },
  list: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, marginBottom: 12, ...SHADOW.sm },
  userRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: COLORS.lightBg },
  modalSafe: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.white },
  modalTitle: { ...FONTS.h2, flex: 1, textAlign: 'center', fontSize: 16 },
  formLabel: { ...FONTS.small, marginBottom: 6 },
  formInput: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: COLORS.black, backgroundColor: COLORS.white, marginBottom: 14 },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...SHADOW.sm },
  outlineBtn: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.lg, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white, marginBottom: 8 },
  outlineBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.black },
  codeBox: { fontSize: 16, fontWeight: '800', color: COLORS.black, backgroundColor: COLORS.lightBg, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10, textAlign: 'center', letterSpacing: 0.5 },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'center', padding: 28 },
  pickerCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 12, ...SHADOW.md },
  pickerTitle: { fontSize: 13, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 8 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderRadius: RADIUS.md },
  pickerRowText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
});

export default UsersScreen;
