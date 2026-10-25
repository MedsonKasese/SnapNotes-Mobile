import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
import { gcm } from '@noble/ciphers/aes.js';
import { Buffer } from 'node:buffer';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Execute the production native adapter, but replace only the module/native
// boundary and timers. This tests deadlines without 30-second sleeps. It is
// not a test of the Android binary or its C++ implementation.
function harness({ load, decoder = undefined } = {}) {
  const timers = new Map();
  let id = 0, imports = 0;
  const context = vm.createContext({
    TextEncoder, TextDecoder: decoder, Uint8Array, ArrayBuffer,
    setTimeout(callback, ms) { timers.set(++id, { callback, ms }); return id; },
    clearTimeout(key) { timers.delete(key); },
  });
  function execute(path, dependencies) {
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const module = { exports: {} };
    vm.runInContext(`(function(require, module, exports) { ${outputText}\n})`, context)(
      name => { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name]; },
      module, module.exports,
    );
    return module.exports;
  }
  const asyncApi = execute('privateAsync.ts', {});
  const crypto = execute('privateCrypto.ts', {
    './privateAsync.ts': asyncApi,
    '@noble/ciphers/aes.js': { gcm },
    'react-native-quick-crypto': {
      install() { imports += 1; context.crypto = load ? load(imports) : webcrypto; },
    },
  });
  return {
    crypto, ...asyncApi,
    fire(ms) {
      for (const [key, timer] of [...timers]) {
        if (timer.ms === ms) { timers.delete(key); timer.callback(); }
      }
    },
    get imports() { return imports; },
    get timers() { return timers.size; },
    async flush() { for (let i = 0; i < 30; i += 1) await Promise.resolve(); },
  };
}

const password = 'private-🔒-password-2026';
const salt = new Uint8Array(16).fill(7);

test('native initialization failures are actionable, redacted and retryable', async () => {
  const app = harness({ load(attempt) { if (attempt === 1) throw new Error('private-native-detail'); return webcrypto; } });
  await assert.rejects(app.crypto.derivePrivateKey(password, salt), error => {
    assert.match(error.message, /\[PV-NATIVE\]/);
    assert.match(error.message, /Expo Go/);
    assert.equal(error.message.includes('private-native-detail'), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  const key = await app.crypto.derivePrivateKey(password, salt);
  assert.equal(key.extractable, false);
  assert.equal(app.imports, 2);
  assert.equal(app.timers, 0);
});

test('native derivation deadline cannot unlock late or start duplicate KDF work', async () => {
  const pending = deferred();
  let calls = 0, savedPassword;
  const provider = {
    getRandomValues: bytes => webcrypto.getRandomValues(bytes),
    subtle: {
      async importKey(_format, encoded) { savedPassword = encoded; return {}; },
      deriveKey(algorithm, _material, target, extractable, usages) {
        calls += 1;
        assert.equal(algorithm.iterations, 600000);
        assert.equal(algorithm.hash, 'SHA-256');
        assert.equal(target.length, 256);
        assert.equal(extractable, false);
        assert.deepEqual([...usages], ['encrypt', 'decrypt']);
        return calls === 1 ? pending.promise : Promise.resolve({ id: 'fresh-key' });
      },
    },
  };
  const app = harness({ load: () => provider });
  const first = app.crypto.derivePrivateKey(password, salt);
  const rejected = assert.rejects(first, /\[PV-TIMEOUT\]/);
  await app.flush();
  app.fire(30000);
  await rejected;
  await assert.rejects(app.crypto.derivePrivateKey(password, salt), /\[PV-BUSY\]/);
  assert.equal(calls, 1);
  pending.resolve({ id: 'late-key' });
  await app.flush();
  assert.equal(savedPassword.every(byte => byte === 0), true, 'temporary password bytes are wiped after real completion');
  const fresh = await app.crypto.derivePrivateKey(password, salt);
  assert.equal(fresh.id, 'fresh-key');
  assert.equal(calls, 2);
  assert.equal(app.timers, 0);
});

test('native key failure releases guard and cleans temporary password bytes', async () => {
  let encoded;
  const provider = {
    getRandomValues: bytes => bytes,
    subtle: {
      async importKey(_format, bytes) { encoded = bytes; throw new Error('failure'); },
    },
  };
  const app = harness({ load: () => provider });
  await assert.rejects(app.crypto.derivePrivateKey(password, salt), /failure/);
  assert.equal(encoded.every(byte => byte === 0), true);
  await assert.rejects(app.crypto.derivePrivateKey(password, salt), /failure/);
  assert.equal(app.timers, 0);
});

test('AES timeout remains a timeout, not an incorrect-password diagnosis', async () => {
  const app = harness();
  const record = {
    version: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA-256', iterations: 600000,
    salt: Buffer.from(salt).toString('base64'), iv: Buffer.alloc(12).toString('base64'),
    ciphertext: Buffer.alloc(17).toString('base64'),
  };
  const pending = deferred();
  const provider = { getRandomValues: bytes => bytes, subtle: { decrypt: () => pending.promise } };
  const work = app.crypto.decryptPrivatePayload(record, {}, provider);
  const rejected = assert.rejects(work, /\[PV-TIMEOUT\]/);
  await app.flush(); app.fire(10000); await rejected;
  pending.resolve(new ArrayBuffer(0)); await app.flush();
  assert.equal(app.timers, 0);
});

test('strict UTF-8 fallback opens Unicode records without TextDecoder and rejects malformed UTF-8', async () => {
  const app = harness();
  const key = await app.crypto.derivePrivateKey(password, salt, webcrypto);
  const payload = { title: '秘密 🔒', text: '\u0000é𝄞\ufeff', html: '<b>旅行</b>' };
  const record = await app.crypto.encryptPrivatePayload(payload, key, salt, webcrypto);
  assert.deepEqual(JSON.parse(JSON.stringify(await app.crypto.decryptPrivatePayload(record, key, webcrypto))), payload);

  const plaintexts = [
    [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80],
    [0xe2, 0x82], [0x80], [0x22, 0xc0, 0xaf, 0x22],
  ];
  for (const bytes of plaintexts) {
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, Uint8Array.from(bytes));
    const malformed = { ...record, iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(encrypted).toString('base64') };
    await assert.rejects(app.crypto.decryptPrivatePayload(malformed, key, webcrypto), error => {
      assert.equal(error.stage, 'decode');
      return true;
    });
  }
});

test('deadline helper ignores late resolve/reject and clears completed timers', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const app = harness();
    const pending = deferred();
    const work = app.waitForPrivateOperation(pending.promise, 12);
    const rejection = assert.rejects(work, /\[PV-TIMEOUT\]/);
    app.fire(12); await rejection;
    pending[outcome](outcome === 'resolve' ? 'late' : new Error('late'));
    await app.flush();
    assert.equal(app.timers, 0);
  }
  const app = harness();
  assert.equal(await app.waitForPrivateOperation(Promise.resolve('ready'), 12), 'ready');
  assert.equal(app.timers, 0);
});
