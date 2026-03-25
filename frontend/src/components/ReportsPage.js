import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
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
import { toast } from 'sonner';
import { BarChart3, TrendingUp, Download, CreditCard, GraduationCap, Calendar, FileText, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';

const ReportsPage = () => {
  const [activeTab, setActiveTab] = useState('financial');
  const [loading, setLoading] = useState(false);
  const [financialReport, setFinancialReport] = useState(null);
  const [academicReport, setAcademicReport] = useState(null);
  const [classes, setClasses] = useState([]);
  
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [attClass, setAttClass] = useState('');
  const [attDate, setAttDate] = useState('');
  const [attendanceReport, setAttendanceReport] = useState(null);

  useEffect(() => {
    fetchClasses();
  }, []);

  const fetchClasses = async () => {
    try {
      const response = await api.get('/classes');
      setClasses(response.data);
    } catch (error) {
      console.error('Failed to fetch classes');
    }
  };

  const fetchFinancialReport = async () => {
    setLoading(true);
    try {
      const params = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      
      const response = await api.get('/reports/financial', { params });
      setFinancialReport(response.data);
    } catch (error) {
      toast.error('Failed to fetch financial report');
    } finally {
      setLoading(false);
    }
  };

  const fetchAcademicReport = async () => {
    if (!selectedClass) {
      toast.error('Please select a class');
      return;
    }
    setLoading(true);
    try {
      const params = { class_name: selectedClass };
      if (selectedSection) params.section = selectedSection;
      
      const response = await api.get('/reports/academic', { params });
      setAcademicReport(response.data);
    } catch (error) {
      toast.error('Failed to fetch academic report');
    } finally {
      setLoading(false);
    }
  };

  const fetchAttendanceReport = async () => {
    setLoading(true);
    try {
      const params = {};
      if (attClass) params.class_name = attClass;
      if (attDate) params.date = attDate;
      const response = await api.get('/reports/attendance', { params });
      setAttendanceReport(response.data);
    } catch (error) {
      toast.error('Failed to fetch attendance report');
    } finally {
      setLoading(false);
    }
  };

  const COLORS = ['#E88A1A', '#1A1A1A', '#A3A3A3', '#E5E5E5'];

  const selectedClassSections = classes.find(c => c.name === selectedClass)?.sections || [];

  // Prepare chart data
  const paymentMethodData = financialReport?.by_payment_method 
    ? Object.entries(financialReport.by_payment_method).map(([name, value]) => ({ name, value }))
    : [];

  const monthlyData = financialReport?.by_month
    ? Object.entries(financialReport.by_month).map(([month, amount]) => ({ month, amount }))
    : [];

  return (
    <div data-testid="reports-page">
      <div className="page-header flex justify-between items-start mb-8">
        <div className="page-header-inner">
          <div className="page-header-accent" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Reports</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Financial, academic and attendance analytics</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6 rounded-xl h-10 bg-slate-100">
          <TabsTrigger value="financial" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="financial-tab">Financial</TabsTrigger>
          <TabsTrigger value="academic" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="academic-tab">Academic</TabsTrigger>
          <TabsTrigger value="attendance" className="rounded-xl text-xs uppercase tracking-wider font-semibold" data-testid="attendance-tab">Attendance</TabsTrigger>
        </TabsList>

        {/* Financial Reports */}
        <TabsContent value="financial">
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    data-testid="start-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    data-testid="end-date"
                  />
                </div>
                <Button onClick={fetchFinancialReport} disabled={loading} data-testid="generate-financial-btn">
                  {loading ? 'Loading...' : 'Generate Report'}
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const params = new URLSearchParams();
                      params.set('format', 'pdf');
                      if (startDate) params.set('start_date', startDate);
                      if (endDate) params.set('end_date', endDate);
                      window.open(`${process.env.REACT_APP_BACKEND_URL}/api/reports/financial/export?${params.toString()}`, '_blank');
                    }}
                    data-testid="export-financial-pdf"
                  >
                    <Download className="h-4 w-4 mr-1" /> PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const params = new URLSearchParams();
                      params.set('format', 'excel');
                      if (startDate) params.set('start_date', startDate);
                      if (endDate) params.set('end_date', endDate);
                      window.open(`${process.env.REACT_APP_BACKEND_URL}/api/reports/financial/export?${params.toString()}`, '_blank');
                    }}
                    data-testid="export-financial-excel"
                  >
                    <FileText className="h-4 w-4 mr-1" /> Excel
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {financialReport && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="bg-slate-900 p-6 rounded-2xl">
                  <p className="stat-label">Total Collection</p>
                  <p className="text-3xl font-bold text-white tracking-tight">₹{financialReport.total_collection?.toLocaleString()}</p>
                </div>
                <div className="bg-white border border-slate-200 border-l-4 border-l-[#E88A1A] p-6 rounded-2xl">
                  <p className="stat-label">Total Pending</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">₹{financialReport.total_pending?.toLocaleString()}</p>
                </div>
                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="stat-label">Transactions</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{financialReport.transaction_count}</p>
                </div>
                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="stat-label">Collection Rate</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">
                    {financialReport.total_collection + financialReport.total_pending > 0
                      ? Math.round((financialReport.total_collection / (financialReport.total_collection + financialReport.total_pending)) * 100)
                      : 0}%
                  </p>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-4">By Payment Method</p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={paymentMethodData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            fill="#8884d8"
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {paymentMethodData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value) => `₹${value.toLocaleString()}`} contentStyle={{ background: '#1A1A1A', border: 'none', borderRadius: '2px', color: '#fff', fontSize: '12px' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-4">Monthly Trend</p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={monthlyData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F5" />
                          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#888' }} />
                          <YAxis tick={{ fontSize: 11, fill: '#888' }} />
                          <Tooltip formatter={(value) => `₹${value.toLocaleString()}`} contentStyle={{ background: '#1A1A1A', border: 'none', borderRadius: '2px', color: '#fff', fontSize: '12px' }} />
                          <Bar dataKey="amount" fill="#E88A1A" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Academic Reports */}
        <TabsContent value="academic">
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="space-y-2">
                  <Label>Class</Label>
                  <Select value={selectedClass} onValueChange={(v) => { setSelectedClass(v); setSelectedSection(''); }}>
                    <SelectTrigger className="w-[150px]" data-testid="report-class">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {classes.map((cls) => (
                        <SelectItem key={cls.name} value={cls.name}>{cls.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Section</Label>
                  <Select value={selectedSection || "all"} onValueChange={(v) => setSelectedSection(v === "all" ? "" : v)} disabled={!selectedClass}>
                    <SelectTrigger className="w-[150px]" data-testid="report-section">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sections</SelectItem>
                      {selectedClassSections.map((sec) => (
                        <SelectItem key={sec.section_name || sec} value={sec.section_name || sec}>{sec.section_name || sec}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={fetchAcademicReport} disabled={loading} data-testid="generate-academic-btn">
                  {loading ? 'Loading...' : 'Generate Report'}
                </Button>
                {selectedClass && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const params = new URLSearchParams({ format: 'pdf', class_name: selectedClass });
                        if (selectedSection) params.set('section', selectedSection);
                        window.open(`${process.env.REACT_APP_BACKEND_URL}/api/reports/academic/export?${params.toString()}`, '_blank');
                      }}
                      data-testid="export-academic-pdf"
                    >
                      <Download className="h-4 w-4 mr-1" /> PDF
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const params = new URLSearchParams({ format: 'excel', class_name: selectedClass });
                        if (selectedSection) params.set('section', selectedSection);
                        window.open(`${process.env.REACT_APP_BACKEND_URL}/api/reports/academic/export?${params.toString()}`, '_blank');
                      }}
                      data-testid="export-academic-excel"
                    >
                      <FileText className="h-4 w-4 mr-1" /> Excel
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {academicReport && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="stat-label">Students Evaluated</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{academicReport.student_count}</p>
                </div>
                <div className="bg-slate-900 p-6 rounded-2xl">
                  <p className="stat-label">Class Average</p>
                  <p className="text-3xl font-bold text-white tracking-tight">{academicReport.class_average}%</p>
                </div>
                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="stat-label">Academic Year</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{academicReport.academic_year}</p>
                </div>
              </div>

              {Object.keys(academicReport.student_results || {}).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Student Performance</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Student ID</TableHead>
                          <TableHead>Total Obtained</TableHead>
                          <TableHead>Total Max</TableHead>
                          <TableHead>Percentage</TableHead>
                          <TableHead>Grade</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(academicReport.student_results).map(([studentId, data]) => (
                          <TableRow key={studentId}>
                            <TableCell className="font-medium">{studentId}</TableCell>
                            <TableCell>{data.total_obtained}</TableCell>
                            <TableCell>{data.total_max}</TableCell>
                            <TableCell>{data.percentage}%</TableCell>
                            <TableCell>
                              <span className={`text-xs uppercase font-bold tracking-wider px-2 py-0.5 border ${
                                data.grade?.startsWith('A') ? 'text-slate-900 border-slate-900' :
                                'text-slate-900 border-slate-200'
                              }`}>
                                {data.grade}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* Attendance Reports */}
        <TabsContent value="attendance">
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
                <div className="space-y-2">
                  <Label>Class</Label>
                  <Select value={attClass || "all"} onValueChange={(v) => setAttClass(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-[150px]" data-testid="att-class">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Classes</SelectItem>
                      {classes.map((cls) => (
                        <SelectItem key={cls.name} value={cls.name}>{cls.display_name || cls.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={attDate}
                    onChange={(e) => setAttDate(e.target.value)}
                    data-testid="att-date"
                  />
                </div>
                <Button onClick={fetchAttendanceReport} disabled={loading} data-testid="generate-attendance-btn">
                  {loading ? 'Loading...' : 'Generate Report'}
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const params = new URLSearchParams({ format: 'pdf' });
                      if (attClass) params.set('class_name', attClass);
                      if (attDate) params.set('date', attDate);
                      window.open(`${process.env.REACT_APP_BACKEND_URL}/api/reports/attendance/export?${params.toString()}`, '_blank');
                    }}
                    data-testid="export-attendance-pdf"
                  >
                    <Download className="h-4 w-4 mr-1" /> PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const params = new URLSearchParams({ format: 'excel' });
                      if (attClass) params.set('class_name', attClass);
                      if (attDate) params.set('date', attDate);
                      window.open(`${process.env.REACT_APP_BACKEND_URL}/api/reports/attendance/export?${params.toString()}`, '_blank');
                    }}
                    data-testid="export-attendance-excel"
                  >
                    <FileText className="h-4 w-4 mr-1" /> Excel
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {attendanceReport && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="stat-label">Total Records</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{attendanceReport.total_records}</p>
                </div>
                <div className="bg-slate-900 p-6 rounded-2xl">
                  <p className="stat-label">Present</p>
                  <p className="text-3xl font-bold text-white tracking-tight">{attendanceReport.present}</p>
                </div>
                <div className="bg-white border border-slate-200 border-l-4 border-l-[#E88A1A] p-6 rounded-2xl">
                  <p className="stat-label">Absent</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{attendanceReport.absent}</p>
                </div>
                <div className="bg-white border border-slate-200 p-6 rounded-2xl">
                  <p className="stat-label">Attendance %</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{attendanceReport.percentage}%</p>
                </div>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ReportsPage;
