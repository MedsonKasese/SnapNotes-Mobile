import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  createNativeCryptoProvider,
  NativeCryptoProviderUnavailableError,
} from '../src/nativeCryptoProvider.ts';

const loadFailureMessage =
  'Quick Crypto/Nitro could not be loaded. Verify the installed development APK includes and initializes these native modules; Metro cannot add native code. Private Notes remains locked and vault data is unchanged. [PV-CRYPTO-LOAD]';
const apiFailureMessage =
  'Quick Crypto loaded, but its required Web Crypto APIs are unavailable. Verify the APK and Metro bundle use the same Quick Crypto version. Private Notes remains locked and vault data is unchanged. [PV-CRYPTO-API]';

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
      assert.ok(error instanceof NativeCryptoProviderUnavailableError);
      assert.equal(error.code, 'PV-CRYPTO-API');
      assert.equal(error.message, apiFailureMessage);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('sanitizes Quick Crypto/Nitro module load failures into a distinct fixed diagnostic', async () => {
  await assert.rejects(
    createNativeCryptoProvider(async () => {
      throw new Error('TurboModuleRegistry-private-diagnostic-sentinel');
    }),
    error => {
      assert.ok(error instanceof NativeCryptoProviderUnavailableError);
      assert.equal(error.code, 'PV-CRYPTO-LOAD');
      assert.equal(error.message, loadFailureMessage);
      assert.equal(error.message.includes('TurboModuleRegistry-private-diagnostic-sentinel'), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('rejects a partial Web Crypto implementation with the API diagnostic', async () => {
  await assert.rejects(
    createNativeCryptoProvider(async () => ({
      default: {
        getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
        subtle: { importKey() {} },
      },
    })),
    error => {
      assert.equal(error.code, 'PV-CRYPTO-API');
      assert.equal(error.message, apiFailureMessage);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});
