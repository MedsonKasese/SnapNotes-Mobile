import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as notes from '../src/notes.ts';
import { searchNotes } from '../src/noteSearch.ts';
import { getNoteActionsMenuLayout } from '../src/noteActionsMenu.ts';
import { noteHtmlToText, plainTextToHtml, sanitizeNoteHtml } from '../src/noteFormatting.ts';
import * as folders from '../src/folders.ts';
import * as draftLibrary from '../src/draftLibrary.ts';

const require = createRequire(import.meta.url);
const sourcePath = process.env.SNAPNOTES_NOTESWORKSPACE_SOURCE
  ?? new URL('../src/components/NotesWorkspace.tsx', import.meta.url);
const source = readFileSync(sourcePath, 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const stateNames = [...source.matchAll(/const \[(\w+)[^\]]*\] = useState\b/g)].map(match => match[1]);
const DRAFT_KEY = '@snapnotes-mobile/editor-draft';
const savedNotes = [{
  id: 'saved-1', title: 'Existing note', text: 'Existing body', category: 'work',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function sameDeps(left, right) {
  return left !== undefined && right !== undefined && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));
}

// A small deterministic hook renderer: refs and state persist by hook slot,
// callbacks honor dependency identity, effects commit after each render and run
// their previous cleanup when dependencies change. No native layout is involved.
function workspace({ initialNotes = [], reads = [], checklistSaves = [], contentReads = [], saveSaves = [] } = {}) {
  let state = { ...notes.initialNotesState(), notes: initialNotes };
  const alerts = [];
  const updateCalls = [];
  const slots = [];
  const effectSlots = [];
  const timers = new Map();
  const storage = { value: null, folderValue: null, libraryValue: null, reads: [...reads], getCalls: 0, sets: [], removes: [] };
  const listeners = new Set();
  const dispatchCalls = [];
  const editorCommands = [];
  const saveCalls = [];
  let cursor = 0;
  let stateCursor = 0;
  const stateSlots = new Map();
  let nextTimer = 1;
  const controller = {
    status: 'ready',
    storageError: null,
    getSnapshot: () => ({ state, status: controller.status, storageError: controller.storageError }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish() { listeners.forEach(listener => listener()); },
    load: () => Promise.resolve(),
    dispatch(action) {
      dispatchCalls.push(action);
      if (controller.status !== 'ready') return;
      state = notes.notesReducer(state, action);
      controller.publish();
    },
    async updateNoteText(id, text, now) {
      updateCalls.push({ id, text, now });
      if (controller.status !== 'ready') return;
      controller.status = 'saving';
      controller.publish();
      const pendingSave = checklistSaves.shift() ?? { promise: Promise.resolve() };
      try {
        await pendingSave.promise;
        state = { ...state, notes: state.notes.map(note => note.id === id ? { ...note, text, updatedAt: now } : note), notice: 'Checklist updated.' };
      } catch {
        controller.storageError = 'Could not save this checklist change on this device.';
      } finally {
        controller.status = 'ready';
        controller.publish();
      }
    },
    async save() {
      if (controller.status !== 'ready') return;
      const now = '2026-10-21T00:00:00Z';
      saveCalls.push({ now, draft: { ...state.draft } });
      const next = notes.notesReducer(state, { type: 'save', id: 'new-test-note', now });
      if (next.notes === state.notes) {
        state = next;
        controller.publish();
        return;
      }
      const previous = state;
      controller.status = 'saving';
      controller.publish();
      const pendingSave = saveSaves.shift() ?? { promise: Promise.resolve() };
      try {
        await pendingSave.promise;
        state = { ...next, notice: 'Note saved on this device.' };
      } catch {
        state = previous;
        controller.storageError = 'Could not save this note on this device.';
      } finally {
        controller.status = 'ready';
        controller.publish();
      }
    },
  };
  const AsyncStorage = {
    getItem(key) {
      if (key === folders.FOLDERS_KEY) return Promise.resolve(storage.folderValue);
      if (key === draftLibrary.DRAFT_LIBRARY_KEY) return Promise.resolve(storage.libraryValue ?? null);
      assert.equal(key, DRAFT_KEY);
      storage.getCalls += 1;
      const read = storage.reads.shift();
      if (read?.promise) return read.promise;
      if (read && typeof read.then === 'function') return read;
      return Promise.resolve(read ?? storage.value);
    },
    async setItem(key, value) {
      if (key === folders.FOLDERS_KEY) { storage.folderValue = value; return; }
      assert.equal(key, DRAFT_KEY);
      storage.sets.push(value);
      storage.value = value;
    },
    async removeItem(key) {
      if (key === folders.FOLDERS_KEY) { storage.folderValue = null; return; }
      assert.equal(key, DRAFT_KEY);
      storage.removes.push(key);
      storage.value = null;
    },
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      stateSlots.set(stateNames[stateCursor++], index);
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
      const previous = slots[index];
      if (!previous || !sameDeps(previous.deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = effectSlots[index];
      if (!previous || !sameDeps(previous.deps, deps)) {
        if (previous?.cleanup) previous.cleanup();
        effectSlots[index] = { effect, deps, cleanup: undefined, pending: true };
      }
    },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  };
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return {
        ...Object.fromEntries(['BackHandler', 'FlatList', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(type => [type, type])),
        Alert: { alert: (...args) => alerts.push(args) },
        BackHandler: { addEventListener: () => ({ remove() {} }) },
        Keyboard: { dismiss() {} }, Platform: { OS: 'android' },
        StyleSheet: { create: styles => styles, absoluteFill: { position: 'absolute' } },
      };
      if (name === 'react-native-safe-area-context') return { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' };
      if (name === '../noteActionsMenu') return { getNoteActionsMenuLayout };
      if (name === 'react/jsx-runtime') return require(name);
      // Native font loading is outside this deterministic recovery harness.
      if (name === '@expo/vector-icons/FontAwesome') return { __esModule: true, default: 'FontAwesome' };
      if (name === '@react-native-async-storage/async-storage') return AsyncStorage;
      if (name === '../notes') return notes;
      if (name === '../notesController') return { createNotesController: () => controller };
      if (name === '../folders') return folders;
      if (name === '../draftLibrary') return draftLibrary;
      if (name === '../deviceNotesStorage') return { deviceNotesStorage: {} };
      if (name === '../noteSearch') return { searchNotes };
      if (name === '../noteFormatting') return { noteHtmlToText, plainTextToHtml, sanitizeNoteHtml,
        getNoteHtmlLines: html => [], normalizeNoteLink: value => value, updateChecklistHtml: (html, _line, checked) => html.replace(checked ? '☐' : '☑', checked ? '☑' : '☐') };
      if (name === './ChecklistLabel') return { ChecklistLabel: 'ChecklistLabel' };
      if (name === './FormattedText') return { FormattedText: 'FormattedText' };
      if (name === './FormattingToolbar') return { FormattingToolbar: 'FormattingToolbar' };
      if (name === './RichNoteEditor') return { RichNoteEditor: 'RichNoteEditor' };
      throw new Error(`Unexpected import: ${name}`);
    },
  });

  function render() {
    cursor = 0;
    stateCursor = 0;
    const tree = exports.NotesWorkspace();
    const attachEditorRef = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(attachEditorRef); return; }
      if (node.type === 'RichNoteEditor' && node.props.ref) {
        const ref = node.props.ref;
        ref.current = {
          getContent() {
            const next = contentReads.shift();
            return next?.promise ?? next ?? Promise.resolve({
              text: state.draft.text,
              html: state.draft.html ?? plainTextToHtml(state.draft.text),
            });
          },
          command(action, url) { editorCommands.push({ action, url }); },
          rememberSelection() {},
        };
      }
      attachEditorRef(node.props?.children);
    };
    attachEditorRef(tree);
    for (const slot of effectSlots) {
      if (slot?.pending) {
        slot.pending = false;
        slot.cleanup = slot.effect();
      }
    }
    return tree;
  }
  async function flushMicrotasks() {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  }
  async function advanceTimers(ms = 500) {
    const due = [...timers.entries()].filter(([, timer]) => timer.delay <= ms);
    for (const [id, timer] of due) {
      if (!timers.has(id)) continue;
      timers.delete(id);
      timer.callback();
    }
    await flushMicrotasks();
  }
  return {
    render, controller, storage, alerts, timers, slots, updateCalls, dispatchCalls, saveCalls, editorCommands,
    get draftHydrated() { return slots[stateSlots.get('draftHydrated')]; },
    get draftStorageError() { return slots[stateSlots.get('draftStorageError')]; },
    flushMicrotasks, advanceTimers,
  };
}

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  return [tree, ...elements(tree.props.children)];
}
function find(tree, predicate, message = 'expected component element to exist') {
  const element = elements(tree).find(predicate);
  assert.ok(element, message);
  return element;
}
const text = tree => Array.isArray(tree) ? tree.map(text).join('')
  : tree?.props ? text(tree.props.children)
    : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const action = (tree, label) => find(tree, element => element.props.label === label, `missing Action: ${label}`);
