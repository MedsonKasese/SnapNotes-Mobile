import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createNotesController, isExpiredTrash, TRASH_RETENTION_DAYS } from '../src/notesController.ts';

const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const DAY_MS = 86400000;
beforeEach(t => { t.mock.method(Date, 'now', () => NOW); });

const note = (id, deletedAt = null) => ({
  id, title: id, text: '', category: 'general', pinned: false, archived: false,
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z', deletedAt,
});
const old = new Date(NOW - 16 * DAY_MS).toISOString();
const recent = new Date(NOW - 14 * DAY_MS).toISOString();

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('15-day cutoff only expires valid deleted notes, including the exact boundary', () => {
  assert.equal(TRASH_RETENTION_DAYS, 15);
  assert.equal(isExpiredTrash(note('old', old), NOW), true);
  assert.equal(isExpiredTrash(note('recent', recent), NOW), false);
  assert.equal(isExpiredTrash(note('active'), NOW), false);
  assert.equal(isExpiredTrash(note('bad', 'not-a-date'), NOW), false);
  assert.equal(isExpiredTrash(note('future', new Date(NOW + DAY_MS).toISOString()), NOW), false);
  const cutoff = NOW - 15 * DAY_MS;
  assert.equal(isExpiredTrash(note('just-before', new Date(cutoff - 1).toISOString()), NOW), true);
  assert.equal(isExpiredTrash(note('boundary', new Date(cutoff).toISOString()), NOW), true);
  assert.equal(isExpiredTrash(note('just-after', new Date(cutoff + 1).toISOString()), NOW), false);
});

test('empty Trash saves only active and archived notes and retains them unchanged', async () => {
  const archived = { ...note('archived'), archived: true, pinned: true };
  let stored = [note('active'), archived, note('deleted', recent)];
  const controller = createNotesController({
    async load() { return stored; },
    async save(notes) { stored = notes; },
  });
  await controller.load();
  await controller.emptyTrash();
  assert.deepEqual(stored, [note('active'), archived]);
  assert.deepEqual(controller.getSnapshot().state.notes, stored);
  assert.equal(controller.getSnapshot().state.notice, 'Trash emptied.');
});

test('failed Empty Trash write retains original records and permits retry', async () => {
  const stored = [note('active'), note('deleted', recent)];
  let fail = true;
  const writes = [];
  const controller = createNotesController({
    async load() { return stored; },
    async save(notes) {
      writes.push(notes);
      if (fail) throw new Error('disk full');
    },
  });
  await controller.load();
  await controller.emptyTrash();
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.deepEqual(controller.getSnapshot().state.notes, stored);
  assert.match(controller.getSnapshot().storageError, /Could not empty Trash/);
  assert.equal(controller.getSnapshot().state.notice, null);

  fail = false;
  await controller.emptyTrash();
  assert.equal(writes.length, 2);
  assert.deepEqual(controller.getSnapshot().state.notes, [note('active')]);
  assert.equal(controller.getSnapshot().storageError, null);
  assert.equal(controller.getSnapshot().state.notice, 'Trash emptied.');
});

test('loading old trash auto-purges without touching active, archived, or recent notes', async () => {
  const archived = { ...note('archived'), archived: true };
  const stored = [note('active'), archived, note('expired', old), note('recent', recent)];
  let persisted;
  const controller = createNotesController({
    async load() { return stored; },
    async save(notes) { persisted = notes; },
  });
  await controller.load();
  assert.deepEqual(persisted, [stored[0], archived, stored[3]]);
  assert.deepEqual(controller.getSnapshot().state.notes, persisted);
});

test('failed expiry cleanup does not hide notes', async () => {
  const stored = [note('active'), note('expired', old)];
  const controller = createNotesController({
    async load() { return stored; },
    async save() { throw new Error('storage error'); },
  });
  await controller.load();
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.deepEqual(controller.getSnapshot().state.notes, stored);
  assert.match(controller.getSnapshot().storageError, /Expired Trash/);
});

test('expiry cleanup stays loading until persisted and blocks conflicting writes', async () => {
  const stored = [note('active'), note('expired', old), note('recent', recent)];
  const write = deferred();
  const writes = [];
  let loads = 0;
  const controller = createNotesController({
    async load() { loads++; return stored; },
    save(notes) { writes.push(notes); return write.promise; },
  });
  const loading = controller.load();
  await Promise.resolve();
  assert.equal(controller.getSnapshot().status, 'loading');
  assert.deepEqual(controller.getSnapshot().state.notes, [], 'results remain hidden until cleanup persists');
  assert.deepEqual(writes, [[stored[0], stored[2]]]);
  assert.equal(controller.load(), loading, 'concurrent loads share the cleanup promise');
  await controller.emptyTrash();
  await controller.togglePin('active', new Date(NOW).toISOString());
  controller.dispatch({ type: 'change', field: 'title', value: 'Ignored while loading' });
  assert.equal(writes.length, 1);
  assert.equal(controller.getSnapshot().state.draft.title, '');

  write.resolve();
  await loading;
  assert.equal(loads, 1);
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.deepEqual(controller.getSnapshot().state.notes, [stored[0], stored[2]]);
});

test('loading unexpired or invalid-date Trash does not rewrite storage', async () => {
  const stored = [note('active'), note('recent', recent), note('invalid', 'not-a-date')];
  let writes = 0;
  const controller = createNotesController({
    async load() { return stored; },
    async save() { writes++; },
  });
  await controller.load();
  assert.equal(writes, 0);
  assert.deepEqual(controller.getSnapshot().state.notes, stored);
  assert.equal(controller.getSnapshot().storageError, null);
});

test('Empty Trash persists first, blocks duplicate writes, and preserves an editor draft', async () => {
  const stored = [note('active'), note('deleted', recent)];
  const write = deferred();
  let writes = 0;
  const controller = createNotesController({
    async load() { return stored; },
    save() { writes++; return write.promise; },
  });
  await controller.load();
  controller.dispatch({ type: 'change', field: 'title', value: 'Unsaved draft' });
  const previous = controller.getSnapshot().state;
  const pending = controller.emptyTrash();
  assert.equal(controller.getSnapshot().status, 'saving');
  assert.equal(controller.getSnapshot().state, previous);
  await controller.emptyTrash();
  await controller.moveToTrash('active', new Date(NOW).toISOString());
  assert.equal(writes, 1);

  write.resolve();
  await pending;
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.deepEqual(controller.getSnapshot().state.notes, [stored[0]]);
  assert.deepEqual(controller.getSnapshot().state.draft, previous.draft);
});

test('Empty Trash is a no-op before loading and when there are no trashed notes', async () => {
  let writes = 0;
  const controller = createNotesController({
    async load() { return [note('active')]; },
    async save() { writes++; },
  });
  await controller.emptyTrash();
  await controller.load();
  const previous = controller.getSnapshot();
  await controller.emptyTrash();
  assert.equal(writes, 0);
  assert.equal(controller.getSnapshot(), previous);
});
