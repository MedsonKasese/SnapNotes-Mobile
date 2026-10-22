import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotesController, isExpiredTrash, TRASH_RETENTION_DAYS } from '../src/notesController.ts';

const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const note = (id, deletedAt = null) => ({
  id, title: id, text: '', category: 'general', pinned: false, archived: false,
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z', deletedAt,
});
const old = new Date(NOW - 16 * 86400000).toISOString();
const recent = new Date(NOW - 14 * 86400000).toISOString();

test('15-day cutoff only expires valid deleted notes', () => {
  assert.equal(TRASH_RETENTION_DAYS, 15);
  assert.equal(isExpiredTrash(note('old', old), NOW), true);
  assert.equal(isExpiredTrash(note('recent', recent), NOW), false);
  assert.equal(isExpiredTrash(note('active'), NOW), false);
  assert.equal(isExpiredTrash(note('bad', 'not-a-date'), NOW), false);
  assert.equal(isExpiredTrash(note('boundary', new Date(NOW - 15 * 86400000).toISOString()), NOW), true);
});

test('empty Trash saves only active notes and retains them', async () => {
  let stored = [note('active'), note('deleted', recent)];
  const controller = createNotesController({
    async load() { return stored; },
    async save(notes) { stored = notes; },
  });
  await controller.load();
  await controller.emptyTrash();
  assert.deepEqual(stored.map(n => n.id), ['active']);
  assert.equal(controller.getSnapshot().state.notice, 'Trash emptied.');
});

test('failed Empty Trash write retains original records', async () => {
  const stored = [note('active'), note('deleted', recent)];
  const controller = createNotesController({
    async load() { return stored; },
    async save() { throw new Error('disk full'); },
  });
  await controller.load();
  await controller.emptyTrash();
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.deepEqual(controller.getSnapshot().state.notes, stored);
  assert.match(controller.getSnapshot().storageError, /Could not empty Trash/);
});

test('loading old trash auto-purges without touching recent trash', async () => {
  const stored = [note('active'), note('expired', '2020-01-01T00:00:00.000Z'), note('recent', new Date().toISOString())];
  let persisted;
  const controller = createNotesController({
    async load() { return stored; },
    async save(notes) { persisted = notes; },
  });
  await controller.load();
  assert.deepEqual(persisted.map(n => n.id), ['active', 'recent']);
  assert.deepEqual(controller.getSnapshot().state.notes, persisted);
});

test('failed expiry cleanup does not hide notes', async () => {
  const stored = [note('active'), note('expired', '2020-01-01T00:00:00.000Z')];
  const controller = createNotesController({
    async load() { return stored; },
    async save() { throw new Error('storage error'); },
  });
  await controller.load();
  assert.deepEqual(controller.getSnapshot().state.notes, stored);
  assert.match(controller.getSnapshot().storageError, /Expired Trash/);
});
