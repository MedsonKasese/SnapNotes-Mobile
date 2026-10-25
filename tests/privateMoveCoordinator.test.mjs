import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateMoveCoordinator } from '../src/privateMoveCoordinator.ts';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('controller writes wait until the entire private move finishes', async () => {
  const entered = deferred();
  const release = deferred();
  const events = [];
  const coordinator = createPrivateMoveCoordinator(
    { load: async () => [], save: async () => { events.push('controller-save'); } },
    { load: async () => [], save: async () => {} },
  );
  const move = coordinator.transactionStorage.withExclusiveMove(async () => {
    events.push('move-start');
    entered.resolve();
    await release.promise;
    events.push('move-end');
  });
  await entered.promise;
  const save = coordinator.controllerNotesStorage.save([]);
  await Promise.resolve();
  assert.deepEqual(events, ['move-start']);
  release.resolve();
  await Promise.all([move, save]);
  assert.deepEqual(events, ['move-start', 'move-end', 'controller-save']);
});

test('a rejected operation releases the gate for subsequent controller writes', async () => {
  const events = [];
  const coordinator = createPrivateMoveCoordinator(
    { load: async () => [], save: async () => { events.push('saved'); } },
    { load: async () => [], save: async () => {} },
  );
  await assert.rejects(
    coordinator.transactionStorage.withExclusiveMove(async () => { throw Error('failed'); }),
    /failed/,
  );
  await coordinator.controllerNotesStorage.save([]);
  assert.deepEqual(events, ['saved']);
});
