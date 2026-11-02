import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthErrorMessage } from '../src/auth/authErrors.ts';

test('credential errors do not reveal whether an email account exists', () => {
  assert.equal(getAuthErrorMessage({ code: 'auth/invalid-credential' }), 'The email or password is incorrect.');
  assert.equal(getAuthErrorMessage({ code: 'auth/user-not-found' }), 'The email or password is incorrect.');
});

test('network, rate-limit, and unknown errors receive safe actionable messages', () => {
  assert.match(getAuthErrorMessage({ code: 'auth/network-request-failed' }), /Check your connection/);
  assert.match(getAuthErrorMessage({ code: 'auth/too-many-requests' }), /Wait a while/);
  const unknown = getAuthErrorMessage({ code: 'auth/internal-error', message: 'raw internal response' });
  assert.match(unknown, /Your notes remain on this device/);
  assert.equal(unknown.includes('raw internal response'), false);
});
