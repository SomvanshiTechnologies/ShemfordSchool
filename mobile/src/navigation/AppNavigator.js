import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import { RoleTabs } from './TabNavigator';
import ReportsScreen from '../screens/ReportsScreen';
import NoticesScreen from '../screens/NoticesScreen';
import MessagesScreen from '../screens/MessagesScreen';
import IssuesScreen from '../screens/IssuesScreen';
import SyllabusScreen from '../screens/SyllabusScreen';
import StudentDetailScreen from '../screens/StudentDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ReceiptScreen from '../screens/ReceiptScreen';
import NewAdmissionScreen from '../screens/NewAdmissionScreen';
import StudentEditScreen from '../screens/StudentEditScreen';
import StudentImportScreen from '../screens/StudentImportScreen';
import FeeSetupScreen from '../screens/FeeSetupScreen';
import FeeConfigScreen from '../screens/FeeConfigScreen';
import FeeReportsScreen from '../screens/FeeReportsScreen';
import PaymentHistoryScreen from '../screens/PaymentHistoryScreen';
import ConcessionsScreen from '../screens/ConcessionsScreen';
import StaffAttendanceScreen from '../screens/StaffAttendanceScreen';
import HolidaysScreen from '../screens/HolidaysScreen';
import AttendanceAlertsScreen from '../screens/AttendanceAlertsScreen';
import BulkUnlockScreen from '../screens/BulkUnlockScreen';
import NoticeComposeScreen from '../screens/NoticeComposeScreen';
import AcademicYearsScreen from '../screens/AcademicYearsScreen';
import MarksScreen from '../screens/MarksScreen';
import ClassesScreen from '../screens/ClassesScreen';
import EmployeesScreen from '../screens/EmployeesScreen';
import UsersScreen from '../screens/UsersScreen';
import UpgradationScreen from '../screens/UpgradationScreen';
import AuditTrailScreen from '../screens/AuditTrailScreen';
import DeletionRequestsScreen from '../screens/DeletionRequestsScreen';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { View } from 'react-native';
import { COLORS } from '../theme/colors';

const Stack = createNativeStackNavigator();

// Header styling shared by all pushed-detail screens
const detailHeader = (title) => ({
  headerShown: true,
  headerTitle: title,
  headerTintColor: COLORS.black,
  headerStyle: { backgroundColor: COLORS.white },
  headerShadowVisible: false,
  headerTitleStyle: { fontWeight: '700', color: COLORS.black },
});

const AppNavigator = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center' }}>
        <ScreenLoader />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <>
            <Stack.Screen name="Main"     component={RoleTabs} />
            <Stack.Screen name="Reports"  component={ReportsScreen}  options={detailHeader('Reports')} />
            {/* Notices + Messages are tabs for some roles; for roles without those tabs
                (admin, teacher), navigation bubbles up to these stack screens instead. */}
            <Stack.Screen name="Notices"  component={NoticesScreen}  options={detailHeader('Notices')} />
            <Stack.Screen name="Messages" component={MessagesScreen} options={detailHeader('Messages')} />
            <Stack.Screen name="Issues"   component={IssuesScreen}   options={detailHeader('Issues')} />
            <Stack.Screen name="Syllabus" component={SyllabusScreen} options={detailHeader('Syllabus')} />
            <Stack.Screen name="StudentDetail" component={StudentDetailScreen} options={detailHeader('Student Details')} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={detailHeader('Settings')} />
            <Stack.Screen name="Receipt" component={ReceiptScreen} options={detailHeader('Fee Receipt')} />
            <Stack.Screen name="NewAdmission" component={NewAdmissionScreen} options={detailHeader('New Admission')} />
            <Stack.Screen name="StudentEdit" component={StudentEditScreen} options={detailHeader('Edit Student')} />
            <Stack.Screen name="StudentImport" component={StudentImportScreen} options={detailHeader('Import Students')} />
            <Stack.Screen name="FeeSetup" component={FeeSetupScreen} options={detailHeader('Fee Setup')} />
            <Stack.Screen name="FeeConfig" component={FeeConfigScreen} options={detailHeader('Class Fees')} />
            <Stack.Screen name="FeeReports" component={FeeReportsScreen} options={detailHeader('Fee Reports')} />
            <Stack.Screen name="PaymentHistory" component={PaymentHistoryScreen} options={detailHeader('Payments')} />
            <Stack.Screen name="Concessions" component={ConcessionsScreen} options={detailHeader('Concessions')} />
            <Stack.Screen name="StaffAttendance" component={StaffAttendanceScreen} options={detailHeader('Staff Attendance')} />
            <Stack.Screen name="Holidays" component={HolidaysScreen} options={detailHeader('Holidays')} />
            <Stack.Screen name="AttendanceAlerts" component={AttendanceAlertsScreen} options={detailHeader('Low Attendance')} />
            <Stack.Screen name="BulkUnlock" component={BulkUnlockScreen} options={detailHeader('Bulk Unlock')} />
            <Stack.Screen name="NoticeCompose" component={NoticeComposeScreen} options={detailHeader('New Notice')} />
            <Stack.Screen name="AcademicYears" component={AcademicYearsScreen} options={detailHeader('Academic Years')} />
            {/* Marks is a bottom tab for teacher/student; admin reaches it from More
                via this stack screen (nearest navigator wins, so tabs are unaffected). */}
            <Stack.Screen name="Marks" component={MarksScreen} options={detailHeader('Marks & Grades')} />
            <Stack.Screen name="Classes" component={ClassesScreen} options={detailHeader('Class Structure')} />
            <Stack.Screen name="Employees" component={EmployeesScreen} options={detailHeader('Employees')} />
            <Stack.Screen name="Users" component={UsersScreen} options={detailHeader('User Management')} />
            <Stack.Screen name="Upgradation" component={UpgradationScreen} options={detailHeader('Class Upgradation')} />
            <Stack.Screen name="AuditTrail" component={AuditTrailScreen} options={detailHeader('Audit Trails')} />
            <Stack.Screen name="DeletionRequests" component={DeletionRequestsScreen} options={detailHeader('Deletion Requests')} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
