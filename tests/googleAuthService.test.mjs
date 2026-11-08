import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthOperationError } from '../src/auth/authServiceCore.ts';
import { createGoogleAuthService, GoogleAuthOperationError } from '../src/auth/googleAuthServiceCore.ts';

function createHarness({ configuration = {}, response = { type: 'success', data: { idToken: 'google-id-token' } }, failure } = {}) {
  const calls = [];
  const config = {
    webClientId: 'test-web-client.apps.googleusercontent.com',
    platform: 'android',
    ...configuration,
  };
  const service = createGoogleAuthService({
    getConfiguration: () => config,
    loadNativeSignIn: async () => {
      calls.push(['loaded']);
      if (failure === 'load') {
        throw Object.assign(new Error('private native response with test@example.invalid id-token-secret'), {
          code: 'unlisted-native-code-secret',
        });
      }
      return {
        configure: async (receivedConfig) => {
          calls.push(['configured', receivedConfig.webClientId]);
          if (failure === 'configure') {
            throw Object.assign(new Error('private configure response with oauth-client-id-secret'), {
              code: 'unlisted-configure-code-secret',
            });
          }
        },
        checkPlayServices: async () => {
          calls.push(['play-services']);
          if (failure === 'play-services') {
            throw Object.assign(new Error('private native response'), { code: 'PLAY_SERVICES_NOT_AVAILABLE' });
          }
        },
        presentExplicitSignIn: async () => {
          calls.push(['google-ui']);
          if (failure === 'google-ui') {
            throw Object.assign(new Error('private picker response with account@example.invalid token-secret'), {
              code: 'DEVELOPER_ERROR',
            });
          }
          return response;
        },
      };
    },
    getAuth: () => 'firebase-auth-instance',
    credentialFromIdToken: (token) => {
      calls.push(['firebase-credential', token]);
      return { idToken: token };
    },
    signInWithCredential: async (auth, credential) => {
      calls.push(['firebase-sign-in', auth, credential.idToken]);
      if (failure === 'firebase') {
        throw Object.assign(new Error('private Firebase response'), { code: 'auth/network-request-failed' });
      }
    },
  });
  return { calls, config, service };
}

test('Google ID token is exchanged only for a Firebase Auth session', async () => {
  const { calls, service } = createHarness();
  assert.equal(service.isConfigured(), true);
  assert.deepEqual(await service.signIn(), { status: 'signed-in' });
  assert.deepEqual(calls, [
    ['loaded'],
    ['configured', 'test-web-client.apps.googleusercontent.com'],
    ['play-services'],
    ['google-ui'],
    ['firebase-credential', 'google-id-token'],
    ['firebase-sign-in', 'firebase-auth-instance', 'google-id-token'],
  ]);
});

test('cancelling the native Google picker does not sign in to Firebase', async () => {
  const { calls, service } = createHarness({ response: { type: 'cancelled', data: null } });
  assert.deepEqual(await service.signIn(), { status: 'cancelled' });
  assert.equal(calls.some(([name]) => name === 'firebase-sign-in'), false);
});

test('missing Android Web OAuth client ID blocks only Google sign-in', async () => {
  const { calls, service } = createHarness({ configuration: { webClientId: '' } });
  assert.equal(service.isConfigured(), false);
  await assert.rejects(service.signIn(), (error) => {
    assert.ok(error instanceof AuthOperationError);
    assert.match(error.message, /not configured/);
    return true;
  });
  assert.deepEqual(calls, []);
});

test('iOS requires both its OAuth client and a valid reversed-client URL scheme', async () => {
  const missing = createHarness({ configuration: { platform: 'ios' } });
  assert.equal(missing.service.isConfigured(), false);
  await assert.rejects(missing.service.signIn(), /not configured for iOS/);
  assert.deepEqual(missing.calls, []);

  const malformed = createHarness({
    configuration: {
      platform: 'ios',
      iosClientId: 'ios-client.apps.googleusercontent.com',
      iosUrlScheme: 'wrong-scheme',
    },
  });
  assert.equal(malformed.service.isConfigured(), false);
});

