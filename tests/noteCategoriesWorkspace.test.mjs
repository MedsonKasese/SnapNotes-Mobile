import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as notes from '../src/notes.ts';
import { createNotesController } from '../src/notesController.ts';
import { privateSharedCoordinator } from '../src/privateSharedCoordinator.ts';
import { searchNotes } from '../src/noteSearch.ts';
import { getNoteActionsMenuLayout } from '../src/noteActionsMenu.ts';
import * as folders from '../src/folders.ts';
import * as draftLibrary from '../src/draftLibrary.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const stateNames = [...source.matchAll(/const \[(\w+)[^\]]*\] = useState\b/g)].map(match => match[1]);
const savedNotes = [
  { id: 'work-1', title: 'Project alpha', text: 'First task', category: 'work' },
  { id: 'work-2', title: 'Project beta', text: 'Second task', category: 'work' },
  { id: 'personal-1', title: 'Project weekend', text: 'A trip', category: 'personal' },
].map(note => ({ ...note, pinned: false, archived: false, deletedAt: null, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' }));

// Exercise real component JSX and handlers with native primitives stubbed out.
// Effects/native layout are intentionally excluded; this does not replace device QA.
function workspace(initialNotes = savedNotes, controllerOverride = null) {
  let state = { ...notes.initialNotesState(), notes: initialNotes };
  let status = 'ready';
  const slots = [];
  const refs = [];
  let refCursor = 0;
  const alerts = [];
  const events = [];
  const archiveCalls = [];
  const trashCalls = [];
  const pinCalls = [];
  const duplicateCalls = [];
  const storedValues = new Map();
  const asyncStorage = {
    async getItem(key) { return storedValues.get(key) ?? null; },
    async setItem(key, value) { storedValues.set(key, value); },
    async removeItem(key) { storedValues.delete(key); },
  };
  let cursor = 0;
  const defaultController = {
    dispatch(action) { events.push(['dispatch', action.type]); state = notes.notesReducer(state, action); },
    getSnapshot: () => ({ state, status, storageError: null }),
    setArchived(...args) { events.push(['archive']); archiveCalls.push(args); },
    duplicateNote(...args) { events.push(['duplicate']); duplicateCalls.push(args); },
    togglePin(...args) { events.push(['pin']); pinCalls.push(args); },
    moveToTrash(...args) { events.push(['move-to-trash']); trashCalls.push(['move', ...args]); },
    restoreFromTrash(...args) { events.push(['restore']); trashCalls.push(['restore', ...args]); },
    permanentlyDelete(...args) { events.push(['delete']); trashCalls.push(['delete', ...args]); },
  };
  const controller = controllerOverride ?? defaultController;
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name === 'react') return {
        useState(initial) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
          return [slots[index], value => {
            const next = typeof value === 'function' ? value(slots[index]) : value;
            if (index === stateNames.indexOf('actionsNoteId') && slots[index] !== null && next === null) events.push(['close-actions']);
            slots[index] = next;
          }];
        },
        useRef(value) {
          const index = refCursor++;
          if (!(index in refs)) refs[index] = { current: value };
          return refs[index];
        },
        useCallback: callback => callback,
        useEffect() {},
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      };
      if (name === 'react-native') return {
        ...Object.fromEntries(['FlatList', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name])),
        Alert: { alert: (...args) => { events.push(['alert']); alerts.push(args); } },
        Keyboard: { dismiss() {} }, Platform: { OS: 'android' },
        StyleSheet: { create: styles => styles, absoluteFill: { position: 'absolute' } },
      };
      if (name === 'react-native-safe-area-context') return { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' };
      if (name === '../noteActionsMenu') return { getNoteActionsMenuLayout };
      if (name === 'react/jsx-runtime') return require(name);
      // Keep the icon element/props inspectable without loading native fonts.
      if (name === '@expo/vector-icons/FontAwesome') return { __esModule: true, default: 'FontAwesome' };
      if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: asyncStorage };
      if (name === '../notes') return notes;
      if (name === '../notesController') return { createNotesController: () => controller };
      if (name === '../privateSharedCoordinator') return { privateSharedCoordinator };
      if (name === '../folders') return folders;
      if (name === '../draftLibrary') return draftLibrary;
      if (name === '../deviceNotesStorage') return {};
      if (name === '../noteSearch') return { searchNotes };
      if (name === './ChecklistLabel') return { ChecklistLabel: 'ChecklistLabel' };
      if (name === '../noteFormatting') return {
        sanitizeNoteHtml: value => value,
        noteHtmlToText: value => value,
        getNoteHtmlLines: value => String(value).split('\n'),
        updateChecklistHtml: value => value,
        normalizeNoteLink: value => value,
      };
      if (name === './RichNoteEditor') return { RichNoteEditor: 'RichNoteEditor' };
      if (name === './PrivateNotesScreen') return { PrivateNotesScreen: 'PrivateNotesScreen' };
      if (name === './FormattingToolbar') return { FormattingToolbar: 'FormattingToolbar' };
      if (name === './FormattedText') return { FormattedText: 'FormattedText' };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return {
    render() { cursor = 0; refCursor = 0; return exports.NotesWorkspace(); },
    controller, alerts, archiveCalls, trashCalls, pinCalls, duplicateCalls, events,
    setStatus(next) { status = next; },
  };
}

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  if (typeof tree.type === 'function' && tree.type.name === 'NoteActionsMenuContent') return [tree, ...elements(tree.type(tree.props))];
  return [tree, ...elements(tree.props.children)];
}
function find(tree, predicate) {
  const element = elements(tree).find(predicate);
  assert.ok(element, 'expected component element to exist');
  return element;
}
const list = tree => find(tree, element => element.type === 'FlatList');
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const chip = (tree, label) => find(tree, element => element.type === 'Pressable' && text(element) === label);
const action = (tree, label) => find(tree, element => element.props.label === label);
const actionsModal = tree => find(tree, element => element.type === 'Modal' && element.props.transparent === true);
const sheetActions = (tree, title) => elements(actionsModal(tree)).filter(element =>
  element.type === 'Pressable' && element.props.accessibilityLabel?.endsWith(`: ${title}`));
