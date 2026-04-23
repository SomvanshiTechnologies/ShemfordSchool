import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import { RoleTabs } from './TabNavigator';
import ReportsScreen from '../screens/ReportsScreen';
import NoticesScreen from '../screens/NoticesScreen';
import MessagesScreen from '../screens/MessagesScreen';
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
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
