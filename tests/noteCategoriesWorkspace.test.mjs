import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as notes from '../src/notes.ts';
import { searchNotes } from '../src/noteSearch.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const savedNotes = [
  { id: 'work-1', title: 'Project alpha', text: 'First task', category: 'work' },
  { id: 'work-2', title: 'Project beta', text: 'Second task', category: 'work' },
  { id: 'personal-1', title: 'Project weekend', text: 'A trip', category: 'personal' },
].map(note => ({ ...note, pinned: false, archived: false, deletedAt: null, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' }));

// Exercise real component JSX and handlers with native primitives stubbed out.
// Effects/native layout are intentionally excluded; this does not replace device QA.
function workspace(initialNotes = savedNotes) {
  let state = { ...notes.initialNotesState(), notes: initialNotes };
  const slots = [];
  const alerts = [];
  const archiveCalls = [];
  const trashCalls = [];
  let cursor = 0;
  const controller = {
    dispatch(action) { state = notes.notesReducer(state, action); },
    getSnapshot: () => ({ state, status: 'ready', storageError: null }),
    setArchived(...args) { archiveCalls.push(args); },
    moveToTrash(...args) { trashCalls.push(['move', ...args]); },
    restoreFromTrash(...args) { trashCalls.push(['restore', ...args]); },
    permanentlyDelete(...args) { trashCalls.push(['delete', ...args]); },
  };
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name === 'react') return {
        useState(initial) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
          return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
        },
        useRef: value => ({ current: value }),
        useCallback: callback => callback,
        useEffect() {},
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      };
      if (name === 'react-native') return {
        ...Object.fromEntries(['FlatList', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name])),
        Alert: { alert: (...args) => alerts.push(args) },
        Keyboard: { dismiss() {} }, Platform: { OS: 'android' },
        StyleSheet: { create: styles => styles, absoluteFill: { position: 'absolute' } },
      };
      if (name === 'react/jsx-runtime') return require(name);
      // Keep the icon element/props inspectable without loading native fonts.
      if (name === '@expo/vector-icons/FontAwesome') return { __esModule: true, default: 'FontAwesome' };
      if (name === '@react-native-async-storage/async-storage') return {};
      if (name === '../notes') return notes;
      if (name === '../notesController') return { createNotesController: () => controller };
      if (name === '../deviceNotesStorage') return {};
      if (name === '../noteSearch') return { searchNotes };
      if (name === './ChecklistLabel') return { ChecklistLabel: 'ChecklistLabel' };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return {
    render() { cursor = 0; return exports.NotesWorkspace(); },
    controller, alerts, archiveCalls, trashCalls,
  };
}

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
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

function editWorkNote(app) {
  chip(app.render(), 'Work').props.onPress();
  const tree = app.render();
  assert.equal(list(tree).props.data.length, 2);
  const card = list(tree).props.renderItem({ item: savedNotes[0] });
  find(card, element => element.props.accessibilityLabel === 'Edit Project alpha').props.onPress();
}

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
  assert.deepEqual(rows.map(row => row.props.icon), ['inbox', 'sticky-note-o', 'briefcase', 'user', 'lightbulb-o', 'star', 'archive', 'trash', 'plus']);
  assert.deepEqual(rows.map(row => row.props.label), ['All notes', 'General', 'Work', 'Personal', 'Ideas', 'Important', 'Archived', 'Trash', 'New note']);
  for (const row of rows) {
    const rendered = row.type(row.props);
    assert.equal(rendered.props.accessibilityRole, 'button');
    assert.ok(text(rendered).includes(row.props.label));
    const icon = find(rendered, element => element.type === 'FontAwesome');
    assert.equal(icon.props.name, row.props.icon);
    assert.equal(icon.props.accessible, false);
  }
});

test('icon-only pin controls retain accessible pin/unpin labels and selected state', () => {
  const app = workspace();
  for (const pinned of [false, true]) {
    const item = { ...savedNotes[0], pinned };
    const card = list(app.render()).props.renderItem({ item });
    const button = find(card, element => element.type === 'Pressable' && element.props.accessibilityLabel === `${pinned ? 'Unpin' : 'Pin'} Project alpha`);
    assert.equal(button.props.accessibilityRole, 'button');
    assert.equal(button.props.accessibilityState.selected, pinned);
    const icon = find(button, element => element.type === 'FontAwesome');
    assert.equal(icon.props.name, 'thumb-tack');
    assert.equal(icon.props.accessible, false);
    assert.equal(icon.props.color, pinned ? '#b98500' : '#52634b');
  }
});

const archivedNote = { ...savedNotes[0], id: 'archived-1', title: 'Archived project', archived: true, pinned: true };

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

test('archive and restore card controls are labelled and call the controller with the correct intent', () => {
  const app = workspace([...savedNotes, archivedNote]);
  for (const [label, item, archived, iconName] of [
    ['Archive Project alpha', savedNotes[0], true, 'archive'],
    ['Restore Archived project', archivedNote, false, 'undo'],
  ]) {
    if (!archived) action(app.render(), 'Archived').props.onPress();
    const card = list(app.render()).props.renderItem({ item });
    const button = find(card, element => element.props.accessibilityLabel === label);
    assert.equal(button.props.accessibilityRole, 'button');
    assert.equal(button.props.accessibilityState.disabled, false);
    const icon = find(button, element => element.type === 'FontAwesome' && element.props.name === iconName);
    assert.equal(icon.props.accessible, false);
    button.props.onPress();
    const call = app.archiveCalls.at(-1);
    assert.equal(call[0], item.id);
    assert.equal(call[1], archived);
    assert.ok(Number.isFinite(Date.parse(call[2])));
    if (!archived) assert.equal(elements(card).some(element => /^Pin |^Unpin |^Archive /.test(element.props.accessibilityLabel ?? '')), false);
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

const trashedNote = { ...savedNotes[0], id: 'trashed-1', title: 'Deleted project', deletedAt: '2026-10-21T00:00:00Z' };

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
    const card = list(app.render()).props.renderItem({ item });
    find(card, element => element.props.accessibilityLabel === `Move to Trash ${item.title}`).props.onPress();
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
  const card = list(app.render()).props.renderItem({ item: trashedNote });
  assert.equal(elements(card).some(element => /^(Edit|Pin|Unpin|Archive|Move to Trash) /.test(element.props.accessibilityLabel ?? '')), false);
  const restore = find(card, element => element.props.accessibilityLabel === 'Restore Deleted project');
  assert.equal(restore.props.accessibilityRole, 'button');
  restore.props.onPress();
  assert.equal(app.trashCalls[0][0], 'restore');
  assert.equal(app.trashCalls[0][1], trashedNote.id);
  assert.ok(Number.isFinite(Date.parse(app.trashCalls[0][2])));
  find(card, element => element.props.accessibilityLabel === 'Delete forever Deleted project').props.onPress();
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
