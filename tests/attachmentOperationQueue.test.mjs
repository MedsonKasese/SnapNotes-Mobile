import assert from 'node:assert/strict';
import test from 'node:test';
import { createAttachmentOperationQueue } from '../src/attachmentOperationQueue.ts';

test('serializes simultaneous operations for the same note', async () => {
  const queue = createAttachmentOperationQueue();
  const order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = queue.run('note1', async () => { order.push('start1'); await gate; order.push('end1'); });
  const second = queue.run('note1', async () => { order.push('start2'); order.push('end2'); });
  await Promise.resolve();
  assert.deepEqual(order, ['start1']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start1', 'end1', 'start2', 'end2']);
  assert.equal(queue.pendingCount(), 0);
});

test('failed operation does not block next operation', async () => {
  const queue = createAttachmentOperationQueue();
  const failed = queue.run('note1', async () => { throw new Error('disk full'); });
  const recovered = queue.run('note1', async () => 'saved');
  await assert.rejects(failed, /disk full/);
  assert.equal(await recovered, 'saved');
  assert.equal(queue.pendingCount(), 0);
});

test('different notes can operate independently', async () => {
  const queue = createAttachmentOperationQueue();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const blocked = queue.run('note1', async () => { await gate; });
  const independent = queue.run('note2', async () => 'ready');
  assert.equal(await independent, 'ready');
  release();
  await blocked;
  assert.equal(queue.pendingCount(), 0);
});