function openNoteActions(app, item, {
  triggerRect = [310, 530, 40, 40], viewportRect = [0, 30, 380, 740], menuHeight = 146,
} = {}) {
  const card = list(app.render()).props.renderItem({ item });
  const openCard = find(card, element => element.props.accessibilityLabel === `Open ${item.title}`);
  assert.equal(openCard.props.accessibilityRole, 'button');
  assert.equal(find(card, element => element.props.accessibilityLabel === `Note actions for ${item.title}`).props.accessibilityRole, 'button');
  const trigger = find(card, element => element.props.accessibilityLabel === `Note actions for ${item.title}`);
  trigger.props.ref({ measureInWindow: callback => callback(...triggerRect) });
  trigger.props.onPress();
  const modal = actionsModal(app.render());
  const layer = find(modal, element => element.props.testID === 'note-actions-layer');
  layer.props.ref.current = { measureInWindow: callback => callback(...viewportRect) };
  modal.props.onShow();
  const menu = find(app.render(), element => element.props.testID === 'note-actions-menu');
  menu.props.onLayout({ nativeEvent: { layout: { height: menuHeight } } });
  return { card, sheet: app.render() };
}

function editWorkNote(app) {
  chip(app.render(), 'Work').props.onPress();
  const tree = app.render();
  assert.equal(list(tree).props.data.length, 2);
  openNoteActions(app, savedNotes[0]);
  find(app.render(), element => element.props.accessibilityLabel === 'Open note: Project alpha').props.onPress();
}

const archivedNote = { ...savedNotes[0], id: 'archived-1', title: 'Archived project', archived: true, pinned: true, deletedAt: null };
const trashedNote = { ...savedNotes[0], id: 'trashed-1', title: 'Deleted project', archived: false, deletedAt: '2026-10-21T00:00:00Z' };

test('editor All notes clears the category filter and includes notes from other categories', () => {
  const app = workspace();
  editWorkNote(app);
  action(app.render(), 'All notes').props.onPress();
  assert.equal(list(app.render()).props.data.length, 3);
  assert.equal(app.controller.getSnapshot().state.editingId, null);
});

test('All notes keeps dirty category edits unless the discard prompt is accepted', () => {
  const app = workspace();
  editWorkNote(app);
  app.controller.dispatch({ type: 'category', category: 'ideas' });
  action(app.render(), 'All notes').props.onPress();
  assert.equal(app.alerts.length, 1);
  assert.equal(app.alerts[0][0], 'Discard unsaved changes?');
  assert.equal(app.controller.getSnapshot().state.draft.category, 'ideas');
  assert.equal(elements(app.render()).some(element => element.type === 'FlatList'), false);
  app.alerts[0][2].find(button => button.text === 'Discard changes').onPress();
  assert.equal(list(app.render()).props.data.length, 3);
  assert.equal(app.controller.getSnapshot().state.notes[0].category, 'work');
});

test('category search intersects results and reports its category total without changing saved notes', () => {
  const app = workspace();
  chip(app.render(), 'Work').props.onPress();
  find(app.render(), element => element.props.accessibilityLabel === 'Search saved notes').props.onChangeText('alpha');
  const tree = app.render();
  assert.equal(list(tree).props.data.length, 1);
  assert.equal(list(tree).props.data[0].id, 'work-1');
  assert.ok(elements(tree).some(element => element.type === 'Text' && text(element) === '1 of 2 notes match'));
  assert.ok(elements(tree).some(element => element.type === 'Text' && text(element) === '2 notes in Work.'));
  assert.equal(app.controller.getSnapshot().state.notes, savedNotes);
});

test('empty categories explain the filter instead of claiming there are no saved notes', () => {
  const app = workspace();
  chip(app.render(), 'Ideas').props.onPress();
  const empty = list(app.render()).props.ListEmptyComponent;
  assert.match(text(empty), /No notes in Ideas yet/);
  assert.doesNotMatch(text(empty), /Your first note|Your space is ready/);
  assert.equal(action(empty, 'Create a note').props.label, 'Create a note');
  assert.equal(app.controller.getSnapshot().state.notes.length, 3);
});

