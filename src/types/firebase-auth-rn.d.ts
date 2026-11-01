import type AsyncStorage from '@react-native-async-storage/async-storage';
import type { Persistence } from 'firebase/auth';

// Firebase 12.14.0 ships getReactNativePersistence in its RN runtime entry,
// but the shared firebase/auth declaration entry omits this platform export.
// Keep the declaration local and typed rather than suppressing the import error
// or casting the storage adapter to an unsafe type.
declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: typeof AsyncStorage): Persistence;
}
