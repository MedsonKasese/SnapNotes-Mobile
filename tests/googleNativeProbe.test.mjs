import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  GOOGLE_NATIVE_PROBE_STATUSES,
  getGoogleNativeProbeLabel,
  runGoogleNativeProbe,
} from '../src/auth/googleNativeProbe.ts';

const PRIVATE_SENTINEL = 'private-email-token-client-id';
const safeLabel = (status) => `Native Google module check (development only): ${status}`;

function errorWithCode(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

test('missing Nitro registry entry reports only registry visibility and skips Nitro import', async () => {
  let importCalls = 0;
  const status = await runGoogleNativeProbe({
    getNitroTurboModule: () => null,
    loadNitroModules: async () => {
      importCalls += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });

  assert.equal(status, 'NITRO_TURBOMODULE_MISSING');
  assert.equal(importCalls, 0);
  assert.equal(getGoogleNativeProbeLabel(status, true), safeLabel(status));
  assert.doesNotMatch(JSON.stringify({ status, label: getGoogleNativeProbeLabel(status, true) }), /private-email-token-client-id/);
});

test('registry lookup exceptions are reduced to a fixed status', async () => {
  const status = await runGoogleNativeProbe({
    getNitroTurboModule: () => {
      throw new Error(`registry lookup failed: ${PRIVATE_SENTINEL}`);
    },
    loadNitroModules: async () => {
      throw new Error('must not load when registry lookup fails');
    },
  });

  assert.equal(status, 'NITRO_TURBOMODULE_LOOKUP_FAILED');
  assert.equal(getGoogleNativeProbeLabel(status, true), safeLabel(status));
  assert.doesNotMatch(JSON.stringify({ status, label: getGoogleNativeProbeLabel(status, true) }), /private-email-token-client-id|registry lookup failed/);
});

test('React Native import failures have a separate fixed status and stop before Nitro import', async () => {
  let nitroImportCalls = 0;
  const status = await runGoogleNativeProbe({
    loadReactNative: async () => {
      throw new Error(`private React Native import details: ${PRIVATE_SENTINEL}`);
    },
    loadNitroModules: async () => {
      nitroImportCalls += 1;
      return {};
    },
  });

  assert.equal(status, 'REACT_NATIVE_IMPORT_FAILED');
  assert.equal(getGoogleNativeProbeLabel(status, true), safeLabel(status));
  assert.equal(nitroImportCalls, 0);
  assert.doesNotMatch(JSON.stringify({ status, label: getGoogleNativeProbeLabel(status, true) }), /private React Native import details|private-email-token-client-id/);
});

test('an unavailable React Native TurboModuleRegistry has its own fixed status', async () => {
  for (const reactNative of [{}, { TurboModuleRegistry: { get: null } }]) {
    const status = await runGoogleNativeProbe({ loadReactNative: async () => reactNative });
    assert.equal(status, 'NITRO_TURBOMODULE_REGISTRY_UNAVAILABLE');
    assert.equal(getGoogleNativeProbeLabel(status, true), safeLabel(status));
  }
});

test('the loaded React Native registry is called with only the fixed Nitro module name', async () => {
  const calls = [];
  const status = await runGoogleNativeProbe({
    loadReactNative: async () => ({
      TurboModuleRegistry: {
        get(name) {
          calls.push(name);
          return null;
        },
      },
    }),
  });

  assert.equal(status, 'NITRO_TURBOMODULE_MISSING');
  assert.deepEqual(calls, ['NitroModules']);
});

test('fixed native install code maps to NITRO_INSTALL_FAILED without exposing its message', async () => {
  const status = await runGoogleNativeProbe({
    getNitroTurboModule: () => ({}),
    loadNitroModules: async () => {
      throw errorWithCode(`native exception: ${PRIVATE_SENTINEL}`, 'NITRO_INSTALL_FAILED');
    },
  });

  assert.equal(status, 'NITRO_INSTALL_FAILED');
  assert.equal(getGoogleNativeProbeLabel(status, true), safeLabel(status));
  assert.doesNotMatch(JSON.stringify({ status, label: getGoogleNativeProbeLabel(status, true) }), /private-email-token-client-id|native exception/);
});

test('unrecognized Nitro initialization errors map to a generic fixed status', async () => {
  const status = await runGoogleNativeProbe({
    getNitroTurboModule: () => ({}),
    loadNitroModules: async () => {
      throw new Error(`unexpected init failure: ${PRIVATE_SENTINEL}`);
    },
  });

  assert.equal(status, 'NITRO_RUNTIME_INIT_FAILED');
  assert.equal(getGoogleNativeProbeLabel(status, true), safeLabel(status));
  assert.doesNotMatch(JSON.stringify({ status, label: getGoogleNativeProbeLabel(status, true) }), /private-email-token-client-id|unexpected init failure/);
});

test('a missing Nitro proxy API is classified as a fixed runtime-init failure', async () => {
  assert.equal(
    await runGoogleNativeProbe({
      getNitroTurboModule: () => ({}),
      loadNitroModules: async () => ({}),
    }),
    'NITRO_RUNTIME_INIT_FAILED',
  );
  assert.equal(
    await runGoogleNativeProbe({
      getNitroTurboModule: () => ({}),
      loadNitroModules: async () => ({ NitroModules: { createHybridObject: null } }),
    }),
    'NITRO_RUNTIME_INIT_FAILED',
  );
});

test('an unregistered Google hybrid object reports only its fixed status', async () => {
  const status = await runGoogleNativeProbe({
    getNitroTurboModule: () => ({}),
    loadNitroModules: async () => ({
      NitroModules: {
        createHybridObject() {
          throw new Error(`hybrid registration failed: ${PRIVATE_SENTINEL}`);
        },
      },
    }),
  });

  assert.equal(status, 'GOOGLE_HYBRID_NOT_REGISTERED');
  assert.equal(getGoogleNativeProbeLabel(status, true), safeLabel(status));
  assert.doesNotMatch(JSON.stringify({ status, label: getGoogleNativeProbeLabel(status, true) }), /private-email-token-client-id|hybrid registration failed/);
});

test('registered Google hybrid object is created once with its fixed native name', async () => {
  const calls = [];
  const status = await runGoogleNativeProbe({
    getNitroTurboModule: () => ({}),
    loadNitroModules: async () => ({
      NitroModules: {
        createHybridObject(name) {
          calls.push(name);
          return {};
        },
      },
    }),
  });

  assert.equal(status, 'GOOGLE_HYBRID_READY');
  assert.deepEqual(calls, ['NitroGoogleSignin']);
});

test('only fixed allowlisted statuses are labeled, and release mode suppresses every status', () => {
  assert.deepEqual(GOOGLE_NATIVE_PROBE_STATUSES, [
    'REACT_NATIVE_IMPORT_FAILED',
    'NITRO_TURBOMODULE_REGISTRY_UNAVAILABLE',
    'NITRO_TURBOMODULE_MISSING',
    'NITRO_TURBOMODULE_LOOKUP_FAILED',
    'NITRO_INSTALL_FAILED',
    'NITRO_RUNTIME_INIT_FAILED',
    'GOOGLE_HYBRID_NOT_REGISTERED',
    'GOOGLE_HYBRID_READY',
  ]);
  for (const status of GOOGLE_NATIVE_PROBE_STATUSES) {
    assert.equal(getGoogleNativeProbeLabel(status, false), null);
    assert.equal(getGoogleNativeProbeLabel(status, true), safeLabel(status));
  }
  assert.equal(getGoogleNativeProbeLabel(PRIVATE_SENTINEL, true), null);
});

test('probe source never logs or reads raw errors and avoids auth, network, and app data', async () => {
  const source = await readFile(new URL('../src/auth/googleNativeProbe.ts', import.meta.url), 'utf8');
  const importedModules = [...source.matchAll(/\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .sort();
  assert.doesNotMatch(source, /console\.|error\.(?:message|stack)|JSON\.stringify/);
  assert.deepEqual(importedModules, ['react-native', 'react-native-nitro-modules']);
  assert.doesNotMatch(source, /\bfetch\s*\(|\bXMLHttpRequest\b/);
  assert.match(source, /import\('react-native'\)/);
  assert.match(source, /get\.call\(registry, 'NitroModules'\)/);
});

test('the tracked Nitro patch removes raw native logging and exposes only a fixed install code', async () => {
  const nativePath = new URL('../node_modules/react-native-nitro-modules/android/src/main/java/com/margelo/nitro/NitroModules.kt', import.meta.url);
  const wrapperPath = new URL('../node_modules/react-native-nitro-modules/src/turbomodule/NativeNitroModules.ts', import.meta.url);
  const patchPath = new URL('../patches/react-native-nitro-modules+0.37.1.patch', import.meta.url);
  const manifestPath = new URL('../package.json', import.meta.url);
  const [nativeSource, wrapperSource, patchSource, manifestText] = await Promise.all([
    readFile(nativePath, 'utf8'),
    readFile(wrapperPath, 'utf8'),
    readFile(patchPath, 'utf8'),
    readFile(manifestPath, 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  const addedPatchLines = patchSource
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n');

  assert.match(patchSource, /diff --git a\/node_modules\/react-native-nitro-modules\/android\//);
  assert.match(addedPatchLines, /NITRO_INSTALL_FAILED/);
  assert.doesNotMatch(addedPatchLines, /\bLog\.(?:e|w|i|d)\s*\(|return\s+\w+\.message/);
  assert.equal(manifest.devDependencies['patch-package'], '8.0.1');
  assert.equal(manifest.scripts.postinstall, 'patch-package');
  assert.match(nativeSource, /private const val NITRO_INSTALL_FAILED = "NITRO_INSTALL_FAILED"/);
  assert.match(nativeSource, /catch \(_: Throwable\)/);
  assert.match(nativeSource, /return NITRO_INSTALL_FAILED/);
  assert.doesNotMatch(nativeSource, /\bLog\.(?:e|w|i|d)\s*\(|return\s+\w+\.message|localizedMessage|stackTrace/);
  assert.match(wrapperSource, /new Error\('NITRO_INSTALL_FAILED'\)/);
  assert.match(wrapperSource, /error\.code = 'NITRO_INSTALL_FAILED'/);
  assert.doesNotMatch(wrapperSource, /Failed to install Nitro: \$\{errorMessage\}|new Error\([^)]*errorMessage/);
});

test('AccountAccessModal exposes the probe only as an explicit Android development action', async () => {
  const source = await readFile(new URL('../src/components/AccountAccessModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /isDevelopmentBuild\(\) && Platform\.OS === 'android' \?/);
  assert.match(source, /<Text accessibilityLiveRegion="polite" style=\{styles\.googleDiagnostic\}>/);
  assert.doesNotMatch(source, /accessibilityRole=["']status["']/);
  assert.match(source, /if \(!isDevelopmentBuild\(\) \|\| Platform\.OS !== 'android'/);
  assert.match(source, /onPress=\{\(\) => \{ void checkGoogleNativeModules\(\); \}\}/);
  assert.match(source, /catch \{\s*setGoogleNativeProbeStatus\('NITRO_RUNTIME_INIT_FAILED'\);\s*\}/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\s*\(/);
});
