import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import { firebaseClientConfig } from './firebaseConfig';

let cachedAuth: Auth | undefined;

function getFirebaseApp() {
  return getApps().some((app) => app.name === '[DEFAULT]')
    ? getApp()
    : initializeApp(firebaseClientConfig);
}

function isAuthAlreadyInitialized(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'auth/already-initialized'
  );
}

/** Initialize Firebase Auth with native AsyncStorage; do not use getAuth first. */
export function getMobileAuth(): Auth {
  if (cachedAuth) return cachedAuth;

  const app = getFirebaseApp();
  try {
    cachedAuth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (error) {
    // Fast refresh can evaluate this module again after the RN-persistent Auth
    // instance has already been created. Reuse only that existing instance.
    if (!isAuthAlreadyInitialized(error)) throw error;
    cachedAuth = getAuth(app);
  }

  return cachedAuth;
}
