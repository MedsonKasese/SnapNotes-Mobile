import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createPrivateSession } from '../src/privateSession.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(process.env.SNAPNOTES_PRIVATE_SCREEN_SOURCE ?? new URL('../src/components/PrivateNotesScreen.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const PASSWORD = 'private-password-123';
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return tree?.props ? [tree, ...elements(tree.props.children)] : [];
}
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' ? tree : '';
function find(tree, predicate) {
  const found = elements(tree).find(predicate);
  assert.ok(found, 'expected Private Notes element');
  return found;
}
const button = (app, label) => find(app.render(), item => item.type === 'Pressable' && text(item) === label);
const visibilityButton = (app, label) => find(app.render(), item => item.type === 'Pressable' && item.props.accessibilityLabel === label);
const icon = (app, name) => find(app.render(), item => item.type === 'MaterialCommunityIcons' && item.props.name === name);
const input = (app, label = 'Private Notes password') => find(app.render(), item => item.props.accessibilityLabel === label);

// Exercise the actual JSX, hooks and async handlers. Native rendering and the
// access boundary are mocked; crypto/storage have separate integration tests.
async function screen({ status = async () => 'locked', setup = async () => {}, unlock = async () => {}, initialState = 'active' } = {}) {
  const slots = [], effects = [], calls = [], listeners = new Map();
  let cursor = 0, mounted = true, writesAfterUnmount = 0, backs = 0;
  const appState = {
    currentState: initialState,
    addEventListener(name, callback) {
      const callbacks = listeners.get(name) ?? new Set();
      callbacks.add(callback);
      listeners.set(name, callbacks);
      return { remove() { callbacks.delete(callback); } };
    },
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => {
        if (!mounted) writesAfterUnmount += 1;
        slots[index] = typeof value === 'function' ? value(slots[index]) : value;
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!effects[index] || deps.some((dep, i) => dep !== effects[index].deps[i])) {
        effects[index]?.cleanup?.();
        effects[index] = { callback, deps, pending: true };
      }
    },
  };
  const access = {
    status,
    setup(...args) { calls.push(['setup', ...args]); return setup(...args); },
    unlock(...args) { calls.push(['unlock', ...args]); return unlock(...args); },
  };
  const modules = {
    react, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'Text', 'TextInput', 'View'].map(name => [name, name])),
      AppState: appState, StyleSheet: { create: styles => styles },
    },
    '@expo/vector-icons/MaterialCommunityIcons': { __esModule: true, default: 'MaterialCommunityIcons' },
    '@react-native-async-storage/async-storage': {},
    '../privateAccess': { createPrivateAccess: () => access },
    '../privateSession': { createPrivateSession },
  };
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, Error,
    require(name) { assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name]; },
  });
  function render() {
    cursor = 0;
    const tree = exports.PrivateNotesScreen({ onBack() { backs += 1; } });
    for (const effect of effects) if (effect?.pending) { effect.pending = false; effect.cleanup = effect.callback(); }
    return tree;
  }
  async function flush() { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }
  render(); await flush();
  return {
    render, flush, calls,
    change(state) { appState.currentState = state; for (const callback of listeners.get('change') ?? []) callback(state); },
    replayEffects() {
      for (const effect of effects) effect?.cleanup?.();
      for (const effect of effects) if (effect) effect.cleanup = effect.callback();
    },
    unmount() { mounted = false; for (const effect of effects) effect?.cleanup?.(); },
    get writesAfterUnmount() { return writesAfterUnmount; },
    get backs() { return backs; },
  };
}
function enterPassword(app, setup = false) {
  input(app).props.onChangeText(PASSWORD);
  if (setup) input(app, 'Confirm Private Notes password').props.onChangeText(PASSWORD);
}
const isUnlocked = app => text(app.render()).includes('Lock Private Notes');

