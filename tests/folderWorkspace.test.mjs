import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as notes from '../src/notes.ts';
import * as folders from '../src/folders.ts';
import * as formatting from '../src/noteFormatting.ts';
import { createNotesController } from '../src/notesController.ts';
import { searchNotes } from '../src/noteSearch.ts';
import { getNoteActionsMenuLayout } from '../src/noteActionsMenu.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(process.env.SNAPNOTES_FOLDER_WORKSPACE_SOURCE ?? new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const NOW = '2026-10-23T09:00:00.000Z';
const folder = { id: 'folder-1', name: 'Research', icon: 'folder', color: '', createdAt: NOW, updatedAt: NOW };
const note = { id: 'note-1', title: 'Research note', text: 'Important', html: '<p><strong>Important</strong></p>', category: 'work', createdAt: NOW, updatedAt: NOW, pinned: true, archived: false, deletedAt: null, folderId: folder.id };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const sameDeps = (left, right) => left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

// Run real JSX, effects, refs and controller persistence; only native rendering
// is stubbed. Deferred writes deliberately cover the pre-render double-tap gap.
async function workspace({ initialNotes = [note], initialFolders = [folder], rawFolders, saveFolders = async () => {}, saveNotes = async () => {} } = {}) {
  let storedNotes = initialNotes;
  let storedFolders = rawFolders === undefined ? JSON.stringify(initialFolders) : rawFolders;
  const folderWrites = [];
  const noteWrites = [];
  const alerts = [];
  const controller = createNotesController({
    async load() { return storedNotes; },
    async save(next) { noteWrites.push(next); await saveNotes(next); storedNotes = next; },
  });
  const backend = {
    async getItem(key) { return key === folders.FOLDERS_KEY ? storedFolders : null; },
    async setItem(key, value) {
      assert.equal(key, folders.FOLDERS_KEY);
      folderWrites.push(value);
      await saveFolders(value);
      storedFolders = value;
    },
    async removeItem() {},
  };
  let cursor = 0;
  const slots = [];
  const effects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!effects[index] || !sameDeps(effects[index].deps, deps)) {
        effects[index]?.cleanup?.();
        effects[index] = { callback, deps, pending: true };
      }
    },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  };
  const exports = {};
  const modules = {
    react,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      ...Object.fromEntries(['FlatList', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name])),
      Alert: { alert: (...args) => alerts.push(args) },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      Keyboard: { dismiss() {} }, Platform: { OS: 'android' },
      StyleSheet: { create: styles => styles, absoluteFill: {} },
    },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons/FontAwesome': { __esModule: true, default: 'FontAwesome' },
    '@react-native-async-storage/async-storage': backend,
    '../notes': notes,
    '../folders': folders,
    '../notesController': { createNotesController: () => controller },
    '../deviceNotesStorage': {},
    '../noteSearch': { searchNotes },
    '../noteActionsMenu': { getNoteActionsMenuLayout },
    '../noteFormatting': formatting,
    './ChecklistLabel': { ChecklistLabel: 'ChecklistLabel' },
    './FormattedText': { FormattedText: 'FormattedText' },
    './FormattingToolbar': { FormattingToolbar: 'FormattingToolbar' },
    './RichNoteEditor': { RichNoteEditor: 'RichNoteEditor' },
  };
  vm.runInNewContext(outputText, {
    exports, setTimeout: () => 1, clearTimeout() {},
    require(name) { assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name]; },
  });
  function render() {
    cursor = 0;
    const tree = exports.NotesWorkspace();
    for (const effect of effects) {
      if (effect?.pending) { effect.pending = false; effect.cleanup = effect.callback(); }
    }
    return tree;
  }
  async function flush() { for (let i = 0; i < 15; i += 1) await Promise.resolve(); }
  render();
  await flush();
  render();
  return { render, flush, controller, alerts, folderWrites, noteWrites,
    get storedNotes() { return storedNotes; }, get storedFolders() { return storedFolders; } };
}
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree?.props) return [];
  return [tree, ...elements(tree.props.children)];
}
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
function find(tree, predicate) {
  const item = elements(tree).find(predicate);
  assert.ok(item, 'expected workspace element');
  return item;
}
const action = (app, label) => find(app.render(), item => item.props.label === label);
const button = (app, label) => find(app.render(), item => item.type === 'Pressable' && text(item) === label);
const input = app => find(app.render(), item => item.props.accessibilityLabel === 'Folder name');
function newFolder(app, name) {
  button(app, '+ New folder').props.onPress();
  input(app).props.onChangeText(name);
  return action(app, 'Save folder');
}
function requestDelete(app) {
  action(app, folder.name).props.onPress();
  button(app, 'Delete folder').props.onPress();
  return app.alerts.at(-1)[2].find(item => item.text === 'Delete folder').onPress;
}
function openMove(app) {
  const list = find(app.render(), item => item.type === 'FlatList');
  const card = list.props.renderItem({ item: app.controller.getSnapshot().state.notes[0] });
  find(card, item => item.props.accessibilityLabel === 'Note actions for ' + note.title).props.onPress();
  find(app.render(), item => item.type.name === 'NoteActionsMenuContent').props.onAction('move-folder');
  return find(app.render(), item => item.type === 'Modal' && item.props.visible && text(item).includes('Move note to folder'));
}

test('folder creation blocks duplicate pre-render saves and commits only after storage succeeds', async () => {
  const pending = deferred();
  const app = await workspace({ saveFolders: () => pending.promise });
  const save = newFolder(app, '  New   research  ');
  save.props.onPress();
  save.props.onPress();
  assert.equal(app.folderWrites.length, 1);
  assert.equal(action(app, 'Save folder').props.disabled, true);
  assert.equal(JSON.parse(app.storedFolders).length, 1);
  pending.resolve();
  await app.flush();
  assert.equal(JSON.parse(app.storedFolders).length, 2);
  assert.equal(JSON.parse(app.storedFolders)[1].name, 'New research');
});

