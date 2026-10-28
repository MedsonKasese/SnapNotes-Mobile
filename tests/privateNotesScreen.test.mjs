import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createPrivateSession } from '../src/privateSession.ts';
import { sanitizeNoteHtml } from '../src/noteFormatting.ts';

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
async function screen({ status = async () => 'locked', setup = async () => {}, unlock = async () => [], restore = async () => 'restored', update = async (_id, _session, changes, note) => ({ ...note, ...changes }), remove = async () => {}, onRestored = async () => {}, initialState = 'active' } = {}) {
  const slots = [], effects = [], calls = [], listeners = new Map();
  const restoreCalls = [], mutationCalls = [], alerts = [];
  const unlockedKey = { token: 'authenticated-test-key' };
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
    useMemo(factory) { cursor++; return factory(); },
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
    readUnlockedSession(...args) {
      calls.push(['unlock', ...args]);
      return Promise.resolve(unlock(...args)).then(notes => {
        lastUnlockedNotes = notes ?? [];
        return { notes: lastUnlockedNotes, key: unlockedKey, salt: new Uint8Array([1]) };
      });
    },
  };
  const modules = {
    react, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name])),
      AppState: appState, StyleSheet: { create: styles => styles },
      Alert: { alert(...args) { alerts.push(args); } },
    },
    '@expo/vector-icons/FontAwesome': { __esModule: true, default: 'FontAwesome' },
    '@expo/vector-icons/MaterialCommunityIcons': { __esModule: true, default: 'MaterialCommunityIcons' },
    '@react-native-async-storage/async-storage': {},
    '../privateAccess': { createPrivateAccess: () => access },
    '../privateSession': { createPrivateSession },
    '../privateRestoreService': { restoreDevicePrivateNoteWithKey(id, key) { restoreCalls.push([id, key]); return restore(id, key); } },
    '../privateNoteManagementService': {
      updateDevicePrivateNote(id, session, changes) {
        mutationCalls.push(['update', id, changes]);
        const note = (lastUnlockedNotes ?? []).find(item => item.id === id) ?? {};
        return update(id, session, changes, note);
      },
      deleteDevicePrivateNote(id, session) { mutationCalls.push(['delete', id]); return remove(id, session); },
    },
    '../notes': { validateDraft: () => null },
    '../noteFormatting': { sanitizeNoteHtml },
    '../noteActionsMenu': { getNoteActionsMenuLayout: () => ({ left: 0, top: 0, width: 216, maxHeight: 500 }) },
    './RichNoteEditor': { RichNoteEditor: 'RichNoteEditor' },
  };
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, Error,
    require(name) { assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name]; },
  });
  let lastUnlockedNotes = [];
  function render() {
    cursor = 0;
    const tree = exports.PrivateNotesScreen({ onBack() { backs += 1; }, onRestored });
    for (const effect of effects) if (effect?.pending) { effect.pending = false; effect.cleanup = effect.callback(); }
    return tree;
  }
  async function flush() { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }
  render(); await flush();
  return {
    render, flush, calls, restoreCalls, mutationCalls, alerts, unlockedKey,
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

test('unlock displays authenticated previews and locking clears decrypted note content', async () => {
  const preview = { id: 'private-1', title: 'Private title', text: 'Sensitive body', html: '<p>Sensitive body</p>', category: 'general',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
  const app = await screen({ unlock: async () => [preview] });
  enterPassword(app); button(app, 'Unlock').props.onPress(); await app.flush();
  assert.deepEqual(app.calls, [['unlock', PASSWORD]]);
  assert.match(text(app.render()), /Private title/);
  const privateCount = find(app.render(), item => item.props.testID === 'private-note-count');
  assert.equal(privateCount.props.children[0], 1);
  assert.match(text(privateCount), /private note/);
  const updatedAt = new Date('2026-01-02T00:00:00.000Z');
  const expectedUpdated = `Updated ${updatedAt.toLocaleDateString()} · ${updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  assert.ok(text(app.render()).includes(expectedUpdated));
  find(app.render(), item => item.type === 'Pressable' && item.props.accessibilityLabel === 'Open private note Private title').props.onPress();
  assert.match(text(app.render()), /Sensitive body/);
  button(app, 'Lock Private Notes').props.onPress();
  assert.doesNotMatch(text(app.render()), /Sensitive body/);
});

test('private card time follows PWA explicit-time precedence and labels legacy missing dates', async () => {
  const timed = { id: 'private-time', title: 'Timed', text: 'Body', html: '<p>Body</p>', category: 'general',
    time: '9:30 AM', createdAt: '2026-01-01T00:00:00.000Z' };
  const timedApp = await screen({ unlock: async () => [timed] });
  enterPassword(timedApp); button(timedApp, 'Unlock').props.onPress(); await timedApp.flush();
  assert.ok(text(timedApp.render()).includes('9:30 AM'));
  assert.ok(!text(timedApp.render()).includes('1 Jan 2026'));

  const legacyApp = await screen({ unlock: async () => [{ ...timed, id: 'legacy', time: undefined, createdAt: undefined }] });
  enterPassword(legacyApp); button(legacyApp, 'Unlock').props.onPress(); await legacyApp.flush();
  assert.ok(text(legacyApp.render()).includes('No date'));
});

test('private-note footer keeps category and Updated time together on the left, with pin and menu on the right', async () => {
  const updatedAt = '2026-10-28T09:01:00.000Z';
  const preview = { id: 'private-footer', title: 'Footer note', text: 'Body', html: '<p>Body</p>',
    category: 'general', pinned: false, updatedAt };
  const app = await screen({ unlock: async () => [preview] });
  enterPassword(app); button(app, 'Unlock').props.onPress(); await app.flush();

  const tree = app.render();
  const footer = find(tree, item => item.props.testID === 'private-note-footer');
  const metadata = find(tree, item => item.props.testID === 'private-note-metadata');
  const actions = find(tree, item => item.props.testID === 'private-note-footer-actions');
  assert.equal(footer.props.children[0], metadata);
  assert.equal(footer.props.children[1], actions);
  assert.equal(text(metadata.props.children[0]), 'general');
  assert.equal(metadata.props.children[0].props.style.textTransform, 'capitalize');
  const expectedUpdated = `Updated ${new Date(updatedAt).toLocaleDateString()} · ${new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  assert.equal(text(metadata.props.children[1]), expectedUpdated);
  assert.deepEqual(elements(actions).filter(item => item.type === 'Pressable').map(item => item.props.accessibilityLabel), [
    'Pin private note Footer note', 'Note actions for Footer note',
  ]);
});

test('moving a private note out asks for one confirmation and refreshes the ordinary library', async () => {
  const preview = { id: 'private-1', title: 'Private title', text: 'Sensitive body', html: '<p>Sensitive body</p>', category: 'general' };
  let refreshes = 0;
  const app = await screen({ unlock: async () => [preview], onRestored: async () => { refreshes += 1; } });
  enterPassword(app); button(app, 'Unlock').props.onPress(); await app.flush();
  find(app.render(), item => item.type === 'Pressable' && item.props.accessibilityLabel === 'Note actions for Private title').props.onPress();
  button(app, 'Move out of Private Notes').props.onPress();
  assert.equal(app.alerts.length, 1);
  assert.equal(app.restoreCalls.length, 0);
  app.alerts[0][2][1].onPress(); await app.flush();
  assert.deepEqual(app.restoreCalls, [['private-1', app.unlockedKey]]);
  assert.equal(elements(app.render()).some(item => item.props.accessibilityLabel === 'Confirm password to restore private note'), false);
  assert.equal(refreshes, 1);
  assert.doesNotMatch(text(app.render()), /Sensitive body/);
});

test('private note cards expose only edit, move-out, and delete actions; pin remains a separate card button', async () => {
  const preview = { id: 'private-1', title: 'Private title', text: 'Sensitive body', html: '<p>Sensitive body</p>', category: 'general', pinned: false };
  const app = await screen({ unlock: async () => [preview] });
  enterPassword(app); button(app, 'Unlock').props.onPress(); await app.flush();
  assert.ok(find(app.render(), item => item.props.accessibilityLabel === 'Pin private note Private title'));
  find(app.render(), item => item.type === 'Pressable' && item.props.accessibilityLabel === 'Note actions for Private title').props.onPress();
  const menu = find(app.render(), item => item.props.testID === 'private-note-actions-menu');
  const menuText = text(menu);
  assert.match(menuText, /Edit note/);
  assert.match(menuText, /Move out of Private Notes/);
  assert.match(menuText, /Delete private note/);
  for (const unsupported of ['Duplicate note', 'Share note', 'edit history', 'Move to folder', 'Archive note', 'Pin note']) {
    assert.doesNotMatch(menuText, new RegExp(unsupported));
  }
  assert.equal(app.alerts.length, 0);
});

test('editing a private note saves without confirmation', async () => {
  const preview = { id: 'private-1', title: 'Private title', text: 'Sensitive body', html: '<p>Sensitive body</p>', category: 'general', pinned: false };
  const app = await screen({ unlock: async () => [preview] });
  enterPassword(app); button(app, 'Unlock').props.onPress(); await app.flush();
  find(app.render(), item => item.type === 'Pressable' && item.props.accessibilityLabel === 'Note actions for Private title').props.onPress();
  button(app, 'Edit note').props.onPress();
  assert.equal(app.alerts.length, 0);
  input(app, 'Edit private note title').props.onChangeText('Updated private title');
  const editor = find(app.render(), item => item.type === 'RichNoteEditor');
  editor.props.onReady(true);
  let snapshotCalls = 0;
  editor.props.ref.current = { async getContent() { snapshotCalls += 1; return { text: 'Updated body', html: '<p>Updated body</p>' }; } };
  button(app, 'Save note').props.onPress(); await app.flush();
  assert.equal(snapshotCalls, 1, 'save waits for the authoritative WebView snapshot');
  assert.deepEqual(JSON.parse(JSON.stringify(app.mutationCalls[0])), ['update', 'private-1', {
    title: 'Updated private title', text: 'Updated body', html: '<p>Updated body</p>',
  }]);
  assert.match(text(app.render()), /Updated private title/);
  assert.equal(app.alerts.length, 0);
});

test('deleting a private note is immediate and does not show a confirmation', async () => {
  const preview = { id: 'private-1', title: 'Private title', text: 'Sensitive body', html: '<p>Sensitive body</p>', category: 'general', pinned: false };
  const app = await screen({ unlock: async () => [preview] });
  enterPassword(app); button(app, 'Unlock').props.onPress(); await app.flush();
  find(app.render(), item => item.type === 'Pressable' && item.props.accessibilityLabel === 'Note actions for Private title').props.onPress();
  button(app, 'Delete private note').props.onPress(); await app.flush();
  assert.deepEqual(app.mutationCalls[0], ['delete', 'private-1']);
  assert.equal(app.alerts.length, 0);
  assert.doesNotMatch(text(app.render()), /Private title|Sensitive body/);
});

test('pinning a private note updates the separate card button without putting pin in the menu', async () => {
  const preview = { id: 'private-1', title: 'Private title', text: 'Sensitive body', html: '<p>Sensitive body</p>', category: 'general', pinned: false };
  const app = await screen({ unlock: async () => [preview] });
  enterPassword(app); button(app, 'Unlock').props.onPress(); await app.flush();
  visibilityButton(app, 'Pin private note Private title').props.onPress(); await app.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(app.mutationCalls[0])), ['update', 'private-1', { pinned: true }]);
  assert.equal(app.alerts.length, 0);
});

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
