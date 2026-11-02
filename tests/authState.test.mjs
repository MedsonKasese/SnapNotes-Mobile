import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authStateFromRefreshedUser,
  authStateFromUser,
  INITIAL_AUTH_STATE,
} from '../src/auth/authState.ts';
import { subscribeToAuthState } from '../src/auth/authStateSubscription.ts';

test('auth state begins unresolved and only a null Firebase observer value means signed out', () => {
  assert.deepEqual(INITIAL_AUTH_STATE, { status: 'initializing' });
  assert.deepEqual(authStateFromUser(null), { status: 'signed-out' });
});

test('a verification reload publishes only while the exact Firebase user instance is still current', () => {
  const originalUser = {
    uid: 'same-user-id', email: 'owner@example.com', displayName: 'Owner', emailVerified: true,
  };
  const replacementSession = { ...originalUser, emailVerified: false };
  assert.deepEqual(authStateFromRefreshedUser(originalUser, originalUser), authStateFromUser(originalUser));
  assert.equal(authStateFromRefreshedUser(originalUser, replacementSession), null);
  assert.equal(authStateFromRefreshedUser(originalUser, null), null);
});

test('mocked observer restoration maps a persisted user to a safe signed-in summary', () => {
  let emitUser;
  let emitError;
  let unsubscribed = false;
  const states = [];
  const restoredUser = {
    uid: 'restored-user-id',
    email: 'owner@example.com',
    displayName: 'Owner',
    emailVerified: true,
    accessToken: 'must-not-escape',
    refreshToken: 'must-not-escape',
    password: 'must-not-escape',
  };

  const unsubscribe = subscribeToAuthState((next, error) => {
    emitUser = next;
    emitError = error;
    return () => { unsubscribed = true; };
  }, (state) => states.push(state));

  emitUser(restoredUser);
  assert.deepEqual(states, [{
    status: 'signed-in',
    user: {
      uid: 'restored-user-id',
      email: 'owner@example.com',
      displayName: 'Owner',
      emailVerified: true,
    },
  }]);
  assert.equal(JSON.stringify(states).includes('must-not-escape'), false);

  emitUser(null);
  assert.deepEqual(states.at(-1), { status: 'signed-out' });
  emitError();
  assert.deepEqual(states.at(-1), { status: 'unavailable' });

  unsubscribe();
  assert.equal(unsubscribed, true);
});
