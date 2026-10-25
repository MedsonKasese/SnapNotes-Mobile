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

test('empty password is rejected without waiting for storage', async () => {
  let reads = 0;
  const access = createPrivateAccess({
    getItem() { reads += 1; return new Promise(() => {}); },
    async setItem() { assert.fail('unlock must not write'); },
  });
  await assert.rejects(access.unlock(''), /Enter your Private Notes password/);
  assert.equal(reads, 0);
});

test('read deadline fails closed, ignores a late result and permits recovery after storage settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release, stalled = true, writes = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const access = createPrivateAccess({
    getItem() { return stalled ? blocked : Promise.resolve(null); },
    async setItem() { writes += 1; },
  });
  for (const operation of ['status', 'unlock', 'setup']) {
    const work = operation === 'unlock' ? access.unlock('password')
      : operation === 'setup' ? access.setup('long-password-123', 'long-password-123') : access.status();
    const rejected = assert.rejects(work, /\[PV-TIMEOUT\]/);
    await Promise.resolve();
    t.mock.timers.tick(10000);
    await rejected;
  }
  assert.equal(writes, 0);
  stalled = false;
  release(null);
  assert.equal(await access.status(), 'setup');
  assert.equal(writes, 0);
});

test('status redacts backend failure details and is retryable', async () => {
  let failed = true;
  const access = createPrivateAccess({
    async getItem() { if (failed) throw new Error('private-storage-sentinel'); return null; },
    async setItem() { assert.fail('status must not write'); },
  });
  await assert.rejects(access.status(), error => {
    assert.match(error.message, /\[PV-STORAGE\]/);
    assert.equal(error.message.includes('private-storage-sentinel'), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  failed = false;
  assert.equal(await access.status(), 'setup');
});
