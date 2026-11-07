import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as notes from '../src/notes.ts';
import * as folders from '../src/folders.ts';
import * as draftLibrary from '../src/draftLibrary.ts';
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
import * as reminderRecurrence from '../src/reminders/recurrence.ts';
import { reminderNativeNotifications, reminderControlsModule } from './reminderTestDoubles.mjs';

const require = createRequire(import.meta.url);
const source = readFileSync(process.env.SNAPNOTES_FOLDER_WORKSPACE_SOURCE ?? new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const NOW = new Date(Date.now() - 60_000).toISOString();
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
  let controller;
  const deviceNotesStorage = {
    async load() { return storedNotes; },
    async save(next) { noteWrites.push(next); await saveNotes(next); storedNotes = next; },
  };
  const backend = {
    async getItem(key) {
      if (key === folders.FOLDERS_KEY) return storedFolders;
      if (key === draftLibrary.DRAFT_LIBRARY_KEY) return null;
      return null;
    },
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
      AppState: { addEventListener: () => ({ remove() {} }) },
      Keyboard: { dismiss() {} }, Platform: { OS: 'android' },
      StyleSheet: { create: styles => styles, absoluteFill: {} },
    },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' },
    'expo-document-picker': { getDocumentAsync: async () => ({ canceled: true, assets: null }) },
    'expo-file-system': { File: class File {}, Paths: { cache: 'cache' } },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async () => {} },
    '@expo/vector-icons/FontAwesome': { __esModule: true, default: 'FontAwesome' },
    '@react-native-async-storage/async-storage': backend,
    '../notes': notes,
    '../folders': folders,
    '../draftLibrary': draftLibrary,
    '../notesController': { createNotesController: storage => (controller = createNotesController(storage)) },
    '../privateSharedCoordinator': { privateSharedCoordinator },
    '../privateOrdinarySaveGuard': { createPrivateOrdinarySaveGuard },
    '../privateVaultStorage': { createPrivateVaultStorage },
    '../privateNoteReader': { countPrivateVaultNotes },
    '../privateMoveService': { moveDeviceNoteToPrivate: async () => { throw new Error('Unexpected Move to Private invocation in this test harness'); } },
    '../deviceNotesStorage': { deviceNotesStorage },
    '../noteSearch': { searchNotes },
    '../noteTransfer': noteTransfer,
    '../noteActionsMenu': { getNoteActionsMenuLayout },
    '../noteFormatting': formatting,
    './drawerAvatar': drawerAvatar,
    './ChecklistLabel': { ChecklistLabel: 'ChecklistLabel' },
    './FormattedText': { FormattedText: 'FormattedText' },
    './FormattingToolbar': { FormattingToolbar: 'FormattingToolbar' },
    './RichNoteEditor': { RichNoteEditor: 'RichNoteEditor' },
    './PrivateNotesScreen': { PrivateNotesScreen: 'PrivateNotesScreen' },
    './NoteAttachments': { NoteAttachments: 'NoteAttachments' },
    './ReminderControls': reminderControlsModule,
    '../reminders/nativeNotifications': reminderNativeNotifications,
    '../reminders/recurrence': reminderRecurrence,
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
const labeled = (app, label) => find(app.render(), item => item.props.accessibilityLabel === label);
const input = app => find(app.render(), item => item.props.accessibilityLabel === 'Folder name');
function newFolder(app, name) {
  labeled(app, 'Create new folder').props.onPress();
  input(app).props.onChangeText(name);
  return action(app, 'Save folder');
}
function requestDelete(app) {
  action(app, folder.name).props.onPress();
  openFolderMenu(app, folder.name);
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
  assert.equal(app.controller.getSnapshot().status, 'saving');
  await app.flush();
  assert.equal(app.noteWrites.length, 1);
  noteWrite.resolve();
  await app.flush();
  assert.equal(app.controller.getSnapshot().status, 'ready');
  assert.equal(app.folderWrites.length, 1);
  staleMove();
  assert.equal(app.noteWrites.length, 1, 'a stale move must not refile notes during the folder write');
  assert.equal(labeled(app, 'Create new folder').props.disabled, true);
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
  await app.flush(); // Allow the failed delete's finally block to release the action lock.
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
  assert.equal(labeled(app, 'Create new folder').props.disabled, true);
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
  const folderRows = () => elements(app.render()).filter(item => item.props.icon === 'folder-o' && item.props.label);
  assert.equal(folderRows().length, 3, 'the collapsed drawer previews exactly three folders');
  const expand = labeled(app, 'View all folders, 20');
  assert.equal(expand.props.accessibilityState.expanded, false);
  expand.props.onPress();
  const scroller = find(app.render(), item => item.type === 'ScrollView' && elements(item).some(child => child.props.label === 'Trash'));
  assert.equal(folderRows().length, folders.MAX_FOLDERS);
  assert.ok(elements(scroller).some(item => item.props.label === 'Folder 20'));
  assert.ok(elements(scroller).some(item => item.props.label === 'Archived'));
  assert.equal(labeled(app, 'Create new folder').props.disabled, true);
  assert.equal(labeled(app, 'Create new folder').props.accessibilityState.disabled, true);
  const collapse = labeled(app, 'Show fewer folders');
  assert.equal(collapse.props.accessibilityState.expanded, true);
  collapse.props.onPress();
  assert.equal(folderRows().length, 3);
  assert.equal(labeled(app, 'View all folders, 20').props.accessibilityState.expanded, false);
});

