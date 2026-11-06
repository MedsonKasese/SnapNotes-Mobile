import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as notes from '../src/notes.ts';
import * as folders from '../src/folders.ts';
import * as drafts from '../src/draftLibrary.ts';
import * as formatting from '../src/noteFormatting.ts';
import { createNotesController } from '../src/notesController.ts';
import { privateSharedCoordinator } from '../src/privateSharedCoordinator.ts';
import { createPrivateOrdinarySaveGuard } from '../src/privateOrdinarySaveGuard.ts';
import { createPrivateVaultStorage } from '../src/privateVaultStorage.ts';
import { countPrivateVaultNotes } from '../src/privateNoteReader.ts';
import { searchNotes } from '../src/noteSearch.ts';
import { getNoteActionsMenuLayout } from '../src/noteActionsMenu.ts';
import * as noteTransfer from '../src/noteTransfer.ts';
import * as drawerAvatar from '../src/components/drawerAvatar.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(process.env.SNAPNOTES_DRAFT_WORKSPACE_SOURCE ?? new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const NOW = '2026-10-23T09:00:00.000Z';
const first = { id: 'draft-1', title: 'First', text: 'Rich body', html: '<p><strong>Rich body</strong></p>', category: 'work', editingId: null, savedAt: NOW };
const second = { ...first, id: 'draft-2', title: 'Second' };
const recoveryKey = '@snapnotes-mobile/editor-draft';
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const sameDeps = (a, b) => a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

