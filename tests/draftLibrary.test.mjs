import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDraftLibrary, upsertDraft, removeDraft, newDraftId } from '../src/draftLibrary.ts';
const first = { id: 'draft-1', title: 'First', text: 'Hello', category: 'general', editingId: null, savedAt: '2026-10-23T14:00:00.000Z' };
test('empty and valid draft libraries load safely', () => {
  assert.deepEqual(parseDraftLibrary(null), []);
  assert.deepEqual(parseDraftLibrary(JSON.stringify([first])), [first]);
});
test('malformed or duplicate records are rejected instead of silently dropped', () => {
  assert.throws(() => parseDraftLibrary('{'));
  assert.throws(() => parseDraftLibrary(JSON.stringify([first, first])));
  assert.throws(() => parseDraftLibrary(JSON.stringify([{ ...first, savedAt: 'invalid' }])));
});
test('upsert preserves other drafts and moves new drafts to the front', () => {
  const second = { ...first, id: 'draft-2', title: 'Second' };
  const all = upsertDraft([first], second);
  assert.deepEqual(all, [second, first]);
  assert.deepEqual(upsertDraft(all, { ...first, text: 'Edited' }), [second, { ...first, text: 'Edited' }]);
  assert.deepEqual(removeDraft(all, second.id), [first]);
});
test('draft IDs remain unique', () => {
  const timestamp = first.savedAt;
  const id = newDraftId([], timestamp);
  assert.notEqual(newDraftId([{ ...first, id }], timestamp), id);
});
