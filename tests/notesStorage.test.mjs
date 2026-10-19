import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES_STORAGE_KEY, createNotesStorage } from '../src/notesStorage.ts';

const date = '2026-10-19T18:00:00.000Z';
const note = (id, text = 'Body') => ({ id, title: '', text, category: 'general', createdAt: date, updatedAt: date });
function backend() {
  const data = new Map();
  let failKey = null;
  return {
    data,
    setFail(key) { failKey = key; },
    async getItem(key) { return data.get(key) ?? null; },
    async setItem(key, value) {
      if (key === failKey) throw Error('simulated write failure');
      if (new TextEncoder().encode(value).length > 1024 * 1024) throw Error('oversized entry');
      data.set(key, value);
    },
  };
}

test('empty storage loads an empty collection without writing', async () => {
  const db = backend();
  assert.deepEqual(await createNotesStorage(db).load(), []);
  assert.equal(db.data.size, 0);
});

test('saves many notes as individual bounded records with stable order', async () => {
  const db = backend();
  const notes = Array.from({ length: 800 }, (_, i) => note('id-' + i, 'x'.repeat(1400)));
  await createNotesStorage(db).save(notes);
  assert.deepEqual(await createNotesStorage(db).load(), notes);
  assert.equal(db.data.has(NOTES_STORAGE_KEY), false);
  const index = JSON.parse(db.data.get('@snapnotes-mobile/notes-index'));
  assert.equal(index.version, 2);
  assert.equal(index.ids.length, 800);
});

test('reads PR 3 legacy notes and migrates on next successful save without deleting legacy', async () => {
  const db = backend();
  const old = [note('old'), note('older')];
  const raw = JSON.stringify({ version: 1, notes: old });
  db.data.set(NOTES_STORAGE_KEY, raw);
  const store = createNotesStorage(db);
  assert.deepEqual(await store.load(), old);
  await store.save([note('new'), ...old]);
  assert.deepEqual(await createNotesStorage(db).load(), [note('new'), ...old]);
  assert.equal(db.data.get(NOTES_STORAGE_KEY), raw);
});

test('interrupted record writes do not switch committed index', async () => {
  const db = backend();
  const store = createNotesStorage(db);
  await store.save([note('safe')]);
  const originalIndex = db.data.get('@snapnotes-mobile/notes-index');
  const rejecting = { getItem: db.getItem, async setItem(key, value) {
    if (key.includes('/note/')) throw Error('disk full');
    await db.setItem(key, value);
  } };
  await assert.rejects(createNotesStorage(rejecting).save([note('changed')]), /disk full/);
  assert.equal(db.data.get('@snapnotes-mobile/notes-index'), originalIndex);
  assert.deepEqual(await store.load(), [note('safe')]);
});

test('failed index commit keeps prior generation readable', async () => {
  const db = backend();
  const store = createNotesStorage(db);
  await store.save([note('safe')]);
  db.setFail('@snapnotes-mobile/notes-index');
  await assert.rejects(store.save([note('next')]), /simulated/);
  assert.deepEqual(await store.load(), [note('safe')]);
});

test('corrupt index or missing note refuses to silently replace existing data', async () => {
  const db = backend();
  const store = createNotesStorage(db);
  await store.save([note('safe')]);
  const index = JSON.parse(db.data.get('@snapnotes-mobile/notes-index'));
  db.data.delete('@snapnotes-mobile/note/' + index.generation + '/0');
  await assert.rejects(store.load(), /missing/);
  assert.ok(db.data.has('@snapnotes-mobile/notes-index'));
});

test('rejects invalid input before writing any records', async () => {
  const db = backend();
  await assert.rejects(createNotesStorage(db).save([note('same'), note('same')]), /duplicate/);
  assert.equal(db.data.size, 0);
});

test('rejects corrupt legacy without changing it', async () => {
  const db = backend();
  db.data.set(NOTES_STORAGE_KEY, '{broken');
  await assert.rejects(createNotesStorage(db).load(), /malformed JSON/);
  assert.equal(db.data.get(NOTES_STORAGE_KEY), '{broken');
});
