import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotesController } from '../src/notesController.ts';
test('saved edits undo and redo only after successful writes', async () => {
  let persisted = [];
  const controller = createNotesController({
    load: async () => persisted,
    save: async notes => { persisted = structuredClone(notes); },
  });
  await controller.load();
  controller.dispatch({ type: 'change', field: 'title', value: 'Before' });
  await controller.save('2026-10-23T10:00:00.000Z');
  const id = controller.getSnapshot().state.notes[0].id;
  controller.dispatch({ type: 'edit', id });
  controller.dispatch({ type: 'change', field: 'title', value: 'After' });
  await controller.save('2026-10-23T10:01:00.000Z');
  assert.equal(controller.canUndoSaved(), true);
  await controller.travelSavedHistory('undo');
  assert.equal(persisted[0].title, 'Before');
  assert.equal(controller.canRedoSaved(), true);
  await controller.travelSavedHistory('redo');
  assert.equal(persisted[0].title, 'After');
});
test('failed history writes leave saved notes unchanged and history retryable', async () => {
  let persisted = [];
  let fail = false;
  const controller = createNotesController({ load: async () => persisted, save: async notes => { if (fail) throw Error('offline'); persisted = structuredClone(notes); } });
  await controller.load();
  controller.dispatch({ type: 'change', field: 'title', value: 'A' });
  await controller.save('2026-10-23T10:00:00.000Z');
  const id = persisted[0].id;
  controller.dispatch({ type: 'edit', id });
  controller.dispatch({ type: 'change', field: 'title', value: 'B' });
  await controller.save('2026-10-23T10:01:00.000Z');
  fail = true;
  await controller.travelSavedHistory('undo');
  assert.equal(persisted[0].title, 'B');
  assert.equal(controller.canUndoSaved(), true);
  fail = false;
  await controller.travelSavedHistory('undo');
  assert.equal(persisted[0].title, 'A');
});
