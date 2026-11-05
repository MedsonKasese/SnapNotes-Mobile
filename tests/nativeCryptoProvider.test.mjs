import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  createNativeCryptoProvider as createNativeCryptoProviderImpl,
  NativeCryptoProviderUnavailableError,
} from '../src/nativeCryptoProvider.ts';

const createNativeCryptoProvider = (loadModule, probeNitroModule = async () => ({})) =>
  createNativeCryptoProviderImpl(loadModule, probeNitroModule);

const loadFailureMessage =
  'Quick Crypto/Nitro could not be loaded. Verify native runtime registration and initialization; Metro cannot add native code. Private Notes remains locked and vault data is unchanged. [PV-CRYPTO-LOAD]';
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

test('maps a null Nitro TurboModule preflight to lookup and skips the provider import', async () => {
  let loadCalls = 0;

  await assert.rejects(
    createNativeCryptoProvider(async () => {
      loadCalls += 1;
      return webcrypto;
    }, async () => null),
    error => {
      assert.ok(error instanceof NativeCryptoProviderUnavailableError);
      assert.equal(error.code, 'PV-CRYPTO-NITRO-LOOKUP');
      assert.match(error.message, /\[PV-CRYPTO-NITRO-LOOKUP\]$/);
      assert.equal(error.cause, undefined);
      return true;
    },
  );

  assert.equal(loadCalls, 0);
});

test('uses a distinct safe code when Nitro is registered but provider import fails generically', async () => {
  await assert.rejects(
    createNativeCryptoProvider(async () => {
      throw new Error('private-import-sentinel');
    }, async () => ({ registered: true })),
    error => {
      assert.ok(error instanceof NativeCryptoProviderUnavailableError);
      assert.equal(error.code, 'PV-CRYPTO-NITRO-IMPORT');
      assert.match(error.message, /\[PV-CRYPTO-NITRO-IMPORT\]$/);
      assert.equal(error.message.includes('private-import-sentinel'), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('sanitizes Quick Crypto/Nitro module load failures into a distinct fixed diagnostic', async () => {
  await assert.rejects(
    createNativeCryptoProvider(async () => {
      throw new Error('TurboModuleRegistry-private-diagnostic-sentinel');
    }, async () => { throw new Error('private-probe-sentinel'); }),
    error => {
      assert.ok(error instanceof NativeCryptoProviderUnavailableError);
      assert.equal(error.code, 'PV-CRYPTO-LOAD');
      assert.equal(error.message, loadFailureMessage);
      assert.equal(error.message.includes('TurboModuleRegistry-private-diagnostic-sentinel'), false);
      assert.equal(error.message.includes('private-probe-sentinel'), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('maps a known missing Nitro TurboModule error to a safe lookup diagnostic', async () => {
  const wrapped = new Error(
    'Failed to get NitroModules: The native "NitroModules" Turbo/Native-Module could not be found.',
    { cause: new Error("TurboModuleRegistry.getEnforcing(...): 'NitroModules' could not be found. private-diagnostic-sentinel") },
  );

  await assert.rejects(
    createNativeCryptoProvider(async () => { throw wrapped; }),
    error => {
      assert.ok(error instanceof NativeCryptoProviderUnavailableError);
      assert.equal(error.code, 'PV-CRYPTO-NITRO-LOOKUP');
      assert.match(error.message, /\[PV-CRYPTO-NITRO-LOOKUP\]$/);
      assert.equal(error.message.includes('private-diagnostic-sentinel'), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('maps Nitro install and missing-proxy failures to a safe initialization diagnostic', async () => {
  const failures = [
    new Error('Failed to install Nitro: private-install-sentinel'),
    new Error(
      'Failed to get NitroModules: The native "NitroModules" Turbo/Native-Module could not be found.',
      { cause: new Error('NitroModules was installed, but `global.NitroModulesProxy` was null! private-proxy-sentinel') },
    ),
  ];

  for (const failure of failures) {
    await assert.rejects(
      createNativeCryptoProvider(async () => { throw failure; }),
      error => {
        assert.ok(error instanceof NativeCryptoProviderUnavailableError);
        assert.equal(error.code, 'PV-CRYPTO-NITRO-INIT');
        assert.match(error.message, /\[PV-CRYPTO-NITRO-INIT\]$/);
        assert.equal(error.message.includes('private-'), false);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});

test('maps a duplicate Nitro runtime error to a safe version diagnostic', async () => {
  await assert.rejects(
    createNativeCryptoProvider(async () => {
      throw new Error('Nitro was installed twice: native version 0.31.0 and JS version 0.37.1 private-version-sentinel');
    }),
    error => {
      assert.ok(error instanceof NativeCryptoProviderUnavailableError);
      assert.equal(error.code, 'PV-CRYPTO-NITRO-VERSION');
      assert.match(error.message, /\[PV-CRYPTO-NITRO-VERSION\]$/);
      assert.equal(error.message.includes('private-version-sentinel'), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('maps Nitro ModuleNotFoundError class names to a broader safe diagnostic', async () => {
  class ModuleNotFoundError extends Error {}
  const failures = [
    new ModuleNotFoundError('private-direct-sentinel'),
    new Error('unrecognized wrapper message', { cause: new ModuleNotFoundError('private-cause-sentinel') }),
  ];

  for (const failure of failures) {
    await assert.rejects(
      createNativeCryptoProvider(async () => { throw failure; }),
      error => {
        assert.ok(error instanceof NativeCryptoProviderUnavailableError);
        assert.equal(error.code, 'PV-CRYPTO-NITRO-MODULE');
        assert.match(error.message, /\[PV-CRYPTO-NITRO-MODULE\]$/);
        assert.equal(error.message.includes('private-'), false);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});

test('skips the registry probe when Nitro already installed its global proxy', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'NitroModulesProxy');
  let probeCalls = 0;

  try {
    Object.defineProperty(globalThis, 'NitroModulesProxy', {
      configurable: true,
      value: {},
    });

    const provider = await createNativeCryptoProvider(
      async () => webcrypto,
      async () => {
        probeCalls += 1;
        return null;
      },
    );

    assert.equal(provider, webcrypto);
    assert.equal(probeCalls, 0);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'NitroModulesProxy', originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'NitroModulesProxy');
    }
  }
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