const labeled = (tree, label) => find(tree, element => element.props.accessibilityLabel === label, `missing control: ${label}`);
const readError = /An earlier recovery draft could not be read/;
const validRecord = (overrides = {}) => JSON.stringify({
  version: 1, title: 'Recovered title', text: 'Recovered body', category: 'ideas', editingId: null, ...overrides,
});
const visibleDraftError = tree => elements(tree).some(element => element.type === 'Text' && readError.test(text(element)));

async function startRead(app) {
  app.render();
  await app.flushMicrotasks();
  assert.equal(app.storage.getCalls, 1, 'startup load completion should begin exactly one draft read');
}
async function beginChecklistRace() {
  const pendingRead = deferred();
  const checklistSave = deferred();
  const checklistNote = { ...savedNotes[0], id: 'check-1', title: 'Checklist', text: '☐ Keep this item' };
  const app = workspace({ initialNotes: [checklistNote], reads: [pendingRead], checklistSaves: [checklistSave] });
  await startRead(app);
  const list = find(app.render(), element => element.type === 'FlatList');
  labeled(list.props.renderItem({ item: checklistNote }), 'Keep this item').props.onPress();
  assert.equal(app.controller.getSnapshot().status, 'saving');
  return { app, pendingRead, checklistSave };
}
function chooseDraftCategory(app, category = 'Personal') {
  find(app.render(), element => element.props.accessibilityLabel === 'Choose note category').props.onPress();
  labeled(app.render(), `Set category ${category}`).props.onPress();
}
function typeDraft(app, { title = 'Typed title', body = 'Typed body' } = {}) {
  if (!elements(app.render()).some(element => element.type === 'RichNoteEditor')) {
    action(app.render(), '+ New note').props.onPress();
  }
  let tree = app.render();
  labeled(tree, 'Note title (optional)').props.onChangeText(title);
  tree = app.render();
  find(tree, element => element.type === 'RichNoteEditor').props.onChange({ text: body, html: plainTextToHtml(body) });
  app.render();
  find(app.render(), element => element.props.accessibilityLabel === 'Choose note category').props.onPress();
  tree = app.render();
  labeled(tree, 'Set category Personal').props.onPress();
  return app.render();
}
async function persistCurrentDraft(app) {
  app.render();
  await app.advanceTimers(500);
  app.render();
}

 test('a late valid recovery cannot replace typed fields/category; debounce persists only the current draft', async () => {
  const pendingRead = deferred();
  const app = workspace({ reads: [pendingRead] });
  await startRead(app);
  typeDraft(app);
  pendingRead.resolve(validRecord());
  await app.flushMicrotasks();
  const tree = app.render();
  const state = app.controller.getSnapshot().state;
  assert.deepEqual({ ...state.draft }, { title: 'Typed title', text: 'Typed body', category: 'personal', html: '<div>Typed body</div>' });
  assert.equal(state.notice, null, 'stale restore must not dispatch');
  assert.equal(visibleDraftError(tree), false);
  await persistCurrentDraft(app);
  assert.equal(app.storage.sets.length, 1);
  assert.deepEqual(JSON.parse(app.storage.sets[0]), {
    version: 1, title: 'Typed title', text: 'Typed body', html: '<div>Typed body</div>', category: 'personal', editingId: null,
    savedAt: JSON.parse(app.storage.sets[0]).savedAt,
  });
  assert.equal(app.storage.removes.length, 0);
});

