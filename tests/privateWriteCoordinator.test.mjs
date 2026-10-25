import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateWriteCoordinator } from '../src/privateWriteCoordinator.ts';

test('cross-store operations execute in FIFO order without overlap', async () => {
  const coordinator = createPrivateWriteCoordinator();
  const events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = coordinator.exclusive(async () => {
    events.push('move-start');
    await gate;
    events.push('move-end');
  });
  const second = coordinator.exclusive(async () => { events.push('notes-save'); });
  const third = coordinator.exclusive(async () => { events.push('vault-save'); });
  assert.equal(coordinator.isBusy(), true);
  await Promise.resolve();
  assert.deepEqual(events, ['move-start']);
  release();
  await Promise.all([first, second, third]);
  assert.deepEqual(events, ['move-start', 'move-end', 'notes-save', 'vault-save']);
  assert.equal(coordinator.isBusy(), false);
});

test('failed operation releases queue for subsequent writers', async () => {
  const coordinator = createPrivateWriteCoordinator();
  const first = coordinator.exclusive(async () => { throw new Error('storage failed'); });
  const second = coordinator.exclusive(async () => 'recovered');
  await assert.rejects(first, /storage failed/);
  assert.equal(await second, 'recovered');
  assert.equal(coordinator.isBusy(), false);
});

test('operation result propagates', async () => {
  const coordinator = createPrivateWriteCoordinator();
  assert.deepEqual(await coordinator.exclusive(async () => ({ ok: true })), { ok: true });
});
