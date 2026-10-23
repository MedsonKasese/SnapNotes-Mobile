import test from 'node:test';
import assert from 'node:assert/strict';
import { initialNotesState, notesReducer, hasUnsavedChanges } from '../src/notes.ts';
import { createNotesStorage, NOTES_STORAGE_KEY } from '../src/notesStorage.ts';

const date = '2026-10-20T12:00:00.000Z';
function backend() {
  const data = new Map();
  return {
    data,
    async getItem(key) { return data.get(key) ?? null; },
    async setItem(key, value) { data.set(key, value); },
    async getAllKeys() { return [...data.keys()]; },
    async multiRemove(keys) { for (const key of keys) data.delete(key); },
  };
}
function savedNote(extra = {}) {
  return { id: 'rich', title: '', text: 'Body', category: 'general', createdAt: date, updatedAt: date, pinned: false, archived: false, deletedAt: null, ...extra };
}

test('format-only edits are dirty and survive save, reload, and another edit', async () => {
  const db = backend();
  const storage = createNotesStorage(db);
  const original = savedNote({ html: '<div>Body</div>' });
  await storage.save([original]);
  const loaded = await storage.load();
  let state = { ...initialNotesState(), notes: loaded };
  state = notesReducer(state, { type: 'edit', id: 'rich' });
  state = notesReducer(state, { type: 'rich-change', text: 'untrusted editor text', html: '<div><strong>Body</strong></div>' });
  assert.equal(state.draft.text, 'Body', 'visible note text comes from sanitized HTML');
  assert.equal(hasUnsavedChanges(state), true);
  state = notesReducer(state, { type: 'save', id: 'unused', now: '2026-10-21T12:00:00.000Z' });
  assert.equal(state.notes[0].html, '<div><strong>Body</strong></div>');
  await storage.save(state.notes);
  const restarted = createNotesStorage(db);
  assert.deepEqual((await restarted.load())[0], state.notes[0]);
  let editingAgain = notesReducer({ ...initialNotesState(), notes: await restarted.load() }, { type: 'edit', id: 'rich' });
  assert.equal(editingAgain.draft.html, '<div><strong>Body</strong></div>');
  editingAgain = notesReducer(editingAgain, { type: 'rich-change', text: 'Body', html: '<div><em>Body</em></div>' });
  assert.equal(hasUnsavedChanges(editingAgain), true);
});

test('legacy notes and generic plain-text edits do not acquire stale html keys', async () => {
  const db = backend();
  const legacy = savedNote();
  db.data.set(NOTES_STORAGE_KEY, JSON.stringify({ version: 1, notes: [legacy] }));
  const loaded = await createNotesStorage(db).load();
  assert.deepEqual(loaded, [legacy]);
  assert.equal(Object.hasOwn(loaded[0], 'html'), false);
  let state = { ...initialNotesState(), notes: [savedNote({ html: '<div><b>Body</b></div>' })] };
  state = notesReducer(state, { type: 'edit', id: 'rich' });
  assert.equal(state.draft.html, '<div><b>Body</b></div>');
  state = notesReducer(state, { type: 'change', field: 'text', value: 'Plain body' });
  assert.equal(Object.hasOwn(state.draft, 'html'), false);
  state = notesReducer(state, { type: 'save', id: 'unused', now: '2026-10-21T12:00:00.000Z' });
  assert.equal(state.notes[0].text, 'Plain body');
  assert.equal(Object.hasOwn(state.notes[0], 'html'), false, 'the original formatting is not accidentally merged back');
});

test('storage rejects invalid or oversized optional HTML and mismatched visible text', async () => {
  const storage = createNotesStorage(backend());
  await assert.rejects(storage.save([savedNote({ html: 42 })]), /html must be a string/);
  await assert.rejects(storage.save([savedNote({ html: '<div>' + 'x'.repeat(100_001) + '</div>', text: 'x'.repeat(100_001) })]), /100000 character limit/);
  await assert.rejects(storage.save([savedNote({ html: '<div>Different</div>' })]), /visible text does not match/);
});

test('storage sanitizes rich HTML before returning or persisting it', async () => {
  const db = backend();
  const storage = createNotesStorage(db);
  await storage.save([savedNote({ html: '<div onclick="x"><strong>Body</strong><script>evil()</script></div>' })]);
  const note = (await storage.load())[0];
  assert.equal(note.html, '<div><strong>Body</strong></div>');
  assert.equal(note.text, 'Body');
});
