import React, { Component } from "react";

class PageErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-slate-600">Something went wrong loading this page.</p>
          <button className="px-4 py-2 bg-orange-500 text-white rounded-lg" onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { SessionProvider } from "./contexts/SessionContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import LoginPage from "./components/LoginPage";
import AuthCallback from "./components/AuthCallback";
import Dashboard from "./components/Dashboard";
import StudentsPage from "./components/StudentsPage";
import EmployeesPage from "./components/EmployeesPage";
import FeesPage from "./components/FeesPage";
import AttendancePage from "./components/AttendancePage";
import MarksPage from "./components/MarksPage";
import AnnouncementsPage from "./components/AnnouncementsPage";
import SyllabusPage from "./components/SyllabusPage";
import IssuesPage from "./components/IssuesPage";
import MessagesPage from "./components/MessagesPage";
import ReportsPage from "./components/ReportsPage";
import UpgradationPage from "./components/UpgradationPage";
import UsersPage from "./components/UsersPage";
import ParentAttendancePage from "./components/ParentAttendancePage";
import ClassStructurePage from "./components/ClassStructurePage";
import SettingsPage from "./components/SettingsPage";
import PayrollPage from "./components/PayrollPage";
import AuditTrailPage from "./components/AuditTrailPage";
import AccountDeletionsPage from "./components/AccountDeletionsPage";
import MobileApp from "./mobile/MobileApp";
import { useMobile } from "./hooks/useMobile";
import ScreenshotBlocker from "./components/ScreenshotBlocker";
import "./mobile/mobile.css";
import "./App.css";

// Desktop pages that the mobile More page links to directly. These don't yet
// have mobile-native equivalents, so the auto-redirect must let them through —
// otherwise tapping Payroll/Issues/Settings/Users/etc. on a touch device loops
// back to /m and looks like the link is broken.
const MOBILE_ALLOWED_DESKTOP_ROUTES = [
  '/payroll',
  '/issues',
  '/settings',
  '/users',
  '/employees',
  '/class-structure',
  '/syllabus',
  '/upgradation', // legacy — /m/upgradation is the native version
];

// Auto-redirect mobile users to /m routes
function MobileRedirect({ children }) {
  const isMobile = useMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  React.useEffect(() => {
    const isTouchDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isAllowedDesktopRoute = MOBILE_ALLOWED_DESKTOP_ROUTES.some(p => location.pathname === p || location.pathname.startsWith(p + '/'));
    if (
      isMobile && isTouchDevice && user
      && !location.pathname.startsWith('/m')
      && location.pathname !== '/login'
      && !isAllowedDesktopRoute
      && !location.hash?.includes('session_id=')
    ) {
      navigate('/m', { replace: true });
    }
  }, [isMobile, user, location.pathname, location.hash, navigate]);

  return children;
}

// Router component that handles session_id detection
function AppRouter() {
  const location = useLocation();
  
  // CRITICAL: Check URL fragment synchronously during render (not in useEffect)
  // This prevents race conditions by processing session_id FIRST
  if (location.hash?.includes('session_id=')) {
    return <AuthCallback />;
  }

  return (
    <MobileRedirect>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      
      {/* Mobile PWA Routes */}
      <Route
        path="/m/*"
        element={
          <ProtectedRoute>
            <MobileApp />
          </ProtectedRoute>
        }
      />
      
      {/* Protected Routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/students"
        element={
          <ProtectedRoute allowedRoles={['admin', 'teacher', 'accountant']}>
            <Layout>
              <PageErrorBoundary><StudentsPage /></PageErrorBoundary>
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/employees"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <Layout>
              <EmployeesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/users"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <Layout>
              <UsersPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/attendance"
        element={
          <ProtectedRoute allowedRoles={['admin', 'teacher']}>
            <Layout>
              <AttendancePage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/fees"
        element={
          <ProtectedRoute allowedRoles={['admin', 'accountant']}>
            <Layout>
              <FeesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/marks"
        element={
          <ProtectedRoute allowedRoles={['admin', 'teacher']}>
            <Layout>
              <MarksPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/announcements"
        element={
          <ProtectedRoute>
            <Layout>
              <AnnouncementsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/syllabus"
        element={
          <ProtectedRoute>
            <Layout>
              <SyllabusPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/class-structure"
        element={
          <ProtectedRoute>
            <Layout>
              <ClassStructurePage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/issues"
        element={
          <ProtectedRoute>
            <Layout>
              <IssuesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/messages"
        element={
          <ProtectedRoute>
            <Layout>
              <MessagesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/reports"
        element={
          <ProtectedRoute allowedRoles={['admin', 'accountant']}>
            <Layout>
              <ReportsPage />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/upgradation"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <Layout>
              <UpgradationPage />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/account-deletions"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <Layout>
              <AccountDeletionsPage />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* Student-specific routes */}
      <Route
        path="/my-attendance"
        element={
          <ProtectedRoute allowedRoles={['student']}>
            <Layout>
              <AttendancePage />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* Parent-specific routes */}
      <Route
        path="/children-attendance"
        element={
          <ProtectedRoute allowedRoles={['parent']}>
            <Layout>
              <ParentAttendancePage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/my-marks"
        element={
          <ProtectedRoute allowedRoles={['student']}>
            <Layout>
              <MarksPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/my-fees"
        element={
          <ProtectedRoute allowedRoles={['student', 'parent']}>
            <Layout>
              <FeesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      <Route
        path="/payroll"
        element={
          <ProtectedRoute allowedRoles={['admin', 'accountant', 'teacher']}>
            <Layout>
              <PayrollPage />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Layout>
              <SettingsPage />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/audit-trail"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <Layout>
              <AuditTrailPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      
      {/* Redirect root to dashboard or login */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      
      {/* Catch all - redirect to dashboard */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </MobileRedirect>
  );
}

function App() {
  return (
    <AuthProvider>
      <SessionProvider>
      <BrowserRouter>
        <ScreenshotBlocker>
          <AppRouter />
          <Toaster
            position="top-right"
            richColors
            closeButton
            toastOptions={{
              style: {
                fontFamily: 'Inter, sans-serif',
              },
            }}
          />
        </ScreenshotBlocker>
      </BrowserRouter>
      </SessionProvider>
    </AuthProvider>
  );
}

export default App;