test('a late malformed record cannot poison user hydration or remove the recovery record', async () => {
  const pendingRead = deferred();
  const app = workspace({ reads: [pendingRead] });
  await startRead(app);
  typeDraft(app);
  app.storage.value = '{newer stored record';
  pendingRead.resolve('{malformed old record');
  await app.flushMicrotasks();
  assert.equal(visibleDraftError(app.render()), false);
  assert.equal(app.storage.removes.length, 0);
  assert.equal(app.storage.value, '{newer stored record');
});

test('a late rejected read cannot poison user hydration or alter newer storage', async () => {
  const pendingRead = deferred();
  const app = workspace({ reads: [pendingRead] });
  await startRead(app);
  typeDraft(app);
  app.storage.value = 'newer serialized record';
  pendingRead.reject(new Error('old read failed'));
  await app.flushMicrotasks();
  assert.equal(visibleDraftError(app.render()), false);
  assert.equal(app.storage.removes.length, 0);
  assert.equal(app.storage.value, 'newer serialized record');
});

test('a late null read does not reset typing, raise an error, or touch storage', async () => {
  const pendingRead = deferred();
  const app = workspace({ reads: [pendingRead] });
  await startRead(app);
  typeDraft(app);
  app.storage.value = 'newer serialized record';
  pendingRead.resolve(null);
  await app.flushMicrotasks();
  assert.equal(visibleDraftError(app.render()), false);
  assert.equal(app.storage.removes.length, 0);
  assert.equal(app.storage.value, 'newer serialized record');
});