test('Show fewer collapses after selecting a folder beyond the preview without changing its notes', async () => {
  const initialFolders = Array.from({ length: 5 }, (_, index) => ({ ...folder, id: 'folder-' + (index + 1), name: 'Folder ' + (index + 1) }));
  const selectedNote = { ...note, folderId: 'folder-5' };
  const app = await workspace({ initialFolders, initialNotes: [selectedNote] });
  labeled(app, 'View all folders, 5').props.onPress();
  action(app, 'Folder 5').props.onPress();
  const folderRows = () => elements(app.render()).filter(item => item.props.icon === 'folder-o' && item.props.label);
  assert.equal(folderRows().length, 5);
  labeled(app, 'Show fewer folders').props.onPress();
  assert.equal(folderRows().length, 3);
  assert.equal(labeled(app, 'View all folders, 5').props.accessibilityState.expanded, false);
  assert.deepEqual(find(app.render(), item => item.type === 'FlatList').props.data, [selectedNote]);
  labeled(app, 'View all folders, 5').props.onPress();
  assert.equal(folderRows().length, 5);
  assert.equal(action(app, 'Folder 5').props.active, true);
  assert.equal(app.folderWrites.length, 0);
  assert.equal(app.noteWrites.length, 0);
});

test('three or fewer folders do not show a redundant expand control', async () => {
  const app = await workspace();
  assert.equal(elements(app.render()).some(item => /^(View all folders,|Show fewer folders)/.test(item.props.accessibilityLabel ?? '')), false);
  assert.equal(labeled(app, 'Create new folder').props.disabled, false);
});

function openFolderMenu(app, name = folder.name) {
  labeled(app, 'Open notes navigation').props.onPress();
  labeled(app, 'Folder actions for ' + name).props.onPress();
  return find(app.render(), item => item.props.testID === 'folder-actions-menu');
}
function openAppearance(app, name = folder.name) {
  openFolderMenu(app, name);
  button(app, 'Customize folder').props.onPress();
  return appearanceModal(app);
}
function appearanceModal(app) {
  return find(app.render(), item => item.type === 'Modal' && item.props.visible && text(item).includes('Customize folder'));
}