test('drawer icons retain their names and remain decorative within labelled buttons', () => {
  const app = workspace();
  const rows = elements(app.render()).filter(element => typeof element.type === 'function' && element.props.icon);
  assert.deepEqual(rows.map(row => row.props.icon), ['inbox', 'sticky-note-o', 'briefcase', 'user', 'lightbulb-o', 'star', 'lock', 'file-text-o', 'archive', 'trash', 'plus']);
  assert.deepEqual(rows.map(row => row.props.label), ['All notes', 'General', 'Work', 'Personal', 'Ideas', 'Important', 'Private Notes', 'Drafts', 'Archived', 'Trash', 'New note']);
  for (const row of rows) {
    const rendered = row.type(row.props);
    assert.equal(rendered.props.accessibilityRole, 'button');
    assert.ok(text(rendered).includes(row.props.label));
    const icon = find(rendered, element => element.type === 'FontAwesome');
    assert.equal(icon.props.name, row.props.icon);
    assert.equal(icon.props.accessible, false);
  }
});

test('library, archive, and trash expose exactly their available note actions in the popup', () => {
  const app = workspace([...savedNotes, archivedNote, trashedNote]);
  for (const [view, item, expected] of [
    ['library', savedNotes[0], ['Open note: Project alpha', 'Duplicate note: Project alpha', 'Move to folder: Project alpha', 'Archive note: Project alpha', 'Move to Trash: Project alpha']],
    ['archive', archivedNote, ['Open note: Archived project', 'Duplicate note: Archived project', 'Move to folder: Archived project', 'Restore from archive: Archived project', 'Move to Trash: Archived project']],
    ['trash', { ...savedNotes[0], id: 'trashed-1', title: 'Deleted project', archived: false, deletedAt: '2026-10-21T00:00:00Z' }, ['Restore note: Deleted project', 'Delete forever: Deleted project']],
  ]) {
    if (view === 'archive') action(app.render(), 'Archived').props.onPress();
    if (view === 'trash') action(app.render(), 'Trash').props.onPress();
    const { card, sheet } = openNoteActions(app, item);
    assert.equal(actionsModal(sheet).props.visible, true);
    assert.deepEqual(sheetActions(sheet, item.title).map(button => button.props.accessibilityLabel), expected);
    assert.equal(elements(card).some(element => element.type === 'Pressable' && /^(Edit|Archive|Move to Trash) /.test(element.props.accessibilityLabel ?? '')), false);
    const pinButtons = elements(card).filter(element => element.type === 'Pressable' && /^(Pin|Unpin) /.test(element.props.accessibilityLabel ?? ''));
    assert.equal(pinButtons.length, view === 'library' ? 1 : 0);
    assert.equal(elements(actionsModal(sheet)).some(element => /^(Pin|Unpin) /.test(element.props.accessibilityLabel ?? '')), false);
  }
});

test('note actions popup can be dismissed by backdrop, native request-close, or accessibility escape', () => {
  for (const dismiss of ['backdrop', 'request-close', 'accessibility-escape']) {
    const app = workspace();
    const { sheet } = openNoteActions(app, savedNotes[0]);
    const modal = actionsModal(sheet);
    if (dismiss === 'accessibility-escape') find(modal, element => element.props.testID === 'note-actions-menu').props.onAccessibilityEscape();
    if (dismiss === 'backdrop') find(modal, element => element.props.accessibilityLabel === 'Close note actions').props.onPress();
    if (dismiss === 'request-close') modal.props.onRequestClose();
    assert.equal(actionsModal(app.render()).props.visible, false, `${dismiss} should close the note actions sheet`);
  }
});

test('note actions are disabled while saving', () => {
  const app = workspace();
  app.setStatus('saving');
  const { sheet } = openNoteActions(app, savedNotes[0]);
  const buttons = sheetActions(sheet, savedNotes[0].title);
  assert.equal(buttons.length, 5);
  for (const button of buttons) {
    assert.equal(button.props.disabled, true);
    assert.equal(button.props.accessibilityState.disabled, true);
  }
  assert.deepEqual(app.events.filter(([event]) => ['pin', 'duplicate', 'archive', 'move-to-trash'].includes(event)), []);
});

test('Duplicate note closes the sheet and routes the selected library or archive note to the controller', () => {
  const app = workspace([...savedNotes, archivedNote, trashedNote]);
  for (const [view, item] of [['library', savedNotes[0]], ['archive', archivedNote]]) {
    if (view === 'archive') action(app.render(), 'Archived').props.onPress();
    const { sheet } = openNoteActions(app, item);
    const duplicate = find(sheet, element => element.props.accessibilityLabel === `Duplicate note: ${item.title}`);
    assert.equal(duplicate.props.accessibilityRole, 'button');
    assert.equal(duplicate.props.disabled, false);
    const start = app.events.length;
    duplicate.props.onPress();
    assert.equal(actionsModal(app.render()).props.visible, false);
    const closeIndex = app.events.findIndex(([event], index) => index >= start && event === 'close-actions');
    const duplicateIndex = app.events.findIndex(([event], index) => index >= start && event === 'duplicate');
    assert.ok(closeIndex >= start && closeIndex < duplicateIndex);
    assert.equal(app.duplicateCalls.at(-1)[0], item.id);
    assert.ok(Number.isFinite(Date.parse(app.duplicateCalls.at(-1)[1])));
    assert.equal(app.controller.getSnapshot().state.editingId, null);
  }

  action(app.render(), 'Trash').props.onPress();
  const { sheet } = openNoteActions(app, trashedNote);
  assert.equal(sheetActions(sheet, trashedNote.title).some(button => button.props.accessibilityLabel.startsWith('Duplicate note:')), false);
  assert.equal(app.duplicateCalls.length, 2);
});