test('a late blank record cannot clear newer storage after the user takes ownership', async () => {
  const pendingRead = deferred();
  const app = workspace({ reads: [pendingRead] });
  await startRead(app);
  typeDraft(app);
  app.storage.value = 'newer serialized record';
  pendingRead.resolve(validRecord({ title: '  ', text: ' \n ', category: 'general' }));
  await app.flushMicrotasks();
  assert.equal(visibleDraftError(app.render()), false);
  assert.equal(app.storage.removes.length, 0);
  assert.equal(app.storage.value, 'newer serialized record');
});

test('starting a new note while recovery is pending takes ownership of the editor', async () => {
  const pendingRead = deferred();
  const app = workspace({ reads: [pendingRead] });
  await startRead(app);
  action(app.render(), '+ New note').props.onPress();
  pendingRead.resolve(validRecord());
  await app.flushMicrotasks();
  assert.equal(app.controller.getSnapshot().state.notice, null);
  assert.deepEqual({ ...app.controller.getSnapshot().state.draft }, { title: '', text: '' });
  assert.match(text(app.render()), /New note/);
});

test('reset through All notes while recovery is pending takes ownership', async () => {
  const pendingRead = deferred();
  const app = workspace({ reads: [pendingRead] });
  await startRead(app);
  action(app.render(), '+ New note').props.onPress();
  action(app.render(), 'All notes').props.onPress();
  pendingRead.resolve(validRecord());
  await app.flushMicrotasks();
  assert.equal(app.controller.getSnapshot().state.notice, null);
  assert.deepEqual({ ...app.controller.getSnapshot().state.draft }, { title: '', text: '' });
  assert.match(text(app.render()), /All notes/);
});

test('editing an existing saved note while recovery is pending takes ownership', async () => {
  const pendingRead = deferred();
  const app = workspace({ initialNotes: savedNotes, reads: [pendingRead] });
  await startRead(app);
  const tree = app.render();
  const list = find(tree, element => element.type === 'FlatList');
  const card = list.props.renderItem({ item: savedNotes[0] });
  labeled(card, 'Open Existing note').props.onPress();
  pendingRead.resolve(validRecord());
  await app.flushMicrotasks();
  const state = app.controller.getSnapshot().state;
  assert.equal(state.editingId, 'saved-1');
  assert.deepEqual({ ...state.draft }, { title: 'Existing note', text: 'Existing body', category: 'work' });
});

test('a valid recovery waits for an in-flight checklist save to succeed', async () => {
  const { app, pendingRead, checklistSave } = await beginChecklistRace();
  pendingRead.resolve(validRecord());
  await app.flushMicrotasks();
  assert.deepEqual({ ...app.controller.getSnapshot().state.draft }, { title: '', text: '' }, 'restore waits while checklist persistence is saving');
  assert.equal(app.controller.getSnapshot().status, 'saving');
  checklistSave.resolve();
  await app.flushMicrotasks();
  assert.deepEqual({ ...app.controller.getSnapshot().state.draft }, { title: 'Recovered title', text: 'Recovered body', category: 'ideas' });
  assert.equal(app.controller.getSnapshot().state.notice, 'Recovered unsaved draft from this device.');
  assert.deepEqual(app.updateCalls.map(({ id, text }) => ({ id, text })), [{ id: 'check-1', text: '☑ Keep this item' }]);
});