test('appearance Save persists only the selected folder and renders its chosen icon and color after reload', async () => {
  const other = { ...folder, id: 'other', name: 'Other', icon: 'cloud', color: 'teal' };
  const originals = [note, { ...note, id: 'archive', archived: true }, { ...note, id: 'trash', deletedAt: NOW }];
  const app = await workspace({ initialFolders: [folder, other], initialNotes: originals });
  openAppearance(app);
  assert.equal(labeled(app, 'folder folder icon').props.accessibilityState.selected, true);
  assert.equal(labeled(app, 'None folder color').props.accessibilityState.selected, true);
  labeled(app, 'briefcase folder icon').props.onPress();
  labeled(app, 'blue folder color').props.onPress();
  action(app, 'Save appearance').props.onPress();
  await app.flush();
  const [saved, untouched] = JSON.parse(app.storedFolders);
  assert.deepEqual({ ...saved, updatedAt: NOW }, { ...folder, icon: 'briefcase', color: 'blue' });
  assert.notEqual(saved.updatedAt, NOW);
  assert.deepEqual(untouched, other);
  assert.deepEqual(app.storedNotes, originals);
  assert.equal(app.noteWrites.length, 0);
  assert.equal(elements(app.render()).some(item => item.type === 'Modal' && item.props.visible && text(item).includes('Customize folder')), false);
  const reloaded = await workspace({ rawFolders: app.storedFolders, initialNotes: originals });
  const row = action(reloaded, folder.name);
  assert.equal(row.props.icon, 'briefcase');
  assert.equal(row.props.iconColor, folders.FOLDER_COLOR_VALUES.blue);
  openAppearance(reloaded);
  assert.equal(labeled(reloaded, 'briefcase folder icon').props.accessibilityState.selected, true);
  assert.equal(labeled(reloaded, 'blue folder color').props.accessibilityState.selected, true);
});

test('appearance Cancel and Android back discard unsaved selections and reopen from saved values', async () => {
  const original = { ...folder, icon: 'star', color: 'rose' };
  const app = await workspace({ initialFolders: [original] });
  openAppearance(app);
  labeled(app, 'heart folder icon').props.onPress();
  labeled(app, 'green folder color').props.onPress();
  action(app, 'Cancel').props.onPress();
  openAppearance(app);
  assert.equal(labeled(app, 'star folder icon').props.accessibilityState.selected, true);
  assert.equal(labeled(app, 'rose folder color').props.accessibilityState.selected, true);
  labeled(app, 'cloud folder icon').props.onPress();
  appearanceModal(app).props.onRequestClose();
  openAppearance(app);
  assert.equal(labeled(app, 'star folder icon').props.accessibilityState.selected, true);
  assert.equal(app.folderWrites.length, 0);
  assert.deepEqual(JSON.parse(app.storedFolders), [original]);
});

test('None removes the color accent without changing the selected icon', async () => {
  const app = await workspace({ initialFolders: [{ ...folder, icon: 'book', color: 'purple' }] });
  openAppearance(app);
  labeled(app, 'None folder color').props.onPress();
  action(app, 'Save appearance').props.onPress();
  await app.flush();
  assert.equal(JSON.parse(app.storedFolders)[0].color, '');
  assert.equal(action(app, folder.name).props.iconColor, undefined);
  assert.equal(action(app, folder.name).props.icon, 'book');
});

test('appearance save failure preserves storage, shows the error and allows retry', async () => {
  let fail = true;
  const app = await workspace({ saveFolders: async () => { if (fail) throw Error('full'); } });
  openAppearance(app);
  labeled(app, 'heart folder icon').props.onPress();
  labeled(app, 'orange folder color').props.onPress();
  action(app, 'Save appearance').props.onPress();
  await app.flush();
  assert.deepEqual(JSON.parse(app.storedFolders), [folder]);
  assert.match(text(appearanceModal(app)), /Could not save folder appearance/);
  assert.equal(action(app, 'Save appearance').props.disabled, false);
  assert.equal(labeled(app, 'heart folder icon').props.accessibilityState.selected, true);
  fail = false;
  action(app, 'Save appearance').props.onPress();
  await app.flush();
  assert.equal(JSON.parse(app.storedFolders)[0].icon, 'heart');
  assert.equal(JSON.parse(app.storedFolders)[0].color, 'orange');
  assert.equal(app.noteWrites.length, 0);
});

test('appearance save blocks double taps and pre-render Android back until persistence completes', async () => {
  const pending = deferred();
  const app = await workspace({ saveFolders: () => pending.promise });
  openAppearance(app);
  labeled(app, 'cloud folder icon').props.onPress();
  const modal = appearanceModal(app);
  const save = action(app, 'Save appearance');
  const cancel = action(app, 'Cancel');
  const reopen = labeled(app, 'Folder actions for ' + folder.name);
  save.props.onPress();
  save.props.onPress();
  modal.props.onRequestClose();
  cancel.props.onPress();
  reopen.props.onPress();
  assert.equal(app.folderWrites.length, 1);
  assert.equal(appearanceModal(app).props.visible, true);
  assert.equal(labeled(app, 'cloud folder icon').props.accessibilityState.selected, true);
  assert.equal(action(app, 'Save appearance').props.disabled, true);
  assert.equal(action(app, 'Cancel').props.disabled, true);
  assert.equal(labeled(app, 'book folder icon').props.disabled, true);
  assert.deepEqual(JSON.parse(app.storedFolders), [folder]);
  pending.resolve();
  await app.flush();
  assert.equal(JSON.parse(app.storedFolders)[0].icon, 'cloud');
});

