import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  generatePrivateSalt, derivePrivateKey, encryptPrivatePayload,
  decryptPrivatePayload, privateSaltFromRecord, validatePrivateCipherRecord,
} from '../src/privateCrypto.ts';
const crypto = webcrypto;
test('PWA Web Crypto password derivation and AES-GCM record round trip, including Unicode', async () => {
  const salt = await generatePrivateSalt(crypto);
  const password = 'private-🔒-password-2026';
  const key = await derivePrivateKey(password, salt, crypto);
  const payload = { title: '旅行計画', text: '秘密 🔒', html: '<b>秘密</b>', category: 'personal' };
  const first = await encryptPrivatePayload(payload, key, salt, crypto);
  const second = await encryptPrivatePayload(payload, key, salt, crypto);
  assert.deepEqual(await decryptPrivatePayload(first, key, crypto), payload);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.deepEqual(privateSaltFromRecord(first), salt);
  const importedKey = await derivePrivateKey(password, privateSaltFromRecord(first), crypto);
  assert.deepEqual(await decryptPrivatePayload(first, importedKey, crypto), payload);
  const wrongKey = await derivePrivateKey('wrong-private-password', salt, crypto);
  await assert.rejects(decryptPrivatePayload(first, wrongKey, crypto));
  const tampered = { ...first, ciphertext: first.ciphertext.slice(0, -4) + 'AAAA' };
  await assert.rejects(decryptPrivatePayload(tampered, key, crypto));
  assert.throws(() => validatePrivateCipherRecord({ ...first, iv: 'invalid' }));
});
test('fails closed when secure Web Crypto is unavailable', async () => {
  await assert.rejects(generatePrivateSalt(null), /unavailable/);
  await assert.rejects(derivePrivateKey('password', new Uint8Array(16), null), /unavailable/);
});
