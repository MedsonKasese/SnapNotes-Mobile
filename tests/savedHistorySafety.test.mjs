import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotesController } from '../src/notesController.ts';

const ORIGINAL_TIME = '2026-10-23T10:00:00.000Z';
const EDIT_TIME = '2026-10-23T10:01:00.000Z';
const seedNote = {
  id: 'seed', title: 'Before', text: 'Original body', html: '<b>Original body</b>',
  category: 'work', createdAt: ORIGINAL_TIME, updatedAt: ORIGINAL_TIME,
  pinned: true, archived: false, deletedAt: null, folderId: 'folder-1',
};
function historyFixture(initial = [seedNote]) {
  let persisted = structuredClone(initial), fail = false, pendingWrite = null;
  const writes = [];
  const storage = {
    async load() { return structuredClone(persisted); },
    async save(notes) {
      writes.push(structuredClone(notes));
      if (pendingWrite) await pendingWrite;
      if (fail) throw Error('device full');
      persisted = structuredClone(notes);
    },
  };
  const controller = createNotesController(storage);
  return {
    controller, storage, writes,
    get persisted() { return structuredClone(persisted); },
    fail(value) { fail = value; },
    holdWrite() {
      let release;
      pendingWrite = new Promise(resolve => { release = resolve; });
      return () => { pendingWrite = null; release(); };
    },
  };
}
async function edit(controller, title = 'After', now = EDIT_TIME, id = 'seed') {
  controller.dispatch({ type: 'edit', id });
  controller.dispatch({ type: 'change', field: 'title', value: title });
  await controller.save(now);
}

test('new-note creation and a new controller do not acquire saved-edit history', async () => {
  const fixture = historyFixture([]);
  const { controller } = fixture;
  assert.equal(controller.canUndoSaved(), false);
  await controller.travelSavedHistory('undo');
  await controller.load();
  controller.dispatch({ type: 'change', field: 'title', value: 'New note' });
  await controller.save(ORIGINAL_TIME);
  assert.equal(controller.canUndoSaved(), false);
  await edit(controller, 'Edited', EDIT_TIME, fixture.persisted[0].id);
  assert.equal(controller.canUndoSaved(), true);
  const restarted = createNotesController(fixture.storage);
  await restarted.load();
  assert.equal(restarted.canUndoSaved(), false);
  assert.equal(restarted.canRedoSaved(), false);
  assert.equal(restarted.getSnapshot().state.notes[0].title, 'Edited');
});

test('failed saved edits do not enter history or clear an existing redo branch', async () => {
  const fixture = historyFixture();
  const { controller } = fixture;
  await controller.load();
  fixture.fail(true);
  await edit(controller);
  assert.equal(controller.canUndoSaved(), false);
  assert.equal(fixture.persisted[0].title, 'Before');
  fixture.fail(false);
  await controller.save(EDIT_TIME);
  await controller.travelSavedHistory('undo');
  fixture.fail(true);
  await edit(controller, 'Uncommitted branch');
  assert.equal(controller.canRedoSaved(), true);
  assert.equal(fixture.persisted[0].title, 'Before');
  assert.equal(controller.getSnapshot().state.draft.title, 'Uncommitted branch');
});

test('a successful saved edit clears redo and undo walks the new branch only', async () => {
  const { controller } = historyFixture();
  await controller.load();
  await edit(controller);
  await controller.travelSavedHistory('undo');
  assert.equal(controller.canRedoSaved(), true);
  await edit(controller, 'New branch');
  assert.equal(controller.canRedoSaved(), false);
  await controller.travelSavedHistory('undo');
  assert.equal(controller.getSnapshot().state.notes[0].title, 'Before');
  await controller.travelSavedHistory('redo');
  assert.equal(controller.getSnapshot().state.notes[0].title, 'New branch');
});