// Exercise real workspace JSX, effects and the real notes controller. Native
// rendering is stubbed; content reads and storage writes may be held in flight.
async function workspace({ initialDrafts = [], rawDrafts, initialNotes = [], recovery = null, saveDrafts = async () => {}, saveNotes = async () => {}, contentReads = [] } = {}) {
  const values = new Map([[drafts.DRAFT_LIBRARY_KEY, rawDrafts === undefined ? JSON.stringify(initialDrafts) : rawDrafts], [recoveryKey, recovery]]);
  let storedNotes = initialNotes;
  const draftWrites = [], noteWrites = [], alerts = [], timers = new Map();
  let timerId = 0, contentCalls = 0;
  let controller;
  let controllerStorage;
  const deviceNotesStorage = {
    async load() { return storedNotes; },
    async save(next) { noteWrites.push(next); await saveNotes(next); storedNotes = next; },
  };
  const backend = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) {
      if (key === drafts.DRAFT_LIBRARY_KEY) { draftWrites.push(value); await saveDrafts(value); }
      values.set(key, value);
    },
    async removeItem(key) { values.delete(key); },
  };
  let cursor = 0;
  const slots = [], effects = [];
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(callback, deps) { const i = cursor++; if (!slots[i] || !sameDeps(slots[i].deps, deps)) slots[i] = { callback, deps }; return slots[i].callback; },
    useEffect(callback, deps) {
      const i = cursor++;
      if (!effects[i] || !sameDeps(effects[i].deps, deps)) { effects[i]?.cleanup?.(); effects[i] = { callback, deps, pending: true }; }
    },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  };
  const exports = {};
  const modules = {
    react, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      ...Object.fromEntries(['FlatList', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name])),
      Alert: { alert: (...args) => alerts.push(args) }, BackHandler: { addEventListener: () => ({ remove() {} }) },
      Keyboard: { dismiss() {} }, Platform: { OS: 'android' }, StyleSheet: { create: styles => styles, absoluteFill: {} },
    },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' },
    'expo-document-picker': { getDocumentAsync: async () => ({ canceled: true, assets: null }) },
    'expo-file-system': { File: class File {}, Paths: { cache: 'cache' } },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async () => {} },
    '@expo/vector-icons/FontAwesome': { __esModule: true, default: 'FontAwesome' },
    '@react-native-async-storage/async-storage': backend,
    '../notes': notes, '../folders': folders, '../draftLibrary': drafts,
    '../notesController': { createNotesController(storage) {
      controllerStorage = storage;
      return (controller = createNotesController(storage));
    } },
    '../privateSharedCoordinator': { privateSharedCoordinator },
    '../privateOrdinarySaveGuard': { createPrivateOrdinarySaveGuard },
    '../privateVaultStorage': { createPrivateVaultStorage },
    '../privateNoteReader': { countPrivateVaultNotes },
    '../privateMoveService': { moveDeviceNoteToPrivate: async () => { throw new Error('Unexpected Move to Private invocation in this test harness'); } },
    '../deviceNotesStorage': { deviceNotesStorage },
    '../noteSearch': { searchNotes }, '../noteActionsMenu': { getNoteActionsMenuLayout }, '../noteFormatting': formatting,
    '../noteTransfer': noteTransfer,
    './drawerAvatar': drawerAvatar,
    './ChecklistLabel': { ChecklistLabel: 'ChecklistLabel' }, './FormattedText': { FormattedText: 'FormattedText' },
    './FormattingToolbar': { FormattingToolbar: 'FormattingToolbar' }, './RichNoteEditor': { RichNoteEditor: 'RichNoteEditor' },
    './PrivateNotesScreen': { PrivateNotesScreen: 'PrivateNotesScreen' },
    './NoteAttachments': { NoteAttachments: 'NoteAttachments' },
  };
  vm.runInNewContext(outputText, {
    exports, require(name) { assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name]; },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); },
  });
  function render() {
    cursor = 0;
    const tree = exports.NotesWorkspace();
    for (const editor of elements(tree).filter(item => item.type === 'RichNoteEditor')) {
      editor.props.ref.current = {
        getContent() {
          contentCalls += 1;
          const next = contentReads.shift();
          return next?.promise ?? next ?? Promise.resolve({ text: controller.getSnapshot().state.draft.text, html: controller.getSnapshot().state.draft.html ?? formatting.plainTextToHtml(controller.getSnapshot().state.draft.text) });
        }, command() {}, rememberSelection() {},
      };
    }
    for (const effect of effects) if (effect?.pending) { effect.pending = false; effect.cleanup = effect.callback(); }
    return tree;
  }
  async function flush() { for (let i = 0; i < 30; i += 1) await Promise.resolve(); }
  async function persistRecovery() { render(); for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } await flush(); }
  render(); await flush(); render();
  return { render, flush, persistRecovery, controller, controllerStorage, alerts, draftWrites, noteWrites,
    get contentCalls() { return contentCalls; }, get storedDrafts() { return values.get(drafts.DRAFT_LIBRARY_KEY); },
    get recovery() { return values.get(recoveryKey) ?? null; }, get storedNotes() { return storedNotes; } };
}
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree?.props) return [];
  return [tree, ...elements(tree.props.children)];
}
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
function find(tree, predicate) { const item = elements(tree).find(predicate); assert.ok(item, 'expected workspace element'); return item; }
const action = (app, label) => find(app.render(), item => item.props.label === label);
const editor = app => find(app.render(), item => item.type === 'RichNoteEditor');
const titleInput = app => find(app.render(), item => item.props.accessibilityLabel === 'Note title (optional)');
function openDraft(app, index = 0) {
  action(app, 'Drafts').props.onPress();
  elements(app.render()).filter(item => item.props.label === 'Open draft')[index].props.onPress();
  editor(app).props.onReady(true);
}
function typeNew(app, title = 'New title', body = 'New body') {
  action(app, '+ New note').props.onPress();
  titleInput(app).props.onChangeText(title);
  editor(app).props.onChange({ text: body, html: formatting.plainTextToHtml(body) });
  editor(app).props.onReady(true);
}
const saveDraft = async app => { action(app, 'Save to Drafts').props.onPress(); await app.flush(); app.render(); };
const confirmDiscard = app => app.alerts.at(-1)[2].find(item => item.text === 'Discard changes').onPress();

test('workspace passes a serialized device storage adapter to the real notes controller', async () => {
  const pending = deferred();
  const original = { id: 'note-1', title: 'Original', text: 'Body', category: 'work', createdAt: NOW, updatedAt: NOW, pinned: false, archived: false, deletedAt: null };
  const firstWrite = [{ ...original, title: 'First write' }];
  const secondWrite = [{ ...original, title: 'Second write' }];
  const app = await workspace({ initialNotes: [original], saveNotes: next => next === firstWrite ? pending.promise : Promise.resolve() });
  assert.deepEqual(await app.controllerStorage.load(), [original]);
  const firstSave = app.controllerStorage.save(firstWrite);
  const secondSave = app.controllerStorage.save(secondWrite);
  await app.flush();
  assert.deepEqual(app.noteWrites, [firstWrite], 'the second device write must wait for the first');
  pending.resolve();
  await Promise.all([firstSave, secondSave]);
  assert.deepEqual(app.noteWrites, [firstWrite, secondWrite]);
  assert.deepEqual(await app.controllerStorage.load(), secondWrite);
});

