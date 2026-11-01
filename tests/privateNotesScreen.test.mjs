import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createPrivateSession } from '../src/privateSession.ts';
import { createPrivateScreenCaptureProtection } from '../src/privateScreenCapture.ts';
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
const lockButton = app => find(app.render(), item => item.type === 'Pressable' && item.props.accessibilityLabel === 'Lock Private Notes');
const icon = (app, name) => find(app.render(), item => item.type === 'MaterialCommunityIcons' && item.props.name === name);
const input = (app, label = 'Private Notes password') => find(app.render(), item => item.props.accessibilityLabel === label);

// Exercise the actual JSX, hooks and async handlers. Native rendering and the
// access boundary are mocked; crypto/storage have separate integration tests.
async function screen({
  status = async () => 'locked', setup = async () => {}, unlock = async () => [],
  unlockWithKey = async () => [], exportBiometricKey = async () => Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  biometricAvailable = false, biometricKey = null,
  restore = async () => 'restored', update = async (_id, _session, changes, note) => ({ ...note, ...changes }),
  remove = async () => {}, onRestored = async () => {}, preventCapture = async () => {},
  allowCapture = async () => {}, initialState = 'active',
} = {}) {
  const slots = [], effects = [], calls = [], listeners = new Map();
  const restoreCalls = [], mutationCalls = [], alerts = [], captureCalls = [], biometricCalls = [];
  const unlockedKey = { token: 'authenticated-test-key' };
  let storedBiometricKey = biometricKey ? Uint8Array.from(biometricKey) : null;
  const asyncStorage = new Map();
  const biometricKeyStore = {
    canUse() { return biometricAvailable; },
    async read() { biometricCalls.push(['read']); return storedBiometricKey ? Uint8Array.from(storedBiometricKey) : null; },
    async save(key) { biometricCalls.push(['save']); storedBiometricKey = Uint8Array.from(key); },
    async remove() { biometricCalls.push(['remove']); storedBiometricKey = null; },
  };
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
  const screenCapture = {
    preventScreenCaptureAsync(key) { captureCalls.push(['prevent', key]); return preventCapture(key); },
    allowScreenCaptureAsync(key) { captureCalls.push(['allow', key]); return allowCapture(key); },
    enableAppSwitcherProtectionAsync() { captureCalls.push(['enable-app-switcher']); return Promise.resolve(); },
    disableAppSwitcherProtectionAsync() { captureCalls.push(['disable-app-switcher']); return Promise.resolve(); },
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
    exportBiometricKey(...args) { calls.push(['exportBiometricKey', ...args]); return exportBiometricKey(...args); },
    readUnlockedSessionWithKey(key) {
      calls.push(['unlockWithBiometricKey', key]);
      return Promise.resolve(unlockWithKey(key)).then(notes => {
        lastUnlockedNotes = notes ?? [];
        return { notes: lastUnlockedNotes, key, salt: new Uint8Array([1]) };
      });
    },
  };
  const modules = {
    react, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name])),
      AppState: appState, Platform: { OS: 'android' }, StyleSheet: { create: styles => styles },
      Alert: { alert(...args) { alerts.push(args); } },
    },
    '@expo/vector-icons/FontAwesome': { __esModule: true, default: 'FontAwesome' },
    '@expo/vector-icons/MaterialCommunityIcons': { __esModule: true, default: 'MaterialCommunityIcons' },
    '@react-native-async-storage/async-storage': {
      async getItem(key) { return asyncStorage.get(key) ?? null; },
      async setItem(key, value) { asyncStorage.set(key, value); },
      async removeItem(key) { asyncStorage.delete(key); },
    },
    'expo-screen-capture': screenCapture,
    '../privateAccess': { createPrivateAccess: () => access },
    '../privateCrypto': { importPrivateKey: async key => ({ raw: Array.from(key) }) },
    '../privateBiometricUnlock': {
      PRIVATE_BIOMETRIC_ENABLED_FLAG: '@test/biometric-enabled',
      privateBiometricKeyStore: biometricKeyStore,
    },
    '../privateSession': { createPrivateSession },
    '../privateScreenCapture': { createPrivateScreenCaptureProtection },
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
  async function flush() { for (let i = 0; i < 32; i += 1) await Promise.resolve(); }
  render(); await flush();
  return {
    render, flush, calls, restoreCalls, mutationCalls, alerts, captureCalls, biometricCalls, asyncStorage, unlockedKey,
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
const isUnlocked = app => elements(app.render()).some(item => item.type === 'Pressable' && item.props.accessibilityLabel === 'Lock Private Notes');

test('private controls stay hidden until capture blocking is active and the native lease lasts until unmount', async () => {
  const pending = deferred();
  const preview = { id: 'private-1', title: 'Private title', text: 'Sensitive body', html: '<p>Sensitive body</p>', category: 'general' };
  const app = await screen({ preventCapture: () => pending.promise, unlock: async () => [preview] });
  assert.deepEqual(app.captureCalls.map(([operation]) => operation), ['prevent']);
  assert.doesNotMatch(text(app.render()), /Private Notes password|Unlock/);
  assert.equal(app.captureCalls[0][1].startsWith('snapnotes-private-notes-'), true);

  pending.resolve();
  await app.flush();
  enterPassword(app); button(app, 'Unlock').props.onPress(); await app.flush();
  assert.match(text(app.render()), /Sensitive body/);
  lockButton(app).props.onPress();
  assert.doesNotMatch(text(app.render()), /Sensitive body/);
  assert.deepEqual(app.captureCalls.map(([operation]) => operation), ['prevent'], 'locking must not release protection while this screen remains mounted');

  app.unmount(); await app.flush();
  assert.deepEqual(app.captureCalls.map(([operation]) => operation), ['prevent', 'allow']);
  assert.equal(app.captureCalls[1][1], app.captureCalls[0][1]);
});

test('private notes fail closed when native capture protection cannot be enabled', async () => {
  const app = await screen({ preventCapture: async () => { throw new Error('native capture unavailable'); } });
  assert.match(text(app.render()), /Screen protection could not be enabled/);
  assert.doesNotMatch(text(app.render()), /Private Notes password|Unlock/);
  app.unmount(); await app.flush();
  assert.deepEqual(app.captureCalls.map(([operation]) => operation), ['prevent', 'allow']);
  assert.equal(app.captureCalls[1][1], app.captureCalls[0][1]);
});

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
  const tree = app.render();
  const titleRow = find(tree, item => item.props.testID === 'private-notes-title-row');
  const lockControl = find(tree, item => item.type === 'Pressable' && item.props.accessibilityLabel === 'Lock Private Notes');
  assert.equal(text(titleRow.props.children[0]), 'Private Notes');
  assert.equal(titleRow.props.children[0].props.accessibilityRole, 'header');
  assert.equal(titleRow.props.children[1], lockControl);
  assert.equal(text(lockControl), 'Lock');
  assert.equal(elements(tree).filter(item => item.type === 'Pressable' && item.props.accessibilityLabel === 'Lock Private Notes').length, 1);
  assert.equal(elements(tree).some(item => item.type === 'Text' && text(item) === 'PRIVATE NOTES'), false);
  const updatedAt = new Date('2026-01-02T00:00:00.000Z');
  const expectedUpdated = `Updated ${updatedAt.toLocaleDateString()} · ${updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  assert.ok(text(app.render()).includes(expectedUpdated));
  find(app.render(), item => item.type === 'Pressable' && item.props.accessibilityLabel === 'Open private note Private title').props.onPress();
  assert.match(text(app.render()), /Sensitive body/);
  lockButton(app).props.onPress();
  assert.doesNotMatch(text(app.render()), /Sensitive body/);
  assert.equal(isUnlocked(app), false);
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

test('deleting a private note requires explicit permanent-deletion confirmation', async () => {
  const preview = { id: 'private-1', title: 'Private title', text: 'Sensitive body', html: '<p>Sensitive body</p>', category: 'general', pinned: false };
  const app = await screen({ unlock: async () => [preview] });
  enterPassword(app); button(app, 'Unlock').props.onPress(); await app.flush();
  find(app.render(), item => item.type === 'Pressable' && item.props.accessibilityLabel === 'Note actions for Private title').props.onPress();
  button(app, 'Delete private note').props.onPress(); await app.flush();
  assert.equal(app.alerts.length, 1);
  assert.equal(app.alerts[0][0], 'Delete private note?');
  assert.match(app.alerts[0][1], /permanently deletes the encrypted note.*cannot be undone/i);
  assert.deepEqual(JSON.parse(JSON.stringify(app.alerts[0][2].map(({ text, style }) => ({ text, style })))), [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete permanently', style: 'destructive' },
  ]);
  assert.equal(app.alerts[0][2][0].onPress, undefined, 'Cancel must only dismiss the confirmation');
  assert.equal(app.mutationCalls.length, 0, 'opening the confirmation must not mutate vault storage');
  assert.match(text(app.render()), /Private title|Sensitive body/);
});

test('confirming permanent deletion removes the selected private note', async () => {
  const preview = { id: 'private-1', title: 'Private title', text: 'Sensitive body', html: '<p>Sensitive body</p>', category: 'general', pinned: false };
  const app = await screen({ unlock: async () => [preview] });
  enterPassword(app); button(app, 'Unlock').props.onPress(); await app.flush();
  find(app.render(), item => item.type === 'Pressable' && item.props.accessibilityLabel === 'Note actions for Private title').props.onPress();
  button(app, 'Delete private note').props.onPress(); await app.flush();
  const destructiveAction = app.alerts[0][2][1];
  assert.equal(destructiveAction.style, 'destructive');
  destructiveAction.onPress(); await app.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(app.mutationCalls[0])), ['delete', 'private-1']);
  assert.equal(app.alerts.length, 1);
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
  lockButton(app).props.onPress();
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

test('locked screen shows the reference biometric action while retaining password unlock and enrolls only after password verification', async () => {
  const preview = { id: 'private-bio', title: 'Biometric note', text: 'Secret body', html: '<p>Secret body</p>', category: 'personal' };
  const app = await screen({ biometricAvailable: true, unlockWithKey: async () => [preview] });
  assert.ok(input(app), 'password fallback remains visible');
  assert.ok(button(app, 'Use passkey or fingerprint'));
  assert.ok(button(app, 'Unlock'));

  enterPassword(app);
  button(app, 'Use passkey or fingerprint').props.onPress();
  await app.flush();

  assert.match(text(app.render()), /Secret body/);
  assert.deepEqual(app.calls.map(([operation]) => operation), ['exportBiometricKey', 'unlockWithBiometricKey']);
  assert.deepEqual(app.calls[0], ['exportBiometricKey', PASSWORD]);
  assert.deepEqual(app.biometricCalls.map(([operation]) => operation), ['read', 'save']);
  assert.equal(app.asyncStorage.get('@test/biometric-enabled'), 'enabled');
  assert.match(text(app.render()), /Secret body/);
  assert.ok(button(app, 'Remove biometric unlock'));
});

test('an existing biometric key unlocks only through vault verification, while an invalid key leaves password fallback available', async () => {
  const app = await screen({
    biometricAvailable: true,
    biometricKey: new Uint8Array(32).fill(4),
    unlockWithKey: async () => { throw new Error('Could not authenticate the vault. [PV-AUTH]'); },
  });
  button(app, 'Use passkey or fingerprint').props.onPress();
  await app.flush();

  assert.equal(app.calls[0][0], 'unlockWithBiometricKey');
  assert.equal(app.calls.some(([operation]) => operation === 'exportBiometricKey'), false);
  assert.equal(isUnlocked(app), false);
  assert.match(text(app.render()), /\[PV-AUTH\]/);
  assert.ok(input(app), 'password fallback remains visible after biometric failure');
  assert.ok(button(app, 'Unlock'));
});

test('successful biometric unlock restores the removable-credential marker if UI metadata was missing', async () => {
  const app = await screen({ biometricAvailable: true, biometricKey: new Uint8Array(32).fill(5) });
  button(app, 'Use passkey or fingerprint').props.onPress();
  await app.flush();

  assert.equal(isUnlocked(app), true);
  assert.equal(app.asyncStorage.get('@test/biometric-enabled'), 'enabled');
  assert.ok(button(app, 'Remove biometric unlock'));
});

test('backgrounding during password-verified enrollment invalidates the attempt before saving a protected key', async () => {
  const pending = deferred();
  const app = await screen({ biometricAvailable: true, exportBiometricKey: () => pending.promise });
  enterPassword(app);
  button(app, 'Use passkey or fingerprint').props.onPress();
  await app.flush();

  assert.equal(app.biometricCalls.some(([operation]) => operation === 'save'), false);
  assert.equal(button(app, 'Cancel').props.disabled, true);
  assert.equal(button(app, '‹ All notes').props.disabled, true);
  app.change('background');
  pending.resolve(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
  await app.flush();

  assert.equal(app.biometricCalls.some(([operation]) => operation === 'save'), false);
  assert.equal(isUnlocked(app), false);
  app.unmount();
  assert.equal(app.writesAfterUnmount, 0);
});
