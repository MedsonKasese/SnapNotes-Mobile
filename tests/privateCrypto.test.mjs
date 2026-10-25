import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  generatePrivateSalt, derivePrivateKey, encryptPrivatePayload,
  decryptPrivatePayload, privateSaltFromRecord, validatePrivateCipherRecord, PrivatePayloadError,
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

test('decrypt reports AES-GCM authentication failures as sanitized decrypt-stage errors', async () => {
  const salt = await generatePrivateSalt(crypto);
  const key = await derivePrivateKey('private-password-2026', salt, crypto);
  const record = await encryptPrivatePayload({ note: 'secret payload' }, key, salt, crypto);
  const tampered = { ...record, ciphertext: record.ciphertext.slice(0, -4) + 'AAAA' };

  await assert.rejects(decryptPrivatePayload(tampered, key, crypto), error => {
    assert.equal(error instanceof PrivatePayloadError, true);
    assert.equal(error.stage, 'decrypt');
    assert.equal(typeof error.message, 'string');
    assert.equal(error.message.includes('secret payload'), false);
    assert.equal(error.message.includes('OperationError'), false);
    assert.equal(error.cause, undefined, 'native authentication errors must not be attached as causes');
    return true;
  });
});

test('decrypt reports plaintext decoding and JSON parsing failures as decode-stage errors', async () => {
  const salt = await generatePrivateSalt(crypto);
  const key = await derivePrivateKey('private-password-2026', salt, crypto);
  const template = await encryptPrivatePayload({ ok: true }, key, salt, crypto);
  const iv = Buffer.from(template.iv, 'base64');
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode('x'),
  ));
  const invalidJsonRecord = { ...template, ciphertext: Buffer.from(ciphertext).toString('base64') };

  await assert.rejects(decryptPrivatePayload(invalidJsonRecord, key, crypto), error => {
    assert.equal(error instanceof PrivatePayloadError, true);
    assert.equal(error.stage, 'decode');
    assert.equal(typeof error.message, 'string');
    assert.equal(error.message.includes('undefined'), false);
    assert.equal(error.cause, undefined, 'decode/parse internals must not be attached as causes');
    return true;
  });
});

test('fails closed when secure Web Crypto is unavailable', async () => {
  await assert.rejects(generatePrivateSalt(null), /unavailable/);
  await assert.rejects(derivePrivateKey('password', new Uint8Array(16), null), /unavailable/);
});

test('large locked records validate without decoding each ciphertext into byte arrays', () => {
  const record = {
    version: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA-256', iterations: 600000,
    salt: Buffer.alloc(16).toString('base64'), iv: Buffer.alloc(12).toString('base64'),
    ciphertext: Buffer.alloc(700000).toString('base64'),
  };
  assert.equal(validatePrivateCipherRecord(record), record);
  for (const invalid of ['A', 'AAA', 'AAAA=', 'AAAA===', 'AA=A', '====', 'AAA\n', 'AAA-', 'AAA_']) {
    assert.throws(() => validatePrivateCipherRecord({ ...record, salt: invalid }));
    assert.throws(() => validatePrivateCipherRecord({ ...record, ciphertext: invalid }));
  }
  // Bad characters anywhere in a large encoded field must still fail closed.
  for (const position of [0, 200000, record.ciphertext.length - 1]) {
    const invalid = record.ciphertext.slice(0, position) + '!' + record.ciphertext.slice(position + 1);
    assert.throws(() => validatePrivateCipherRecord({ ...record, ciphertext: invalid }));
  }
});