test('every supported folder icon and color is selectable and round-trips through workspace persistence', async () => {
  const app = await workspace();
  const colors = ['', ...Object.keys(folders.FOLDER_COLOR_VALUES)];
  for (const [index, icon] of folders.FOLDER_ICON_NAMES.entries()) {
    const color = colors[index % colors.length];
    openAppearance(app);
    labeled(app, icon + ' folder icon').props.onPress();
    labeled(app, (color || 'None') + ' folder color').props.onPress();
    action(app, 'Save appearance').props.onPress();
    await app.flush();
    assert.equal(JSON.parse(app.storedFolders)[0].icon, icon);
    assert.equal(JSON.parse(app.storedFolders)[0].color, color);
  }
  assert.equal(app.folderWrites.length, folders.FOLDER_ICON_NAMES.length);
  assert.equal(app.noteWrites.length, 0);
});

test('renaming a customized folder preserves appearance and creation uses valid defaults', async () => {
  const app = await workspace({ initialFolders: [{ ...folder, icon: 'flask', color: 'teal' }] });
  openFolderMenu(app);
  button(app, 'Rename folder').props.onPress();
  input(app).props.onChangeText('Renamed research');
  action(app, 'Save folder').props.onPress();
  await app.flush();
  newFolder(app, 'Brand new').props.onPress();
  await app.flush();
  const [renamed, created] = JSON.parse(app.storedFolders);
  assert.equal(renamed.icon, 'flask');
  assert.equal(renamed.color, 'teal');
  assert.equal(renamed.name, 'Renamed research');
  assert.equal(created.icon, 'folder');
  assert.equal(created.color, '');
  assert.equal(app.noteWrites.length, 0);
});

const folderMenu = app => elements(app.render()).find(item => item.props.testID === 'folder-actions-menu');
const navigationOpen = app => labeled(app, 'Open notes navigation').props.accessibilityState.expanded;
const drawerModal = app => find(app.render(), item => item.type === 'Modal' && elements(item).some(child => child.props.accessibilityLabel === 'Close notes navigation'));

test('each visible folder has a separate accessible overflow button next to its note count, not shared controls', async () => {
  const initialFolders = Array.from({ length: folders.MAX_FOLDERS }, (_, index) => ({ ...folder, id: 'folder-' + (index + 1), name: 'Folder ' + (index + 1) }));
  const app = await workspace({ initialFolders });
  labeled(app, 'Open notes navigation').props.onPress();
  const triggers = () => elements(app.render()).filter(item => item.props.accessibilityLabel?.startsWith('Folder actions for '));
  assert.equal(triggers().length, 3);
  assert.equal(elements(app.render()).some(item => item.type === 'Pressable' && ['Rename folder', 'Customize folder', 'Delete folder'].includes(text(item))), false);
  labeled(app, 'View all folders, 20').props.onPress();
  assert.equal(triggers().length, folders.MAX_FOLDERS);
  for (const item of initialFolders) {
    const row = find(app.render(), element => element.props.testID === 'folder-row-' + item.id);
    const children = row.props.children;
    assert.equal(children[0].props.label, item.name);
    assert.match(children[0].props.detail, /^\d+ notes$/);
    assert.equal(children[0].props.fill, true);
    assert.equal(children[1].props.accessibilityLabel, 'Folder actions for ' + item.name);
    assert.equal(children[1].props.accessibilityRole, 'button');
    assert.equal(children[1].props.accessibilityState.expanded, false);
    const triggerStyle = children[1].props.style({ pressed: false }).flat().filter(Boolean);
    assert.ok(triggerStyle.some(style => style.width >= 44 && style.minHeight >= 44));
  }
  openFolderMenu(app, 'Folder 20');
  assert.equal(labeled(app, 'Folder actions for Folder 20').props.accessibilityState.expanded, true);
  assert.equal(folderMenu(app).props.accessibilityLabel, 'Actions for folder Folder 20');
  assert.equal(app.folderWrites.length, 0);
  assert.equal(app.noteWrites.length, 0);
});

