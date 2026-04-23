import { NativeModules, Platform } from 'react-native';

/**
 * Resolve the backend host for the current runtime.
 *
 * Strategy (dev):
 *   Ask the JS runtime which host loaded this bundle and reuse that IP for API
 *   calls. This means: when a teammate scans the Expo QR code on another phone,
 *   the app that loads from your PC's LAN IP automatically points its API to
 *   the same LAN IP — no env var or manual IP setup required.
 *
 *   - Web            → window.location.hostname
 *   - iOS / Android  → NativeModules.SourceCode.scriptURL (Metro bundler URL)
 *
 * Fallbacks:
 *   1. EXPO_PUBLIC_API_HOST env var (manual override if needed)
 *   2. Platform default: Android emulator → 10.0.2.2, else → localhost
 *
 * Production builds (__DEV__ === false) ignore auto-detection and expect
 * EXPO_PUBLIC_API_HOST to point at a real public backend URL.
 */

function detectDevHost() {
  // Web: the browser knows its own hostname
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      return window.location.hostname;
    }
    return null;
  }

  // Native: Metro sets scriptURL to the URL this JS bundle was fetched from,
  // e.g. "http://192.168.1.5:8081/index.bundle?platform=ios&dev=true".
  try {
    const sc = NativeModules.SourceCode;
    const scriptURL = sc?.getConstants?.().scriptURL || sc?.scriptURL;
    if (!scriptURL) return null;
    const m = scriptURL.match(/^https?:\/\/([^:/]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const envHost = process.env.EXPO_PUBLIC_API_HOST;
const defaultHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
// Only auto-detect in dev. In release builds, require an explicit env host.
const devHost = (typeof __DEV__ !== 'undefined' && __DEV__) ? detectDevHost() : null;

export const API_HOST = envHost || devHost || defaultHost;
export const API_PORT = process.env.EXPO_PUBLIC_API_PORT || 8000;
export const API_ORIGIN = `http://${API_HOST}:${API_PORT}`;
export const API_URL = `${API_ORIGIN}/api`;