test('failed duplicate persistence is exposed as an accessible library error without changing saved notes', async () => {
  const controller = createNotesController({
    load: async () => savedNotes,
    save: async () => { throw new Error('storage unavailable'); },
  });
  await controller.load();
  const app = workspace(savedNotes, controller);
  const completed = new Promise(resolve => {
    let sawSaving = false;
    const unsubscribe = controller.subscribe(() => {
      if (controller.getSnapshot().status === 'saving') sawSaving = true;
      else if (sawSaving) { unsubscribe(); resolve(); }
    });
  });
  const { sheet } = openNoteActions(app, savedNotes[0]);
  find(sheet, element => element.props.accessibilityLabel === 'Duplicate note: Project alpha').props.onPress();
  await completed;
  const error = find(app.render(), element => element.props.accessibilityRole === 'alert' && text(element).includes('Could not duplicate this note'));
  assert.match(text(error), /original note has not been changed/);
  assert.equal(controller.getSnapshot().state.notes, savedNotes);
  assert.equal(controller.getSnapshot().status, 'ready');
});

test('a stale enabled sheet callback is ignored if saving begins before it is pressed', () => {
  const app = workspace();
  const { sheet } = openNoteActions(app, savedNotes[0]);
  const archive = find(sheet, element => element.props.accessibilityLabel === 'Archive note: Project alpha');
  app.setStatus('saving');
  archive.props.onPress();
  assert.equal(actionsModal(app.render()).props.visible, true);
  assert.deepEqual(app.archiveCalls, []);
  assert.deepEqual(app.events.filter(([event]) => event === 'close-actions'), []);
});

test('opening a note card while saving does not start an editor session', () => {
  const app = workspace();
  app.setStatus('saving');
  const card = list(app.render()).props.renderItem({ item: savedNotes[0] });
  find(card, element => element.props.accessibilityLabel === 'Open Project alpha').props.onPress();
  assert.equal(app.controller.getSnapshot().state.editingId, null);
  assert.equal(elements(app.render()).some(element => element.type === 'FlatList'), true);
  assert.deepEqual(app.events.filter(([event]) => event === 'dispatch'), []);
});

test('selecting actions closes the sheet before opening editor or a confirmation, then runs confirmed actions', () => {
  const app = workspace();
  const { sheet } = openNoteActions(app, savedNotes[0]);
  find(sheet, element => element.props.accessibilityLabel === 'Open note: Project alpha').props.onPress();
  assert.equal(actionsModal(app.render()).props.visible, false);
  assert.ok(app.events.findIndex(([event]) => event === 'close-actions') < app.events.findIndex(([event]) => event === 'dispatch'));
  assert.equal(app.controller.getSnapshot().state.editingId, savedNotes[0].id);

  const confirmApp = workspace();
  const opened = openNoteActions(confirmApp, savedNotes[0]);
  find(opened.sheet, element => element.props.accessibilityLabel === 'Move to Trash: Project alpha').props.onPress();
  assert.equal(actionsModal(confirmApp.render()).props.visible, false);
  const closeIndex = confirmApp.events.findIndex(([event]) => event === 'close-actions');
  const alertIndex = confirmApp.events.findIndex(([event]) => event === 'alert');
  assert.ok(closeIndex >= 0 && closeIndex < alertIndex);
  assert.equal(confirmApp.trashCalls.length, 0);
  confirmApp.alerts[0][2].find(button => button.text === 'Move to Trash').onPress();
  assert.equal(confirmApp.trashCalls[0][0], 'move');
  assert.equal(confirmApp.trashCalls[0][1], savedNotes[0].id);
});

test('active library and category counts exclude archived notes while the archive shows only archived notes', () => {
  const app = workspace([...savedNotes, archivedNote]);
  const tree = app.render();
  assert.deepEqual(list(tree).props.data.map(note => note.id), savedNotes.map(note => note.id));
  assert.equal(action(tree, 'All notes').props.detail, '3 saved notes');
  assert.equal(action(tree, 'Work').props.detail, '2 notes');
  assert.equal(action(tree, 'Archived').props.detail, '1 archived note');
  chip(tree, 'Work').props.onPress();
  assert.equal(list(app.render()).props.data.length, 2);
  action(app.render(), 'Archived').props.onPress();
  const archive = app.render();
  assert.deepEqual(list(archive).props.data.map(note => note.id), ['archived-1']);
  assert.equal(action(archive, 'Archived').props.active, true);
  assert.equal(elements(archive).some(element => element.type === 'Pressable' && text(element) === 'Work'), false);
  action(archive, 'All notes').props.onPress();
  assert.equal(list(app.render()).props.data.length, 3);
});

test('search is scoped to the active library or archive and empty archives explain restoration', () => {
  const app = workspace([...savedNotes, archivedNote]);
  find(app.render(), element => element.props.accessibilityLabel === 'Search saved notes').props.onChangeText('Archived project');
  assert.equal(list(app.render()).props.data.length, 0);
  action(app.render(), 'Archived').props.onPress();
  assert.equal(list(app.render()).props.data[0].id, archivedNote.id);
  find(app.render(), element => element.props.accessibilityLabel === 'Search saved notes').props.onChangeText('weekend');
  assert.equal(list(app.render()).props.data.length, 0);
  assert.match(text(list(app.render()).props.ListEmptyComponent), /No matching notes/);

  const emptyApp = workspace();
  action(emptyApp.render(), 'Archived').props.onPress();
  const empty = list(emptyApp.render()).props.ListEmptyComponent;
  assert.match(text(empty), /Your archive is empty/);
  assert.match(text(empty), /restore them at any time/);
  assert.equal(elements(empty).some(element => element.props.label), false);
});