test('opening folder actions does not navigate, change filters or discard an editor draft', async () => {
  const other = { ...folder, id: 'other', name: 'Other' };
  const app = await workspace({ initialFolders: [folder, other] });
  action(app, other.name).props.onPress();
  openFolderMenu(app);
  assert.equal(action(app, other.name).props.active, true);
  assert.equal(action(app, folder.name).props.active, false);
  assert.equal(find(app.render(), item => item.type === 'FlatList').props.data.length, 0);
  labeled(app, 'Close folder actions').props.onPress();
  app.controller.dispatch({ type: 'change', field: 'title', value: 'Unsaved thought' });
  const draft = { ...app.controller.getSnapshot().state.draft };
  openFolderMenu(app);
  assert.deepEqual(app.controller.getSnapshot().state.draft, draft);
  assert.equal(app.alerts.length, 0);
  assert.equal(app.noteWrites.length, 0);
  assert.equal(app.folderWrites.length, 0);
});

test('rename from a non-active folder menu changes only that folder and closes navigation before its dialog', async () => {
  const other = { ...folder, id: 'other', name: 'Other', icon: 'cloud', color: 'teal' };
  const app = await workspace({ initialFolders: [folder, other] });
  action(app, other.name).props.onPress();
  openFolderMenu(app);
  labeled(app, 'Rename folder: ' + folder.name).props.onPress();
  assert.equal(folderMenu(app), undefined);
  assert.equal(navigationOpen(app), false);
  assert.equal(elements(app.render()).filter(item => item.type === 'Modal' && item.props.visible).length, 1);
  assert.equal(input(app).props.value, folder.name);
  input(app).props.onChangeText('Renamed target');
  action(app, 'Save folder').props.onPress();
  await app.flush();
  assert.deepEqual(JSON.parse(app.storedFolders).map(item => item.name), ['Renamed target', other.name]);
  assert.deepEqual(JSON.parse(app.storedFolders)[1], other);
  assert.equal(action(app, other.name).props.active, true);
});

test('customize from a non-active folder menu preserves the currently open folder', async () => {
  const other = { ...folder, id: 'other', name: 'Other', icon: 'cloud', color: 'teal' };
  const app = await workspace({ initialFolders: [folder, other] });
  action(app, other.name).props.onPress();
  openAppearance(app);
  assert.equal(navigationOpen(app), false);
  assert.equal(folderMenu(app), undefined);
  assert.equal(elements(app.render()).filter(item => item.type === 'Modal' && item.props.visible).length, 1);
  labeled(app, 'star folder icon').props.onPress();
  action(app, 'Save appearance').props.onPress();
  await app.flush();
  const saved = JSON.parse(app.storedFolders);
  assert.equal(saved[0].icon, 'star');
  assert.deepEqual(saved[1], other);
  assert.equal(action(app, other.name).props.active, true);
  assert.equal(app.noteWrites.length, 0);
});

test('delete from a non-active folder menu confirms its name and unfiles only that folder’s notes', async () => {
  const other = { ...folder, id: 'other', name: 'Other' };
  const otherNote = { ...note, id: 'other-note', folderId: other.id };
  const app = await workspace({ initialFolders: [folder, other], initialNotes: [note, otherNote] });
  action(app, other.name).props.onPress();
  openFolderMenu(app);
  const remove = labeled(app, 'Delete folder: ' + folder.name).props.onPress;
  remove();
  remove();
  assert.equal(app.alerts.length, 1, 'a stale second tap cannot open another confirmation');
  assert.match(app.alerts[0][1], /Delete "Research"/);
  assert.equal(navigationOpen(app), false);
  assert.equal(folderMenu(app), undefined);
  app.alerts[0][2].find(item => item.text === 'Delete folder').onPress();
  await app.flush();
  assert.deepEqual(JSON.parse(app.storedFolders), [other]);
  assert.equal(app.storedNotes[0].folderId, null);
  assert.deepEqual(app.storedNotes[1], otherNote);
  assert.equal(action(app, other.name).props.active, true);
  remove();
  assert.equal(app.alerts.length, 1);
});

