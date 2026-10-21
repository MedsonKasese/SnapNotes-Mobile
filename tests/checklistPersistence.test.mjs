import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotesController } from '../src/notesController.ts';
import { createNotesStorage } from '../src/notesStorage.ts';

const NOW = '2026-10-20T20:00:00.000Z';
const LATER = '2026-10-20T21:00:00.000Z';
const note = { id: 'checklist', title: 'Shopping', text: '☐ Milk\n☐ Bread', category: 'general', createdAt: NOW, updatedAt: NOW };

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('checklist changes wait for storage and block overlapping toggles and saves', async () => {
  const write = deferred();
  const writes = [];
  const controller = createNotesController({
    async load() { return [note]; },
    save(notes) { writes.push(notes); return write.promise; },
  });
  await controller.load();
  const pending = controller.updateNoteText(note.id, '☑ Milk\n☐ Bread', LATER);
  assert.equal(controller.getSnapshot().status, 'saving');
  assert.equal(controller.getSnapshot().state.notes[0], note);
  await controller.updateNoteText(note.id, '☐ Milk\n☑ Bread', LATER);
  await controller.save(LATER);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].text, '☑ Milk\n☐ Bread');
  write.resolve();
  await pending;
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.state.notes[0].text, '☑ Milk\n☐ Bread');
  assert.equal(snapshot.state.notes[0].updatedAt, LATER);
  assert.equal(snapshot.state.notes[0].createdAt, NOW);
  assert.equal(snapshot.state.editingId, null);
  assert.equal(snapshot.state.draft.text, '');
});

test('failed checklist writes retain saved data and allow a successful retry', async () => {
  let fail = true;
  const controller = createNotesController({
    async load() { return [note]; },
    async save() { if (fail) throw new Error('Disk full'); },
  });
  await controller.load();
  await controller.updateNoteText(note.id, '☑ Milk\n☐ Bread', LATER);
  assert.equal(controller.getSnapshot().state.notes[0], note);
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.match(controller.getSnapshot().storageError, /Could not save this checklist change/);
  fail = false;
  await controller.updateNoteText(note.id, '☑ Milk\n☐ Bread', LATER);
  assert.equal(controller.getSnapshot().storageError, null);
  assert.equal(controller.getSnapshot().state.notes[0].text, '☑ Milk\n☐ Bread');
});

test('check and uncheck survive fresh controllers using the real storage adapter', async () => {
  const data = new Map();
  const backend = {
    async getItem(key) { return data.get(key) ?? null; },
    async setItem(key, value) { data.set(key, value); },
  };
  const storage = createNotesStorage(backend);
  await storage.save([note]);
  const first = createNotesController(storage);
  await first.load();
  await first.updateNoteText(note.id, '☑ Milk\n☐ Bread', LATER);
  const second = createNotesController(createNotesStorage(backend));
  await second.load();
  assert.equal(second.getSnapshot().state.notes[0].text, '☑ Milk\n☐ Bread');
  await second.updateNoteText(note.id, note.text, LATER);
  const third = createNotesController(createNotesStorage(backend));
  await third.load();
  assert.equal(third.getSnapshot().state.notes[0].text, note.text);
});

test('missing checklist notes and toggles before hydration do not write', async () => {
  let writes = 0;
  const controller = createNotesController({
    async load() { return [note]; },
    async save() { writes++; },
  });
  await controller.updateNoteText(note.id, '☑ Milk', LATER);
  await controller.load();
  await controller.updateNoteText('missing', '☑ Milk', LATER);
  assert.equal(writes, 0);
  assert.equal(controller.getSnapshot().state.notes[0], note);
});
