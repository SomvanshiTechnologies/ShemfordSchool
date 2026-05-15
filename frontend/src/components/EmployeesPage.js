import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import { getCached, setCached } from '../lib/pageCache';

const TopProgressBar = ({ active }) =>
  active ? (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px] overflow-hidden" style={{ background: '#fde8c8' }}>
      <div className="h-full w-2/5" style={{ background: '#E88A1A', animation: 'topbar-slide 1.4s ease-in-out infinite' }} />
    </div>
  ) : null;
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { toast } from 'sonner';
import { Plus, Search, Eye, Edit, UserCog, Filter, AlertTriangle, Link2, Loader2, Copy, Check, X } from 'lucide-react';

const EmployeesPage = () => {
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const sentinelRef = useRef(null);
  const PAGE_SIZE = 30;
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterStatus, setFilterStatus] = useState('true');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [linkingUser, setLinkingUser] = useState(null);
  const [linkedPassword, setLinkedPassword] = useState(null);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    date_of_birth: '',
    gender: 'male',
    address: '',
    designation: '',
    department: '',
    salary: '',
    bank_account_number: '',
    bank_ifsc: '',
    bank_name: '',
    bank_account_holder: ''
  });
  const [editData, setEditData] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    date_of_birth: '',
    gender: 'male',
    address: '',
    designation: '',
    department: '',
    salary: ''
  });

  useEffect(() => {
    setPage(1);
    setEmployees([]);
    fetchEmployees(1, false);
    fetchDepartments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterDept, filterStatus]);

  const fetchEmployees = useCallback(async (pg = 1, append = false) => {
    const cacheKey = `employees:${filterStatus}:${filterDept}:${pg}`;
    const cached = getCached(cacheKey);

    if (!append) {
      if (cached) {
        setEmployees(cached.employees);
        setTotalEmployees(cached.total);
        setTotalPages(cached.pages);
        setLoading(false);
      }
      setRefreshing(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = { is_active: filterStatus === 'true', page: pg, limit: PAGE_SIZE };
      if (filterDept) params.department = filterDept;
      const res = await api.get('/employees', { params });
      const arr = Array.isArray(res.data) ? res.data : (res.data?.employees ?? []);
      const total = parseInt(res.headers?.['x-total-count'] ?? arr.length);
      const pages = parseInt(res.headers?.['x-total-pages'] ?? 1);
      const result = { employees: arr, total, pages };
      setCached(cacheKey, result);
      setEmployees(prev => append ? [...prev, ...arr] : arr);
      setTotalEmployees(total);
      setTotalPages(pages);
    } catch (error) {
      if (!cached && !append) toast.error('Failed to fetch employees');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [filterStatus, filterDept]);

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingMore && !loading) {
        setPage(prev => {
          const next = prev + 1;
          if (next <= totalPages) { fetchEmployees(next, true); return next; }
          return prev;
        });
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadingMore, loading, totalPages, fetchEmployees]);

  const fetchDepartments = async () => {
    try {
      const response = await api.get('/departments');
      setDepartments(response.data);
    } catch (error) {
      console.error('Failed to fetch departments');
    }
  };

  const handleAddEmployee = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        ...formData,
        salary: formData.salary ? parseFloat(formData.salary) : undefined
      };
      await api.post('/employees', data);
      toast.success('Employee added successfully');
      setShowAddDialog(false);
      setFormData({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        date_of_birth: '',
        gender: 'male',
        address: '',
        designation: '',
        department: '',
        salary: '',
        bank_account_number: '',
        bank_ifsc: '',
        bank_name: '',
        bank_account_holder: ''
      });
      setPage(1); setEmployees([]); fetchEmployees(1, false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to add employee');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (employeeId) => {
    try {
      await api.put(`/employees/${employeeId}`, { is_active: false });
      toast.success('Employee deactivated');
      setDeactivateTarget(null);
      setPage(1); setEmployees([]); fetchEmployees(1, false);
    } catch (error) {
      toast.error('Failed to deactivate employee');
    }
  };

  const handleViewEmployee = (employee) => {
    setSelectedEmployee(employee);
    setShowViewDialog(true);
  };

  const handleEditEmployee = (employee) => {
    setSelectedEmployee(employee);
    setEditData({
      first_name: employee.first_name || '',
      last_name: employee.last_name || '',
      phone: employee.phone || '',
      date_of_birth: employee.date_of_birth || '',
      gender: employee.gender || 'male',
      address: employee.address || '',
      designation: employee.designation || '',
      department: employee.department || '',
      salary: employee.salary || '',
    });
    setShowEditDialog(true);
  };

  const handleUpdateEmployee = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        ...editData,
        salary: editData.salary ? parseFloat(editData.salary) : undefined,
      };
      await api.put(`/employees/${selectedEmployee.employee_id}`, data);
      toast.success('Employee updated successfully');
      setShowEditDialog(false);
      setPage(1); setEmployees([]); fetchEmployees(1, false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update employee');
    } finally {
      setSaving(false);
    }
  };

  const handleLinkUser = async (employeeId) => {
    setLinkingUser(employeeId);
    try {
      const res = await api.post(`/employees/${employeeId}/link-user`);
      setLinkedPassword(res.data.temp_password);
      setPasswordCopied(false);
      setShowPasswordDialog(true);
      setPage(1); setEmployees([]); fetchEmployees(1, false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to link user account');
    } finally {
      setLinkingUser(null);
    }
  };

  const copyPassword = () => {
    if (linkedPassword) {
      navigator.clipboard.writeText(linkedPassword);
      setPasswordCopied(true);
      setTimeout(() => setPasswordCopied(false), 2000);
    }
  };

  const filteredEmployees = employees.filter(emp => {
    const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase();
    const empId = emp.employee_id?.toLowerCase() || '';
    return fullName.includes(searchTerm.toLowerCase()) || empId.includes(searchTerm.toLowerCase());
  });

  return (
    <div data-testid="employees-page">
      <TopProgressBar active={refreshing} />
      <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div className="page-header-inner">
          <div className="page-header-accent" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Employees</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Manage staff and employee records</p>
          </div>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button data-testid="add-employee-btn">
              <Plus className="h-4 w-4 mr-2" />
              Add Employee
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Employee</DialogTitle>
              <DialogDescription>Fill in the employee details</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddEmployee}>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="first_name">First Name *</Label>
                    <Input
                      id="first_name"
                      value={formData.first_name}
                      onChange={(e) => setFormData({...formData, first_name: e.target.value})}
                      required
                      data-testid="emp-first-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="last_name">Last Name *</Label>
                    <Input
                      id="last_name"
                      value={formData.last_name}
                      onChange={(e) => setFormData({...formData, last_name: e.target.value})}
                      required
                      data-testid="emp-last-name"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                      required
                      data-testid="emp-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                      data-testid="emp-phone"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="department">Department *</Label>
                    <Select
                      value={formData.department}
                      onValueChange={(value) => setFormData({...formData, department: value})}
                    >
                      <SelectTrigger data-testid="emp-department">
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map((dept) => (
                          <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="designation">Designation *</Label>
                    <Input
                      id="designation"
                      value={formData.designation}
                      onChange={(e) => setFormData({...formData, designation: e.target.value})}
                      required
                      data-testid="emp-designation"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="gender">Gender *</Label>
                    <Select
                      value={formData.gender}
                      onValueChange={(value) => setFormData({...formData, gender: value})}
                    >
                      <SelectTrigger data-testid="emp-gender">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dob">Date of Birth</Label>
                    <Input
                      id="dob"
                      type="date"
                      value={formData.date_of_birth}
                      onChange={(e) => setFormData({...formData, date_of_birth: e.target.value})}
                      data-testid="emp-dob"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="salary">Monthly Salary</Label>
                  <Input
                    id="salary"
                    type="number"
                    value={formData.salary}
                    onChange={(e) => setFormData({...formData, salary: e.target.value})}
                    data-testid="emp-salary"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => setFormData({...formData, address: e.target.value})}
                    data-testid="emp-address"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bank_account_number">Bank Account Number</Label>
                    <Input
                      id="bank_account_number"
                      value={formData.bank_account_number}
                      onChange={(e) => setFormData({...formData, bank_account_number: e.target.value})}
                      data-testid="emp-bank-account"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bank_ifsc">IFSC Code</Label>
                    <Input
                      id="bank_ifsc"
                      value={formData.bank_ifsc}
                      onChange={(e) => setFormData({...formData, bank_ifsc: e.target.value.toUpperCase()})}
                      placeholder="e.g. SBIN0001234"
                      data-testid="emp-bank-ifsc"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bank_name">Bank Name</Label>
                    <Input
                      id="bank_name"
                      value={formData.bank_name}
                      onChange={(e) => setFormData({...formData, bank_name: e.target.value})}
                      data-testid="emp-bank-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bank_account_holder">Account Holder Name</Label>
                    <Input
                      id="bank_account_holder"
                      value={formData.bank_account_holder}
                      onChange={(e) => setFormData({...formData, bank_account_holder: e.target.value})}
                      data-testid="emp-bank-holder"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving} data-testid="submit-employee-btn">
                  {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : 'Add Employee'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Notice */}
      <div className="mb-6 border border-slate-200 bg-white p-4 flex items-center gap-3 rounded-xl">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" strokeWidth={1.5} />
        <p className="text-xs text-slate-500">
          Employees cannot be deleted. They can only be deactivated for record keeping.
        </p>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or employee ID..."
                className="pl-10 pr-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="search-employees"
              />
              {searchTerm && (
                <button className="absolute right-3 top-3 text-muted-foreground hover:text-slate-900" onClick={() => setSearchTerm('')}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select value={filterDept || "all"} onValueChange={(v) => setFilterDept(v === "all" ? "" : v)}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="filter-department">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full sm:w-[150px]" data-testid="filter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Employees Table */}
      {filteredEmployees.length > 0 && (
        <p className="text-xs text-slate-500 mb-2">Showing {filteredEmployees.length} of {employees.length} employee{employees.length !== 1 ? 's' : ''}</p>
      )}
      <Card>
        <CardContent className="p-0">
          {loading && filteredEmployees.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-900 border-t-transparent"></div>
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64">
              <div className="empty-state-icon"><UserCog className="h-8 w-8" /></div>
              <p className="text-slate-500 font-medium">No employees found</p>
              <Button variant="link" className="text-slate-900" onClick={() => setShowAddDialog(true)}>Add your first employee</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>User Account</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((emp) => (
                  <TableRow key={emp.employee_id} data-testid={`employee-row-${emp.employee_id}`}>
                    <TableCell className="font-medium">{emp.employee_id}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{emp.first_name} {emp.last_name}</p>
                        <p className="text-sm text-muted-foreground">{emp.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>{emp.department}</TableCell>
                    <TableCell>{emp.designation}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${emp.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-500'}`}>
                        {emp.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {emp.user_id ? (
                        <Badge variant="outline" className="gap-1 text-slate-900 border-slate-900">
                          <Link2 className="h-3 w-3" /> Linked
                        </Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleLinkUser(emp.employee_id)}
                          disabled={linkingUser === emp.employee_id}
                          data-testid={`link-user-${emp.employee_id}`}
                        >
                          {linkingUser === emp.employee_id ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Link2 className="h-3 w-3 mr-1" />
                          )}
                          Link Account
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleViewEmployee(emp)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleEditEmployee(emp)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      {emp.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-slate-600 hover:text-slate-900"
                          onClick={() => setDeactivateTarget(emp)}
                        >
                          Deactivate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex items-center justify-center py-4 gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading more...
            </div>
          )}
          {!loading && !loadingMore && page >= totalPages && totalEmployees > 0 && (
            <p className="text-center text-xs text-slate-400 py-3">{totalEmployees} employee{totalEmployees !== 1 ? 's' : ''} total</p>
          )}
        </CardContent>
      </Card>

      {/* Edit Employee Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
            <DialogDescription>Update employee details</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateEmployee}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_first_name">First Name *</Label>
                  <Input
                    id="edit_first_name"
                    value={editData.first_name}
                    onChange={(e) => setEditData({...editData, first_name: e.target.value})}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_last_name">Last Name *</Label>
                  <Input
                    id="edit_last_name"
                    value={editData.last_name}
                    onChange={(e) => setEditData({...editData, last_name: e.target.value})}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_phone">Phone</Label>
                  <Input
                    id="edit_phone"
                    value={editData.phone}
                    onChange={(e) => setEditData({...editData, phone: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_dob">Date of Birth</Label>
                  <Input
                    id="edit_dob"
                    type="date"
                    value={editData.date_of_birth}
                    onChange={(e) => setEditData({...editData, date_of_birth: e.target.value})}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_department">Department *</Label>
                  <Select
                    value={editData.department}
                    onValueChange={(value) => setEditData({...editData, department: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((dept) => (
                        <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_designation">Designation *</Label>
                  <Input
                    id="edit_designation"
                    value={editData.designation}
                    onChange={(e) => setEditData({...editData, designation: e.target.value})}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_gender">Gender *</Label>
                  <Select
                    value={editData.gender}
                    onValueChange={(value) => setEditData({...editData, gender: value})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_salary">Monthly Salary</Label>
                  <Input
                    id="edit_salary"
                    type="number"
                    value={editData.salary}
                    onChange={(e) => setEditData({...editData, salary: e.target.value})}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_address">Address</Label>
                <Input
                  id="edit_address"
                  value={editData.address}
                  onChange={(e) => setEditData({...editData, address: e.target.value})}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowEditDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation AlertDialog */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={(open) => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Employee</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate <strong>{deactivateTarget?.first_name} {deactivateTarget?.last_name}</strong>?
              Their user account will be revoked. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-slate-900 text-white hover:bg-slate-800"
              onClick={() => deactivateTarget && handleDeactivate(deactivateTarget.employee_id)}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Temp Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>User Account Created</DialogTitle>
            <DialogDescription>
              Share this temporary password with the employee. They should change it on first login.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <code className="flex-1 font-mono text-sm text-slate-900 tracking-wider">{linkedPassword}</code>
              <Button variant="outline" size="sm" onClick={copyPassword} className="shrink-0">
                {passwordCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            {passwordCopied && <p className="text-xs text-green-600 mt-2">Copied to clipboard!</p>}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowPasswordDialog(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Employee Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Employee Details</DialogTitle>
          </DialogHeader>
          {selectedEmployee && (
            <div className="grid gap-4">
              <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <UserCog className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold">{selectedEmployee.first_name} {selectedEmployee.last_name}</h3>
                  <p className="text-muted-foreground">ID: {selectedEmployee.employee_id}</p>
                </div>
                <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${selectedEmployee.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-500'}`}>
                  {selectedEmployee.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Department</Label>
                  <p className="font-medium">{selectedEmployee.department}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Designation</Label>
                  <p className="font-medium">{selectedEmployee.designation}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Email</Label>
                  <p className="font-medium">{selectedEmployee.email}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Phone</Label>
                  <p className="font-medium">{selectedEmployee.phone || '-'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Joining Date</Label>
                  <p className="font-medium">{selectedEmployee.joining_date}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Salary</Label>
                  <p className="font-medium">{selectedEmployee.salary ? `₹${selectedEmployee.salary.toLocaleString()}` : '-'}</p>
                </div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <Label className="text-muted-foreground">User Account</Label>
                {selectedEmployee.user_id ? (
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="gap-1 text-slate-900 border-slate-900">
                      <Link2 className="h-3 w-3" /> Linked
                    </Badge>
                    <span className="text-sm text-muted-foreground">ID: {selectedEmployee.user_id}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-muted-foreground">No user account linked</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLinkUser(selectedEmployee.employee_id)}
                      disabled={linkingUser === selectedEmployee.employee_id}
                      data-testid="view-link-user-btn"
                    >
                      {linkingUser === selectedEmployee.employee_id ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Link2 className="h-3 w-3 mr-1" />
                      )}
                      Link Now
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EmployeesPage;