test('a valid recovery waits for an in-flight checklist save to fail', async () => {
  const { app, pendingRead, checklistSave } = await beginChecklistRace();
  pendingRead.resolve(validRecord());
  await app.flushMicrotasks();
  checklistSave.reject(new Error('offline'));
  await app.flushMicrotasks();
  const snapshot = app.controller.getSnapshot();
  assert.equal(snapshot.status, 'ready');
  assert.match(snapshot.storageError, /Could not save this checklist/);
  assert.deepEqual({ ...snapshot.state.draft }, { title: 'Recovered title', text: 'Recovered body', category: 'ideas' });
  assert.equal(snapshot.state.notice, 'Recovered unsaved draft from this device.');
});

test('a recovery arriving after checklist save success restores normally', async () => {
  const { app, pendingRead, checklistSave } = await beginChecklistRace();
  checklistSave.resolve();
  await app.flushMicrotasks();
  assert.equal(app.controller.getSnapshot().status, 'ready');
  pendingRead.resolve(validRecord());
  await app.flushMicrotasks();
  assert.equal(app.controller.getSnapshot().state.draft.title, 'Recovered title');
});

test('a recovery arriving after checklist save failure restores normally', async () => {
  const { app, pendingRead, checklistSave } = await beginChecklistRace();
  checklistSave.reject(new Error('offline'));
  await app.flushMicrotasks();
  assert.equal(app.controller.getSnapshot().status, 'ready');
  pendingRead.resolve(validRecord());
  await app.flushMicrotasks();
  assert.equal(app.controller.getSnapshot().state.draft.title, 'Recovered title');
});

test('a true editor action supersedes a recovery waiting for checklist persistence', async () => {
  const { app, pendingRead, checklistSave } = await beginChecklistRace();
  pendingRead.resolve(validRecord());
  await app.flushMicrotasks();
  action(app.render(), '+ New note').props.onPress();
  checklistSave.resolve();
  await app.flushMicrotasks();
  const state = app.controller.getSnapshot().state;
  assert.equal(state.notice, 'Checklist updated.');
  assert.deepEqual({ ...state.draft }, { title: '', text: '' });
  assert.equal(app.draftHydrated, false);
});

test('empty category navigation invalidates a pending restore without hydrating or deleting its key', async () => {
  const pendingRead = deferred();
  const app = workspace({ reads: [pendingRead] });
  app.storage.value = validRecord();
  await startRead(app);
  labeled(app.render(), 'Open notes navigation').props.onPress();
  let tree = app.render();
  find(tree, element => element.props.label === 'Work' && typeof element.props.onPress === 'function').props.onPress();
  pendingRead.resolve(validRecord());
  await app.flushMicrotasks();
  assert.equal(app.controller.getSnapshot().state.notice, null);
  assert.deepEqual({ ...app.controller.getSnapshot().state.draft }, { title: '', text: '' });
  assert.match(text(app.render()), /Work/);
  assert.equal(app.draftHydrated, false);
  await app.advanceTimers(500);
  assert.equal(app.storage.value, validRecord());
  assert.equal(app.storage.removes.length, 0);
});

test('an unopposed valid recovery record restores normally after startup loading', async () => {
  const app = workspace({ reads: [validRecord()] });
  await startRead(app);
  await app.flushMicrotasks();
  const tree = app.render();
  const state = app.controller.getSnapshot().state;
  assert.deepEqual({ ...state.draft }, { title: 'Recovered title', text: 'Recovered body', category: 'ideas' });
  assert.equal(state.notice, 'Recovered unsaved draft from this device.');
  assert.equal(find(tree, element => element.type === 'TextInput' && element.props.accessibilityLabel === 'Note title (optional)').props.value, 'Recovered title');
  assert.equal(visibleDraftError(tree), false);
});

test('formatted recovery restores and persists its HTML alongside the visible text', async () => {
  const html = '<div><strong>Rich only</strong></div>';
  const app = workspace({ reads: [validRecord({ text: 'Rich only', html })] });
  await startRead(app);
  await app.flushMicrotasks();
  assert.deepEqual({ ...app.controller.getSnapshot().state.draft }, {
    title: 'Recovered title', text: 'Rich only', category: 'ideas', html,
  });
  await persistCurrentDraft(app);
  assert.equal(JSON.parse(app.storage.sets[0]).html, html);
  assert.equal(noteHtmlToText(JSON.parse(app.storage.sets[0]).html), 'Rich only');
});

