import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotesController } from '../src/notesController.ts';
import { createNotesStorage, NOTES_STORAGE_KEY } from '../src/notesStorage.ts';

const NOW = '2026-10-19T18:00:00.000Z';
const LATER = '2026-10-19T19:00:00.000Z';
const note = { id: 'local-note-2', title: 'Original', text: 'Body', category: 'general', createdAt: NOW, updatedAt: NOW, pinned: false, archived: false };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function draft(controller, value = 'New note') {
  controller.dispatch({ type: 'change', field: 'text', value });
}
function memoryBackend() {
  const data = new Map();
  return { data, async getItem(key) { return data.get(key) ?? null; }, async setItem(key, value) { data.set(key, value); } };
}

test('startup blocks all edits/saves and never writes before hydration; duplicate loads coalesce', async () => {
  const read = deferred();
  let reads = 0, writes = 0;
  const controller = createNotesController({ load() { reads++; return read.promise; }, async save() { writes++; } });
  draft(controller);
  await controller.save(NOW);
  assert.equal(controller.getSnapshot().state.draft.text, '');
  const loading = controller.load();
  assert.equal(controller.load(), loading);
  assert.equal(reads, 1);
  assert.equal(controller.getSnapshot().status, 'loading');
  read.resolve([note]);
  await loading;
  assert.equal(writes, 0);
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.deepEqual(controller.getSnapshot().state.notes, [note]);
  await controller.load();
  assert.equal(reads, 1);
});

test('load failure protects existing storage and supports retry without editing an empty replacement', async () => {
  let fail = true, writes = 0;
  const controller = createNotesController({ async load() { if (fail) throw Error('offline disk'); return [note]; }, async save() { writes++; } });
  await controller.load();
  assert.equal(controller.getSnapshot().status, 'load-error');
  assert.match(controller.getSnapshot().storageError, /not been changed/);
  draft(controller);
  await controller.save(NOW);
  assert.equal(writes, 0);
  fail = false;
  await controller.load();
  assert.deepEqual(controller.getSnapshot().state.notes, [note]);
  assert.equal(controller.getSnapshot().storageError, null);
});

test('save acknowledgement waits for storage; duplicate saves and edits are blocked while pending', async () => {
  const write = deferred();
  let writes = 0;
  const controller = createNotesController({ async load() { return []; }, save() { writes++; return write.promise; } });
  await controller.load();
  draft(controller);
  const pending = controller.save(NOW);
  assert.equal(controller.getSnapshot().status, 'saving');
  assert.equal(controller.getSnapshot().state.notes.length, 0);
  assert.equal(controller.getSnapshot().state.notice, null);
  assert.equal(controller.getSnapshot().state.draft.text, 'New note');
  draft(controller, 'Blocked');
  controller.dispatch({ type: 'reset' });
  await controller.save(NOW);
  assert.equal(writes, 1);
  write.resolve();
  await pending;
  assert.equal(controller.getSnapshot().state.notes[0].text, 'New note');
  assert.equal(controller.getSnapshot().state.draft.text, '');
  assert.match(controller.getSnapshot().state.notice, /saved on this device/);
});

test('failed create keeps draft and saved collection, then retries successfully', async () => {
  let fail = true;
  const controller = createNotesController({ async load() { return [note]; }, async save() { if (fail) throw Error('full'); } });
  await controller.load();
  draft(controller);
  await controller.save(LATER);
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.deepEqual(controller.getSnapshot().state.notes, [note]);
  assert.equal(controller.getSnapshot().state.draft.text, 'New note');
  assert.equal(controller.getSnapshot().state.notice, null);
  assert.match(controller.getSnapshot().storageError, /draft is still here/);
  fail = false;
  await controller.save(LATER);
  assert.equal(controller.getSnapshot().state.notes.length, 2);
  assert.equal(controller.getSnapshot().storageError, null);
});

test('private-vault save failures show redacted security guidance and retain the editor draft', async () => {
  const controller = createNotesController({
    async load() { return []; },
    async save() { throw Error('Corrupt private vault index. do not show this detail'); },
  });
  await controller.load();
  draft(controller, 'Still available');
  await controller.save(LATER);
  const snapshot = controller.getSnapshot();
  assert.match(snapshot.storageError, /Private Notes storage could not be verified/);
  assert.doesNotMatch(snapshot.storageError, /do not show this detail/);
  assert.equal(snapshot.state.draft.text, 'Still available');
  assert.deepEqual(snapshot.state.notes, []);
});