test('archive and restore sheet actions call the controller with the correct intent', () => {
  const app = workspace([...savedNotes, archivedNote]);
  for (const [label, item, archived] of [
    ['Archive note: Project alpha', savedNotes[0], true],
    ['Restore from archive: Archived project', archivedNote, false],
  ]) {
    if (!archived) action(app.render(), 'Archived').props.onPress();
    const { sheet } = openNoteActions(app, item);
    const button = find(sheet, element => element.props.accessibilityLabel === label);
    assert.equal(button.props.accessibilityRole, 'button');
    assert.equal(button.props.accessibilityState.disabled, false);
    const start = app.events.length;
    button.props.onPress();
    assert.equal(actionsModal(app.render()).props.visible, false);
    const closeIndex = app.events.findIndex(([event], index) => index >= start && event === 'close-actions');
    const controllerIndex = app.events.findIndex(([event], index) => index >= start && event === 'archive');
    assert.ok(closeIndex >= start && closeIndex < controllerIndex);
    const call = app.archiveCalls.at(-1);
    assert.equal(call[0], item.id);
    assert.equal(call[1], archived);
    assert.ok(Number.isFinite(Date.parse(call[2])));
  }
});

test('opening Archived preserves dirty edits until the user explicitly discards them', () => {
  const app = workspace();
  editWorkNote(app);
  app.controller.dispatch({ type: 'change', field: 'text', value: 'Unsaved work' });
  action(app.render(), 'Archived').props.onPress();
  assert.equal(app.alerts.length, 1);
  assert.equal(app.alerts[0][0], 'Discard unsaved changes?');
  assert.equal(app.controller.getSnapshot().state.draft.text, 'Unsaved work');
  assert.equal(elements(app.render()).some(element => element.type === 'FlatList'), false);
  app.alerts[0][2].find(button => button.text === 'Discard changes').onPress();
  assert.equal(list(app.render()).props.data.length, 0);
  assert.equal(action(app.render(), 'Archived').props.active, true);
  assert.equal(app.controller.getSnapshot().state.editingId, null);
  assert.equal(app.controller.getSnapshot().state.notes, savedNotes);
});

test('Trash is excluded from library, categories and archive, with independent counts and search', () => {
  const app = workspace([...savedNotes, archivedNote, trashedNote]);
  const tree = app.render();
  assert.deepEqual(list(tree).props.data.map(note => note.id), savedNotes.map(note => note.id));
  assert.equal(action(tree, 'All notes').props.detail, '3 saved notes');
  assert.equal(action(tree, 'Work').props.detail, '2 notes');
  assert.equal(action(tree, 'Trash').props.detail, '1 trashed notes');
  action(tree, 'Archived').props.onPress();
  assert.deepEqual(list(app.render()).props.data.map(note => note.id), [archivedNote.id]);
  action(app.render(), 'Trash').props.onPress();
  assert.equal(action(app.render(), 'Trash').props.active, true);
  assert.deepEqual(list(app.render()).props.data.map(note => note.id), [trashedNote.id]);
  assert.equal(elements(app.render()).some(element => element.type === 'Pressable' && text(element) === 'Work'), false);
  find(app.render(), element => element.props.accessibilityLabel === 'Search saved notes').props.onChangeText('weekend');
  assert.equal(list(app.render()).props.data.length, 0);
  assert.match(text(list(app.render()).props.ListEmptyComponent), /No matching notes/);
  find(app.render(), element => element.props.accessibilityLabel === 'Search saved notes').props.onChangeText('Deleted');
  assert.deepEqual(list(app.render()).props.data.map(note => note.id), [trashedNote.id]);
});

test('moving active or archived notes to Trash requires explicit destructive confirmation', () => {
  const app = workspace([...savedNotes, archivedNote]);
  for (const item of [savedNotes[0], archivedNote]) {
    if (item.archived) action(app.render(), 'Archived').props.onPress();
    const { sheet } = openNoteActions(app, item);
    find(sheet, element => element.props.accessibilityLabel === `Move to Trash: ${item.title}`).props.onPress();
    const alert = app.alerts.at(-1);
    assert.equal(alert[0], 'Move to Trash?');
    assert.equal(alert[2].find(button => button.text === 'Cancel').style, 'cancel');
    assert.equal(app.trashCalls.length, item.archived ? 1 : 0);
    const confirm = alert[2].find(button => button.text === 'Move to Trash');
    assert.equal(confirm.style, 'destructive');
    confirm.onPress();
    assert.equal(app.trashCalls.at(-1)[0], 'move');
    assert.equal(app.trashCalls.at(-1)[1], item.id);
    assert.ok(Number.isFinite(Date.parse(app.trashCalls.at(-1)[2])));
  }
});

