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
    'title', 'text', 'html', 'category', 'createdAt', 'updatedAt', 'pinned', 'tags', 'time', 'folderId',
    'reminderAt', 'reminderNotified', 'reminderRepeat', 'attachments', 'history',
  ]);
  assert.equal('reminderScheduleKey' in payload, false);
  assert.equal(payload.title, note.title);
  assert.equal(payload.html, note.html);
  assert.equal(payload.createdAt, note.createdAt);
  assert.equal(payload.updatedAt, note.updatedAt);
  assert.equal(payload.folderId, note.folderId);
  assert.equal(payload.pinned, note.pinned);
  assert.deepEqual(note, before);
});

test('reminder state moves only into the private payload and receives an opaque cancellation key', () => {
  const reminderAt = '2026-10-30T09:00:00.000Z';
  const reminderRepeat = { frequency: 'monthly', interval: 2, timeZone: 'Africa/Blantyre', anchorAt: reminderAt };
  const payload = buildMobilePrivatePayload({ ...note, reminderAt, reminderNotified: false, reminderRepeat });
  assert.equal(payload.reminderAt, reminderAt);
  assert.deepEqual(payload.reminderRepeat, reminderRepeat);
  assert.equal(payload.reminderNotified, false);
  assert.match(payload.reminderScheduleKey, /^private-reminder-[a-z0-9-]+$/);
  assert.equal(payload.reminderScheduleKey.includes(note.id), false);
  assert.equal(payload.reminderScheduleKey.includes(note.title), false);
  assert.equal(payload.reminderScheduleKey.includes(note.text), false);
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
