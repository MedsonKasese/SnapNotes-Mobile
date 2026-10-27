import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMobilePrivatePayload, assertPrivateMoveSafe } from '../src/privateMovePreparation.ts';

const note = {
  id: 'note-1', title: 'Sensitive title', text: 'Sensitive text',
  html: '<p>Sensitive text</p>', category: 'personal', folderId: 'folder-1',
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  pinned: false, archived: false, deletedAt: null,
};

test('private payload follows PWA field schema without mutating source', () => {
  const before = structuredClone(note);
  const payload = buildMobilePrivatePayload(note);
  assert.deepEqual(Object.keys(payload), [
    'title', 'text', 'html', 'category', 'pinned', 'tags', 'time', 'folderId',
    'reminderAt', 'reminderNotified', 'reminderRepeat', 'attachments', 'history',
  ]);
  assert.equal(payload.title, note.title);
  assert.equal(payload.html, note.html);
  assert.equal(payload.folderId, note.folderId);
  assert.equal(payload.pinned, note.pinned);
  assert.deepEqual(note, before);
});

test('preflight blocks duplicate vault records and missing or duplicate source notes', () => {
  assert.throws(() => assertPrivateMoveSafe([note], note.id, [note.id]), /already has/);
  assert.throws(() => assertPrivateMoveSafe([], note.id, []), /missing or duplicated/);
  assert.throws(() => assertPrivateMoveSafe([note, note], note.id, []), /missing or duplicated/);
});

test('archived and trashed notes require restoration before private migration', () => {
  assert.throws(() => assertPrivateMoveSafe([{ ...note, archived: true }], note.id, []), /Restore/);
  assert.throws(() => assertPrivateMoveSafe([{ ...note, deletedAt: '2026-01-02' }], note.id, []), /Restore/);
  assert.equal(assertPrivateMoveSafe([note], note.id, []).id, note.id);
});
