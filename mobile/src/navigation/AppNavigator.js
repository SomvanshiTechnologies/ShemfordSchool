import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import { RoleTabs } from './TabNavigator';
import ReportsScreen from '../screens/ReportsScreen';
import { ScreenLoader } from '../components/LoadingSkeleton';
import { View } from 'react-native';
import { COLORS } from '../theme/colors';

const Stack = createNativeStackNavigator();

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
            <Stack.Screen name="Main" component={RoleTabs} />
            <Stack.Screen name="Reports" component={ReportsScreen} options={{ headerShown: true, headerTitle: 'Reports', headerTintColor: COLORS.black }} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