test('password visibility controls start hidden, toggle independently, and preserve entered values', async () => {
  const app = await screen({ status: async () => 'setup' });
  enterPassword(app, true);
  assert.equal(input(app).props.secureTextEntry, true);
  assert.equal(input(app, 'Confirm Private Notes password').props.secureTextEntry, true);
  assert.equal(visibilityButton(app, 'Show Private Notes password').props.accessibilityRole, 'button');
  assert.equal(visibilityButton(app, 'Show confirmation password').props.accessibilityRole, 'button');

  visibilityButton(app, 'Show Private Notes password').props.onPress();
  assert.equal(input(app).props.secureTextEntry, false);
  assert.equal(input(app).props.value, PASSWORD);
  assert.equal(input(app, 'Confirm Private Notes password').props.secureTextEntry, true);
  assert.equal(icon(app, 'eye-off').props.size, 22);

  visibilityButton(app, 'Show confirmation password').props.onPress();
  assert.equal(input(app, 'Confirm Private Notes password').props.secureTextEntry, false);
  assert.equal(input(app, 'Confirm Private Notes password').props.value, PASSWORD);
  visibilityButton(app, 'Hide Private Notes password').props.onPress();
  assert.equal(input(app).props.secureTextEntry, true);
  assert.equal(input(app).props.value, PASSWORD);
  assert.equal(input(app, 'Confirm Private Notes password').props.secureTextEntry, false);
});

test('setup and unlock clear secure inputs, while manual lock remains locked on foreground', async () => {
  const app = await screen({ status: async () => 'setup' });
  assert.equal(input(app).props.secureTextEntry, true);
  assert.equal(input(app, 'Confirm Private Notes password').props.secureTextEntry, true);
  enterPassword(app, true);
  button(app, 'Set password').props.onPress(); await app.flush();
  assert.deepEqual(app.calls, [['setup', PASSWORD, PASSWORD]]);
  assert.equal(isUnlocked(app), true);
  button(app, 'Lock Private Notes').props.onPress();
  assert.equal(input(app).props.value, '');
  app.change('background'); app.change('active');
  assert.equal(isUnlocked(app), false);
  enterPassword(app);
  button(app, 'Unlock').props.onPress(); await app.flush();
  assert.equal(isUnlocked(app), true);
});

for (const state of ['background', 'inactive']) {
  test(`moving to ${state} clears setup inputs and resets both visibility controls`, async () => {
    const app = await screen({ status: async () => 'setup' });
    enterPassword(app, true);
    visibilityButton(app, 'Show Private Notes password').props.onPress();
    visibilityButton(app, 'Show confirmation password').props.onPress();
    assert.equal(input(app).props.secureTextEntry, false);
    assert.equal(input(app, 'Confirm Private Notes password').props.secureTextEntry, false);

    app.change(state);
    assert.equal(input(app).props.value, '');
    assert.equal(input(app).props.secureTextEntry, true);
    assert.equal(input(app, 'Confirm Private Notes password').props.value, '');
    assert.equal(input(app, 'Confirm Private Notes password').props.secureTextEntry, true);
    assert.ok(visibilityButton(app, 'Show Private Notes password'));
    assert.ok(visibilityButton(app, 'Show confirmation password'));
  });
}

test('a pre-render double press starts only one password setup', async () => {
  const pending = deferred();
  const app = await screen({ status: async () => 'setup', setup: () => pending.promise });
  enterPassword(app, true);
  const submit = button(app, 'Set password').props.onPress;
  submit(); submit();
  assert.equal(app.calls.length, 1);
  pending.resolve(); await app.flush();
  assert.equal(isUnlocked(app), true);
});

test('visibility controls are masked and disabled while setup is pending', async () => {
  const pending = deferred();
  const app = await screen({ status: async () => 'setup', setup: () => pending.promise });
  enterPassword(app, true);
  visibilityButton(app, 'Show Private Notes password').props.onPress();
  visibilityButton(app, 'Show confirmation password').props.onPress();
  button(app, 'Set password').props.onPress();

  assert.equal(button(app, 'Please wait…').props.disabled, true);
  assert.equal(input(app).props.secureTextEntry, true);
  assert.equal(input(app, 'Confirm Private Notes password').props.secureTextEntry, true);
  assert.equal(visibilityButton(app, 'Show Private Notes password').props.disabled, true);
  assert.equal(visibilityButton(app, 'Show confirmation password').props.disabled, true);
  pending.resolve(); await app.flush();
  assert.equal(isUnlocked(app), true);
});