test('workspace device storage queue continues after a rejected write', async () => {
  const pending = deferred();
  let attempts = 0;
  const app = await workspace({ saveNotes: () => ++attempts === 1 ? pending.promise : Promise.resolve() });
  const rejected = assert.rejects(app.controllerStorage.save([]), /device full/);
  const next = app.controllerStorage.save([]);
  await app.flush();
  assert.equal(attempts, 1);
  pending.reject(new Error('device full'));
  await rejected;
  await next;
  assert.equal(attempts, 2);
  assert.deepEqual(app.storedNotes, []);
});

test('save, restart, reopen and update preserve rich formatting, category and unrelated drafts', async () => {
  const app = await workspace({ initialDrafts: [first, second] });
  openDraft(app);
  titleInput(app).props.onChangeText('Updated');
  await saveDraft(app);
  const saved = JSON.parse(app.storedDrafts);
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[1], second);
  assert.equal(saved[0].title, 'Updated');
  const restarted = await workspace({ rawDrafts: app.storedDrafts });
  openDraft(restarted);
  assert.equal(restarted.controller.getSnapshot().state.draft.html, first.html);
  assert.equal(restarted.controller.getSnapshot().state.draft.category, 'work');
});

test('pre-render double draft saves and cross-save presses share one editor lock', async () => {
  const pending = deferred();
  const app = await workspace({ contentReads: [pending] });
  typeNew(app);
  const save = action(app, 'Save to Drafts');
  const normal = action(app, 'Save note');
  save.props.onPress(); save.props.onPress(); normal.props.onPress();
  assert.equal(app.contentCalls, 1);
  pending.resolve({ text: 'Latest body', html: '<p>Latest body</p>' });
  await app.flush();
  assert.equal(app.draftWrites.length, 1);
  assert.equal(app.noteWrites.length, 0);
  assert.equal(JSON.parse(app.storedDrafts).length, 1);
});

test('a normal note save blocks a stale Save to Drafts callback before rendering', async () => {
  const pending = deferred();
  const app = await workspace({ contentReads: [pending] });
  typeNew(app);
  const saveDraft = action(app, 'Save to Drafts');
  action(app, 'Save note').props.onPress(); saveDraft.props.onPress();
  assert.equal(app.contentCalls, 1);
  pending.resolve({ text: 'Body', html: '<p>Body</p>' }); await app.flush();
  assert.equal(app.noteWrites.length, 1); assert.equal(app.draftWrites.length, 0);
});

test('navigation and stale input callbacks cannot replace content during a draft write', async () => {
  const pending = deferred();
  const app = await workspace({ saveDrafts: () => pending.promise });
  typeNew(app);
  const staleTitle = titleInput(app).props.onChangeText;
  const staleBody = editor(app).props.onChange;
  const archive = action(app, 'Archived');
  action(app, 'Save to Drafts').props.onPress(); await app.flush();
  archive.props.onPress();
  if (app.alerts.at(-1)?.[0] === 'Discard unsaved changes?') confirmDiscard(app);
  staleTitle('Lost title'); staleBody({ text: 'Lost body', html: '<p>Lost body</p>' });
  assert.equal(app.controller.getSnapshot().state.draft.title, 'New title');
  assert.equal(app.controller.getSnapshot().state.draft.text, 'New body');
  pending.resolve(); await app.flush();
  assert.match(text(app.render()), /UNFINISHED WORK/);
});

test('a stale discard confirmation cannot reset the editor during saving', async () => {
  const pending = deferred();
  const app = await workspace({ saveDrafts: () => pending.promise });
  typeNew(app); action(app, 'Archived').props.onPress();
  const confirm = app.alerts.at(-1)[2].find(item => item.text === 'Discard changes').onPress;
  action(app, 'Save to Drafts').props.onPress(); await app.flush(); confirm();
  assert.equal(app.controller.getSnapshot().state.draft.title, 'New title');
  pending.resolve(); await app.flush();
});

