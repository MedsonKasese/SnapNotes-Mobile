import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService, AuthOperationError } from '../src/auth/authServiceCore.ts';
import { getAuthErrorMessage } from '../src/auth/authErrors.ts';

function makeService(overrides = {}) {
  const calls = [];
  const user = {
    uid: 'firebase-user-1',
    email: 'ada@example.com',
    displayName: null,
    emailVerified: false,
  };
  const auth = { currentUser: user };
  const dependencies = {
    getMobileAuth: () => auth,
    getCurrentUser: (target) => target.currentUser,
    createUserWithEmailAndPassword: async (_auth, email, password) => {
      calls.push(['create', email, password]);
      return { user };
    },
    signInWithEmailAndPassword: async (_auth, email, password) => {
      calls.push(['sign-in', email, password]);
      return { user };
    },
    updateProfile: async (target, profile) => {
      calls.push(['update-profile', target.uid, profile.displayName]);
    },
    sendEmailVerification: async (target) => {
      calls.push(['send-verification', target.uid]);
    },
    signOut: async (target) => {
      calls.push(['sign-out', target === auth]);
    },
    ...overrides,
  };
  return { service: createAuthService(dependencies), calls, user, auth };
}

test('registration normalizes identity fields, preserves the password, and sends verification after account creation', async () => {
  const { service, calls } = makeService();
  const result = await service.register('  Ada   Lovelace ', ' ADA@Example.COM ', '  exact password  ');
  assert.deepEqual(calls, [
    ['create', 'ada@example.com', '  exact password  '],
    ['update-profile', 'firebase-user-1', 'Ada Lovelace'],
    ['send-verification', 'firebase-user-1'],
  ]);
  assert.deepEqual(result, {
    email: 'ada@example.com',
    displayName: 'Ada Lovelace',
    displayNameUpdated: true,
    verificationEmailSent: true,
  });
});

test('post-creation profile or email failures are reported without repeating account creation', async () => {
  const { service, calls } = makeService({
    updateProfile: async () => { throw new Error('provider payload must not escape'); },
    sendEmailVerification: async () => { throw new Error('provider payload must not escape'); },
  });
  const result = await service.register('Ada', 'ada@example.com', 'password1');
  assert.deepEqual(result, {
    email: 'ada@example.com',
    displayName: null,
    displayNameUpdated: false,
    verificationEmailSent: false,
  });
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
  assert.equal(calls.filter(([name]) => name === 'update-profile').length, 0);
  assert.equal(calls.filter(([name]) => name === 'send-verification').length, 0);
});

test('a failed verification send does not undo the created account or throw an account-creation error', async () => {
  const { service, calls } = makeService({
    sendEmailVerification: async () => { throw Object.assign(new Error('raw response'), { code: 'auth/network-request-failed' }); },
  });
  const result = await service.register('Ada', 'ada@example.com', 'password1');
  assert.equal(result.displayNameUpdated, true);
  assert.equal(result.verificationEmailSent, false);
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
});

test('sign-in normalizes email but passes the password unchanged', async () => {
  const { service, calls } = makeService();
  await service.signIn(' ADA@Example.COM ', ' exact password ');
  assert.deepEqual(calls, [['sign-in', 'ada@example.com', ' exact password ']]);
});

test('sign-out delegates only to Firebase Auth and never invokes a local-data operation', async () => {
  const { service, calls } = makeService();
  await service.signOut();
  assert.deepEqual(calls, [['sign-out', true]]);
});

test('failed registration follow-ups can be retried against the existing Firebase user', async () => {
  const { service, calls, user } = makeService();
  await service.retryRegistrationDisplayName('Ada Lovelace');
  await service.retryRegistrationVerificationEmail();
  assert.deepEqual(calls, [
    ['update-profile', user.uid, 'Ada Lovelace'],
    ['send-verification', user.uid],
  ]);
  assert.equal(calls.some(([name]) => name === 'create'), false);
});

test('Firebase errors map to safe copy and never expose raw provider details', () => {
  const error = Object.assign(new Error('secret provider response'), { code: 'auth/network-request-failed' });
  assert.equal(getAuthErrorMessage(error), 'Could not reach the sign-in service. Check your connection and try again.');
  assert.equal(getAuthErrorMessage(error).includes('secret provider response'), false);
  assert.equal(getAuthErrorMessage(new Error('raw unknown error')).includes('raw unknown error'), false);
  assert.throws(() => { throw new AuthOperationError('safe'); }, { message: 'safe' });
});
