import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthErrorMessage } from '../src/auth/authErrors.ts';

test('credential errors do not reveal whether an email account exists', () => {
  assert.equal(getAuthErrorMessage({ code: 'auth/invalid-credential' }), 'The email or password is incorrect.');
  assert.equal(getAuthErrorMessage({ code: 'auth/user-not-found' }), 'The email or password is incorrect.');
});

test('registration and provider restrictions have distinct, non-misleading messages', () => {
  assert.match(getAuthErrorMessage({ code: 'auth/admin-restricted-operation' }), /restricted this operation/);
  const providerDisabled = getAuthErrorMessage({ code: 'auth/operation-not-allowed' });
  assert.match(providerDisabled, /Email and password authentication is not enabled/);
  assert.doesNotMatch(providerDisabled, /sign-in/);
  assert.match(getAuthErrorMessage({ code: 'auth/email-already-in-use' }), /Try signing in instead/);
});

test('network, rate-limit, and unknown errors receive safe actionable messages', () => {
  assert.match(getAuthErrorMessage({ code: 'auth/network-request-failed' }), /Check your connection/);
  assert.match(getAuthErrorMessage({ code: 'auth/too-many-requests' }), /Wait a while/);
  const unknown = getAuthErrorMessage({ code: 'auth/internal-error', message: 'raw internal response' });
  assert.match(unknown, /Your notes remain on this device/);
  assert.equal(unknown.includes('raw internal response'), false);
});
