import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateWriteCoordinator } from '../src/privateWriteCoordinator.ts';
import { createPrivateOrdinarySaveGuard } from '../src/privateOrdinarySaveGuard.ts';
import { createNotesController } from '../src/notesController.ts';

const note = id => ({ id });

test('ordinary saves proceed when encrypted IDs do not overlap', async () => {
  let saved;
  const storage = createPrivateOrdinarySaveGuard(createPrivateWriteCoordinator(),
    { load: async () => [], save: async notes => { saved = notes; } },
    { load: async () => [{ id: 'private-1' }] });
  await storage.save([note('ordinary-1')]);
  assert.deepEqual(saved, [note('ordinary-1')]);
});

test('stale ordinary snapshot cannot reintroduce encrypted note plaintext', async () => {
  let saves = 0;
  const storage = createPrivateOrdinarySaveGuard(createPrivateWriteCoordinator(),
    { load: async () => [], save: async () => { saves += 1; } },
    { load: async () => [{ id: 'private-1' }] });
  await assert.rejects(storage.save([note('private-1')]), /Save blocked/);
  assert.equal(saves, 0);
});

test('vault read failures block writes rather than bypass the guard', async () => {
  let saves = 0;
  const storage = createPrivateOrdinarySaveGuard(createPrivateWriteCoordinator(),
    { load: async () => [], save: async () => { saves += 1; } },
    { load: async () => { throw new Error('vault unavailable'); } });
  await assert.rejects(storage.save([note('ordinary-1')]), /vault unavailable/);
  assert.equal(saves, 0);
});

test('new ordinary note skips an ID already used by an encrypted private note', async () => {
  const privateEntries = [{ id: 'local-note-1', privateData: { ciphertext: 'opaque-private-payload' } }];
  let persisted = [];
  const storage = createPrivateOrdinarySaveGuard(createPrivateWriteCoordinator(), {
    load: async () => structuredClone(persisted),
    save: async notes => { persisted = structuredClone(notes); },
  }, { load: async () => structuredClone(privateEntries) });
  const controller = createNotesController(storage);
  await controller.load();
  controller.dispatch({ type: 'change', field: 'text', value: 'Ordinary test note' });
  await controller.save('2026-10-28T08:00:00.000Z');

  assert.equal(controller.getSnapshot().state.notes[0].id, 'local-note-2');
  assert.equal(persisted[0].id, 'local-note-2');
  assert.equal(persisted[0].text, 'Ordinary test note');
  assert.equal(JSON.stringify(persisted).includes('opaque-private-payload'), false);
  assert.equal(privateEntries[0].privateData.ciphertext, 'opaque-private-payload');
  assert.equal(controller.getSnapshot().storageError, null);
});

test('a vault ID claimed after allocation is blocked at save time without losing the draft', async () => {
  const coordinator = createPrivateWriteCoordinator();
  const privateEntries = [];
  let persisted = [];
  const guarded = createPrivateOrdinarySaveGuard(coordinator, {
    load: async () => structuredClone(persisted),
    save: async notes => { persisted = structuredClone(notes); },
  }, { load: async () => structuredClone(privateEntries) });
  const storage = {
    ...guarded,
    async allocateNoteId(usedIds) {
      const id = await guarded.allocateNoteId(usedIds);
      await coordinator.exclusive(async () => {
        privateEntries.push({ id, privateData: { ciphertext: 'concurrent-private-payload' } });
      });
      return id;
    },
  };
  const controller = createNotesController(storage);
  await controller.load();
  controller.dispatch({ type: 'change', field: 'text', value: 'Keep this unsaved draft' });
  await controller.save('2026-10-28T08:00:00.000Z');

  assert.equal(privateEntries[0].id, 'local-note-1');
  assert.deepEqual(persisted, []);
  assert.equal(controller.getSnapshot().state.draft.text, 'Keep this unsaved draft');
  assert.match(controller.getSnapshot().storageError, /Private-note protection blocked this write/);
  assert.equal(JSON.stringify(persisted).includes('concurrent-private-payload'), false);
});
