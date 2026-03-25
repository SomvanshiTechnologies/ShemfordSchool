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
        <Route path="*" element={<Navigate to="/m" replace />} />
      </Routes>
    </MobileLayout>
  );
};

export default MobileApp;
