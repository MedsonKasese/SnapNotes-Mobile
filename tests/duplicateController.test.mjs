import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotesController } from '../src/notesController.ts';
import { MAX_NOTE_CHARACTERS } from '../src/notes.ts';
import { createPrivateWriteCoordinator } from '../src/privateWriteCoordinator.ts';
import { createPrivateOrdinarySaveGuard } from '../src/privateOrdinarySaveGuard.ts';

const FIRST = '2026-10-19T09:00:00.000Z';
const SECOND = '2026-10-23T12:00:00.000Z';
const original = { id: 'local-note-2', title: 'Ideas', text: 'Keep this body', category: 'ideas', createdAt: FIRST, updatedAt: FIRST, pinned: true, archived: false, deletedAt: null };

test('duplicate follows PWA semantics without changing original or editing draft', async () => {
  let persisted = [original];
  const controller = createNotesController({ async load() { return persisted; }, async save(notes) { persisted = notes; } });
  await controller.load();
  controller.dispatch({ type: 'change', field: 'text', value: 'Unsaved editor draft' });
  await controller.duplicateNote(original.id, SECOND);
  const state = controller.getSnapshot().state;
  assert.equal(state.notes.length, 2);
  assert.deepEqual(state.notes[1], original);
  assert.equal(state.draft.text, 'Unsaved editor draft');
  assert.deepEqual(state.notes[0], { ...original, id: 'local-note-3', title: 'Copy of Ideas', createdAt: SECOND, updatedAt: SECOND, pinned: false });
  assert.equal(state.notice, 'Note duplicated.');
  const restarted = createNotesController({ async load() { return persisted; }, async save() {} });
  await restarted.load();
  assert.deepEqual(restarted.getSnapshot().state.notes, state.notes);
});

test('duplicate of archived note returns to active library and blank title has PWA fallback', async () => {
  let persisted = [{ ...original, title: '', archived: true }];
  const controller = createNotesController({ async load() { return persisted; }, async save(notes) { persisted = notes; } });
  await controller.load();
  await controller.duplicateNote(original.id, SECOND);
  assert.equal(persisted[0].title, 'Copy of Untitled note');
  assert.equal(persisted[0].archived, false);
  assert.equal(persisted[0].category, 'ideas');
});

test('duplicate of a note at the character limit is rejected before persistence when the copy title would overflow', async () => {
  const longNote = { ...original, title: 'x'.repeat(MAX_NOTE_CHARACTERS - 4) };
  let writes = 0;
  const controller = createNotesController({ async load() { return [longNote]; }, async save() { writes++; } });
  await controller.load();
  await controller.duplicateNote(longNote.id, SECOND);
  const state = controller.getSnapshot().state;
  assert.equal(state.notes.length, 1);
  assert.match(controller.getSnapshot().storageError, /too long to duplicate/);
  assert.equal(writes, 0);
});

test('checklist text updates persist supplied HTML and preserve it for legacy calls', async () => {
  const html = '<p>☑ formatted item</p>';
  let persisted = [{ ...original, html }];
  const controller = createNotesController({ async load() { return persisted; }, async save(notes) { persisted = notes; } });
  await controller.load();
  await controller.updateNoteText(original.id, '☑ formatted item', SECOND, '<p>☐ formatted item</p>');
  assert.equal(persisted[0].html, '<p>☐ formatted item</p>');
  await controller.updateNoteText(original.id, '☑ updated plain text', SECOND);
  assert.equal(persisted[0].html, '<p>☐ formatted item</p>');
});

test('failed duplication does not alter saved notes; retry works and IDs remain unique', async () => {
  let fail = true;
  let persisted = [original, { ...original, id: 'local-note-3' }];
  const controller = createNotesController({ async load() { return persisted; }, async save(notes) { if (fail) throw Error('disk full'); persisted = notes; } });
  await controller.load();
  await controller.duplicateNote(original.id, SECOND);
  assert.equal(controller.getSnapshot().state.notes.length, 2);
  assert.match(controller.getSnapshot().storageError, /original note has not been changed/);
  fail = false;
  await controller.duplicateNote(original.id, SECOND);
  assert.equal(persisted[0].id, 'local-note-4');
});

test('missing and trashed notes cannot be duplicated', async () => {
  let writes = 0;
  const controller = createNotesController({ async load() { return [{ ...original, deletedAt: FIRST }]; }, async save() { writes++; } });
  await controller.load();
  await controller.duplicateNote(original.id, SECOND);
  await controller.duplicateNote('missing', SECOND);
  assert.equal(writes, 0);
});

test('duplicate allocates an ID outside both ordinary and encrypted-vault namespaces', async () => {
  let persisted = [original];
  const privateEntries = [{ id: 'local-note-3', privateData: { ciphertext: 'opaque-private-payload' } }];
  const storage = createPrivateOrdinarySaveGuard(createPrivateWriteCoordinator(), {
    async load() { return structuredClone(persisted); },
    async save(notes) { persisted = structuredClone(notes); },
  }, {
    async load() { return structuredClone(privateEntries); },
  });
  const controller = createNotesController(storage);
  await controller.load();
  await controller.duplicateNote(original.id, SECOND);

  assert.deepEqual(persisted.map(note => note.id), ['local-note-4', 'local-note-2']);
  assert.equal(new Set(persisted.map(note => note.id)).size, persisted.length);
  assert.deepEqual(privateEntries, [{ id: 'local-note-3', privateData: { ciphertext: 'opaque-private-payload' } }]);
  assert.equal(controller.getSnapshot().storageError, null);
});
