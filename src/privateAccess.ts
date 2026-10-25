import { generatePrivateSalt, derivePrivateKey, encryptPrivatePayload, decryptPrivatePayload, privateSaltFromRecord, PrivatePayloadError, PRIVATE_MIN_PASSWORD_LENGTH, type PrivateCipherRecord } from './privateCrypto.ts';
import { createPrivateVaultStorage, type PrivateVaultEntry } from './privateVaultStorage.ts';

export const PRIVATE_VERIFIER_ID = '__snapnotes-private-verifier-v1__';
const VERIFIER_TEXT = 'snapnotes-private-vault-ready-v1';

type Backend = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

export function validatePrivatePassword(password: string, confirmation: string): string | null {
  if (password.length < PRIVATE_MIN_PASSWORD_LENGTH) return 'Use at least 12 characters.';
  if (password !== confirmation) return 'Passwords do not match.';
  return null;
}

async function verifyPassword(password: string, privateData: PrivateCipherRecord): Promise<void> {
  if (!password) throw new Error('Enter your Private Notes password.');
  let salt: Uint8Array;
  try {
    salt = privateSaltFromRecord(privateData);
  } catch {
    throw new Error('The encrypted password verifier has an unsupported format. No changes were made. [PV-DATA]');
  }
  let key: Awaited<ReturnType<typeof derivePrivateKey>>;
  try {
    key = await derivePrivateKey(password, salt);
  } catch {
    // Provider initialization, importKey and PBKDF2 failures are not evidence of
    // a wrong password. Never surface raw native exception details or inputs.
    throw new Error('This build could not prepare the private key. Check the native development build and try again. No changes were made. [PV-KEY]');
  }
  let payload: unknown;
  try {
    payload = await decryptPrivatePayload(privateData, key);
  } catch (cause) {
    if (cause instanceof PrivatePayloadError && cause.stage === 'decode') {
      throw new Error('The vault decrypted, but this build could not read its payload. Check the app runtime. No changes were made. [PV-DECODE]');
    }
    // AES-GCM authentication cannot distinguish a wrong password, damaged
    // ciphertext or a faulty native decrypt implementation. Do not claim it can.
    throw new Error('Could not authenticate the vault. Incorrect password, damaged data, or a native decryption failure may be responsible. No changes were made. [PV-AUTH]');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
    (payload as { verifier?: unknown }).verifier !== VERIFIER_TEXT) {
    throw new Error('The decrypted password verifier was not recognized. No changes were made. [PV-VERIFY]');
  }
}

export function createPrivateAccess(backend: Backend) {
  const vault = createPrivateVaultStorage(backend);
  return {
    async status(): Promise<'setup' | 'locked'> {
      const entries = await vault.load();
      if (entries.length === 0) return 'setup';
      if (!entries.some(item => item.id === PRIVATE_VERIFIER_ID)) {
        throw new Error('Private vault exists without a password verifier. Setup is blocked to protect existing data.');
      }
      return 'locked';
    },
    async setup(password: string, confirmation: string): Promise<void> {
      const error = validatePrivatePassword(password, confirmation);
      if (error) throw new Error(error);
      // Never overwrite an existing vault or silently reset a forgotten password.
      if ((await vault.load()).length !== 0) throw new Error('Private vault already exists.');
      let privateData: PrivateCipherRecord;
      try {
        const salt = await generatePrivateSalt();
        const key = await derivePrivateKey(password, salt);
        // Exercise the serialized record and a newly derived key, rather than a
        // same-key round trip. Broken crypto/runtime setups must not be saved.
        privateData = JSON.parse(JSON.stringify(await encryptPrivatePayload({ verifier: VERIFIER_TEXT }, key, salt)));
        await verifyPassword(password, privateData);
      } catch {
        throw new Error('Private Notes setup could not be verified on this device. No vault was saved. Check the native development build. [PV-SETUP]');
      }
      const entry: PrivateVaultEntry = { id: PRIVATE_VERIFIER_ID, privateData };
      if (!await vault.initializeIfEmpty([entry])) throw new Error('Private vault already exists.');
    },
    async unlock(password: string): Promise<void> {
      let entries: PrivateVaultEntry[];
      try {
        entries = await vault.load();
      } catch {
        throw new Error('Could not read the encrypted vault. No changes were made. [PV-STORAGE]');
      }
      const verifier = entries.find(item => item.id === PRIVATE_VERIFIER_ID);
      if (!verifier) throw new Error('Private vault has no password verifier.');
      await verifyPassword(password, verifier.privateData);
    },
  };
}
