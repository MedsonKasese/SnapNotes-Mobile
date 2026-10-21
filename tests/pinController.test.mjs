import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotesController } from '../src/notesController.ts';
import { createNotesStorage } from '../src/notesStorage.ts';

const NOW = '2026-10-19T18:00:00.000Z';
const LATER = '2026-10-19T19:00:00.000Z';
const note = { id: 'original', title: 'Original', text: 'Body', category: 'general', createdAt: NOW, updatedAt: NOW, pinned: false };
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function draft(controller, value) {
  controller.dispatch({ type: 'change', field: 'text', value });
}

test('pin and unpin persist across restarts while preserving content and creation metadata', async () => {
  const data = new Map();
  const backend = { async getItem(key) { return data.get(key) ?? null; }, async setItem(key, value) { data.set(key, value); } };
  const first = createNotesController(createNotesStorage(backend));
  await first.load();
  draft(first, 'Saved body');
  await first.save(NOW);
  const original = first.getSnapshot().state.notes[0];
  await first.togglePin(original.id, LATER);
  assert.deepEqual(first.getSnapshot().state.notes[0], { ...original, pinned: true, updatedAt: LATER });
  assert.equal(first.getSnapshot().state.notice, 'Note pinned.');

  const second = createNotesController(createNotesStorage(backend));
  await second.load();
  assert.deepEqual(second.getSnapshot().state.notes, first.getSnapshot().state.notes);
  await second.togglePin(original.id, NOW);
  assert.equal(second.getSnapshot().state.notice, 'Note unpinned.');
  const third = createNotesController(createNotesStorage(backend));
  await third.load();
  assert.deepEqual(third.getSnapshot().state.notes, [{ ...original, pinned: false, updatedAt: NOW }]);
});

test('pin acknowledgement waits for storage and blocks competing writes and draft edits', async () => {
  const write = deferred();
  const other = { ...note, id: 'other' };
  let writes = 0, saved;
  const controller = createNotesController({
    async load() { return [note, other]; },
    save(notes) { writes++; saved = notes; return write.promise; },
  });
  await controller.load();
  controller.dispatch({ type: 'edit', id: note.id });
  draft(controller, 'Unsaved draft');
  const previous = controller.getSnapshot().state;
  const pending = controller.togglePin(note.id, LATER);
  assert.equal(controller.getSnapshot().status, 'saving');
  assert.equal(controller.getSnapshot().state, previous);
  assert.deepEqual(saved, [{ ...note, pinned: true, updatedAt: LATER }, other]);
  assert.equal(saved[1], other);
  draft(controller, 'Blocked edit');
  await controller.togglePin(note.id, LATER);
  await controller.updateNoteText(note.id, 'Blocked checklist', LATER);
  await controller.save(LATER);
  assert.equal(writes, 1);
  write.resolve();
  await pending;
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.equal(controller.getSnapshot().state.draft, previous.draft);
  assert.equal(controller.getSnapshot().state.editingId, note.id);
  assert.equal(note.pinned, false);
  assert.equal(note.updatedAt, NOW);
});

test('failed pin writes retain saved notes and unsaved drafts, then allow retry', async () => {
  let fail = true;
  const controller = createNotesController({
    async load() { return [note]; },
    async save() { if (fail) throw Error('disk full'); },
  });
  await controller.load();
  draft(controller, 'Keep this draft');
  const previous = controller.getSnapshot().state;
  await controller.togglePin(note.id, LATER);
  assert.equal(controller.getSnapshot().state, previous);
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.match(controller.getSnapshot().storageError, /pin change.*not been changed/);
  fail = false;
  await controller.togglePin(note.id, LATER);
  assert.equal(controller.getSnapshot().state.notes[0].pinned, true);
  assert.equal(controller.getSnapshot().state.draft, previous.draft);
  assert.equal(controller.getSnapshot().storageError, null);
});

test('pinning is blocked before hydration and after load failure; missing IDs never write', async () => {
  let writes = 0;
  const controller = createNotesController({
    async load() { throw Error('unreadable'); },
    async save() { writes++; },
  });
  await controller.togglePin(note.id, LATER);
  await controller.load();
  await controller.togglePin(note.id, LATER);
  assert.equal(writes, 0);
  assert.equal(controller.getSnapshot().status, 'load-error');

  const ready = createNotesController({ async load() { return [note]; }, async save() { writes++; } });
  await ready.load();
  const previous = ready.getSnapshot().state;
  await ready.togglePin('missing', LATER);
  assert.equal(writes, 0);
  assert.equal(ready.getSnapshot().state.notes, previous.notes);
  assert.match(ready.getSnapshot().state.error, /could not be found/);
});
