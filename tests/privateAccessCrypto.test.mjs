import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { createPrivateSession } from '../src/privateSession.ts';

const projectRoot = new URL('../', import.meta.url);

async function makeHarness(options = {}) {
  const { beforeDerive, deriveHook, encryptHook } = options;
  const decoder = Object.hasOwn(options, 'decoder') ? options.decoder : TextDecoder;
  const context = vm.createContext({ TextEncoder, TextDecoder: decoder, Uint8Array, ArrayBuffer, console });
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
      const derive = () => cryptoExports.derivePrivateKey(password, salt, webcrypto);
      return deriveHook ? deriveHook({ password, salt, derive }) : derive();
    },
    async encryptPrivatePayload(...args) {
      const record = await cryptoExports.encryptPrivatePayload(...args, webcrypto);
      return encryptHook ? encryptHook({ payload: args[0], key: args[1], salt: args[2], record }) : record;
    },
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
    async storeVerifierPayload(backend, payload) {
      const salt = await cryptoExports.generatePrivateSalt(webcrypto);
      const key = await cryptoExports.derivePrivateKey(password, salt, webcrypto);
      const privateData = await cryptoExports.encryptPrivatePayload(payload, key, salt, webcrypto);
      await storageExports.createPrivateVaultStorage(backend).save([{
        id: accessExports.PRIVATE_VERIFIER_ID,
        privateData,
      }]);
    },
    createVaultRecord: (payload, key, salt) =>
      cryptoExports.encryptPrivatePayload(payload, key, salt, webcrypto),
  };
}

