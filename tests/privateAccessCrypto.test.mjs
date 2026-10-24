import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const projectRoot = new URL('../', import.meta.url);

async function makeHarness({ beforeDerive } = {}) {
  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, console });
  const cryptoSource = await readFile(new URL('src/privateCrypto.ts', projectRoot), 'utf8');
  const storageSource = await readFile(new URL('src/privateVaultStorage.ts', projectRoot), 'utf8');
  const accessSource = await readFile(new URL('src/privateAccess.ts', projectRoot), 'utf8');

  function execute(source, filename, resolve) {
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    }).outputText;
    const module = { exports: {} };
    const run = vm.runInContext(`(function (require, module, exports) { ${output}\n})`, context, { filename });
    run(resolve, module, module.exports);
    return module.exports;
  }

  const cryptoExports = execute(cryptoSource, 'privateCrypto.ts', specifier => {
    if (specifier === '@noble/ciphers/aes.js') return { gcm: () => { throw new Error('Unexpected non-WebCrypto path'); } };
    throw new Error(`Unexpected crypto dependency: ${specifier}`);
  });
  const cryptoAdapter = {
    ...cryptoExports,
    generatePrivateSalt: (...args) => cryptoExports.generatePrivateSalt(...args, webcrypto),
    async derivePrivateKey(password, salt) {
      if (beforeDerive) await beforeDerive();
      return cryptoExports.derivePrivateKey(password, salt, webcrypto);
    },
    encryptPrivatePayload: (...args) => cryptoExports.encryptPrivatePayload(...args, webcrypto),
    decryptPrivatePayload: (...args) => cryptoExports.decryptPrivatePayload(...args, webcrypto),
  };
  const storageExports = execute(storageSource, 'privateVaultStorage.ts', specifier => {
    if (specifier === './privateCrypto.ts') return cryptoExports;
    throw new Error(`Unexpected storage dependency: ${specifier}`);
  });
  const accessExports = execute(accessSource, 'privateAccess.ts', specifier => {
    if (specifier === './privateCrypto.ts') return cryptoAdapter;
    if (specifier === './privateVaultStorage.ts') return storageExports;
    throw new Error(`Unexpected access dependency: ${specifier}`);
  });
  return {
    createAccess: backend => accessExports.createPrivateAccess(backend),
    createVault: backend => storageExports.createPrivateVaultStorage(backend),
  };
}

function memoryBackend() {
  const values = new Map();
  let failNextIndexWrite = false;
  return {
    values,
    failNextIndexWrite() { failNextIndexWrite = true; },
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) {
      if (failNextIndexWrite && key === '@snapnotes-mobile/private-vault/index') {
        failNextIndexWrite = false;
        throw new Error('simulated index commit failure');
      }
      values.set(key, value);
    },
  };
}

const password = 'long-private-password-2026';
const verifierText = 'snapnotes-private-vault-ready-v1';
const ordinaryRecords = new Map([
  ['@snapnotes-mobile/note/existing-note', '{"title":"ordinary note sentinel"}'],
  ['@snapnotes-mobile/draft/existing-draft', '{"text":"ordinary draft sentinel"}'],
]);

test('simultaneous setup from two access factories initializes shared vault once', async () => {
  const backend = memoryBackend();
  for (const [key, value] of ordinaryRecords) backend.values.set(key, value);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let deriveCalls = 0;
  const harness = await makeHarness({
    beforeDerive: async () => {
      deriveCalls += 1;
      if (deriveCalls === 2) release();
      await blocked;
    },
  });
  const firstPassword = 'first-private-password-2026';
  const secondPassword = 'second-private-password-2026';
  const first = harness.createAccess(backend);
  const second = harness.createAccess(backend);
  const attempts = await Promise.allSettled([
    first.setup(firstPassword, firstPassword),
    second.setup(secondPassword, secondPassword),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1,
    'exactly one concurrent setup may commit');
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
  const winnerIndex = attempts.findIndex(result => result.status === 'fulfilled');
  const winner = winnerIndex === 0 ? first : second;
  const winnerPassword = winnerIndex === 0 ? firstPassword : secondPassword;
  const losingPassword = winnerIndex === 0 ? secondPassword : firstPassword;
  await winner.unlock(winnerPassword);
  await assert.rejects(winner.unlock(losingPassword), /Incorrect password/);

  const persisted = [...backend.values.values()].join('\n');
  assert.equal(persisted.includes(firstPassword), false);
  assert.equal(persisted.includes(secondPassword), false);
  assert.equal(persisted.includes(verifierText), false);
  for (const [key, value] of ordinaryRecords) assert.equal(backend.values.get(key), value);
});

test('a vault committed by another writer during crypto setup is preserved', async () => {
  const backend = memoryBackend();
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let entered;
  const cryptoStarted = new Promise(resolve => { entered = resolve; });
  const harness = await makeHarness({ beforeDerive: async () => { entered(); await blocked; } });
  const access = harness.createAccess(backend);
  const setup = access.setup(password, password);
  await cryptoStarted;
  const competing = [{
    id: 'already-committed',
    privateData: {
      version: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA-256', iterations: 600000,
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAA=',
    },
  }];
  await harness.createVault(backend).save(competing);
  release();
  await assert.rejects(setup, /already exists/);
  assert.equal(JSON.stringify(await harness.createVault(backend).load()), JSON.stringify(competing));
});

test('real WebCrypto setup unlocks with its password and rejects a wrong password', async () => {
  const backend = memoryBackend();
  const harness = await makeHarness();
  const access = harness.createAccess(backend);
  await access.setup(password, password);
  await access.unlock(password);
  await assert.rejects(access.unlock('wrong-password-2026'), /Incorrect password/);
  const persisted = [...backend.values.values()].join('\n');
  assert.equal(persisted.includes(password), false);
  assert.equal(persisted.includes(verifierText), false);
});

test('failed setup commit leaves an empty vault retryable', async () => {
  const backend = memoryBackend();
  const harness = await makeHarness();
  const access = harness.createAccess(backend);
  backend.failNextIndexWrite();
  await assert.rejects(access.setup(password, password), /index commit failure/);
  assert.equal(await access.status(), 'setup');
  await access.setup(password, password);
  await access.unlock(password);
});