test('Back, outside tap, cancel and accessibility escape dismiss folder actions without closing the drawer', async () => {
  const app = await workspace();
  for (const dismiss of [
    () => drawerModal(app).props.onRequestClose(),
    () => labeled(app, 'Close folder actions').props.onPress(),
    () => action(app, 'Cancel folder actions').props.onPress(),
    () => folderMenu(app).props.onAccessibilityEscape(),
  ]) {
    openFolderMenu(app);
    const panel = find(app.render(), item => item.props.importantForAccessibility === 'no-hide-descendants' && item.props.accessibilityElementsHidden);
    assert.ok(panel);
    assert.equal(folderMenu(app).props.accessibilityViewIsModal, true);
    assert.equal(elements(app.render()).filter(item => item.type === 'Modal' && item.props.visible).length, 1);
    dismiss();
    assert.equal(folderMenu(app), undefined);
    assert.equal(navigationOpen(app), true);
    assert.equal(labeled(app, 'Folder actions for ' + folder.name).props.accessibilityState.expanded, false);
  }
  drawerModal(app).props.onRequestClose();
  assert.equal(navigationOpen(app), false);
  assert.equal(app.folderWrites.length, 0);
  assert.equal(app.noteWrites.length, 0);
});

test('dismissed or replaced menu callbacks cannot act on the wrong folder and drawer reopen is fresh', async () => {
  const other = { ...folder, id: 'other', name: 'Other' };
  const app = await workspace({ initialFolders: [folder, other] });
  openFolderMenu(app);
  const staleRename = labeled(app, 'Rename folder: ' + folder.name).props.onPress;
  labeled(app, 'Folder actions for ' + other.name).props.onPress();
  staleRename();
  assert.equal(folderMenu(app).props.accessibilityLabel, 'Actions for folder Other');
  assert.equal(elements(app.render()).filter(item => item.type === 'Modal' && item.props.visible).length, 1);
  const staleDelete = labeled(app, 'Delete folder: Other').props.onPress;
  labeled(app, 'Close notes navigation').props.onPress();
  staleDelete();
  assert.equal(app.alerts.length, 0);
  assert.equal(navigationOpen(app), false);
  labeled(app, 'Open notes navigation').props.onPress();
  assert.equal(folderMenu(app), undefined);
  action(app, folder.name).props.onPress();
  assert.equal(action(app, folder.name).props.active, true);
  assert.equal(navigationOpen(app), false);
  assert.equal(app.folderWrites.length, 0);
});

test('folder action triggers reject stale presses while a folder write is pending', async () => {
  const pending = deferred();
  const app = await workspace({ saveFolders: () => pending.promise });
  const staleTrigger = labeled(app, 'Folder actions for ' + folder.name).props.onPress;
  newFolder(app, 'Another').props.onPress();
  staleTrigger();
  assert.equal(folderMenu(app), undefined);
  assert.equal(labeled(app, 'Folder actions for ' + folder.name).props.disabled, true);
  assert.equal(labeled(app, 'Folder actions for ' + folder.name).props.accessibilityState.disabled, true);
  pending.resolve();
  await app.flush();
  openFolderMenu(app);
  assert.equal(folderMenu(app).props.accessibilityLabel, 'Actions for folder ' + folder.name);
});

test('a previous opening cannot act after the same folder is reopened or after navigation changes', async () => {
  const app = await workspace();
  openFolderMenu(app);
  const staleRename = labeled(app, 'Rename folder: ' + folder.name).props.onPress;
  labeled(app, 'Close folder actions').props.onPress();
  openFolderMenu(app);
  staleRename();
  assert.ok(folderMenu(app), 'the new opening must remain intact');
  assert.equal(navigationOpen(app), true);
  assert.equal(elements(app.render()).filter(item => item.type === 'Modal' && item.props.visible).length, 1);
  const staleDelete = labeled(app, 'Delete folder: ' + folder.name).props.onPress;
  action(app, 'Archived').props.onPress();
  staleDelete();
  assert.equal(folderMenu(app), undefined);
  assert.equal(navigationOpen(app), false);
  assert.equal(app.alerts.length, 0);
  assert.equal(app.folderWrites.length, 0);
});
