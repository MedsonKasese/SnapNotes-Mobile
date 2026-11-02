import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDisplayName,
  normalizeEmail,
  validateRegistration,
  validateSignIn,
} from '../src/auth/authValidation.ts';

test('email and display name normalization are stable without altering passwords', () => {
  assert.equal(normalizeEmail('  Ada@Example.COM  '), 'ada@example.com');
  assert.equal(normalizeDisplayName('  Ada   Lovelace  '), 'Ada Lovelace');
});

test('sign-in requires a valid email and a non-empty password', () => {
  assert.deepEqual(validateSignIn('', ''), {
    email: 'Enter your email address.',
    password: 'Enter your password.',
  });
  assert.deepEqual(validateSignIn('not-an-email', 'secret'), {
    email: 'Enter a valid email address.',
  });
  assert.deepEqual(validateSignIn(' ADA@example.com ', ' secret '), {});
});

test('registration validates required fields, email shape, password length and confirmation', () => {
  assert.deepEqual(validateRegistration('', 'bad', 'short', 'different'), {
    displayName: 'Enter your name.',
    email: 'Enter a valid email address.',
    password: 'Use at least 6 characters.',
    confirmPassword: 'The passwords do not match.',
  });
  assert.deepEqual(validateRegistration('Ada', 'ada@example.com', '  12345  ', '  12345  '), {});
  assert.deepEqual(validateRegistration('Ada', 'ada@example.com', 'secret1', ''), {
    confirmPassword: 'Confirm your password.',
  });
});

test('registration display name is capped at the PWA-compatible 80 characters', () => {
  const errors = validateRegistration('A'.repeat(81), 'ada@example.com', 'secret1', 'secret1');
  assert.equal(errors.displayName, 'Use 80 characters or fewer.');
});