function memoryBackend() {
  const values = new Map();
  const writes = [];
  let failNextIndexWrite = false;
  return {
    values,
    writes,
    failNextIndexWrite() { failNextIndexWrite = true; },
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) {
      if (failNextIndexWrite && key === '@snapnotes-mobile/private-vault/index') {
        failNextIndexWrite = false;
        throw new Error('simulated index commit failure');
      }
      writes.push([key, value]);
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

function verifierCipherEntry(backend) {
  const pointer = JSON.parse(backend.values.get('@snapnotes-mobile/private-vault/index'));
  const generationKey = `@snapnotes-mobile/private-vault/generation/${pointer.generation}`;
  const generation = JSON.parse(backend.values.get(generationKey));
  return { generationKey, generation };
}

function assertSanitizedTaggedError(error, tag, forbiddenText) {
  assert.match(error.message, new RegExp(`\\[${tag}\\]`));
  assert.equal(error.message.includes(forbiddenText), false, 'underlying secret text must be redacted');
  assert.equal(error.cause, undefined, 'underlying errors must not be exposed as causes');
  return true;
}

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

test('setup unlocks with its password in a fresh harness and fails closed for a wrong password', async () => {
  const backend = memoryBackend();
  const setupHarness = await makeHarness();
  await setupHarness.createAccess(backend).setup(password, password);
  const snapshot = new Map(backend.values);

  const freshAccess = (await makeHarness()).createAccess(backend);
  await freshAccess.unlock(password);
  const writesBeforeFailure = backend.writes.length;
  await assert.rejects(freshAccess.unlock('wrong-password-2026'), /Incorrect password/);
  assert.equal(backend.writes.length, writesBeforeFailure, 'unlock failure must not write to the backend');
  assert.deepEqual(backend.values, snapshot);
});

test('unlock redacts native/provider key derivation failures and performs no writes', async () => {
  const backend = memoryBackend();
  await (await makeHarness()).createAccess(backend).setup(password, password);
  const writesBeforeFailure = backend.writes.length;
  const failureHarness = await makeHarness({
    deriveHook: async () => { throw new Error('native-provider-secret-sentinel'); },
  });

  await assert.rejects(failureHarness.createAccess(backend).unlock(password), error =>
    assertSanitizedTaggedError(error, 'PV-KEY', 'native-provider-secret-sentinel'));
  assert.equal(backend.writes.length, writesBeforeFailure);
});

test('unlock redacts vault-load failures and performs no writes', async () => {
  const backend = memoryBackend();
  backend.getItem = async () => { throw new Error('storage-private-sentinel'); };
  const access = (await makeHarness()).createAccess(backend);

  await assert.rejects(access.unlock(password), error =>
    assertSanitizedTaggedError(error, 'PV-STORAGE', 'storage-private-sentinel'));
  assert.equal(backend.writes.length, 0);
});

test('empty password is rejected before key derivation or backend writes', async () => {
  const backend = memoryBackend();
  await (await makeHarness()).createAccess(backend).setup(password, password);
  const writesBeforeFailure = backend.writes.length;
  let deriveCalls = 0;
  const harness = await makeHarness({ deriveHook: async () => { deriveCalls += 1; } });

  await assert.rejects(harness.createAccess(backend).unlock(''), error => {
    assert.equal(error.message, 'Enter your Private Notes password.');
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(deriveCalls, 0);
  assert.equal(backend.writes.length, writesBeforeFailure);
});

test('cipher authentication failure has its fixed message and performs no writes', async () => {
  const backend = memoryBackend();
  await (await makeHarness()).createAccess(backend).setup(password, password);
  const { generationKey, generation } = verifierCipherEntry(backend);
  const ciphertext = generation.entries[0].privateData.ciphertext;
  generation.entries[0].privateData.ciphertext = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`;
  backend.values.set(generationKey, JSON.stringify(generation));
  const writesBeforeFailure = backend.writes.length;

  await assert.rejects((await makeHarness()).createAccess(backend).unlock(password), error => {
    assert.equal(error.message,
      'Could not authenticate the vault. Incorrect password, damaged data, or a native decryption failure may be responsible. No changes were made. [PV-AUTH]');
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(backend.writes.length, writesBeforeFailure);
});

test('TextDecoder throws and a missing TextDecoder are reported as sanitized decode failures', async t => {
  const backend = memoryBackend();
  await (await makeHarness()).createAccess(backend).setup(password, password);
  const writesBeforeFailure = backend.writes.length;
  const throwingDecoder = class {
    decode() { throw new Error('decoder-private-sentinel'); }
  };

  await t.test('decoder throws', async () => {
    const access = (await makeHarness({ decoder: throwingDecoder })).createAccess(backend);
    await assert.rejects(access.unlock(password), error =>
      assertSanitizedTaggedError(error, 'PV-DECODE', 'decoder-private-sentinel'));
  });
  await t.test('decoder is missing', async () => {
    const access = (await makeHarness({ decoder: undefined })).createAccess(backend);
    await assert.rejects(access.unlock(password), error => {
      assert.match(error.message, /\[PV-DECODE\]/);
      assert.equal(error.message.includes('TextDecoder'), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  });
  assert.equal(backend.writes.length, writesBeforeFailure);
});

test('an authenticated payload with the wrong verifier reports PV-VERIFY without writing', async () => {
  const backend = memoryBackend();
  const harness = await makeHarness();
  await harness.storeVerifierPayload(backend, { verifier: 'not-the-private-verifier' });
  const writesBeforeFailure = backend.writes.length;

  await assert.rejects(harness.createAccess(backend).unlock(password), error => {
    assert.match(error.message, /\[PV-VERIFY\]/);
    assert.equal(error.message.includes('not-the-private-verifier'), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(backend.writes.length, writesBeforeFailure);
});

test('setup rederivation failure is sanitized and occurs before any backend write', async () => {
  const backend = memoryBackend();
  let deriveCalls = 0;
  const harness = await makeHarness({
    deriveHook: async ({ derive }) => {
      deriveCalls += 1;
      if (deriveCalls === 2) throw new Error('setup-rederive-secret-sentinel');
      return derive();
    },
  });

  await assert.rejects(harness.createAccess(backend).setup(password, password), error =>
    assertSanitizedTaggedError(error, 'PV-SETUP', 'setup-rederive-secret-sentinel'));
  assert.equal(deriveCalls, 2, 'setup must derive a fresh key from the stored salt before committing');
  assert.equal(backend.writes.length, 0);
  assert.equal(backend.values.size, 0);
});

test('setup decoder failure is sanitized and occurs before any backend write', async () => {
  const throwingDecoder = class {
    decode() { throw new Error('setup-decoder-secret-sentinel'); }
  };
  const backend = memoryBackend();
  const harness = await makeHarness({ decoder: throwingDecoder });

  await assert.rejects(harness.createAccess(backend).setup(password, password), error =>
    assertSanitizedTaggedError(error, 'PV-SETUP', 'setup-decoder-secret-sentinel'));
  assert.equal(backend.writes.length, 0);
  assert.equal(backend.values.size, 0);
});

test('setup JSON round-trip corruption and a non-exact verifier are rejected before writes', async t => {
  await t.test('cipher record changes through JSON serialization', async () => {
    const backend = memoryBackend();
    const harness = await makeHarness({
      encryptHook: ({ record }) => {
        const result = { ...record };
        Object.defineProperty(result, 'toJSON', {
          value: () => ({ ...record, ciphertext: `${record.ciphertext[0] === 'A' ? 'B' : 'A'}${record.ciphertext.slice(1)}` }),
        });
        return result;
      },
    });
    await assert.rejects(harness.createAccess(backend).setup(password, password), /\[PV-SETUP\]/);
    assert.equal(backend.writes.length, 0);
    assert.equal(backend.values.size, 0);
  });

  await t.test('decrypted verifier must match the exact verifier string', async () => {
    const backend = memoryBackend();
    const harness = await makeHarness({
      encryptHook: async ({ key, salt }) =>
        harness.createVaultRecord({ verifier: `${verifierText}-extra` }, key, salt),
    });
    await assert.rejects(harness.createAccess(backend).setup(password, password), /\[PV-SETUP\]/);
    assert.equal(backend.writes.length, 0);
    assert.equal(backend.values.size, 0);
  });
});

test('a persisted pre-existing cipher record still unlocks unchanged', async () => {
  const backend = memoryBackend();
  const writer = await makeHarness();
  await writer.storeVerifierPayload(backend, { verifier: verifierText });
  const beforeUnlock = new Map(backend.values);
  const freshAccess = (await makeHarness()).createAccess(backend);

  assert.equal(await freshAccess.status(), 'locked');
  await freshAccess.unlock(password);
  assert.deepEqual(backend.values, beforeUnlock, 'unlock must not rewrite an existing encrypted record');
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

test('leaving during real password setup keeps the late committed vault locked and unlockable', async () => {
  const backend = memoryBackend();
  for (const [key, value] of ordinaryRecords) backend.values.set(key, value);
  let release, entered;
  const blocked = new Promise(resolve => { release = resolve; });
  const cryptoStarted = new Promise(resolve => { entered = resolve; });
  const harness = await makeHarness({ beforeDerive: async () => { entered(); await blocked; } });
  const access = harness.createAccess(backend);
  const session = createPrivateSession();
  const token = session.begin();
  const setup = access.setup(password, password);
  await cryptoStarted;
  // Cancel and the back action both invalidate the screen's guard. They do not
  // roll back storage work already in progress, as explained on the setup UI.
  session.invalidate();
  assert.equal(session.valid(token), false);
  release();
  await setup;
  session.finish(token);
  assert.equal(session.valid(token), false);
  assert.equal(await access.status(), 'locked');
  const fresh = harness.createAccess(backend);
  assert.equal(await fresh.status(), 'locked');
  await fresh.unlock(password);
  await assert.rejects(fresh.unlock('wrong-password-2026'), /Incorrect password/);
  const persisted = [...backend.values.values()].join('\n');
  assert.equal(persisted.includes(password), false);
  assert.equal(persisted.includes(verifierText), false);
  for (const [key, value] of ordinaryRecords) assert.equal(backend.values.get(key), value);
});
