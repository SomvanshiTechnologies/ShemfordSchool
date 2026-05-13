import React, { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as ScreenCapture from 'expo-screen-capture';
import { AuthProvider } from './src/contexts/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  useEffect(() => {
    let subscription;
    (async () => {
      try {
        await ScreenCapture.preventScreenCaptureAsync();
        if (Platform.OS === 'ios') {
          subscription = ScreenCapture.addScreenshotListener(() => {
            Alert.alert(
              'Screenshot detected',
              'Screenshots of this app are not permitted. The incident has been logged.'
            );
          });
        }
      } catch (e) {
        console.warn('Screen capture protection unavailable:', e?.message);
      }
    })();

    return () => {
      if (subscription) subscription.remove();
      ScreenCapture.allowScreenCaptureAsync().catch(() => {});
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <AppNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
