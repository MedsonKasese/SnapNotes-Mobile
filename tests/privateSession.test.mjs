import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateSession } from '../src/privateSession.ts';

test('only one foreground unlock attempt begins at once', () => {
  const session = createPrivateSession();
  const token = session.begin();
  assert.equal(typeof token, 'number');
  assert.equal(session.begin(), null);
  session.finish(token);
  assert.equal(session.valid(token), true);
});

test('background invalidates pending unlock even after returning active', () => {
  const session = createPrivateSession();
  const token = session.begin();
  session.setActive(false);
  assert.equal(session.valid(token), false);
  assert.equal(session.begin(), null);
  session.setActive(true);
  assert.equal(session.valid(token), false);
  assert.notEqual(session.begin(), token);
});

test('manual lock and navigation invalidate stale results', () => {
  const session = createPrivateSession();
  const token = session.begin();
  session.invalidate();
  assert.equal(session.valid(token), false);
  assert.notEqual(session.begin(), token);
});

test('starting a later attempt retires the completed attempt token', () => {
  const session = createPrivateSession();
  const old = session.begin();
  session.finish(old);
  const current = session.begin();
  assert.notEqual(current, old);
  assert.equal(session.valid(old), false);
  assert.equal(session.valid(current), true);
});

test('finishing an invalidated attempt cannot release a newer pending attempt', () => {
  const session = createPrivateSession();
  const old = session.begin();
  session.invalidate();
  const current = session.begin();
  session.finish(old);
  assert.equal(session.begin(), null);
  assert.equal(session.valid(old), false);
  assert.equal(session.valid(current), true);
  session.finish(current);
  const next = session.begin();
  assert.notEqual(next, null);
  assert.notEqual(next, current);
});
