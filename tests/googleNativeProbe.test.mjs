import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  GOOGLE_NATIVE_PROBE_STATUSES,
  getGoogleNativeProbeLabel,
  runGoogleNativeProbe,
} from '../src/auth/googleNativeProbe.ts';

const PRIVATE_SENTINEL = 'private-email-token-client-id';

test('Nitro import or runtime initialization failure returns only the fixed unavailable status', async () => {
  const status = await runGoogleNativeProbe(async () => {
    throw new Error(`native initialization failed: ${PRIVATE_SENTINEL}`);
  });

  assert.equal(status, 'NITRO_RUNTIME_UNAVAILABLE');
  assert.equal(
    getGoogleNativeProbeLabel(status, true),
    'Native Google module check (development only): NITRO_RUNTIME_UNAVAILABLE',
  );
  assert.doesNotMatch(JSON.stringify({ status, label: getGoogleNativeProbeLabel(status, true) }), /private-email-token-client-id|native initialization failed/);
});

test('missing Nitro runtime API returns the fixed unavailable status', async () => {
  assert.equal(await runGoogleNativeProbe(async () => ({})), 'NITRO_RUNTIME_UNAVAILABLE');
  assert.equal(
    await runGoogleNativeProbe(async () => ({ NitroModules: { createHybridObject: null } })),
    'NITRO_RUNTIME_UNAVAILABLE',
  );
});

test('unregistered Google hybrid object returns only the fixed registration status', async () => {
  const status = await runGoogleNativeProbe(async () => ({
    NitroModules: {
      createHybridObject() {
        throw new Error(`hybrid registration failed: ${PRIVATE_SENTINEL}`);
      },
    },
  }));

  assert.equal(status, 'GOOGLE_HYBRID_NOT_REGISTERED');
  assert.equal(
    getGoogleNativeProbeLabel(status, true),
    'Native Google module check (development only): GOOGLE_HYBRID_NOT_REGISTERED',
  );
  assert.doesNotMatch(JSON.stringify({ status, label: getGoogleNativeProbeLabel(status, true) }), /private-email-token-client-id|hybrid registration failed/);
});

test('registered Google hybrid object is created once with its fixed native name', async () => {
  const calls = [];
  const status = await runGoogleNativeProbe(async () => ({
    NitroModules: {
      createHybridObject(name) {
        calls.push(name);
        return {};
      },
    },
  }));

  assert.equal(status, 'GOOGLE_HYBRID_READY');
  assert.deepEqual(calls, ['NitroGoogleSignin']);
});

test('only fixed allowlisted statuses are labeled, and release mode suppresses every status', () => {
  assert.deepEqual(GOOGLE_NATIVE_PROBE_STATUSES, [
    'NITRO_RUNTIME_UNAVAILABLE',
    'GOOGLE_HYBRID_NOT_REGISTERED',
    'GOOGLE_HYBRID_READY',
  ]);
  for (const status of GOOGLE_NATIVE_PROBE_STATUSES) {
    assert.equal(getGoogleNativeProbeLabel(status, false), null);
    assert.equal(
      getGoogleNativeProbeLabel(status, true),
      `Native Google module check (development only): ${status}`,
    );
  }
  assert.equal(getGoogleNativeProbeLabel(PRIVATE_SENTINEL, true), null);
});

test('probe source does not log, retain, or expose native error details or application data', async () => {
  const source = await readFile(new URL('../src/auth/googleNativeProbe.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.|error\.(?:message|stack|code)|JSON\.stringify/);
  assert.doesNotMatch(source, /import\s+[^;]*(?:firebase|firestore|cloudLibrary|deviceNotes|privateNotes)/i);
  assert.doesNotMatch(source, /\bfetch\s*\(|\bXMLHttpRequest\b/);
  assert.doesNotMatch(source, /catch\s*\(\s*error\s*\)/);
});

test('AccountAccessModal exposes the probe only as an explicit Android development action', async () => {
  const source = await readFile(new URL('../src/components/AccountAccessModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /isDevelopmentBuild\(\) && Platform\.OS === 'android' \?/);
  assert.match(source, /if \(!isDevelopmentBuild\(\) \|\| Platform\.OS !== 'android'/);
  assert.match(source, /onPress=\{\(\) => \{ void checkGoogleNativeModules\(\); \}\}/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\s*\(/);
});
