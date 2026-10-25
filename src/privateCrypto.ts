import { gcm } from '@noble/ciphers/aes.js';
import { PrivateOperationTimeoutError, waitForPrivateOperation } from './privateAsync.ts';

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
let nativeDerivationPending = false;

export class PrivateCryptoUnavailableError extends Error {
  constructor() {
    super('Private Notes requires a compatible SnapNotes development APK. Expo Go does not include its native cryptography. Your encrypted vault was not changed. [PV-NATIVE]');
    this.name = 'PrivateCryptoUnavailableError';
  }
}

export class PrivateCryptoBusyError extends Error {
  constructor() {
    super('The previous native key operation is still running. Wait for it to finish or restart the app without clearing its data. [PV-BUSY]');
    this.name = 'PrivateCryptoBusyError';
  }
}

async function getNativeCryptoProvider(): Promise<CryptoLike> {
  if (!nativeCryptoProviderPromise) {
    nativeCryptoProviderPromise = (async () => {
      try {
        const { install } = await import('react-native-quick-crypto');
        install();
        const provider = globalThis.crypto as CryptoLike | undefined;
        if (!provider?.subtle || typeof provider.getRandomValues !== 'function') {
          throw new PrivateCryptoUnavailableError();
        }
        return provider;
      } catch {
        throw new PrivateCryptoUnavailableError();
      }
    })();
    // A failed first initialization must not poison all subsequent attempts.
    void nativeCryptoProviderPromise.catch(() => { nativeCryptoProviderPromise = undefined; });
  }
  return waitForPrivateOperation(nativeCryptoProviderPromise, 10_000);
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
  const length = base64ByteLength(value);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) {
    const n = (alphabet.indexOf(value[i]) << 18) | (alphabet.indexOf(value[i + 1]) << 12) |
      ((value[i + 2] === '=' ? 0 : alphabet.indexOf(value[i + 2])) << 6) |
      (value[i + 3] === '=' ? 0 : alphabet.indexOf(value[i + 3]));
    bytes[offset++] = (n >> 16) & 255;
    if (offset < length) bytes[offset++] = (n >> 8) & 255;
    if (offset < length) bytes[offset++] = n & 255;
  }
  return bytes;
}

// Validate encoded fields without allocating/decoding every note's ciphertext
// when loading the locked vault. Authentication still happens before plaintext.
function base64ByteLength(value: string): number {
  if (value.length % 4 !== 0) throw Error('Invalid private note encoding.');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const end = value.length - padding;
  if ((padding === 2 && end % 4 !== 2) || (padding === 1 && end % 4 !== 3)) {
    throw Error('Invalid private note encoding.');
  }
  for (let i = 0; i < end; i += 1) {
    const c = value.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
      (c >= 48 && c <= 57) || c === 43 || c === 47)) {
      throw Error('Invalid private note encoding.');
    }
  }
  return value.length / 4 * 3 - padding;
}

function decodePrivateUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  // Some native runtimes have TextEncoder but no TextDecoder. URI decoding is
  // strict UTF-8 (rejects truncation, overlong sequences and surrogate encodings),
  // unlike Buffer.toString which silently replaces malformed bytes. No globals
  // are patched and a real decoder failure is never swallowed.
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 4096) {
    let chunk = '';
    for (let j = i; j < Math.min(i + 4096, bytes.length); j += 1) {
      chunk += '%' + bytes[j].toString(16).padStart(2, '0');
    }
    chunks.push(chunk);
  }
  const text = decodeURIComponent(chunks.join(''));
  // Match TextDecoder's default BOM handling.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function validatePrivateCipherRecord(value: unknown): PrivateCipherRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid encrypted private note.');
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || data.algorithm !== 'AES-GCM' || data.kdf !== 'PBKDF2-SHA-256' ||
    data.iterations !== PRIVATE_KDF_ITERATIONS || typeof data.salt !== 'string' ||
    typeof data.iv !== 'string' || typeof data.ciphertext !== 'string' ||
    base64ByteLength(data.salt) < 16 || base64ByteLength(data.iv) !== 12 ||
    base64ByteLength(data.ciphertext) < 17) throw Error('Unsupported or invalid private note format.');
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
  if (typeof password !== 'string' || !password) throw Error('Private Notes password is required.');
  if (salt.length < 16) throw Error('Invalid private-note salt.');
  const provider = await resolveCryptoProvider(cryptoProvider);
  const native = cryptoProvider === undefined;
  if (native && nativeDerivationPending) throw new PrivateCryptoBusyError();
  if (native) nativeDerivationPending = true;
  const work = (async () => {
    const encoded = new TextEncoder().encode(password);
    try {
      const material = await provider.subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveKey']);
      return await provider.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: PRIVATE_KDF_ITERATIONS, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    } finally {
      encoded.fill(0);
    }
  })();
  // A UI timeout does not cancel native PBKDF2. Hold the guard until the real
  // work settles so repeated presses cannot start more expensive native jobs.
  void work.then(
    () => { if (native) nativeDerivationPending = false; },
    () => { if (native) nativeDerivationPending = false; },
  );
  return waitForPrivateOperation(work, 30_000);
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
    : new Uint8Array(await waitForPrivateOperation(provider.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      plaintext as BufferSource,
    ), 10_000));
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
      : new Uint8Array(await waitForPrivateOperation((await resolveCryptoProvider(cryptoProvider)).subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        ciphertext as BufferSource,
      ), 10_000));
  } catch (cause) {
    if (cause instanceof PrivateOperationTimeoutError) throw cause;
    throw new PrivatePayloadError('decrypt');
  }
  try {
    return JSON.parse(decodePrivateUtf8(plaintext));
  } catch {
    throw new PrivatePayloadError('decode');
  } finally {
    plaintext.fill(0);
  }
}

export function privateSaltFromRecord(value: unknown): Uint8Array {
  return base64ToBytes(validatePrivateCipherRecord(value).salt);
}
