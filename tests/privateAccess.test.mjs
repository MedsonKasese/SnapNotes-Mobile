import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePrivatePassword, createPrivateAccess } from '../src/privateAccess.ts';

test('password setup requires 12 characters and matching confirmation', () => {
  assert.match(validatePrivatePassword('short', 'short'), /12 characters/);
  assert.match(validatePrivatePassword('long-password-123', 'different'), /match/);
  assert.equal(validatePrivatePassword('long-password-123', 'long-password-123'), null);
});

test('empty vault prompts setup without creating records', async () => {
  const values = new Map();
  const backend = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
  };
  const access = createPrivateAccess(backend);
  assert.equal(await access.status(), 'setup');
  await assert.rejects(access.setup('short', 'short'), /12 characters/);
  assert.equal(values.size, 0);
  await assert.rejects(access.unlock('anything'), /no password verifier/);
});

test('nonempty vault without verifier blocks setup instead of overwriting data', async () => {
  const values = new Map([
    ['@snapnotes-mobile/private-vault/index', JSON.stringify({ version: 1, generation: 'existing' })],
    ['@snapnotes-mobile/private-vault/generation/existing', JSON.stringify({ version: 1, entries: [{
      id: 'existing-encrypted-note',
      privateData: { version: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA-256', iterations: 600000,
        salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA' },
    }] })],
  ]);
  const backend = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
  };
  const access = createPrivateAccess(backend);
  await assert.rejects(access.status(), /without a password verifier/);
  await assert.rejects(access.setup('long-password-123', 'long-password-123'), /already exists/);
});