test('Trash cards only restore or confirm permanent deletion and empty Trash explains recovery', () => {
  const app = workspace([trashedNote]);
  action(app.render(), 'Trash').props.onPress();
  const { card, sheet } = openNoteActions(app, trashedNote);
  assert.equal(elements(card).some(element => /^(Edit|Pin|Unpin|Archive|Move to Trash) /.test(element.props.accessibilityLabel ?? '')), false);
  const restore = find(sheet, element => element.props.accessibilityLabel === 'Restore note: Deleted project');
  assert.equal(restore.props.accessibilityRole, 'button');
  restore.props.onPress();
  assert.equal(app.trashCalls[0][0], 'restore');
  assert.equal(app.trashCalls[0][1], trashedNote.id);
  assert.ok(Number.isFinite(Date.parse(app.trashCalls[0][2])));
  const reopened = openNoteActions(app, trashedNote).sheet;
  find(reopened, element => element.props.accessibilityLabel === 'Delete forever: Deleted project').props.onPress();
  assert.equal(app.trashCalls.length, 1);
  const alert = app.alerts.at(-1);
  assert.equal(alert[0], 'Delete forever?');
  assert.match(alert[1], /cannot be undone/);
  assert.equal(alert[2].find(button => button.text === 'Cancel').style, 'cancel');
  const confirm = alert[2].find(button => button.text === 'Delete forever');
  assert.equal(confirm.style, 'destructive');
  confirm.onPress();
  assert.deepEqual(app.trashCalls.at(-1), ['delete', trashedNote.id]);

  const emptyApp = workspace();
  action(emptyApp.render(), 'Trash').props.onPress();
  const empty = list(emptyApp.render()).props.ListEmptyComponent;
  assert.match(text(empty), /Trash is empty/);
  assert.match(text(empty), /restore or permanently delete/);
  assert.equal(elements(empty).some(element => element.props.label), false);
});

test('opening Trash preserves unsaved edits until discard is confirmed', () => {
  const app = workspace();
  editWorkNote(app);
  app.controller.dispatch({ type: 'change', field: 'text', value: 'Unsaved work' });
  action(app.render(), 'Trash').props.onPress();
  assert.equal(app.alerts[0][0], 'Discard unsaved changes?');
  assert.equal(app.controller.getSnapshot().state.draft.text, 'Unsaved work');
  assert.equal(elements(app.render()).some(element => element.type === 'FlatList'), false);
  app.alerts[0][2].find(button => button.text === 'Discard changes').onPress();
  assert.equal(action(app.render(), 'Trash').props.active, true);
  assert.equal(app.controller.getSnapshot().state.editingId, null);
  assert.equal(app.controller.getSnapshot().state.notes, savedNotes);
});

test('cards do not group their independent checklist and menu accessibility elements', () => {
  const item = { ...savedNotes[0], text: '☐ Keep separate' };
  const app = workspace([item]);
  const { card, sheet } = openNoteActions(app, item);
  assert.equal(card.props.accessible, false);
  const checkbox = find(card, element => element.props.accessibilityRole === 'checkbox');
  assert.equal(checkbox.props.accessibilityLabel, 'Keep separate');
  assert.equal(checkbox.props.disabled, false);
  const menu = find(card, element => element.props.accessibilityLabel === 'Note actions for Project alpha');
  assert.equal(menu.props.accessibilityRole, 'button');
  assert.notEqual(menu.props.accessible, false);
  assert.equal(app.controller.getSnapshot().state.editingId, null, 'opening the menu must not dispatch an edit');
  assert.equal(find(sheet, element => element.props.accessibilityLabel === 'Open note: Project alpha').props.accessibilityRole, 'button');
});

test('a stale Open sheet callback cannot navigate while another write is saving', () => {
  const app = workspace();
  const { sheet } = openNoteActions(app, savedNotes[0]);
  const open = find(sheet, element => element.props.accessibilityLabel === 'Open note: Project alpha');
  app.setStatus('saving');
  open.props.onPress();
  assert.equal(actionsModal(app.render()).props.visible, true);
  assert.equal(app.controller.getSnapshot().state.editingId, null);
  assert.deepEqual(app.events.filter(([event]) => ['close-actions', 'dispatch'].includes(event)), []);
});

test('pin and unpin stay on one independent card button, never in the action menu', () => {
  for (const pinned of [false, true]) {
    const item = { ...savedNotes[0], pinned };
    const app = workspace([item]);
    const card = list(app.render()).props.renderItem({ item });
    const buttons = elements(card).filter(element => element.type === 'Pressable' && /^(Pin|Unpin) /.test(element.props.accessibilityLabel ?? ''));
    assert.equal(buttons.length, 1);
    const pin = buttons[0];
    assert.equal(card.props.accessible, false, 'independent controls must remain reachable');
    assert.equal(pin.props.accessibilityRole, 'button');
    assert.equal(pin.props.accessibilityLabel, `${pinned ? 'Unpin' : 'Pin'} Project alpha`);
    assert.equal(pin.props.accessibilityState.selected, pinned);
    assert.equal(pin.props.disabled, false);
    assert.equal(pin.props.accessibilityState.disabled, false);
    const icon = find(pin, element => element.type === 'FontAwesome');
    assert.equal(icon.props.name, 'thumb-tack');
    assert.equal(icon.props.accessible, false);
    assert.equal(icon.props.color, pinned ? '#b98500' : '#8c9988');
    pin.props.onPress();
    assert.equal(app.pinCalls.length, 1);
    assert.equal(app.pinCalls[0][0], item.id);
    assert.ok(Number.isFinite(Date.parse(app.pinCalls[0][1])));
    assert.equal(app.controller.getSnapshot().state.editingId, null);
    assert.equal(actionsModal(app.render()).props.visible, false);
    assert.deepEqual(app.events.filter(([event]) => event === 'dispatch'), []);

    const { sheet } = openNoteActions(app, item);
    assert.deepEqual(sheetActions(sheet, item.title).map(button => button.props.accessibilityLabel), [
      'Open note: Project alpha', 'Duplicate note: Project alpha', 'Move to folder: Project alpha', 'Archive note: Project alpha', 'Move to Trash: Project alpha',
    ]);
  }
});

