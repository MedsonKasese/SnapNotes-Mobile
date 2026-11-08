import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createGoogleAuthDiagnostic,
  getGoogleAuthDiagnosticLabel,
} from '../src/auth/googleAuthDiagnostics.ts';
import { getAuthErrorMessage } from '../src/auth/authErrors.ts';

test('development diagnostic keeps only an allowlisted stage and error code', () => {
  const rawError = Object.assign(
    new Error('raw text includes account@example.invalid and id-token-secret'),
    { code: 'private-provider-code-secret' },
  );
  const error = {
    message: rawError.message,
    diagnostic: createGoogleAuthDiagnostic('account-picker', rawError),
  };

  const label = getGoogleAuthDiagnosticLabel(error, true);
  assert.equal(
    label,
    'Google sign-in diagnostic (development only): account-picker / UNCLASSIFIED',
  );
  assert.doesNotMatch(label, /account@example|id-token-secret|private-provider-code-secret|raw text/);
});

test('allowlisted provider codes are retained but arbitrary codes and stages are rejected', () => {
  const loadError = Object.assign(new Error('raw module init includes token-secret'), {
    code: 'unlisted-import-error-secret',
  });
  const loadDiagnostic = createGoogleAuthDiagnostic(
    'native-module-load',
    loadError,
    'NATIVE_MODULE_LOAD_FAILED',
  );
  assert.equal(loadDiagnostic.code, 'NATIVE_MODULE_LOAD_FAILED');
  assert.equal(
    getGoogleAuthDiagnosticLabel({ diagnostic: loadDiagnostic }, true),
    'Google sign-in diagnostic (development only): native-module-load / NATIVE_MODULE_LOAD_FAILED',
  );
  assert.doesNotMatch(JSON.stringify(loadDiagnostic), /token-secret|unlisted-import-error-secret/);

  const knownError = Object.assign(new Error('ignored raw message'), { code: 'DEVELOPER_ERROR' });
  const knownDiagnostic = createGoogleAuthDiagnostic('native-module-configure', knownError);
  assert.equal(knownDiagnostic.code, 'DEVELOPER_ERROR');
  assert.equal(
    getGoogleAuthDiagnosticLabel({ diagnostic: knownDiagnostic }, true),
    'Google sign-in diagnostic (development only): native-module-configure / DEVELOPER_ERROR',
  );

  assert.equal(
    getGoogleAuthDiagnosticLabel({ diagnostic: { stage: 'account@example.invalid', code: 'DEVELOPER_ERROR' } }, true),
    null,
  );
  assert.equal(
    getGoogleAuthDiagnosticLabel({ diagnostic: { stage: 'firebase-auth', code: 'secret-token-value' } }, true),
    null,
  );
});

test('release mode suppresses diagnostics and keeps the existing generic auth message', () => {
  const error = {
    message: 'do-not-display-raw-message',
    diagnostic: { stage: 'account-picker', code: 'UNCLASSIFIED' },
  };
  assert.equal(getGoogleAuthDiagnosticLabel(error, false), null);
  assert.equal(
    getAuthErrorMessage(Object.assign(new Error('do-not-display-raw-message'), { code: 'private-code' })),
    'Something went wrong. Please try again. Your notes remain on this device.',
  );
});

test('AccountAccessModal only asks for and renders the diagnostic in a development build', async () => {
  const source = await readFile(new URL('../src/components/AccountAccessModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /function isDevelopmentBuild\(\): boolean\s*\{\s*return typeof __DEV__ !== 'undefined' && __DEV__;/);
  assert.match(source, /getGoogleAuthDiagnosticLabel\(error, isDevelopmentBuild\(\)\)/);
  assert.equal((source.match(/isDevelopmentBuild\(\) && googleDiagnostic/g) ?? []).length, 2);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\s*\(/);
});