test('setup completing after backgrounding cannot unlock and shows the committed vault as locked', async () => {
  const pending = deferred();
  const app = await screen({ status: async () => 'setup', setup: () => pending.promise });
  enterPassword(app, true);
  button(app, 'Set password').props.onPress();
  app.change('background'); app.change('active');
  pending.resolve(); await app.flush();
  assert.equal(isUnlocked(app), false);
  assert.equal(input(app).props.value, '');
  assert.ok(button(app, 'Unlock'));
  assert.equal(elements(app.render()).some(item => item.props.accessibilityLabel === 'Confirm Private Notes password'), false);
});

for (const state of ['background', 'inactive']) {
  test(`unlock completing after ${state} stays locked even if the app has returned to foreground`, async () => {
    const pending = deferred();
    const app = await screen({ unlock: () => pending.promise });
    enterPassword(app);
    button(app, 'Unlock').props.onPress();
    app.change(state); app.change('active');
    pending.resolve(); await app.flush();
    assert.equal(isUnlocked(app), false);
    assert.equal(input(app).props.value, '');
    assert.equal(button(app, 'Unlock').props.disabled, false);
  });
}

test('authentication is not started while the screen is in the background', async () => {
  const app = await screen();
  enterPassword(app);
  const submit = button(app, 'Unlock').props.onPress;
  app.change('background');
  submit();
  assert.equal(app.calls.length, 0);
});

test('late authentication failure after backgrounding cannot publish a stale error', async () => {
  const pending = deferred();
  const app = await screen({ unlock: () => pending.promise });
  enterPassword(app); button(app, 'Unlock').props.onPress();
  app.change('background'); app.change('active');
  pending.reject(new Error('stale authentication error')); await app.flush();
  assert.equal(text(app.render()).includes('stale authentication error'), false);
  assert.equal(input(app).props.value, '');
  assert.equal(isUnlocked(app), false);
});

for (const outcome of ['resolve', 'reject']) {
  test(`unmount ignores a pending authentication ${outcome} and removes lifecycle listeners`, async () => {
    const pending = deferred();
    const app = await screen({ unlock: () => pending.promise });
    enterPassword(app); button(app, 'Unlock').props.onPress();
    app.unmount();
    if (outcome === 'resolve') pending.resolve(); else pending.reject(new Error('late error'));
    await app.flush();
    app.change('background');
    assert.equal(app.writesAfterUnmount, 0);
  });
}

test('back navigation clears passwords and invalidates an in-flight unlock before unmount', async () => {
  const pending = deferred();
  const app = await screen({ unlock: () => pending.promise });
  enterPassword(app);
  visibilityButton(app, 'Show Private Notes password').props.onPress();
  button(app, 'Unlock').props.onPress();
  button(app, '‹ All notes').props.onPress();
  assert.equal(app.backs, 1);
  assert.equal(input(app).props.value, '');
  assert.equal(input(app).props.secureTextEntry, true);
  assert.ok(visibilityButton(app, 'Show Private Notes password'));
  pending.resolve(); await app.flush();
  assert.equal(isUnlocked(app), false);
});

test('wrong password is retryable and corrupt vault status never offers password setup', async () => {
  let attempts = 0;
  const app = await screen({ unlock: async () => { if (++attempts === 1) throw new Error('Incorrect password or damaged private vault.'); } });
  enterPassword(app);
  visibilityButton(app, 'Show Private Notes password').props.onPress();
  button(app, 'Unlock').props.onPress(); await app.flush();
  assert.equal(isUnlocked(app), false);
  assert.match(text(app.render()), /Incorrect password/);
  assert.equal(input(app).props.value, PASSWORD);
  assert.equal(input(app).props.secureTextEntry, true);
  assert.ok(visibilityButton(app, 'Show Private Notes password'));
  button(app, 'Unlock').props.onPress(); await app.flush();
  assert.equal(isUnlocked(app), true);
  const corrupt = await screen({ status: async () => { throw new Error('corrupt'); } });
  assert.match(text(corrupt.render()), /No changes were made/);
  assert.equal(elements(corrupt.render()).some(item => item.type === 'TextInput'), false);
});