test('undo and redo restore rich content, category and timestamps without changing other notes', async () => {
  const other = { ...seedNote, id: 'other', title: 'Unrelated' };
  const fixture = historyFixture([seedNote, other]);
  const { controller } = fixture;
  await controller.load();
  controller.dispatch({ type: 'edit', id: 'seed' });
  controller.dispatch({ type: 'rich-change', text: 'Formatted edit', html: '<i>Formatted edit</i>' });
  controller.dispatch({ type: 'category', category: 'personal' });
  await controller.save(EDIT_TIME);
  const edited = fixture.persisted[0];
  await controller.togglePin('other', EDIT_TIME);
  const unrelated = fixture.persisted[1];
  await controller.travelSavedHistory('undo');
  assert.deepEqual(fixture.persisted, [seedNote, unrelated]);
  await controller.travelSavedHistory('redo');
  assert.deepEqual(fixture.persisted, [edited, unrelated]);
});

test('redo write failure preserves both state and retryable history', async () => {
  const fixture = historyFixture();
  const { controller } = fixture;
  await controller.load();
  await edit(controller);
  await controller.travelSavedHistory('undo');
  fixture.fail(true);
  await controller.travelSavedHistory('redo');
  assert.deepEqual(fixture.persisted, [seedNote]);
  assert.equal(controller.canRedoSaved(), true);
  assert.equal(controller.canUndoSaved(), false);
  assert.match(controller.getSnapshot().storageError, /saved note is unchanged/);
  fixture.fail(false);
  await controller.travelSavedHistory('redo');
  assert.equal(fixture.persisted[0].title, 'After');
  assert.equal(controller.canRedoSaved(), false);
  assert.equal(controller.getSnapshot().storageError, null);
});

test('history publishes and transfers its entry only after storage commits, blocking concurrent operations', async () => {
  const fixture = historyFixture();
  const { controller } = fixture;
  await controller.load();
  await edit(controller);
  const beforeWrite = controller.getSnapshot().state;
  const release = fixture.holdWrite();
  const undo = controller.travelSavedHistory('undo');
  assert.equal(controller.getSnapshot().status, 'saving');
  assert.equal(controller.canUndoSaved(), false);
  assert.equal(controller.canRedoSaved(), false);
  assert.equal(controller.getSnapshot().state, beforeWrite);
  assert.equal(fixture.persisted[0].title, 'After');
  const count = fixture.writes.length;
  await controller.travelSavedHistory('undo');
  await controller.travelSavedHistory('redo');
  await controller.togglePin('seed', EDIT_TIME);
  await controller.save(EDIT_TIME);
  controller.dispatch({ type: 'change', field: 'title', value: 'Concurrent draft' });
  assert.equal(fixture.writes.length, count);
  assert.equal(controller.getSnapshot().state, beforeWrite);
  release();
  await undo;
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.equal(fixture.persisted[0].title, 'Before');
  assert.equal(controller.canRedoSaved(), true);
});

for (const [name, mutate] of [
  ['pin change', c => c.togglePin('seed', EDIT_TIME)],
  ['archive', c => c.setArchived('seed', true, EDIT_TIME)],
  ['checklist edit', c => c.updateNoteText('seed', 'Changed later', EDIT_TIME, '<b>Changed later</b>')],
  ['folder move', c => c.moveNoteToFolder('seed', 'folder-2')],
  ['folder deletion', c => c.clearFolder('folder-1')],
  ['Trash', c => c.moveToTrash('seed', EDIT_TIME)],
  ['permanent deletion', async c => { await c.moveToTrash('seed', EDIT_TIME); await c.permanentlyDelete('seed'); }],
]) {
  test(`undo refuses a conflicting ${name} without any storage write`, async () => {
    const fixture = historyFixture();
    const { controller } = fixture;
    await controller.load();
    await edit(controller);
    await mutate(controller);
    const changed = fixture.persisted;
    const count = fixture.writes.length;
    await controller.travelSavedHistory('undo');
    assert.deepEqual(fixture.persisted, changed);
    assert.equal(fixture.writes.length, count);
    assert.match(controller.getSnapshot().state.error, /cancelled to protect/);
    assert.equal(controller.canUndoSaved(), false);
    assert.equal(controller.canRedoSaved(), false);
  });
}