test('failed folder creation is visible inside the dialog and can be retried', async () => {
  let fail = true;
  const app = await workspace({ saveFolders: async () => { if (fail) throw Error('full'); } });
  newFolder(app, 'Another').props.onPress();
  await app.flush();
  assert.equal(JSON.parse(app.storedFolders).length, 1);
  const modal = find(app.render(), item => item.type === 'Modal' && item.props.visible && text(item).includes('New folder'));
  assert.match(text(modal), /Could not save folders/);
  assert.equal(action(app, 'Save folder').props.disabled, false);
  fail = false;
  action(app, 'Save folder').props.onPress();
  await app.flush();
  assert.equal(JSON.parse(app.storedFolders).length, 2);
});

test('failed note unfiling refuses folder deletion and preserves rich, archived and trashed notes', async () => {
  const originals = [note, { ...note, id: 'archive', archived: true }, { ...note, id: 'trash', pinned: false, deletedAt: NOW }];
  const app = await workspace({ initialNotes: originals, saveNotes: async () => { throw Error('full'); } });
  requestDelete(app)();
  await app.flush();
  assert.equal(app.folderWrites.length, 0);
  assert.deepEqual(app.storedNotes, originals);
  assert.equal(JSON.parse(app.storedFolders).length, 1);
  assert.match(text(app.render()), /Could not unfile notes/);
});

test('deletion blocks stale moves across both writes and preserves every note and its edit time', async () => {
  const noteWrite = deferred();
  const folderWrite = deferred();
  const originals = [note, { ...note, id: 'archive', archived: true }, { ...note, id: 'trash', deletedAt: NOW }];
  const app = await workspace({ initialNotes: originals, saveNotes: () => noteWrite.promise, saveFolders: () => folderWrite.promise });
  const moveModal = openMove(app);
  const staleMove = find(moveModal, item => item.type === 'Pressable' && text(item) === folder.name).props.onPress;
  moveModal.props.onRequestClose();
  const confirm = requestDelete(app);
  confirm();
  confirm();
  staleMove();
  assert.equal(app.noteWrites.length, 1);
  noteWrite.resolve();
  await app.flush();
  assert.equal(app.controller.getSnapshot().status, 'ready');
  assert.equal(app.folderWrites.length, 1);
  staleMove();
  assert.equal(app.noteWrites.length, 1, 'a stale move must not refile notes during the folder write');
  assert.equal(button(app, '+ New folder').props.disabled, true);
  folderWrite.resolve();
  await app.flush();
  staleMove();
  assert.equal(app.noteWrites.length, 1, 'a stale move must not target a deleted folder');
  assert.deepEqual(JSON.parse(app.storedFolders), []);
  assert.deepEqual(app.storedNotes, originals.map(item => ({ ...item, folderId: null })));
});

test('a failed folder removal reports that notes were safely unfiled and supports retry', async () => {
  let fail = true;
  const app = await workspace({ saveFolders: async () => { if (fail) throw Error('full'); } });
  requestDelete(app)();
  await app.flush();
  assert.equal(app.storedNotes[0].folderId, null);
  assert.equal(JSON.parse(app.storedFolders).length, 1);
  assert.match(text(app.render()), /folder remains, but its notes are safely unfiled/);
  fail = false;
  requestDelete(app)();
  await app.flush();
  assert.deepEqual(JSON.parse(app.storedFolders), []);
  assert.equal(app.storedNotes[0].html, note.html);
});

test('a delayed delete confirmation preserves folders created after the prompt opened', async () => {
  const app = await workspace();
  const confirm = requestDelete(app);
  newFolder(app, 'Newer folder').props.onPress();
  await app.flush();
  assert.equal(JSON.parse(app.storedFolders).length, 2);
  confirm();
  await app.flush();
  assert.deepEqual(JSON.parse(app.storedFolders).map(item => item.name), ['Newer folder']);
});

test('unreadable folders fail closed and show an accessible error without overwriting storage', async () => {
  const app = await workspace({ rawFolders: '{broken' });
  assert.equal(button(app, '+ New folder').props.disabled, true);
  const errors = elements(app.render()).filter(item => item.props.accessibilityRole === 'alert');
  assert.ok(errors.some(item => /Folders could not be loaded/.test(text(item))));
  assert.equal(app.folderWrites.length, 0);
  assert.equal(app.storedFolders, '{broken');
});

test('folder navigation filters active notes and remains scrollable with the maximum folder count', async () => {
  const initialFolders = Array.from({ length: folders.MAX_FOLDERS }, (_, index) => ({ ...folder, id: index ? 'folder-' + (index + 1) : folder.id, name: index ? 'Folder ' + (index + 1) : folder.name }));
  const app = await workspace({ initialFolders, initialNotes: [note, { ...note, id: 'outside', folderId: null }, { ...note, id: 'archive', archived: true }, { ...note, id: 'trash', deletedAt: NOW }] });
  action(app, folder.name).props.onPress();
  const list = find(app.render(), item => item.type === 'FlatList');
  assert.deepEqual(list.props.data.map(item => item.id), [note.id]);
  const scroller = find(app.render(), item => item.type === 'ScrollView' && elements(item).some(child => child.props.label === 'Trash'));
  assert.ok(elements(scroller).some(item => item.props.label === 'Folder 20'));
  assert.equal(button(app, '+ New folder').props.disabled, true);
});
