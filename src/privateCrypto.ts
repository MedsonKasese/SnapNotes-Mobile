import * as ExpoCrypto from 'expo-crypto';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';

// Compatible with the PWA's private-notes.js version 1 encrypted payload.
// This module fails closed if a secure Web Crypto implementation is unavailable.
// Do not persist decrypted private-note content in normal notes or recovery storage.
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
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw Error('Invalid private note encoding.');
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
export function generatePrivateSalt(cryptoProvider?: CryptoLike | null): Uint8Array {
  if (cryptoProvider === null) throw Error('Secure private-note encryption is unavailable on this device. No private data was written.');
  return cryptoProvider ? cryptoProvider.getRandomValues(new Uint8Array(16)) : ExpoCrypto.getRandomBytes(16);
}
export async function derivePrivateKey(password: string, salt: Uint8Array, cryptoProvider?: CryptoLike | null): Promise<PrivateKey> {
  if (cryptoProvider === null) throw Error('Secure private-note encryption is unavailable on this device. No private data was written.');
  if (typeof password !== 'string' || !password) throw Error('Private Notes password is required.');
  if (salt.length < 16) throw Error('Invalid private-note salt.');
  const encoded = new TextEncoder().encode(password);
  if (cryptoProvider) {
    const material = await cryptoProvider.subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveKey']);
    return cryptoProvider.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: PRIVATE_KDF_ITERATIONS, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  return pbkdf2Async(sha256, encoded, salt, { c: PRIVATE_KDF_ITERATIONS, dkLen: 32, asyncTick: 20 });
}
export async function encryptPrivatePayload(
  payload: unknown, key: PrivateKey, salt: Uint8Array, cryptoProvider?: CryptoLike | null,
): Promise<PrivateCipherRecord> {
  if (cryptoProvider === null) throw Error('Secure private-note encryption is unavailable on this device. No private data was written.');
  if (salt.length < 16) throw Error('Invalid private-note salt.');
  const iv = cryptoProvider ? cryptoProvider.getRandomValues(new Uint8Array(12)) : ExpoCrypto.getRandomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  let ciphertext: Uint8Array;
  if (key instanceof Uint8Array) ciphertext = gcm(key, iv).encrypt(plaintext);
  else if (cryptoProvider) ciphertext = new Uint8Array(await cryptoProvider.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource));
  else throw Error('Invalid private encryption key.');
  return { version: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA-256', iterations: PRIVATE_KDF_ITERATIONS,
    salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) };
}
export async function decryptPrivatePayload(
  value: unknown, key: PrivateKey, cryptoProvider?: CryptoLike | null,
): Promise<unknown> {
  if (cryptoProvider === null) throw Error('Secure private-note encryption is unavailable on this device. No private data was written.');
  const record = validatePrivateCipherRecord(value);
  const iv = base64ToBytes(record.iv), ciphertext = base64ToBytes(record.ciphertext);
  let plaintext: Uint8Array;
  if (key instanceof Uint8Array) plaintext = gcm(key, iv).decrypt(ciphertext);
  else if (cryptoProvider) plaintext = new Uint8Array(await cryptoProvider.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext as BufferSource));
  else throw Error('Invalid private encryption key.');
  return JSON.parse(new TextDecoder().decode(plaintext));
}
export function privateSaltFromRecord(value: unknown): Uint8Array {
  return base64ToBytes(validatePrivateCipherRecord(value).salt);
}
