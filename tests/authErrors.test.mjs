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
});

test('duplicate-email errors do not disclose whether an address is registered', () => {
  const inUse = getAuthErrorMessage({ code: 'auth/email-already-in-use' });
  const alreadyExists = getAuthErrorMessage({ code: 'auth/email-already-exists' });
  assert.equal(inUse, 'We could not complete this request with the provided details. Check them and try again.');
  assert.equal(alreadyExists, inUse);
  assert.doesNotMatch(inUse, /email|already|exist|registered|sign[\s-]*in|account/i);
});

test('network, rate-limit, and unknown errors receive safe actionable messages', () => {
  assert.match(getAuthErrorMessage({ code: 'auth/network-request-failed' }), /Check your connection/);
  assert.match(getAuthErrorMessage({ code: 'auth/too-many-requests' }), /Wait a while/);
  const unknown = getAuthErrorMessage({ code: 'auth/internal-error', message: 'raw internal response' });
  assert.match(unknown, /Your notes remain on this device/);
  assert.equal(unknown.includes('raw internal response'), false);
});
