import { gcm } from '@noble/ciphers/aes.js';

// Compatible with the PWA's private-notes.js version 1 encrypted payload.
// Native builds use Quick Crypto so PBKDF2 runs in native code rather than a
// slow JavaScript loop. Never weaken the PWA's KDF settings or write plaintext.
export const PRIVATE_CRYPTO_VERSION = 1;
export const PRIVATE_KDF_ITERATIONS = 600_000;
export const PRIVATE_MIN_PASSWORD_LENGTH = 12;
export type PrivateCipherRecord = {
  version: 1;
  algorithm: 'AES-GCM';
  kdf: 'PBKDF2-SHA-256';
  iterations: 600000;
  salt: string;
  iv: string;
  ciphertext: string;
};
type CryptoLike = Pick<Crypto, 'getRandomValues' | 'subtle'>;
type PrivateKey = CryptoKey | Uint8Array;

// Keep native exception details out of the UI: errors may contain inputs. These
// stages distinguish authentication failures from a missing/broken text decoder.
export class PrivatePayloadError extends Error {
  readonly stage: 'decrypt' | 'decode';

  constructor(stage: 'decrypt' | 'decode') {
    super(stage === 'decrypt' ? 'Private payload decryption failed.' : 'Private payload decoding failed.');
    this.name = 'PrivatePayloadError';
    this.stage = stage;
  }
}

let nativeCryptoProviderPromise: Promise<CryptoLike> | undefined;

function unavailableError(): Error {
  return new Error(
    'Native secure cryptography is unavailable. Private Notes encryption requires the SnapNotes development build; Expo Go does not include this native module.',
  );
}

async function getNativeCryptoProvider(): Promise<CryptoLike> {
  if (!nativeCryptoProviderPromise) {
    nativeCryptoProviderPromise = (async () => {
      try {
        const { install } = await import('react-native-quick-crypto');
        install();
        const provider = globalThis.crypto as CryptoLike | undefined;
        if (!provider?.subtle || typeof provider.getRandomValues !== 'function') {
          throw unavailableError();
        }
        return provider;
      } catch {
        throw unavailableError();
      }
    })();
  }
  return nativeCryptoProviderPromise;
}

async function resolveCryptoProvider(cryptoProvider?: CryptoLike | null): Promise<CryptoLike> {
  if (cryptoProvider === null) {
    throw new Error('Secure private-note encryption is unavailable on this device. No private data was written.');
  }
  return cryptoProvider ?? getNativeCryptoProvider();
}

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

function base64ToBytes(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw Error('Invalid private note encoding.');
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
  return Uint8Array.from(bytes);
}

export function validatePrivateCipherRecord(value: unknown): PrivateCipherRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid encrypted private note.');
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || data.algorithm !== 'AES-GCM' || data.kdf !== 'PBKDF2-SHA-256' ||
    data.iterations !== PRIVATE_KDF_ITERATIONS || typeof data.salt !== 'string' ||
    typeof data.iv !== 'string' || typeof data.ciphertext !== 'string' ||
    base64ToBytes(data.salt).length < 16 || base64ToBytes(data.iv).length !== 12 ||
    base64ToBytes(data.ciphertext).length < 17) throw Error('Unsupported or invalid private note format.');
  return data as PrivateCipherRecord;
}

export async function generatePrivateSalt(cryptoProvider?: CryptoLike | null): Promise<Uint8Array> {
  const provider = await resolveCryptoProvider(cryptoProvider);
  return provider.getRandomValues(new Uint8Array(16));
}

export async function derivePrivateKey(
  password: string,
  salt: Uint8Array,
  cryptoProvider?: CryptoLike | null,
): Promise<PrivateKey> {
  return derivePrivateKeyWithExtractability(password, salt, cryptoProvider, false);
}

async function derivePrivateKeyWithExtractability(
  password: string,
  salt: Uint8Array,
  cryptoProvider: CryptoLike | null | undefined,
  extractable: boolean,
): Promise<CryptoKey> {
  if (typeof password !== 'string' || !password) throw Error('Private Notes password is required.');
  if (salt.length < 16) throw Error('Invalid private-note salt.');
  const provider = await resolveCryptoProvider(cryptoProvider);
  const encoded = new TextEncoder().encode(password);
  const material = await provider.subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveKey']);
  return provider.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PRIVATE_KDF_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  );
}

// Exportability is reserved for an explicit biometric enrollment flow. Normal
// password unlock continues to derive a non-exportable key.
export async function derivePrivateKeyForBiometric(
  password: string,
  salt: Uint8Array,
  cryptoProvider?: CryptoLike | null,
): Promise<CryptoKey> {
  return derivePrivateKeyWithExtractability(password, salt, cryptoProvider, true);
}

export async function exportPrivateKey(key: CryptoKey, cryptoProvider?: CryptoLike | null): Promise<Uint8Array> {
  if (!key.extractable) throw Error('The private key is not exportable.');
  const provider = await resolveCryptoProvider(cryptoProvider);
  return new Uint8Array(await provider.subtle.exportKey('raw', key));
}

export async function importPrivateKey(key: Uint8Array, cryptoProvider?: CryptoLike | null): Promise<CryptoKey> {
  if (key.length !== 32) throw Error('Invalid private vault key.');
  const provider = await resolveCryptoProvider(cryptoProvider);
  return provider.subtle.importKey('raw', key as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptPrivatePayload(
  payload: unknown,
  key: PrivateKey,
  salt: Uint8Array,
  cryptoProvider?: CryptoLike | null,
): Promise<PrivateCipherRecord> {
  if (salt.length < 16) throw Error('Invalid private-note salt.');
  const provider = await resolveCryptoProvider(cryptoProvider);
  const iv = provider.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = key instanceof Uint8Array
    ? gcm(key, iv).encrypt(plaintext)
    : new Uint8Array(await provider.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      plaintext as BufferSource,
    ));
  return {
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: PRIVATE_KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };
}

export async function decryptPrivatePayload(
  value: unknown,
  key: PrivateKey,
  cryptoProvider?: CryptoLike | null,
): Promise<unknown> {
  const record = validatePrivateCipherRecord(value);
  const iv = base64ToBytes(record.iv);
  const ciphertext = base64ToBytes(record.ciphertext);
  let plaintext: Uint8Array;
  try {
    plaintext = key instanceof Uint8Array
      ? gcm(key, iv).decrypt(ciphertext)
      : new Uint8Array(await (await resolveCryptoProvider(cryptoProvider)).subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        ciphertext as BufferSource,
      ));
  } catch {
    throw new PrivatePayloadError('decrypt');
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch {
    throw new PrivatePayloadError('decode');
  }
}

export function privateSaltFromRecord(value: unknown): Uint8Array {
  return base64ToBytes(validatePrivateCipherRecord(value).salt);
}
