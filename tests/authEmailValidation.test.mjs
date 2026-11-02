import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEmailAddress } from '../src/auth/authValidation.ts';

test('email shape accepts provider-neutral and undotted domains for Firebase to evaluate', () => {
  assert.equal(validateEmailAddress('ada@internal'), undefined);
  assert.equal(validateEmailAddress('ada+notes@sub.example.com'), undefined);
});

test('email shape still rejects missing parts, whitespace, or multiple at-signs', () => {
  assert.equal(validateEmailAddress(''), 'Enter your email address.');
  assert.equal(validateEmailAddress('not-an-email'), 'Enter a valid email address.');
  assert.equal(validateEmailAddress('ada@@example.com'), 'Enter a valid email address.');
  assert.equal(validateEmailAddress('ada @example.com'), 'Enter a valid email address.');
});