test('failed draft write retains latest editor snapshot and exposes a retryable error', async () => {
  let fail = true;
  const app = await workspace({ initialDrafts: [first], contentReads: [Promise.resolve({ text: 'Latest', html: '<p><b>Latest</b></p>' })], saveDrafts: async () => { if (fail) throw Error('full'); } });
  openDraft(app); await saveDraft(app);
  assert.deepEqual(JSON.parse(app.storedDrafts), [first]);
  assert.equal(app.controller.getSnapshot().state.draft.text, 'Latest');
  assert.match(text(app.render()), /Could not save drafts/);
  fail = false; await saveDraft(app);
  assert.equal(JSON.parse(app.storedDrafts)[0].text, 'Latest');
  assert.equal(JSON.parse(app.storedDrafts).length, 1);
});

test('saving a reopened draft as a note removes only that draft after the note commits', async () => {
  const pending = deferred();
  const app = await workspace({ initialDrafts: [first, second], saveNotes: () => pending.promise });
  openDraft(app); action(app, 'Save note').props.onPress(); await app.flush();
  assert.deepEqual(JSON.parse(app.storedDrafts), [first, second]);
  pending.resolve(); await app.flush();
  assert.deepEqual(JSON.parse(app.storedDrafts), [second]);
  assert.equal(app.storedNotes.length, 1);
  assert.equal(app.storedNotes[0].html, first.html);
  action(app, 'Drafts').props.onPress();
  typeNew(app, 'Another', 'Different'); await saveDraft(app);
  assert.equal(JSON.parse(app.storedDrafts).length, 2);
  assert.ok(JSON.parse(app.storedDrafts).some(item => item.id === second.id));
});

test('failed or invalid note saves never delete the saved draft', async () => {
  const app = await workspace({ initialDrafts: [first], saveNotes: async () => { throw Error('full'); } });
  openDraft(app); action(app, 'Save note').props.onPress(); await app.flush();
  assert.deepEqual(JSON.parse(app.storedDrafts), [first]);
  assert.equal(app.draftWrites.length, 0);
  assert.equal(app.controller.getSnapshot().state.draft.title, first.title);
  const invalid = await workspace({ initialDrafts: [{ ...first, text: 'x'.repeat(1501), html: undefined }] });
  openDraft(invalid); action(invalid, 'Save note').props.onPress(); await invalid.flush();
  assert.equal(invalid.draftWrites.length, 0); assert.equal(invalid.noteWrites.length, 0);
});

test('failed post-save draft cleanup preserves the note and draft and reports the partial success', async () => {
  const app = await workspace({ initialDrafts: [first], saveDrafts: async () => { throw Error('full'); } });
  openDraft(app); action(app, 'Save note').props.onPress(); await app.flush();
  assert.equal(app.storedNotes.length, 1);
  assert.deepEqual(JSON.parse(app.storedDrafts), [first]);
  assert.match(text(app.render()), /note was saved.*draft/i);
});

test('recovery remembers a reopened saved draft ID instead of creating a duplicate', async () => {
  const app = await workspace({ initialDrafts: [first, second] });
  openDraft(app); titleInput(app).props.onChangeText('Recovered edit');
  await app.persistRecovery();
  assert.equal(JSON.parse(app.recovery).openedDraftId, first.id);
  const restarted = await workspace({ rawDrafts: app.storedDrafts, recovery: app.recovery });
  editor(restarted).props.onReady(true);
  await saveDraft(restarted);
  const saved = JSON.parse(restarted.storedDrafts);
  assert.equal(saved.length, 2); assert.equal(saved[0].title, 'Recovered edit');
});

test('draft deletion requires confirmation, preserves notes and survives restart', async () => {
  const app = await workspace({ initialDrafts: [first, second] });
  action(app, 'Drafts').props.onPress(); action(app, 'Delete').props.onPress();
  assert.equal(app.draftWrites.length, 0);
  app.alerts.at(-1)[2].find(item => item.text === 'Delete draft').onPress(); await app.flush();
  assert.deepEqual(JSON.parse(app.storedDrafts), [second]); assert.equal(app.noteWrites.length, 0);
});