test('the standalone pin control is disabled and announced as disabled while saving', () => {
  const app = workspace();
  app.setStatus('saving');
  const card = list(app.render()).props.renderItem({ item: savedNotes[0] });
  const pin = find(card, element => element.props.accessibilityLabel === 'Pin Project alpha');
  assert.equal(pin.props.disabled, true);
  assert.equal(pin.props.accessibilityState.disabled, true);
  assert.deepEqual(app.pinCalls, []);
});

const popup = tree => find(tree, element => element.props.testID === 'note-actions-menu');
const popupLayer = tree => find(tree, element => element.props.testID === 'note-actions-layer');
const flatStyle = style => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]));

function triggerFor(app, item, measureInWindow) {
  const card = list(app.render()).props.renderItem({ item });
  const trigger = find(card, element => element.props.accessibilityLabel === `Note actions for ${item.title}`);
  trigger.props.ref({ measureInWindow });
  return trigger;
}

test('the contextual popup stays compact and accessible with its duplicate, folder, archive, and trash actions', () => {
  const app = workspace();
  const { sheet } = openNoteActions(app, savedNotes[0]);
  const menu = popup(sheet);
  const style = flatStyle(menu.props.style);
  assert.equal(style.width, 216);
  assert.equal(style.position, 'absolute');
  assert.equal(style.borderRadius, 14);
  assert.equal(menu.props.pointerEvents, 'auto');
  assert.equal(menu.props.accessibilityViewIsModal, true);
  assert.equal(menu.props.accessibilityElementsHidden, false);
  assert.deepEqual(elements(menu).filter(element => element.type === 'FontAwesome').map(icon => icon.props.name), ['file-text-o', 'clone', 'folder-o', 'archive', 'trash-o']);
  assert.equal(elements(menu).some(element => element.props.accessibilityRole === 'header'), false);
  assert.doesNotMatch(text(menu), /Cancel|Share|history|private|Pin|Unpin/);
  assert.deepEqual(sheetActions(sheet, savedNotes[0].title).map(button => text(button)), ['Open note', 'Duplicate note', 'Move to folder', 'Archive note', 'Move to Trash']);
  const danger = find(menu, element => element.type === 'Text' && text(element) === 'Move to Trash');
  assert.equal(flatStyle(danger.props.style).color, '#b3261e');
  for (const button of sheetActions(sheet, savedNotes[0].title)) {
    assert.ok(flatStyle(button.props.style({ pressed: false })).minHeight >= 44);
  }
});

test('the popup uses the tapped trigger and the measured safe viewport origin', () => {
  const app = workspace();
  const triggerRect = [324, 680, 40, 40];
  const viewportRect = [8, 48, 370, 720];
  const { sheet } = openNoteActions(app, savedNotes[0], { triggerRect, viewportRect, menuHeight: 160 });
  const style = flatStyle(popup(sheet).props.style);
  const rect = ([x, y, width, height]) => ({ x, y, width, height });
  const expected = getNoteActionsMenuLayout(rect(triggerRect), rect(viewportRect), 160);
  for (const key of ['left', 'top', 'width', 'maxHeight']) assert.equal(style[key], expected[key]);
  assert.ok(style.top < triggerRect[1] - viewportRect[1]);
});

test('the popup stays hidden and noninteractive until native anchor and panel measurements are ready', () => {
  const app = workspace();
  let finishTrigger;
  const trigger = triggerFor(app, savedNotes[0], callback => { finishTrigger = callback; });
  trigger.props.onPress();
  let tree = app.render();
  popupLayer(tree).props.ref.current = { measureInWindow: callback => callback(0, 30, 380, 740) };
  actionsModal(tree).props.onShow();
  popup(tree).props.onLayout({ nativeEvent: { layout: { height: 150 } } });
  tree = app.render();
  assert.equal(popup(tree).props.pointerEvents, 'none');
  assert.equal(popup(tree).props.accessibilityElementsHidden, true);
  assert.equal(flatStyle(popup(tree).props.style).opacity, 0);
  finishTrigger(310, 530, 40, 40);
  tree = app.render();
  assert.equal(popup(tree).props.pointerEvents, 'auto');
  assert.equal(popup(tree).props.accessibilityElementsHidden, false);
  assert.notEqual(flatStyle(popup(tree).props.style).opacity, 0);
});