test('native and Firebase failures map to safe messages without exposing provider details', async () => {
  const nativeFailure = createHarness({ failure: 'load' });
  await assert.rejects(nativeFailure.service.signIn(), (error) => {
    assert.ok(error instanceof AuthOperationError);
    assert.doesNotMatch(error.message, /private native response/);
    return true;
  });

  const firebaseFailure = createHarness({ failure: 'firebase' });
  await assert.rejects(firebaseFailure.service.signIn(), (error) => {
    assert.ok(error instanceof AuthOperationError);
    assert.match(error.message, /Could not reach the sign-in service/);
    assert.doesNotMatch(error.message, /private Firebase response/);
    return true;
  });
});

test('Google sign-in diagnostics identify stages while keeping provider details out of errors', async () => {
  const nativeFailure = createHarness({ failure: 'load' });
  await assert.rejects(nativeFailure.service.signIn(), (error) => {
    assert.ok(error instanceof GoogleAuthOperationError);
    assert.equal(error.diagnostic.stage, 'native-module-load');
    assert.equal(error.diagnostic.code, 'NATIVE_MODULE_LOAD_FAILED');
    assert.doesNotMatch(error.message, /private native response|example\.invalid|token-secret|unlisted-native-code-secret/);
    return true;
  });
  assert.deepEqual(nativeFailure.calls, [['loaded']]);

  const configureFailure = createHarness({ failure: 'configure' });
  await assert.rejects(configureFailure.service.signIn(), (error) => {
    assert.equal(error.diagnostic.stage, 'native-module-configure');
    assert.equal(error.diagnostic.code, 'UNCLASSIFIED');
    assert.doesNotMatch(error.message, /private configure response|oauth-client-id-secret|unlisted-configure-code-secret/);
    return true;
  });
  assert.deepEqual(configureFailure.calls, [
    ['loaded'],
    ['configured', 'test-web-client.apps.googleusercontent.com'],
  ]);

  const playServicesFailure = createHarness({ failure: 'play-services' });
  await assert.rejects(playServicesFailure.service.signIn(), (error) => {
    assert.equal(error.diagnostic.stage, 'play-services');
    assert.equal(error.diagnostic.code, 'PLAY_SERVICES_NOT_AVAILABLE');
    return true;
  });

  const pickerFailure = createHarness({ failure: 'google-ui' });
  await assert.rejects(pickerFailure.service.signIn(), (error) => {
    assert.equal(error.diagnostic.stage, 'account-picker');
    assert.equal(error.diagnostic.code, 'DEVELOPER_ERROR');
    assert.doesNotMatch(error.message, /private picker response|account@example|token-secret/);
    return true;
  });

  const firebaseFailure = createHarness({ failure: 'firebase' });
  await assert.rejects(firebaseFailure.service.signIn(), (error) => {
    assert.equal(error.diagnostic.stage, 'firebase-auth');
    assert.equal(error.diagnostic.code, 'auth/network-request-failed');
    return true;
  });
});

test('missing Google ID token is identified as an account-picker-stage failure', async () => {
  const { service } = createHarness({ response: { type: 'noSavedCredentialFound', data: null } });
  await assert.rejects(service.signIn(), (error) => {
    assert.equal(error.diagnostic.stage, 'account-picker');
    assert.equal(error.diagnostic.code, 'NO_ID_TOKEN');
    assert.doesNotMatch(error.message, /google-id-token|private/);
    return true;
  });
});

test('Google sign-in implementation has no note or Private Notes storage dependency', async () => {
  const { readFile } = await import('node:fs/promises');
  const core = await readFile(new URL('../src/auth/googleAuthServiceCore.ts', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('../src/auth/googleAuthService.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(`${core}\n${adapter}`, /notesStorage|AsyncStorage|Firestore|privateVault|noteTransfer/i);
});
