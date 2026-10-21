import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES_STORAGE_KEY, createNotesStorage } from '../src/notesStorage.ts';

const date = '2026-10-19T18:00:00.000Z';
const note = (id, text = 'Body') => ({ id, title: '', text, category: 'general', createdAt: date, updatedAt: date, pinned: false });
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
    async getAllKeys() { return [...data.keys()]; },
    async multiRemove(keys) { for (const key of keys) data.delete(key); },
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
  const rejecting = {
    getItem: db.getItem,
    setItem: async (key, value) => {
      if (key.includes('/note/')) throw Error('disk full');
      await db.setItem(key, value);
    },
    getAllKeys: db.getAllKeys,
    multiRemove: db.multiRemove,
  };
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


test('repeated saves retain only the active generation instead of growing storage forever', async () => {
  const db = backend();
  const store = createNotesStorage(db);
  await store.save([note('one')]);
  await store.save([note('one', 'edited')]);
  await store.save([note('one', 'edited again')]);
  assert.deepEqual(await store.load(), [note('one', 'edited again')]);
  const noteKeys = [...db.data.keys()].filter(key => key.startsWith('@snapnotes-mobile/note/'));
  assert.equal(noteKeys.length, 1);
  assert.equal(db.data.size, 2); // one active note record and the committed index
});

test('startup cleanup removes orphan generations but preserves the active generation and legacy snapshot', async () => {
  const db = backend();
  const legacy = JSON.stringify({ version: 1, notes: [note('legacy')] });
  db.data.set(NOTES_STORAGE_KEY, legacy);
  const store = createNotesStorage(db);
  await store.save([note('active')]);
  const index = JSON.parse(db.data.get('@snapnotes-mobile/notes-index'));
  db.data.set('@snapnotes-mobile/note/orphan-generation/0', JSON.stringify(note('orphan')));
  assert.deepEqual(await store.load(), [note('active')]);
  assert.equal(db.data.has('@snapnotes-mobile/note/orphan-generation/0'), false);
  assert.equal(db.data.has('@snapnotes-mobile/note/' + index.generation + '/0'), true);
  assert.equal(db.data.get(NOTES_STORAGE_KEY), legacy);
});

test('cleanup failure does not report a committed save as failed', async () => {
  const db = backend();
  const store = createNotesStorage({
    getItem: db.getItem,
    setItem: db.setItem,
    getAllKeys: async () => { throw Error('cleanup unavailable'); },
    multiRemove: db.multiRemove,
  });
  await assert.doesNotReject(store.save([note('committed')]));
  assert.deepEqual(await store.load(), [note('committed')]);
});

test('a failed save does not block a later successful retry', async () => {
  const db = backend();
  const store = createNotesStorage(db);
  await store.save([note('safe')]);
  db.setFail('@snapnotes-mobile/notes-index');
  await assert.rejects(store.save([note('failed')]), /simulated/);
  db.setFail(null);
  await store.save([note('recovered')]);
  assert.deepEqual(await store.load(), [note('recovered')]);
  assert.equal([...db.data.keys()].filter(key => key.startsWith('@snapnotes-mobile/note/')).length, 1);
});

