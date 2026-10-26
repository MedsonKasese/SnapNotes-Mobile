import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateWriteCoordinator } from '../src/privateWriteCoordinator.ts';
import { createCoordinatedPrivateStores } from '../src/privateCoordinatedStores.ts';

test('ordinary and vault writes share one exclusive queue', async () => {
  const events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const ordinary = { load: async () => [], save: async () => { events.push('notes-start'); await gate; events.push('notes-end'); } };
  const vault = { load: async () => [], save: async () => { events.push('vault-write'); } };
  const stores = createCoordinatedPrivateStores(createPrivateWriteCoordinator(), ordinary, vault);
  const first = stores.notes.save([]);
  const second = stores.privateVault.save([]);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ['notes-start']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['notes-start', 'notes-end', 'vault-write']);
});

test('transaction uses raw stores under the outer lock, avoiding nested-lock deadlock', async () => {
  const events = [];
  const ordinary = { load: async () => [], save: async () => { events.push('source'); } };
  const vault = { load: async () => [], save: async () => { events.push('vault'); } };
  const stores = createCoordinatedPrivateStores(createPrivateWriteCoordinator(), ordinary, vault);
  await stores.withExclusiveMove(async () => {
    await stores.transactionStores.privateVault.save([]);
    await stores.transactionStores.notes.save([]);
  });
  assert.deepEqual(events, ['vault', 'source']);
});