test('Save waits for the rich editor snapshot before invoking the controller save', async () => {
  const content = deferred();
  const app = workspace({ contentReads: [content] });
  await startRead(app);
  typeDraft(app, { title: 'Flush title', body: 'stale editor state' });
  action(app.render(), 'Save note').props.onPress();
  assert.equal(app.saveCalls.length, 0, 'controller save must wait for getContent()');
  content.resolve({ text: 'flushed body', html: '<div><b>flushed body</b></div>' });
  await app.flushMicrotasks();
  assert.equal(app.saveCalls.length, 1);
  assert.deepEqual(app.saveCalls[0].draft, {
    title: 'Flush title', text: 'flushed body', category: 'personal', html: '<div><b>flushed body</b></div>',
  });
});

test('controller save remains pending until asynchronous device persistence resolves', async () => {
  const save = deferred();
  const app = workspace({ saveSaves: [save] });
  await startRead(app);
  typeDraft(app, { title: 'Pending save', body: 'Keep this draft' });
  action(app.render(), 'Save note').props.onPress();
  await app.flushMicrotasks();
  assert.equal(app.saveCalls.length, 1);
  assert.equal(app.controller.getSnapshot().status, 'saving');
  assert.equal(app.controller.getSnapshot().state.notes.length, 0);
  save.resolve();
  await app.flushMicrotasks();
  assert.equal(app.controller.getSnapshot().status, 'ready');
  assert.equal(app.controller.getSnapshot().state.notes.length, 1);
});

test('blank-record cleanup is debounced and a newer draft replaces cleanup with a write', async () => {
  const app = workspace({ reads: [validRecord({ title: '  ', text: '  ' })] });
  await startRead(app);
  await app.flushMicrotasks();
  app.render();
  assert.equal(app.timers.size, 1, 'blank recovery schedules cleanup through the normal write queue');
  typeDraft(app, { title: 'Newer title', body: 'Newer body' });
  await persistCurrentDraft(app);
  assert.equal(app.storage.removes.length, 0, 'superseded cleanup must not erase the newer draft');
  assert.equal(app.storage.sets.length, 1);
  assert.equal(JSON.parse(app.storage.sets[0]).title, 'Newer title');
  assert.equal(JSON.parse(app.storage.sets[0]).text, 'Newer body');
});

test('an unopposed malformed record is retained and reports an error; typing clears it and resumes persistence', async () => {
  const app = workspace({ reads: ['broken previous record'] });
  await startRead(app);
  await app.flushMicrotasks();
  app.render();
  assert.equal(app.draftHydrated, false);
  assert.match(app.draftStorageError, readError);
  assert.equal(app.storage.removes.length, 0);
  assert.equal(app.storage.value, null);
  typeDraft(app, { title: 'Replacement title', body: 'Replacement body' });
  assert.equal(app.draftStorageError, null);
  await persistCurrentDraft(app);
  assert.equal(app.storage.sets.length, 1);
  const saved = JSON.parse(app.storage.sets[0]);
  assert.equal(saved.title, 'Replacement title');
  assert.equal(saved.text, 'Replacement body');
  assert.equal(saved.category, 'personal');
});

test('choosing a category after a malformed read preserves the unreadable key and error until typing', async () => {
  const app = workspace({ reads: ['malformed retained record'] });
  app.storage.value = 'malformed retained record';
  await startRead(app);
  await app.flushMicrotasks();
  action(app.render(), '+ New note').props.onPress();
  chooseDraftCategory(app);
  assert.equal(app.draftHydrated, false);
  assert.match(app.draftStorageError, readError);
  assert.equal(app.storage.value, 'malformed retained record');
  await app.advanceTimers(500);
  assert.equal(app.storage.removes.length, 0);
  typeDraft(app, { title: 'After category', body: 'Replace malformed key' });
  assert.equal(app.draftStorageError, null);
  await persistCurrentDraft(app);
  assert.equal(JSON.parse(app.storage.sets.at(-1)).title, 'After category');
});

test('blank Save after a malformed read and category choice preserves the unreadable key', async () => {
  const app = workspace({ reads: ['malformed retained record'] });
  app.storage.value = 'malformed retained record';
  await startRead(app);
  await app.flushMicrotasks();
  action(app.render(), '+ New note').props.onPress();
  chooseDraftCategory(app);
  action(app.render(), 'Save note').props.onPress();
  await app.flushMicrotasks();
  assert.ok(app.controller.getSnapshot().state.error, 'empty Save must fail actual draft validation');
  await app.advanceTimers(500);
  assert.equal(app.draftHydrated, false);
  assert.match(app.draftStorageError, readError);
  assert.equal(app.storage.value, 'malformed retained record');
  assert.equal(app.storage.removes.length, 0);
});

