import * as SecureStore from 'expo-secure-store';

export const PRIVATE_BIOMETRIC_KEY_ID = 'snapnotes.private.vault.biometric-key.v1';
export const PRIVATE_BIOMETRIC_ENABLED_FLAG = '@snapnotes-mobile/private-vault/biometric-unlock-enabled';
const PRIVATE_KEY_BYTES = 32;
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Unlock Private Notes',
};

type SecureStorePort = {
  canUseBiometricAuthentication(): boolean;
  getItemAsync(key: string, options?: SecureStore.SecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStore.SecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string, options?: SecureStore.SecureStoreOptions): Promise<void>;
};

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    result += alphabet[a >> 2];
    result += alphabet[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
    result += b === undefined ? '=' : alphabet[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
    result += c === undefined ? '=' : alphabet[c & 63];
  }
  return result;
}

function base64ToPrivateKey(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('The protected biometric key is invalid. Unlock with your password and set up biometric unlock again.');
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 4) {
    const n = (alphabet.indexOf(value[i]) << 18) | (alphabet.indexOf(value[i + 1]) << 12) |
      ((value[i + 2] === '=' ? 0 : alphabet.indexOf(value[i + 2])) << 6) |
      (value[i + 3] === '=' ? 0 : alphabet.indexOf(value[i + 3]));
    bytes.push((n >> 16) & 255);
    if (value[i + 2] !== '=') bytes.push((n >> 8) & 255);
    if (value[i + 3] !== '=') bytes.push(n & 255);
  }
  const key = Uint8Array.from(bytes);
  if (key.length !== PRIVATE_KEY_BYTES || bytesToBase64(key) !== value) {
    key.fill(0);
    throw new Error('The protected biometric key is invalid. Unlock with your password and set up biometric unlock again.');
  }
  return key;
}

export function createPrivateBiometricKeyStore(store: SecureStorePort = SecureStore) {
  return {
    canUse(): boolean {
      try {
        return store.canUseBiometricAuthentication();
      } catch {
        return false;
      }
    },
    async read(): Promise<Uint8Array | null> {
      let encoded: string | null;
      try {
        encoded = await store.getItemAsync(PRIVATE_BIOMETRIC_KEY_ID, SECURE_STORE_OPTIONS);
      } catch {
        // Native errors can include device-specific details. Keep the password path available.
        throw new Error('Biometric verification was canceled or could not be completed. Enter your password to continue.');
      }
      return encoded === null ? null : base64ToPrivateKey(encoded);
    },
    async save(key: Uint8Array): Promise<void> {
      if (key.length !== PRIVATE_KEY_BYTES) throw new Error('The private vault key has an unsupported format.');
      if (!this.canUse()) throw new Error('Secure biometric unlock is not available on this device. Use your password instead.');
      try {
        // SecureStore encrypts this value with the platform's protected keystore/keychain;
        // requireAuthentication prevents its release until device biometric verification.
        await store.setItemAsync(PRIVATE_BIOMETRIC_KEY_ID, bytesToBase64(key), SECURE_STORE_OPTIONS);
      } catch {
        throw new Error('Biometric unlock could not be enabled. No private data was changed. Use your password instead.');
      }
    },
    async remove(): Promise<void> {
      try {
        await store.deleteItemAsync(PRIVATE_BIOMETRIC_KEY_ID, SECURE_STORE_OPTIONS);
      } catch {
        throw new Error('Biometric unlock could not be removed. No private data was changed.');
      }
    },
  };
}

export const privateBiometricKeyStore = createPrivateBiometricKeyStore();