test('failed edit retains editing target and original saved metadata until retry', async () => {
  let fail = true;
  const controller = createNotesController({ async load() { return [note]; }, async save() { if (fail) throw Error('full'); } });
  await controller.load();
  controller.dispatch({ type: 'edit', id: note.id });
  draft(controller, 'Changed');
  await controller.save(LATER);
  assert.equal(controller.getSnapshot().state.editingId, note.id);
  assert.equal(controller.getSnapshot().state.notes[0], note);
  assert.equal(controller.getSnapshot().state.draft.text, 'Changed');
  fail = false;
  await controller.save(LATER);
  assert.deepEqual(controller.getSnapshot().state.notes, [{ ...note, text: 'Changed', updatedAt: LATER }]);
});

test('invalid save, typing, cancel and selection never write; subscriptions can unsubscribe', async () => {
  let writes = 0, notifications = 0;
  const controller = createNotesController({ async load() { return [note]; }, async save() { writes++; } });
  const unsubscribe = controller.subscribe(() => notifications++);
  await controller.load();
  await controller.save(NOW);
  assert.ok(controller.getSnapshot().state.error);
  controller.dispatch({ type: 'edit', id: note.id });
  draft(controller, 'Unsaved');
  controller.dispatch({ type: 'reset' });
  assert.equal(writes, 0);
  assert.deepEqual(controller.getSnapshot().state.notes, [note]);
  assert.ok(notifications > 0);
  unsubscribe();
  const count = notifications;
  draft(controller);
  assert.equal(notifications, count);
});

test('fresh controller restores saved creates and edits across restarts without persisting drafts', async () => {
  const backend = memoryBackend();
  const first = createNotesController(createNotesStorage(backend));
  await first.load();
  draft(first, 'First saved');
  await first.save(NOW);
  const id = first.getSnapshot().state.notes[0].id;
  draft(first, 'Do not persist this draft');
  const second = createNotesController(createNotesStorage(backend));
  await second.load();
  assert.equal(second.getSnapshot().state.notes[0].text, 'First saved');
  assert.equal(second.getSnapshot().state.draft.text, '');
  draft(second, 'Second saved');
  await second.save(LATER);
  assert.notEqual(second.getSnapshot().state.notes[0].id, id);
  second.dispatch({ type: 'edit', id });
  draft(second, 'First edited');
  await second.save(LATER);
  const third = createNotesController(createNotesStorage(backend));
  await third.load();
  assert.deepEqual(third.getSnapshot().state.notes.map(n => n.text), ['Second saved', 'First edited']);
  assert.equal(third.getSnapshot().state.notes[1].id, id);
  assert.equal(third.getSnapshot().state.notes[1].createdAt, NOW);
  assert.equal(third.getSnapshot().state.notes[1].updatedAt, LATER);
});

test('archive and restore persist state and update timestamps', async () => {
  let saved;
  const controller = createNotesController({
    async load() { return [note]; },
    async save(notes) { saved = notes; },
  });
  await controller.load();
  await controller.setArchived(note.id, true, LATER);
  assert.equal(controller.getSnapshot().state.notes[0].archived, true);
  assert.equal(controller.getSnapshot().state.notes[0].updatedAt, LATER);
  assert.equal(saved[0].archived, true);
  assert.equal(controller.getSnapshot().state.notice, 'Note archived.');
  await controller.setArchived(note.id, false, NOW);
  assert.equal(controller.getSnapshot().state.notes[0].archived, false);
  assert.equal(saved[0].archived, false);
  assert.equal(controller.getSnapshot().state.notice, 'Note restored.');
});

test('failed archive write rolls back and keeps the note active', async () => {
  const controller = createNotesController({
    async load() { return [note]; },
    async save() { throw Error('disk full'); },
  });
  await controller.load();
  await controller.setArchived(note.id, true, LATER);
  assert.equal(controller.getSnapshot().state.notes[0].archived, false);
  assert.match(controller.getSnapshot().storageError, /Could not archive/);
});

test('corrupt and future-version storage stays byte-for-byte intact with saves blocked', async () => {
  for (const raw of ['{broken', JSON.stringify({ version: 2, notes: [note] })]) {
    const backend = memoryBackend();
    backend.data.set(NOTES_STORAGE_KEY, raw);
    const controller = createNotesController(createNotesStorage(backend));
    await controller.load();
    draft(controller);
    await controller.save(NOW);
    assert.equal(controller.getSnapshot().status, 'load-error');
    assert.equal(backend.data.get(NOTES_STORAGE_KEY), raw);
  }
});