for (const phase of ['setup', 'locked']) {
  test(`Cancel exits ${phase} without starting authentication and clears secure inputs`, async () => {
    const app = await screen({ status: async () => phase });
    if (phase === 'setup') assert.match(text(app.render()), /cancel after starting setup, it may still finish/);
    enterPassword(app, phase === 'setup');
    visibilityButton(app, 'Show Private Notes password').props.onPress();
    if (phase === 'setup') visibilityButton(app, 'Show confirmation password').props.onPress();
    button(app, 'Cancel').props.onPress();
    assert.equal(app.backs, 1);
    assert.equal(app.calls.length, 0);
    assert.equal(input(app).props.value, '');
    assert.equal(input(app).props.secureTextEntry, true);
    assert.ok(visibilityButton(app, 'Show Private Notes password'));
    if (phase === 'setup') assert.equal(input(app, 'Confirm Private Notes password').props.value, '');
    if (phase === 'setup') assert.equal(input(app, 'Confirm Private Notes password').props.secureTextEntry, true);
    if (phase === 'setup') assert.ok(visibilityButton(app, 'Show confirmation password'));
    assert.equal(isUnlocked(app), false);
  });

  for (const outcome of ['resolve', 'reject']) {
    test(`Cancel during ${phase} ignores a late ${outcome} and leaves a fresh visit locked`, async () => {
      const pending = deferred();
      const app = await screen({ status: async () => phase, setup: () => pending.promise, unlock: () => pending.promise });
      enterPassword(app, phase === 'setup');
      button(app, phase === 'setup' ? 'Set password' : 'Unlock').props.onPress();
      assert.equal(app.calls.length, 1);
      const cancel = button(app, 'Cancel');
      assert.notEqual(cancel.props.disabled, true);
      cancel.props.onPress();
      assert.equal(app.backs, 1);
      assert.equal(input(app).props.value, '');
      if (phase === 'setup') assert.equal(input(app, 'Confirm Private Notes password').props.value, '');
      if (outcome === 'resolve') pending.resolve(); else pending.reject(new Error('cancelled authentication error'));
      await app.flush();
      assert.equal(isUnlocked(app), false);
      assert.equal(text(app.render()).includes('cancelled authentication error'), false);
      app.unmount();
      assert.equal(app.writesAfterUnmount, 0);
      const fresh = await screen();
      assert.equal(isUnlocked(fresh), false);
      assert.equal(input(fresh).props.value, '');
      enterPassword(fresh); button(fresh, 'Unlock').props.onPress(); await fresh.flush();
      assert.equal(isUnlocked(fresh), true);
    });
  }
}

for (const initialState of ['background', 'inactive']) {
  test(`mounting ${initialState} permits authentication only after foreground activation`, async () => {
    const app = await screen({ initialState });
    enterPassword(app);
    button(app, 'Unlock').props.onPress();
    assert.equal(app.calls.length, 0);
    app.change('active');
    button(app, 'Unlock').props.onPress(); await app.flush();
    assert.equal(app.calls.length, 1);
    assert.equal(isUnlocked(app), true);
  });
}

test('React effect replay invalidates old authentication but allows a fresh foreground attempt', async () => {
  const pending = deferred();
  let attempts = 0;
  const app = await screen({ unlock: () => ++attempts === 1 ? pending.promise : Promise.resolve() });
  enterPassword(app); button(app, 'Unlock').props.onPress();
  app.replayEffects(); await app.flush();
  pending.resolve(); await app.flush();
  assert.equal(isUnlocked(app), false);
  enterPassword(app); button(app, 'Unlock').props.onPress(); await app.flush();
  assert.equal(app.calls.length, 2);
  assert.equal(isUnlocked(app), true);
});
