import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import { getCached, setCached } from '../lib/pageCache';

const TopProgressBar = ({ active }) =>
  active ? (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px] overflow-hidden" style={{ background: '#fde8c8' }}>
      <div className="h-full w-2/5" style={{ background: '#E88A1A', animation: 'topbar-slide 1.4s ease-in-out infinite' }} />
    </div>
  ) : null;
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { toast } from 'sonner';
import { Search, Users, Shield, Edit, X, Loader2, UserCheck, UserX, KeyRound, Copy } from 'lucide-react';
import { getInitials, formatDate } from '../lib/utils';

const UsersPage = () => {
  const { user: currentUser } = useAuth();
  const { viewSession } = useSession();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const sentinelRef = useRef(null);
  const PAGE_SIZE = 30;
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [newRole, setNewRole] = useState('');
  const [createData, setCreateData] = useState({
    name: '', email: '', password: '', role: 'teacher', phone: ''
  });
  // Admin set/generate password for ANY user
  const [pwUser, setPwUser] = useState(null);
  const [pwInput, setPwInput] = useState('');
  const [pwResult, setPwResult] = useState(null);
  const [pwLoading, setPwLoading] = useState(false);

  const handleSetUserPassword = async (generate) => {
    if (!pwUser) return;
    setPwLoading(true);
    try {
      const body = generate ? {} : { password: pwInput };
      const res = await api.post(`/users/${pwUser.user_id}/reset-password`, body);
      setPwResult(res.data);
      setPwInput('');
      toast.success('Password updated');
    } catch (e) {
      if (!e._handled) toast.error(e.response?.data?.detail || 'Failed to set password');
    } finally { setPwLoading(false); }
  };

  // Debounced server-side search term — separate from the input value so we
  // can throttle DB hits without losing keystrokes.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const fetchUsers = useCallback(async (pg = 1, append = false) => {
    const cacheKey = `users:${viewSession}:${filterRole}:${debouncedSearch}:${pg}`;
    const cached = getCached(cacheKey);

    if (!append) {
      if (cached) {
        setUsers(cached.users);
        setTotalUsers(cached.total);
        setTotalPages(cached.pages);
        setLoading(false);
      }
      setRefreshing(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = { page: pg, limit: PAGE_SIZE };
      if (filterRole) params.role = filterRole;
      if (debouncedSearch) params.search = debouncedSearch;
      const res = await api.get('/users', { params });
      const arr = Array.isArray(res.data) ? res.data : (res.data?.users ?? []);
      const total = parseInt(res.headers?.['x-total-count'] ?? arr.length) || 0;
      const pages = parseInt(res.headers?.['x-total-pages'] ?? 1) || 1;
      setCached(cacheKey, { users: arr, total, pages });
      // Dedupe by user_id when appending — backend pages may overlap during
      // rapid scroll, and React requires unique keys.
      setUsers(prev => {
        const next = append ? [...prev, ...arr] : arr;
        const seen = new Map();
        for (const u of next) if (u?.user_id) seen.set(u.user_id, u);
        return Array.from(seen.values());
      });
      setTotalUsers(total);
      setTotalPages(pages);
    } catch (error) {
      if (!cached && !append) toast.error('Failed to fetch users');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [filterRole, debouncedSearch, viewSession]);

  useEffect(() => {
    setPage(1);
    setUsers([]);
    fetchUsers(1, false);
  }, [fetchUsers]);

  // Infinite scroll — only fire when there's a next page to fetch AND we have
  // at least one row already loaded (prevents the observer from runaway-firing
  // while the empty-state placeholder is in view, which previously bumped page
  // up to 71+ and triggered rate-limit 429s).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      if (loadingMore || loading) return;
      if (users.length === 0) return;
      if (page >= totalPages) return;
      setPage(prev => {
        const next = prev + 1;
        if (next <= totalPages) { fetchUsers(next, true); return next; }
        return prev;
      });
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadingMore, loading, totalPages, page, users.length, fetchUsers]);

  const handleUpdateRole = async () => {
    if (!selectedUser || !newRole) return;

    try {
      await api.put(`/users/${selectedUser.user_id}/role`, { role: newRole });
      toast.success('Role updated successfully');
      setShowEditDialog(false);
      setPage(1); setUsers([]); fetchUsers(1, false);
    } catch (error) {
      toast.error('Failed to update role');
    }
  };

  // Toggle is_active on a user; backend cascades to db.students / db.employees
  const [togglingId, setTogglingId] = useState(null);
  const handleToggleActive = async (u) => {
    if (togglingId) return;
    setTogglingId(u.user_id);
    try {
      await api.put(`/users/${u.user_id}`, { is_active: !u.is_active });
      toast.success(u.is_active ? 'User deactivated' : 'User activated');
      // Update the row locally to avoid a full refetch
      setUsers((rows) => rows.map((r) =>
        r.user_id === u.user_id ? { ...r, is_active: !u.is_active } : r
      ));
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update user status');
    } finally {
      setTogglingId(null);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await api.post('/auth/create-user', createData);
      toast.success('User account created successfully');
      setShowCreateDialog(false);
      setCreateData({ name: '', email: '', password: '', role: 'teacher', phone: '' });
      setPage(1); setUsers([]); fetchUsers(1, false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create user');
    }
  };

  const openEditDialog = (user) => {
    setSelectedUser(user);
    setNewRole(user.role);
    setShowEditDialog(true);
  };

  const getRoleBadge = (role) => {
    const colors = {
      admin: 'bg-slate-900/90 text-white border-transparent',
      teacher: 'bg-amber-50 text-amber-800 border-amber-200',
      student: 'bg-blue-50 text-blue-700 border-blue-200',
      parent: 'bg-purple-50 text-purple-700 border-purple-200',
      accountant: 'bg-emerald-50 text-emerald-700 border-emerald-200'
    };
    return <Badge variant="outline" className={`capitalize font-medium text-xs ${colors[role] || 'bg-gray-50 text-gray-600'}`}>{role}</Badge>;
  };

  // Server-side search is the source of truth (see fetchUsers above). The list
  // shown here is exactly what the backend returned for the current search +
  // filter, so no further client-side filtering is needed.
  const filteredUsers = users;

  const roles = ['admin', 'teacher', 'student', 'parent', 'accountant'];

  return (
    <div data-testid="users-page">
      <TopProgressBar active={refreshing} />
      <div className="page-header flex justify-between items-start">
        <div className="page-header-inner">
          <div className="page-header-accent" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">User Management</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Manage user accounts and roles</p>
          </div>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button data-testid="create-user-btn">
              <Users className="h-4 w-4 mr-2" />
              Create User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create User Account</DialogTitle>
              <DialogDescription>Create accounts for staff, teachers, students, or other roles</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateUser}>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Full Name *</Label>
                  <Input value={createData.name} onChange={(e) => setCreateData({...createData, name: e.target.value})} required data-testid="create-name" placeholder="Enter full name" />
                </div>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input type="email" value={createData.email} onChange={(e) => setCreateData({...createData, email: e.target.value})} required data-testid="create-email" placeholder="Enter email" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Role *</Label>
                    <Select value={createData.role} onValueChange={(v) => setCreateData({...createData, role: v})}>
                      <SelectTrigger data-testid="create-role"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {roles.map(r => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input value={createData.phone} onChange={(e) => setCreateData({...createData, phone: e.target.value})} data-testid="create-phone" placeholder="Phone" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Password * <span className="text-xs text-muted-foreground">(min 8 characters)</span></Label>
                  <Input type="password" value={createData.password} onChange={(e) => setCreateData({...createData, password: e.target.value})} required minLength={8} data-testid="create-password" placeholder="Set password" />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
                <Button type="submit" data-testid="submit-create-user-btn">Create Account</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                className="pl-10 pr-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="search-users"
              />
              {searchTerm && (
                <button className="absolute right-3 top-3 text-muted-foreground hover:text-slate-900" onClick={() => setSearchTerm('')}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select value={filterRole || "all"} onValueChange={(v) => setFilterRole(v === "all" ? "" : v)}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="filter-role">
                <Shield className="h-4 w-4 mr-2" />
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {roles.map((role) => (
                  <SelectItem key={role} value={role} className="capitalize">{role}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      {filteredUsers.length > 0 && (
        <p className="text-xs text-muted-foreground mb-2">Showing {filteredUsers.length} of {users.length} user{users.length !== 1 ? 's' : ''}</p>
      )}
      <Card>
        <CardContent className="p-0">
          {loading && filteredUsers.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-900 border-t-transparent"></div>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64">
              <div className="empty-state-icon"><Users className="h-7 w-7" /></div>
              <p className="text-sm font-medium text-slate-900">No users found</p>
              <p className="text-xs text-muted-foreground mt-1">{searchTerm ? 'Try a different search term' : 'No accounts have been created yet'}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  {/* Email/Status/Joined hidden on mobile to keep the table within the viewport */}
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                  <TableHead className="hidden md:table-cell">Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.user_id} data-testid={`user-row-${user.user_id}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage src={user.picture} />
                          <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-xs text-muted-foreground">{user.user_id}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{user.email}</TableCell>
                    <TableCell>{getRoleBadge(user.role)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${user.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{formatDate(user.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {user.user_id !== currentUser?.user_id && (
                          <Button variant="ghost" size="sm" onClick={() => openEditDialog(user)} title="Edit role">
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => { setPwUser(user); setPwInput(''); setPwResult(null); }} title="Set / generate password" data-testid={`set-pw-${user.user_id}`}>
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        {user.user_id !== currentUser?.user_id && (
                          user.is_active ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleToggleActive(user)}
                              disabled={togglingId === user.user_id}
                              title="Deactivate user"
                            >
                              {togglingId === user.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50"
                              onClick={() => handleToggleActive(user)}
                              disabled={togglingId === user.user_id}
                              title="Activate user"
                            >
                              {togglingId === user.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                            </Button>
                          )
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex items-center justify-center py-4 gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading more...
            </div>
          )}
          {!loading && !loadingMore && page >= totalPages && totalUsers > 0 && (
            <p className="text-center text-xs text-slate-400 py-3">{totalUsers} user{totalUsers !== 1 ? 's' : ''} total</p>
          )}
        </CardContent>
      </Card>

      {/* Edit Role Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User Role</DialogTitle>
            <DialogDescription>Change the role for {selectedUser?.name}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2">
              <Label>Select New Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger data-testid="new-role-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role} value={role} className="capitalize">{role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleUpdateRole} data-testid="update-role-btn">Update Role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set / Generate Password (any user) */}
      <Dialog open={!!pwUser} onOpenChange={(o) => { if (!o) { setPwUser(null); setPwResult(null); setPwInput(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Set Password</DialogTitle>
            <DialogDescription>{pwUser?.name} ({pwUser?.role}) — they can sign in with their email/ID and this password.</DialogDescription>
          </DialogHeader>
          {pwResult ? (
            <div className="space-y-3 py-2">
              <p className="text-sm font-medium text-green-700">Password updated successfully</p>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <code className="text-sm font-mono flex-1 break-all">{pwResult.password}</code>
                <Button size="sm" variant="outline" className="rounded-lg shrink-0"
                  onClick={async () => { try { await navigator.clipboard.writeText(pwResult.password); toast.success('Copied'); } catch { toast.error('Copy failed'); } }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Login: {pwResult.email}. Share securely — the user can change it after signing in.</p>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>New Password <span className="text-xs text-muted-foreground">(min 6 chars — leave blank to auto-generate)</span></Label>
                <Input type="text" value={pwInput} onChange={(e) => setPwInput(e.target.value)} placeholder="Custom password, or leave blank" data-testid="user-pw-input" />
              </div>
            </div>
          )}
          <DialogFooter>
            {pwResult ? (
              <Button onClick={() => { setPwUser(null); setPwResult(null); }}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => handleSetUserPassword(true)} disabled={pwLoading}>
                  {pwLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null} Generate
                </Button>
                <Button onClick={() => handleSetUserPassword(false)} disabled={pwLoading || (!!pwInput && pwInput.length < 6)} data-testid="user-pw-save">
                  Set Password
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UsersPage;
