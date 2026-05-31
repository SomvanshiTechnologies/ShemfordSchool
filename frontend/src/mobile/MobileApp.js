import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import MobileLayout from './MobileLayout';
import AdminDashboard from './screens/AdminDashboard';
import TeacherDashboard from './screens/TeacherDashboard';
import ParentDashboard from './screens/ParentDashboard';
import StudentDashboard from './screens/StudentDashboard';
import MobileAttendance from './screens/MobileAttendance';
import MobileFees from './screens/MobileFees';
import MobileMarks from './screens/MobileMarks';
import MobileMessages from './screens/MobileMessages';
import MobileNotices from './screens/MobileNotices';
import MobileReports from './screens/MobileReports';
import MobileStudents from './screens/MobileStudents';
import MobileMore from './screens/MobileMore';
import MobileAuditTrail from './screens/MobileAuditTrail';
import MobileUpgradation from './screens/MobileUpgradation';
import MobileIssues from './screens/MobileIssues';
import MobileSettings from './screens/MobileSettings';
import MobileAccountDeletions from './screens/MobileAccountDeletions';
import MobilePayroll from './screens/MobilePayroll';

const RoleDashboard = () => {
  const { user } = useAuth();
  switch (user?.role) {
    case 'admin': return <AdminDashboard />;
    case 'teacher': return <TeacherDashboard />;
    case 'parent': return <ParentDashboard />;
    case 'student': return <StudentDashboard />;
    default: return <AdminDashboard />;
  }
};

const MobileApp = () => {
  return (
    <MobileLayout>
      <Routes>
        <Route path="/" element={<RoleDashboard />} />
        <Route path="/attendance" element={<MobileAttendance />} />
        <Route path="/fees" element={<MobileFees />} />
        <Route path="/marks" element={<MobileMarks />} />
        <Route path="/messages" element={<MobileMessages />} />
        <Route path="/notices" element={<MobileNotices />} />
        <Route path="/reports" element={<MobileReports />} />
        <Route path="/students" element={<MobileStudents />} />
        <Route path="/more" element={<MobileMore />} />
        <Route path="/audit-trail" element={<MobileAuditTrail />} />
        <Route path="/upgradation" element={<MobileUpgradation />} />
        <Route path="/issues" element={<MobileIssues />} />
        <Route path="/settings" element={<MobileSettings />} />
        <Route path="/account-deletions" element={<MobileAccountDeletions />} />
        <Route path="/payroll" element={<MobilePayroll />} />
        <Route path="*" element={<Navigate to="/m" replace />} />
      </Routes>
    </MobileLayout>
  );
};

export default MobileApp;