test('late native measurements cannot revive a dismissed popup at either async stage', () => {
  for (const stage of ['layer', 'trigger']) {
    const app = workspace();
    let finishLayer;
    let finishTrigger;
    let triggerCalls = 0;
    const trigger = triggerFor(app, savedNotes[0], callback => { triggerCalls++; finishTrigger = callback; });
    trigger.props.onPress();
    const tree = app.render();
    popupLayer(tree).props.ref.current = { measureInWindow: callback => { finishLayer = callback; } };
    actionsModal(tree).props.onShow();
    if (stage === 'trigger') finishLayer(0, 30, 380, 740);
    find(tree, element => element.props.accessibilityLabel === 'Close note actions').props.onPress();
    if (stage === 'layer') finishLayer(0, 30, 380, 740);
    else finishTrigger(310, 530, 40, 40);
    assert.equal(actionsModal(app.render()).props.visible, false);
    assert.equal(popup(app.render()).props.pointerEvents, 'none');
    if (stage === 'layer') assert.equal(triggerCalls, 0);
  }
});

test('old measurements and an old onShow cannot move the menu to a previous note', () => {
  const app = workspace();
  const pendingFirst = [];
  const pendingSecond = [];
  const first = triggerFor(app, savedNotes[0], callback => pendingFirst.push(callback));
  first.props.onPress();
  let tree = app.render();
  popupLayer(tree).props.ref.current = { measureInWindow: callback => callback(0, 30, 380, 740) };
  const oldOnShow = actionsModal(tree).props.onShow;
  oldOnShow();
  const second = triggerFor(app, savedNotes[1], callback => pendingSecond.push(callback));
  second.props.onPress();
  const secondCalls = pendingSecond.length;
  oldOnShow();
  assert.equal(pendingSecond.length, secondCalls);
  pendingSecond.at(-1)(290, 300, 40, 40);
  popup(app.render()).props.onLayout({ nativeEvent: { layout: { height: 150 } } });
  for (const finish of pendingFirst) finish(20, 700, 40, 40);
  tree = app.render();
  assert.deepEqual(sheetActions(tree, savedNotes[1].title).map(button => text(button)), ['Open note', 'Duplicate note', 'Move to folder', 'Archive note', 'Move to Trash']);
  const expected = getNoteActionsMenuLayout({ x: 290, y: 300, width: 40, height: 40 }, { x: 0, y: 30, width: 380, height: 740 }, 150);
  const style = flatStyle(popup(tree).props.style);
  assert.equal(style.left, expected.left);
  assert.equal(style.top, expected.top);
  assert.equal(app.controller.getSnapshot().state.editingId, null);
});

test('viewport changes remeasure the trigger and keep tall menu content inside the new frame', () => {
  const app = workspace();
  openNoteActions(app, savedNotes[0]);
  triggerFor(app, savedNotes[0], callback => callback(260, 100, 40, 40));
  const layer = popupLayer(app.render());
  layer.props.ref.current = { measureInWindow: callback => callback(0, 24, 320, 230) };
  layer.props.onLayout();
  popup(app.render()).props.onLayout({ nativeEvent: { layout: { height: 340 } } });
  const menu = popup(app.render());
  const style = flatStyle(menu.props.style);
  assert.equal(style.maxHeight, 206);
  assert.ok(style.left >= 12 && style.left + style.width <= 308);
  assert.ok(style.top >= 12 && style.top + Math.min(340, style.maxHeight) <= 218);
  assert.equal(menu.props.pointerEvents, 'auto');
  assert.equal(find(menu, element => element.type === 'ScrollView').props.keyboardShouldPersistTaps, 'handled');
});

test('all existing library, archive, and trash menu actions retain their original decorative icons', () => {
  const app = workspace([...savedNotes, archivedNote, trashedNote]);
  for (const [view, item, icons] of [
    ['library', savedNotes[0], ['file-text-o', 'clone', 'folder-o', 'archive', 'trash-o']],
    ['archive', archivedNote, ['file-text-o', 'clone', 'folder-o', 'undo', 'trash-o']],
    ['trash', trashedNote, ['undo', 'trash']],
  ]) {
    if (view !== 'library') action(app.render(), view === 'archive' ? 'Archived' : 'Trash').props.onPress();
    const { sheet } = openNoteActions(app, item);
    const buttons = sheetActions(sheet, item.title);
    assert.equal(flatStyle(popup(sheet).props.style).width, 216, 'icons must not widen the compact popup');
    assert.deepEqual(buttons.map(button => find(button, element => element.type === 'FontAwesome').props.name), icons);
    for (const button of buttons) {
      const icon = find(button, element => element.type === 'FontAwesome');
      const label = find(button, element => element.type === 'Text');
      const destructive = /^(Move to Trash|Delete forever):/.test(button.props.accessibilityLabel);
      assert.equal(icon.props.size, 19);
      assert.equal(icon.props.accessible, false, 'the button label, not the decorative glyph, should be announced');
      assert.equal(icon.props.color, destructive ? '#b3261e' : '#52634b');
      assert.equal(flatStyle(icon.props.style).flexShrink, 0);
      assert.equal(flatStyle(icon.props.style).width, 20);
      assert.equal(flatStyle(label.props.style).flex, 1);
      assert.equal(flatStyle(label.props.style).flexShrink, 1);
      assert.equal(flatStyle(label.props.style).minWidth, 0);
      assert.equal(label.props.numberOfLines, undefined, 'long and scaled labels must be allowed to wrap');
      const row = flatStyle(button.props.style({ pressed: false }));
      assert.equal(row.flexDirection, 'row');
      assert.equal(row.alignItems, 'center');
      assert.equal(row.gap, 10);
      assert.ok(row.minHeight >= 44);
    }
  }
});