test('choosing a category after a rejected read preserves the unreadable key and error until typing', async () => {
  const app = workspace({ reads: [Promise.reject(new Error('offline'))] });
  app.storage.value = 'previous unreadable record';
  await startRead(app);
  await app.flushMicrotasks();
  action(app.render(), '+ New note').props.onPress();
  chooseDraftCategory(app);
  assert.equal(app.draftHydrated, false);
  assert.match(app.draftStorageError, readError);
  assert.equal(app.storage.value, 'previous unreadable record');
  await app.advanceTimers(500);
  assert.equal(app.storage.removes.length, 0);
  typeDraft(app, { title: 'After category', body: 'Replace rejected key' });
  assert.equal(app.draftStorageError, null);
  await persistCurrentDraft(app);
  assert.equal(JSON.parse(app.storage.sets.at(-1)).title, 'After category');
});

test('an unopposed rejected read retains the old record, reports an error, then permits typing and persistence', async () => {
  const app = workspace({ reads: [Promise.reject(new Error('offline'))] });
  app.storage.value = 'previous unreadable record';
  await startRead(app);
  await app.flushMicrotasks();
  app.render();
  assert.equal(app.draftHydrated, false);
  assert.match(app.draftStorageError, readError);
  assert.equal(app.storage.removes.length, 0);
  assert.equal(app.storage.value, 'previous unreadable record');
  typeDraft(app, { title: 'After read error', body: 'Still editable' });
  assert.equal(app.draftStorageError, null);
  await persistCurrentDraft(app);
  assert.equal(JSON.parse(app.storage.sets.at(-1)).title, 'After read error');
});

test('a card tap during checklist persistence does not open a blank editor or supersede recovery', async () => {
  const { app, pendingRead, checklistSave } = await beginChecklistRace();
  const item = app.controller.getSnapshot().state.notes[0];
  const list = find(app.render(), element => element.type === 'FlatList');
  const card = list.props.renderItem({ item });
  labeled(card, 'Open Checklist').props.onPress();
  assert.equal(app.controller.getSnapshot().state.editingId, null);
  assert.ok(elements(app.render()).some(element => element.type === 'FlatList'));
  assert.equal(app.dispatchCalls.some(action => action.type === 'edit'), false);

  pendingRead.resolve(validRecord());
  await app.flushMicrotasks();
  checklistSave.resolve();
  await app.flushMicrotasks();
  assert.equal(app.controller.getSnapshot().state.draft.title, 'Recovered title');
  assert.equal(app.controller.getSnapshot().state.notice, 'Recovered unsaved draft from this device.');
});

test('a rich recovery record with inconsistent visible text is retained as unreadable, not silently replaced', async () => {
  const raw = validRecord({ text: 'Keep the original text', html: '<b>Different content</b>' });
  const app = workspace({ reads: [raw] });
  app.storage.value = raw;
  await startRead(app);
  await app.flushMicrotasks();
  assert.equal(app.draftHydrated, false);
  assert.match(app.draftStorageError, readError);
  assert.equal(app.controller.getSnapshot().state.draft.text, '');
  await app.advanceTimers(500);
  assert.equal(app.storage.value, raw);
  assert.equal(app.storage.removes.length, 0);
});

test('discarding through navigation invalidates an outstanding snapshot instead of saving an old draft', async () => {
  const content = deferred();
  const app = workspace({ contentReads: [content] });
  await startRead(app);
  typeDraft(app, { title: 'Old draft', body: 'Do not save after discard' });
  action(app.render(), 'Save note').props.onPress();
  const navigation = elements(app.render()).find(element => typeof element.type === 'function' && element.props.label === 'All notes' && element.props.detail);
  assert.ok(navigation);
  navigation.props.onPress();
  const prompt = app.alerts.find(alert => alert[0] === 'Discard unsaved changes?');
  assert.ok(prompt);
  prompt[2].find(button => button.text === 'Discard changes').onPress();
  content.resolve({ text: 'Do not save after discard', html: '<b>Do not save after discard</b>' });
  await app.flushMicrotasks();
  assert.equal(app.saveCalls.length, 0);
  assert.equal(app.controller.getSnapshot().state.notes.length, 0);
  assert.equal(app.controller.getSnapshot().state.draft.text, '');
});
