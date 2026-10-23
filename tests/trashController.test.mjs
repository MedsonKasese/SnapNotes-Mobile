import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createNotesController } from '../src/notesController.ts';

const NOW = '2026-10-19T18:00:00.000Z';
const LATER = '2026-10-20T12:34:56.789Z';
// Loading now expires old Trash, so fixtures must not age with the real clock.
beforeEach(t => { t.mock.method(Date, 'now', () => Date.parse(NOW)); });

const note = (id, changes = {}) => ({
  id,
  title: 'A complete note',
  text: 'Saved body',
  category: 'general',
  createdAt: NOW,
  updatedAt: NOW,
  pinned: false,
  archived: false,
  deletedAt: null,
  ...changes,
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const operations = [
  {
    name: 'moveToTrash',
    initial: () => note('target', { archived: true }),
    invoke: (controller, id = 'target') => controller.moveToTrash(id, LATER),
    expected: (original, notes) => notes.map(item => item.id === original.id
      ? { ...item, deletedAt: LATER, archived: false, updatedAt: LATER } : item),
    notice: 'Note moved to Trash.',
  },
  {
    name: 'restoreFromTrash',
    initial: () => note('target', { deletedAt: '2026-10-18T10:00:00.000Z' }),
    invoke: (controller, id = 'target') => controller.restoreFromTrash(id, LATER),
    expected: (original, notes) => notes.map(item => item.id === original.id
      ? { ...item, deletedAt: null, archived: false, updatedAt: LATER } : item),
    notice: 'Note restored.',
  },
  {
    name: 'permanentlyDelete',
    initial: () => note('target', { deletedAt: '2026-10-18T10:00:00.000Z' }),
    invoke: (controller, id = 'target') => controller.permanentlyDelete(id),
    expected: (original, notes) => notes.filter(item => item.id !== original.id),
    notice: 'Note permanently deleted.',
  },
];

for (const operation of operations) {
  test(`${operation.name} persists first, ignores duplicate/in-flight operations, then publishes success`, async () => {
    const original = operation.initial();
    const companion = note('companion');
    const initialNotes = [original, companion];
    const write = deferred();
    let writes = 0;
    let persisted;
    const controller = createNotesController({
      async load() { return initialNotes; },
      save(notes) { writes++; persisted = notes; return write.promise; },
    });
    await controller.load();

    const pending = operation.invoke(controller);
    assert.equal(controller.getSnapshot().status, 'saving');
    assert.deepEqual(controller.getSnapshot().state.notes, initialNotes, 'optimistic state is not published before storage succeeds');
    assert.deepEqual(persisted, operation.expected(original, initialNotes), 'the complete next collection is sent to storage first');

    await operation.invoke(controller);
    await controller.moveToTrash('companion', LATER);
    assert.equal(writes, 1, 'duplicate and different in-flight operation calls are ignored');
    assert.deepEqual(controller.getSnapshot().state.notes, initialNotes);

    write.resolve();
    await pending;
    assert.equal(controller.getSnapshot().status, 'ready');
    assert.deepEqual(controller.getSnapshot().state.notes, operation.expected(original, initialNotes));
    assert.equal(controller.getSnapshot().state.notice, operation.notice);
    assert.equal(controller.getSnapshot().storageError, null);
  });
}

for (const operation of operations) {
  test(`${operation.name} rolls back on storage failure and can be retried`, async () => {
    const original = operation.initial();
    const companion = note('companion');
    const initialNotes = [original, companion];
    let fail = true;
    const writes = [];
    const controller = createNotesController({
      async load() { return initialNotes; },
      async save(notes) {
        writes.push(notes);
        if (fail) throw Error('disk full');
      },
    });
    await controller.load();

    await operation.invoke(controller);
    assert.equal(controller.getSnapshot().status, 'ready');
    assert.deepEqual(controller.getSnapshot().state.notes, initialNotes, 'failed operation retains the original complete notes');
    assert.match(controller.getSnapshot().storageError, /Could not/);
    assert.equal(controller.getSnapshot().state.notice, null);

    fail = false;
    await operation.invoke(controller);
    assert.equal(writes.length, 2, 'retry attempts storage again');
    assert.deepEqual(controller.getSnapshot().state.notes, operation.expected(original, initialNotes));
    assert.equal(controller.getSnapshot().storageError, null);
    assert.equal(controller.getSnapshot().state.notice, operation.notice);
  });
}

test('trash operations are no-ops for missing or inappropriate targets', async () => {
  const active = note('active');
  const trashed = note('trashed', { deletedAt: '2026-10-18T10:00:00.000Z' });
  let writes = 0;
  const controller = createNotesController({
    async load() { return [active, trashed]; },
    async save() { writes++; },
  });
  await controller.load();
  const before = controller.getSnapshot();

  await controller.moveToTrash('missing', LATER);
  await controller.moveToTrash('trashed', LATER);
  await controller.restoreFromTrash('missing', LATER);
  await controller.restoreFromTrash('active', LATER);
  await controller.permanentlyDelete('missing');
  await controller.permanentlyDelete('active');

  assert.equal(writes, 0);
  assert.deepEqual(controller.getSnapshot(), before);
});
