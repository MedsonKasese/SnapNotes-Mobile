import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/privateBiometricUnlock.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const exports = {};
vm.runInNewContext(outputText, {
  exports,
  require(name) {
    assert.equal(name, 'expo-secure-store');
    return {};
  },
});
const { createPrivateBiometricKeyStore, PRIVATE_BIOMETRIC_KEY_ID } = exports;

function fakeSecureStore({ available = true, read, write, remove } = {}) {
  const values = new Map();
  const calls = [];
  return {
    values,
    calls,
    canUseBiometricAuthentication() { return available; },
    async getItemAsync(key, options) {
      calls.push(['read', key, options]);
      if (read) return read(key, options, values);
      return values.get(key) ?? null;
    },
    async setItemAsync(key, value, options) {
      calls.push(['write', key, value, options]);
      if (write) return write(key, value, options, values);
      values.set(key, value);
    },
    async deleteItemAsync(key, options) {
      calls.push(['remove', key, options]);
      if (remove) return remove(key, options, values);
      values.delete(key);
    },
  };
}

const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

test('biometric key storage requires platform authentication and round-trips only a 256-bit key', async () => {
  const nativeStore = fakeSecureStore();
  const keyStore = createPrivateBiometricKeyStore(nativeStore);
  assert.match(PRIVATE_BIOMETRIC_KEY_ID, /^[\w.-]+$/, 'SecureStore keys must use only supported identifier characters');
  assert.equal(keyStore.canUse(), true);

  await keyStore.save(privateKey);
  const encoded = nativeStore.values.get(PRIVATE_BIOMETRIC_KEY_ID);
  assert.equal(typeof encoded, 'string');
  assert.notEqual(encoded, String.fromCharCode(...privateKey));
  assert.equal(nativeStore.calls[0][0], 'write');
  assert.equal(nativeStore.calls[0][1], PRIVATE_BIOMETRIC_KEY_ID);
  assert.equal(nativeStore.calls[0][2], encoded);
  assert.equal(nativeStore.calls[0][3].requireAuthentication, true);
  assert.equal(nativeStore.calls[0][3].authenticationPrompt, 'Unlock Private Notes');

  const restored = await keyStore.read();
  assert.deepEqual(Array.from(restored), Array.from(privateKey));
  assert.equal(nativeStore.calls[1][0], 'read');
  assert.equal(nativeStore.calls[1][1], PRIVATE_BIOMETRIC_KEY_ID);
  assert.equal(nativeStore.calls[1][2].requireAuthentication, true);
  assert.equal(nativeStore.calls[1][2].authenticationPrompt, 'Unlock Private Notes');

  await keyStore.remove();
  assert.equal(nativeStore.values.has(PRIVATE_BIOMETRIC_KEY_ID), false);
  assert.equal(nativeStore.calls[2][0], 'remove');
  assert.equal(nativeStore.calls[2][2].requireAuthentication, true);
});

test('devices without eligible biometrics cannot save a biometric credential', async () => {
  const nativeStore = fakeSecureStore({ available: false });
  const keyStore = createPrivateBiometricKeyStore(nativeStore);
  assert.equal(keyStore.canUse(), false);
  await assert.rejects(keyStore.save(privateKey), /not available on this device/);
  assert.equal(nativeStore.calls.length, 0);
});

test('malformed protected key material fails closed', async () => {
  const nativeStore = fakeSecureStore();
  nativeStore.values.set(PRIVATE_BIOMETRIC_KEY_ID, 'AQ==');
  const keyStore = createPrivateBiometricKeyStore(nativeStore);
  await assert.rejects(keyStore.read(), /protected biometric key is invalid/);
});

test('native biometric errors are sanitized and leave password authentication available', async () => {
  const nativeStore = fakeSecureStore({ read: async () => { throw new Error('native-detail-secret'); } });
  const keyStore = createPrivateBiometricKeyStore(nativeStore);

  await assert.rejects(keyStore.read(), error => {
    assert.match(error.message, /Biometric verification was canceled/);
    assert.equal(error.message.includes('native-detail-secret'), false);
    assert.equal(error.cause, undefined);
    return true;
  });
});
