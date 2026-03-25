import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';

import AdminDashboard from '../screens/admin/AdminDashboard';
import TeacherDashboard from '../screens/teacher/TeacherDashboard';
import ParentDashboard from '../screens/parent/ParentDashboard';
import StudentDashboard from '../screens/student/StudentDashboard';
import AttendanceScreen from '../screens/AttendanceScreen';
import FeesScreen from '../screens/FeesScreen';
import MarksScreen from '../screens/MarksScreen';
import MessagesScreen from '../screens/MessagesScreen';
import NoticesScreen from '../screens/NoticesScreen';
import ReportsScreen from '../screens/ReportsScreen';
import StudentsScreen from '../screens/StudentsScreen';
import MoreScreen from '../screens/MoreScreen';

const Tab = createBottomTabNavigator();

const tabIcon = (name, focused) => ({ color, size }) => (
  <Ionicons name={focused ? name : `${name}-outline`} size={22} color={color} />
);

const screenOptions = {
  headerShown: false,
  tabBarActiveTintColor: COLORS.primary,
  tabBarInactiveTintColor: COLORS.lightMuted,
  tabBarStyle: {
    height: 68,
    paddingBottom: 10,
    paddingTop: 8,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
  },
  tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
};

const AdminTabs = () => (
  <Tab.Navigator screenOptions={screenOptions}>
    <Tab.Screen name="Home" component={AdminDashboard} options={{ tabBarIcon: ({ focused, color, size }) => <Ionicons name={focused ? 'grid' : 'grid-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="Students" component={StudentsScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'people' : 'people-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="Fees" component={FeesScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'card' : 'card-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="Attendance" component={AttendanceScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="More" component={MoreScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'menu' : 'menu-outline'} size={22} color={color} /> }} />
  </Tab.Navigator>
);

const TeacherTabs = () => (
  <Tab.Navigator screenOptions={screenOptions}>
    <Tab.Screen name="Home" component={TeacherDashboard} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'grid' : 'grid-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="Attendance" component={AttendanceScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="Marks" component={MarksScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'school' : 'school-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="Messages" component={MessagesScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'chatbubble' : 'chatbubble-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="More" component={MoreScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'menu' : 'menu-outline'} size={22} color={color} /> }} />
  </Tab.Navigator>
);

const ParentTabs = () => (
  <Tab.Navigator screenOptions={screenOptions}>
    <Tab.Screen name="Home" component={ParentDashboard} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'grid' : 'grid-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="Fees" component={FeesScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'card' : 'card-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="Messages" component={MessagesScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'chatbubble' : 'chatbubble-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="Notices" component={NoticesScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'notifications' : 'notifications-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="More" component={MoreScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'menu' : 'menu-outline'} size={22} color={color} /> }} />
  </Tab.Navigator>
);

const StudentTabs = () => (
  <Tab.Navigator screenOptions={screenOptions}>
    <Tab.Screen name="Home" component={StudentDashboard} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'grid' : 'grid-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="Marks" component={MarksScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'school' : 'school-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="Attendance" component={AttendanceScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="Notices" component={NoticesScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'notifications' : 'notifications-outline'} size={22} color={color} /> }} />
    <Tab.Screen name="More" component={MoreScreen} options={{ tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? 'menu' : 'menu-outline'} size={22} color={color} /> }} />
  </Tab.Navigator>
);

export const RoleTabs = () => {
  const { user } = useAuth();
  switch (user?.role) {
    case 'admin': return <AdminTabs />;
    case 'teacher': return <TeacherTabs />;
    case 'parent': return <ParentTabs />;
    case 'student': return <StudentTabs />;
    default: return <AdminTabs />;
  }
};
