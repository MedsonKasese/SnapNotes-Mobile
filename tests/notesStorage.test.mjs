import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES_STORAGE_KEY, createNotesStorage } from '../src/notesStorage.ts';

const CREATED_AT = '2025-01-02T03:04:05.000Z';
const UPDATED_AT = '2025-02-03T04:05:06.000Z';

function note(id, title, text, createdAt = CREATED_AT, updatedAt = createdAt) {
  return { id, category: 'general', title, text, createdAt, updatedAt };
}

function memoryBackend(initial = null) {
  let value = initial;
  const writes = [];
  return {
    writes,
    get value() { return value; },
    set value(nextValue) { value = nextValue; },
    async getItem(key) {
      assert.equal(key, NOTES_STORAGE_KEY);
      return value;
    },
    async setItem(key, nextValue) {
      assert.equal(key, NOTES_STORAGE_KEY);
      writes.push(nextValue);
      value = nextValue;
    },
  };
}

test('uses a stable namespaced key and returns an empty list when storage is missing', async () => {
  const backend = memoryBackend();
  assert.equal(NOTES_STORAGE_KEY, '@snapnotes-mobile/notes');
  assert.deepEqual(await createNotesStorage(backend).load(), []);
  assert.deepEqual(backend.writes, []);
});

test('round-trips ordered notes through a fresh instance, preserving unicode and metadata', async () => {
  const backend = memoryBackend();
  const original = [
    { ...note('new-id', '🌱 Café', 'こんにちは — body', CREATED_AT, UPDATED_AT), transient: 'omit me' },
    note('older-id', '', 'Second note', '2024-12-01T00:00:00Z'),
  ];

  await createNotesStorage(backend).save(original);
  const savedPayload = JSON.parse(backend.value);
  assert.deepEqual(savedPayload, {
    version: 1,
    notes: [
      note('new-id', '🌱 Café', 'こんにちは — body', CREATED_AT, UPDATED_AT),
      note('older-id', '', 'Second note', '2024-12-01T00:00:00Z'),
    ],
  });
  assert.deepEqual(await createNotesStorage(backend).load(), savedPayload.notes);

  backend.value = JSON.stringify({
    version: 1,
    futureTopLevelField: true,
    notes: [{ ...savedPayload.notes[0], futureNoteField: 'discard me' }, savedPayload.notes[1]],
  });
  assert.deepEqual(await createNotesStorage(backend).load(), savedPayload.notes);
});

test('saves an empty collection as a valid versioned payload', async () => {
  const backend = memoryBackend();
  await createNotesStorage(backend).save([]);
  assert.deepEqual(JSON.parse(backend.value), { version: 1, notes: [] });
  assert.deepEqual(await createNotesStorage(backend).load(), []);
});

const corruptPayloads = [
  ['malformed JSON', '{not json'],
  ['non-object payload', '[]'],
  ['missing version', JSON.stringify({ notes: [] })],
  ['unsupported version', JSON.stringify({ version: 2, notes: [] })],
  ['missing notes', JSON.stringify({ version: 1 })],
  ['non-array notes', JSON.stringify({ version: 1, notes: {} })],
  ['non-object note', JSON.stringify({ version: 1, notes: [null] })],
  ['missing note field', JSON.stringify({ version: 1, notes: [{ ...note('one', 'Title', 'Body'), text: undefined }] })],
  ['invalid category', JSON.stringify({ version: 1, notes: [{ ...note('one', 'Title', 'Body'), category: 'work' }] })],
  ['empty id', JSON.stringify({ version: 1, notes: [note('  ', 'Title', 'Body')] })],
  ['duplicate ids', JSON.stringify({ version: 1, notes: [note('same', 'One', ''), note('same', '', 'Two')] })],
  ['invalid timestamp', JSON.stringify({ version: 1, notes: [note('one', 'Title', 'Body', 'not-a-date')] })],
  ['impossible calendar date', JSON.stringify({ version: 1, notes: [note('one', 'Title', 'Body', '2025-02-30T00:00:00Z')] })],
  ['empty draft', JSON.stringify({ version: 1, notes: [note('one', '  ', '\n\t')] })],
  ['oversize draft', JSON.stringify({ version: 1, notes: [note('one', '', 'x'.repeat(1501))] })],
];

for (const [label, raw] of corruptPayloads) {
  test(`rejects ${label} without overwriting stored data`, async () => {
    const backend = memoryBackend(raw);
    await assert.rejects(createNotesStorage(backend).load());
    assert.equal(backend.value, raw);
    assert.deepEqual(backend.writes, []);
  });
}

test('validates an entire collection before saving and leaves storage untouched on invalid input', async () => {
  const existing = JSON.stringify({ version: 1, notes: [note('saved', 'Keep', 'Stored')] });
  const backend = memoryBackend(existing);
  const invalid = [note('first', 'Valid', 'Note'), note('second', '', '')];
  await assert.rejects(createNotesStorage(backend).save(invalid), /Write a title or note before saving/);
  assert.equal(backend.value, existing);
  assert.deepEqual(backend.writes, []);
});

test('propagates backend read and write rejections without masking them', async () => {
  const readError = new Error('read failed');
  const readBackend = { getItem: async () => { throw readError; }, setItem: async () => {} };
  await assert.rejects(createNotesStorage(readBackend).load(), error => error === readError);

  const writeError = new Error('write failed');
  const writeBackend = { getItem: async () => null, setItem: async () => { throw writeError; } };
  await assert.rejects(createNotesStorage(writeBackend).save([note('one', 'Title', 'Body')]), error => error === writeError);
});
