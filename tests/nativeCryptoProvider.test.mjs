import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createNativeCryptoProvider } from '../src/nativeCryptoProvider.ts';

const unavailableMessage =
  'Native secure cryptography is unavailable. Private Notes encryption requires the SnapNotes development build; Expo Go does not include this native module.';

test('uses Quick Crypto exports directly without calling the global install hook', async () => {
  let installCalls = 0;
  const originalGlobalCrypto = globalThis.crypto;
  const nativeModule = {
    default: webcrypto,
    install() {
      installCalls += 1;
      throw new Error('global crypto assignment failed');
    },
  };

  const provider = await createNativeCryptoProvider(async () => nativeModule);

  assert.equal(provider, webcrypto);
  assert.equal(installCalls, 0);
  assert.equal(globalThis.crypto, originalGlobalCrypto);
});

test('accepts the Quick Crypto module namespace when it exposes Web Crypto APIs directly', async () => {
  const nativeModule = {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    subtle: webcrypto.subtle,
  };

  assert.equal(await createNativeCryptoProvider(async () => nativeModule), nativeModule);
});

test('fails closed instead of falling back to ambient Web Crypto when native exports are missing', async () => {
  assert.equal(typeof globalThis.crypto?.subtle, 'object', 'test runtime should have ambient Web Crypto');

  await assert.rejects(
    createNativeCryptoProvider(async () => ({ install() {} })),
    error => {
      assert.equal(error.message, unavailableMessage);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('sanitizes native module load failures without preserving their cause', async () => {
  await assert.rejects(
    createNativeCryptoProvider(async () => {
      throw new Error('native-module-private-diagnostic-sentinel');
    }),
    error => {
      assert.equal(error.message, unavailableMessage);
      assert.equal(error.message.includes('native-module-private-diagnostic-sentinel'), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('rejects a partial Web Crypto implementation that lacks required key operations', async () => {
  await assert.rejects(
    createNativeCryptoProvider(async () => ({
      default: {
        getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
        subtle: { importKey() {} },
      },
    })),
    error => error.message === unavailableMessage,
  );
});