test('redo also refuses a note modified after undo', async () => {
  const fixture = historyFixture();
  const { controller } = fixture;
  await controller.load();
  await edit(controller);
  await controller.travelSavedHistory('undo');
  await controller.moveNoteToFolder('seed', 'new-folder');
  const changed = fixture.persisted;
  const count = fixture.writes.length;
  await controller.travelSavedHistory('redo');
  assert.deepEqual(fixture.persisted, changed);
  assert.equal(fixture.writes.length, count);
  assert.equal(controller.canRedoSaved(), false);
  assert.match(controller.getSnapshot().state.error, /cancelled to protect/);
});

test('saved history retains only the most recent 30 edits and supports repeated undo/redo', async () => {
  const fixture = historyFixture();
  const { controller } = fixture;
  await controller.load();
  for (let index = 1; index <= 31; index++) {
    await edit(controller, `Edit ${index}`, new Date(Date.parse(ORIGINAL_TIME) + index * 1000).toISOString());
  }
  for (let index = 0; index < 30; index++) await controller.travelSavedHistory('undo');
  assert.equal(controller.canUndoSaved(), false);
  assert.equal(fixture.persisted[0].title, 'Edit 1');
  for (let index = 0; index < 30; index++) await controller.travelSavedHistory('redo');
  assert.equal(controller.canRedoSaved(), false);
  assert.equal(fixture.persisted[0].title, 'Edit 31');
});

test('unchanged saves do not create history or rewrite the saved timestamp', async () => {
  const fixture = historyFixture();
  const { controller } = fixture;
  await controller.load();
  controller.dispatch({ type: 'edit', id: 'seed' });
  await controller.save(EDIT_TIME);
  assert.equal(controller.canUndoSaved(), false);
  assert.equal(controller.canRedoSaved(), false);
  assert.deepEqual(fixture.persisted, [seedNote]);
  assert.equal(controller.getSnapshot().state.editingId, null);
  assert.deepEqual(controller.getSnapshot().state.draft, { title: '', text: '' });
});

test('unchanged saves preserve existing undo and redo chains', async () => {
  const fixture = historyFixture();
  const { controller } = fixture;
  await controller.load();
  await edit(controller);
  const edited = fixture.persisted[0];
  controller.dispatch({ type: 'edit', id: 'seed' });
  await controller.save('2026-10-23T10:02:00.000Z');
  assert.deepEqual(fixture.persisted, [edited]);
  await controller.travelSavedHistory('undo');
  assert.deepEqual(fixture.persisted, [seedNote]);
  assert.equal(controller.canUndoSaved(), false);
  controller.dispatch({ type: 'edit', id: 'seed' });
  await controller.save('2026-10-23T10:03:00.000Z');
  assert.equal(controller.canRedoSaved(), true);
  await controller.travelSavedHistory('redo');
  assert.deepEqual(fixture.persisted, [edited]);
});

test('the initial rich-editor snapshot of a plain-text note is not a saved content edit', async () => {
  const { html: _html, ...plainNote } = seedNote;
  const fixture = historyFixture([plainNote]);
  const { controller } = fixture;
  await controller.load();
  await edit(controller);
  const edited = fixture.persisted[0];
  controller.dispatch({ type: 'edit', id: 'seed' });
  controller.dispatch({ type: 'rich-change', text: plainNote.text, html: '<div>Original body</div>' });
  await controller.save('2026-10-23T10:02:00.000Z');
  assert.deepEqual(fixture.persisted, [edited]);
  await controller.travelSavedHistory('undo');
  assert.deepEqual(fixture.persisted, [plainNote]);
  assert.equal(controller.canUndoSaved(), false);
  assert.equal(controller.canRedoSaved(), true);
});
