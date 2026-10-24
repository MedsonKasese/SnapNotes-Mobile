import { generatePrivateSalt, derivePrivateKey, encryptPrivatePayload, decryptPrivatePayload, privateSaltFromRecord, PRIVATE_MIN_PASSWORD_LENGTH } from './privateCrypto.ts';
import { createPrivateVaultStorage, type PrivateVaultEntry } from './privateVaultStorage.ts';

export const PRIVATE_VERIFIER_ID = '__snapnotes-private-verifier-v1__';
const VERIFIER_TEXT = 'snapnotes-private-vault-ready-v1';

type Backend = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

export function validatePrivatePassword(password: string, confirmation: string): string | null {
  if (password.length < PRIVATE_MIN_PASSWORD_LENGTH) return 'Use at least 12 characters.';
  if (password !== confirmation) return 'Passwords do not match.';
  return null;
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
      const salt = await generatePrivateSalt();
      const key = await derivePrivateKey(password, salt);
      const privateData = await encryptPrivatePayload({ verifier: VERIFIER_TEXT }, key, salt);
      const entry: PrivateVaultEntry = { id: PRIVATE_VERIFIER_ID, privateData };
      await vault.save([entry]);
    },
    async unlock(password: string): Promise<void> {
      const entries = await vault.load();
      const verifier = entries.find(item => item.id === PRIVATE_VERIFIER_ID);
      if (!verifier) throw new Error('Private vault has no password verifier.');
      try {
        const key = await derivePrivateKey(password, privateSaltFromRecord(verifier.privateData));
        const payload = await decryptPrivatePayload(verifier.privateData, key);
        if (!payload || typeof payload !== 'object' || (payload as { verifier?: unknown }).verifier !== VERIFIER_TEXT) {
          throw new Error('Incorrect password or damaged private vault.');
        }
      } catch {
        throw new Error('Incorrect password or damaged private vault.');
      }
    },
  };
}
