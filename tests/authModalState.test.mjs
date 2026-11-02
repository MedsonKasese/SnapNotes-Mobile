import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/AccountAccessModal.tsx', import.meta.url), 'utf8');

function functionBody(name) {
  const start = source.indexOf(`const ${name} = async () => {`);
  assert.notEqual(start, -1, `${name} handler should exist`);
  const end = source.indexOf('\n  };', start);
  assert.notEqual(end, -1, `${name} handler should close`);
  return source.slice(start, end);
}

test('registration result and retry state survive Firebase observer sign-in updates', () => {
  assert.doesNotMatch(source, /key=\{sessionKey\}/);
  assert.match(source, /const \[createdEmail, setCreatedEmail\]/);
  assert.match(source, /const \[pendingDisplayName, setPendingDisplayName\]/);
  assert.match(source, /const \[verificationRetryAvailable, setVerificationRetryAvailable\]/);
  assert.match(source, /const result = await authService\.register\([\s\S]*?setCreatedEmail\(result\.email\)[\s\S]*?setPendingDisplayName\([\s\S]*?setVerificationRetryAvailable\(/);
});

test('successful explicit sign-out clears account form state after Firebase Auth succeeds', () => {
  const body = functionBody('handleSignOut');
  assert.match(body, /await authService\.signOut\(\);\s*clearTransientState\(\)/);
  assert.doesNotMatch(body, /AsyncStorage|notesStorage|Firestore|privateVault/i);
});

test('unverified users retain local notes and can refresh status or request a fresh verification email', () => {
  assert.match(source, /Verification pending/);
  assert.match(source, /Refresh verification status/);
  assert.match(source, /Resend verification email/);
  assert.match(source, /invalid or expired/);
  assert.match(source, /Your local notes stay available while you verify/);
});

test('password recovery has a neutral acknowledgement and does not gate the notes workspace', () => {
  assert.match(source, /Forgot password\?/);
  assert.match(source, /requestPasswordReset\(email\)/);
  assert.match(source, /response will not reveal whether an account exists/);
  assert.match(source, /Local notes remain on this device whether you sign in, sign out, or stay offline/);
});
