import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateScreenCaptureProtection } from '../src/privateScreenCapture.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function captureApi(overrides = {}) {
  const calls = [];
  return {
    calls,
    preventScreenCaptureAsync: async key => { calls.push(['prevent', key]); await overrides.prevent?.(key); },
    allowScreenCaptureAsync: async key => { calls.push(['allow', key]); await overrides.allow?.(key); },
    enableAppSwitcherProtectionAsync: async () => { calls.push(['enable-app-switcher']); await overrides.enableAppSwitcher?.(); },
    disableAppSwitcherProtectionAsync: async () => { calls.push(['disable-app-switcher']); await overrides.disableAppSwitcher?.(); },
  };
}

test('capture protection uses a unique key per private-screen lease and releases only its own key', async () => {
  const api = captureApi();
  const first = createPrivateScreenCaptureProtection(api);
  const second = createPrivateScreenCaptureProtection(api);
  await first.activate();
  await second.activate();
  await first.release();
  assert.deepEqual(api.calls.map(([operation]) => operation), ['prevent', 'prevent', 'allow']);
  assert.notEqual(api.calls[0][1], api.calls[1][1]);
  assert.equal(api.calls[2][1], api.calls[0][1]);
  await second.release();
  assert.equal(api.calls[3][1], api.calls[1][1]);
});

test('unmount during asynchronous activation waits to release the native protection key', async () => {
  const pending = deferred();
  const api = captureApi({ prevent: () => pending.promise });
  const guard = createPrivateScreenCaptureProtection(api);
  const activating = guard.activate();
  const releasing = guard.release();
  assert.deepEqual(api.calls.map(([operation]) => operation), ['prevent']);
  pending.resolve();
  await Promise.all([activating, releasing]);
  assert.deepEqual(api.calls.map(([operation]) => operation), ['prevent', 'allow']);
  assert.equal(api.calls[1][1], api.calls[0][1]);
});

test('failed native activation is cleaned up and release is idempotent', async () => {
  const api = captureApi({ prevent: async () => { throw new Error('native protection unavailable'); } });
  const guard = createPrivateScreenCaptureProtection(api);
  await assert.rejects(guard.activate(), /native protection unavailable/);
  await guard.release();
  await guard.release();
  assert.deepEqual(api.calls.map(([operation]) => operation), ['prevent', 'allow']);
  assert.equal(api.calls[1][1], api.calls[0][1]);
});

test('iOS app-switcher privacy is enabled and disabled with the screen-capture lease', async () => {
  const api = captureApi();
  const guard = createPrivateScreenCaptureProtection(api, true);
  await guard.activate();
  await guard.release();
  assert.deepEqual(api.calls.map(([operation]) => operation), [
    'prevent', 'enable-app-switcher', 'disable-app-switcher', 'allow',
  ]);
});