test('invalid saves return rejected promises without blocking a valid retry', async () => {
  const db = backend();
  const store = createNotesStorage(db);
  let pending;
  assert.doesNotThrow(() => { pending = store.save([note('duplicate'), note('duplicate')]); });
  assert.ok(pending instanceof Promise);
  await assert.rejects(pending, /duplicate/);
  assert.equal(db.data.size, 0);
  await store.save([note('valid')]);
  assert.deepEqual(await store.load(), [note('valid')]);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

for (const separateInstance of [false, true]) {
  test(`load waits for an in-flight save${separateInstance ? ' across storage instances' : ''}`, async () => {
    const db = backend();
    const writer = createNotesStorage(db);
    const reader = separateInstance ? createNotesStorage(db) : writer;
    await writer.save([note('old')]);
    const entered = deferred();
    const release = deferred();
    const setItem = db.setItem;
    db.setItem = async (key, value) => {
      await setItem(key, value);
      if (key.startsWith('@snapnotes-mobile/note/')) {
        entered.resolve();
        await release.promise;
      }
    };
    const saving = writer.save([note('new')]);
    await entered.promise;
    const loading = reader.load();
    // Let the reader run if it is not correctly queued behind the writer.
    await new Promise(resolve => setImmediate(resolve));
    release.resolve();
    await saving;
    assert.deepEqual(await loading, [note('new')]);
    assert.deepEqual(await writer.load(), [note('new')]);
  });
}

test('a save waits for a load and its cleanup to finish', async () => {
  const db = backend();
  const store = createNotesStorage(db);
  await store.save([note('old')]);
  const entered = deferred();
  const release = deferred();
  const getAllKeys = db.getAllKeys;
  let pause = true;
  db.getAllKeys = async () => {
    if (pause) {
      pause = false;
      entered.resolve();
      await release.promise;
    }
    return getAllKeys();
  };
  const loading = store.load();
  await entered.promise;
  const saving = createNotesStorage(db).save([note('new')]);
  await new Promise(resolve => setImmediate(resolve));
  release.resolve();
  assert.deepEqual(await loading, [note('old')]);
  await saving;
  assert.deepEqual(await store.load(), [note('new')]);
});

test('concurrent saves across instances commit in invocation order and snapshot input', async () => {
  const db = backend();
  const first = createNotesStorage(db);
  const second = createNotesStorage(db);
  const entered = deferred();
  const release = deferred();
  const setItem = db.setItem;
  let pause = true;
  db.setItem = async (key, value) => {
    if (pause && key.startsWith('@snapnotes-mobile/note/')) {
      pause = false;
      entered.resolve();
      await release.promise;
    }
    await setItem(key, value);
  };
  const savingFirst = first.save([note('first')]);
  await entered.promise;
  const input = [note('second')];
  const savingSecond = second.save(input);
  input[0].text = 'mutated after save';
  await new Promise(resolve => setImmediate(resolve));
  release.resolve();
  await Promise.all([savingFirst, savingSecond]);
  assert.deepEqual(await first.load(), [note('second')]);
  assert.equal([...db.data.keys()].filter(key => key.startsWith('@snapnotes-mobile/note/')).length, 1);
});

test('failed loads do not block later recovery', async () => {
  const db = backend();
  const store = createNotesStorage(db);
  const original = db.getItem;
  db.getItem = async () => { throw Error('read unavailable'); };
  await assert.rejects(store.load(), /read unavailable/);
  db.getItem = original;
  await store.save([note('recovered')]);
  assert.deepEqual(await store.load(), [note('recovered')]);
});

for (const legacy of [false, true]) {
  test(`startup removes failed first-save records with ${legacy ? 'validated legacy notes' : 'empty storage'}`, async () => {
    const db = backend();
    const snapshot = JSON.stringify({ version: 1, notes: [note('legacy')] });
    if (legacy) db.data.set(NOTES_STORAGE_KEY, snapshot);
    db.data.set('@another-app/keep', 'unrelated');
    db.setFail('@snapnotes-mobile/notes-index');
    const store = createNotesStorage(db);
    await assert.rejects(store.save([note('uncommitted')]), /simulated/);
    assert.ok([...db.data.keys()].some(key => key.startsWith('@snapnotes-mobile/note/')));
    assert.deepEqual(await store.load(), legacy ? [note('legacy')] : []);
    assert.equal([...db.data.keys()].some(key => key.startsWith('@snapnotes-mobile/note/')), false);
    assert.equal(db.data.get('@another-app/keep'), 'unrelated');
    if (legacy) assert.equal(db.data.get(NOTES_STORAGE_KEY), snapshot);
  });
}

for (const corruptKey of ['@snapnotes-mobile/notes-index', NOTES_STORAGE_KEY]) {
  test(`corruption at ${corruptKey} never triggers destructive cleanup`, async () => {
    const db = backend();
    db.data.set(corruptKey, '{broken');
    db.data.set('@snapnotes-mobile/note/orphan/0', JSON.stringify(note('recovery')));
    const before = [...db.data];
    await assert.rejects(createNotesStorage(db).load());
    assert.deepEqual([...db.data], before);
  });
}

test('record-removal failures leave committed data readable and later cleanup retries', async () => {
  const db = backend();
  const store = createNotesStorage(db);
  await store.save([note('old')]);
  const remove = db.multiRemove;
  db.multiRemove = async () => { throw Error('cannot delete'); };
  await assert.doesNotReject(store.save([note('new')]));
  assert.deepEqual(await store.load(), [note('new')]);
  assert.equal([...db.data.keys()].filter(key => key.startsWith('@snapnotes-mobile/note/')).length, 2);
  db.multiRemove = remove;
  assert.deepEqual(await store.load(), [note('new')]);
  assert.equal([...db.data.keys()].filter(key => key.startsWith('@snapnotes-mobile/note/')).length, 1);
});

test('index size limits count UTF-8 bytes rather than UTF-16 code units', async () => {
  const db = backend();
  const oversizedId = 'é'.repeat(600_000);
  assert.ok(oversizedId.length < 1024 * 1024);
  await assert.rejects(createNotesStorage(db).save([note(oversizedId)]), /Notes index exceeds/);
  assert.equal(db.data.size, 0);
});


test('supports every category and defaults legacy records without a category to General', async () => {
  const db = backend();
  const categories = ['general', 'work', 'personal', 'ideas', 'important'];
  const categorized = categories.map((category, index) => ({ ...note('category-' + index), category }));
  await createNotesStorage(db).save(categorized);
  assert.deepEqual(await createNotesStorage(db).load(), categorized);

  const legacyDb = backend();
  const legacyRecord = { ...note('legacy-no-category') };
  delete legacyRecord.category;
  legacyDb.data.set(NOTES_STORAGE_KEY, JSON.stringify({ version: 1, notes: [legacyRecord] }));
  assert.deepEqual(await createNotesStorage(legacyDb).load(), [note('legacy-no-category')]);
});


test('pinned state persists and legacy records without pinned default to unpinned', async () => {
  const db = backend();
  const notes = [{ ...note('pinned'), pinned: true }, note('not-pinned')];
  await createNotesStorage(db).save(notes);
  assert.deepEqual(await createNotesStorage(db).load(), notes);

  const legacyDb = backend();
  const legacyRecord = { ...note('legacy') };
  delete legacyRecord.pinned;
  delete legacyRecord.category;
  legacyDb.data.set(NOTES_STORAGE_KEY, JSON.stringify({ version: 1, notes: [legacyRecord] }));
  assert.deepEqual(await createNotesStorage(legacyDb).load(), [note('legacy')]);
});

test('rejects invalid pinned values without committing a save', async () => {
  const db = backend();
  await assert.rejects(createNotesStorage(db).save([{ ...note('bad'), pinned: 'yes' }]), /pinned must be a boolean/);
  assert.equal(db.data.size, 0);
});