test('unreadable draft storage is never overwritten and its error is visible in the editor', async () => {
  const app = await workspace({ rawDrafts: '{broken' });
  typeNew(app);
  assert.equal(action(app, 'Save to Drafts').props.disabled, true);
  assert.match(text(app.render()), /Could not read saved drafts/);
  assert.equal(app.storedDrafts, '{broken'); assert.equal(app.draftWrites.length, 0);
});

test('missing or trashed linked notes reopen as new notes without mutating Trash', async () => {
  const trashed = { ...first, id: 'note-1', createdAt: NOW, updatedAt: NOW, pinned: false, archived: false, deletedAt: NOW };
  for (const initialNotes of [[], [trashed]]) {
    const app = await workspace({ initialNotes, initialDrafts: [{ ...first, editingId: trashed.id }] });
    openDraft(app); assert.equal(app.controller.getSnapshot().state.editingId, null);
    assert.deepEqual(app.storedNotes, initialNotes);
  }
});

test('malformed rich draft records cannot silently replace their stored text when opened', async () => {
  for (const invalid of [{ ...first, html: '<p>Different text</p>' }, { ...first, html: 'x'.repeat(notes.MAX_NOTE_HTML_LENGTH + 1) }]) {
    const app = await workspace({ initialDrafts: [invalid] });
    action(app, 'Drafts').props.onPress(); action(app, 'Open draft').props.onPress();
    assert.equal(elements(app.render()).some(item => item.type === 'RichNoteEditor'), false);
    assert.equal(app.alerts.at(-1)?.[0], 'Could not open draft');
    assert.equal(app.draftWrites.length, 0);
  }
});

test('a linked draft updates its existing note and preserves pin, folder and archive metadata', async () => {
  const original = { id: 'note-1', title: 'Original', text: 'Before', category: 'personal', createdAt: NOW, updatedAt: NOW, pinned: true, archived: true, deletedAt: null, folderId: 'folder-1' };
  const app = await workspace({ initialNotes: [original], initialDrafts: [{ ...first, editingId: original.id }, second] });
  openDraft(app);
  assert.equal(app.controller.getSnapshot().state.editingId, original.id);
  action(app, 'Save changes').props.onPress(); await app.flush();
  assert.equal(app.storedNotes.length, 1);
  assert.equal(app.storedNotes[0].id, original.id);
  assert.equal(app.storedNotes[0].title, first.title);
  assert.equal(app.storedNotes[0].pinned, true);
  assert.equal(app.storedNotes[0].archived, true);
  assert.equal(app.storedNotes[0].folderId, original.folderId);
  assert.equal(app.storedNotes[0].createdAt, NOW);
  assert.deepEqual(JSON.parse(app.storedDrafts), [second]);
});

test('empty draft saves do not persist a library entry', async () => {
  const app = await workspace();
  action(app, '+ New note').props.onPress(); editor(app).props.onReady(true);
  await saveDraft(app);
  assert.equal(app.draftWrites.length, 0);
  assert.equal(app.alerts.at(-1)?.[0], 'Empty draft');
  assert.ok(editor(app));
});

test('Save to Drafts remains disabled until the editor is ready', async () => {
  const app = await workspace();
  action(app, '+ New note').props.onPress();
  assert.equal(action(app, 'Save to Drafts').props.disabled, true);
  editor(app).props.onReady(true);
  assert.equal(action(app, 'Save to Drafts').props.disabled, false);
});

test('a failed editor snapshot preserves the draft and releases the save lock for retry', async () => {
  const pending = deferred();
  const app = await workspace({ initialDrafts: [first], contentReads: [pending] });
  openDraft(app); action(app, 'Save to Drafts').props.onPress();
  pending.reject(Error('Editor timed out')); await app.flush();
  assert.equal(app.alerts.at(-1)?.[0], 'Could not save draft');
  assert.equal(app.controller.getSnapshot().state.draft.title, first.title);
  assert.equal(app.draftWrites.length, 0);
  assert.equal(action(app, 'Save to Drafts').props.disabled, false);
  await saveDraft(app);
  assert.equal(app.draftWrites.length, 1);
});
