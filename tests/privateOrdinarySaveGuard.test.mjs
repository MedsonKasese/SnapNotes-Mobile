import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateWriteCoordinator } from '../src/privateWriteCoordinator.ts';
import { createPrivateOrdinarySaveGuard } from '../src/privateOrdinarySaveGuard.ts';

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
