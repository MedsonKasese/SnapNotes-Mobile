import assert from 'node:assert/strict';
import test from 'node:test';
import { createAttachmentService } from '../src/attachmentService.ts';
import { createPrivateWriteCoordinator } from '../src/privateWriteCoordinator.ts';

const picked = { uri: 'content://picker/1', name: 'test.pdf', size: 100, mimeType: 'application/pdf' };

function harness(isOrdinaryNote) {
  const items = [];
  let copies = 0;
  let sequence = 0;
  const files = {
    async copyIntoPrivateStorage(_uri, key) { copies++; files.sizes.set(key, 100); },
    async storedFileSize(key) { return files.sizes.get(key) ?? null; },
    async removePrivateFile(key) { files.sizes.delete(key); },
    sizes: new Map(),
  };
  const manifest = {
    async load() { return [...items]; },
    async save(_noteId, next) { items.splice(0, items.length, ...next); },
  };
  const coordinator = createPrivateWriteCoordinator();
  const service = createAttachmentService(
    files, manifest, () => 'opaque_key_' + (++sequence), coordinator,
    async noteId => {
      if (!isOrdinaryNote(noteId)) throw new Error('Attachments are not available in Private Notes.');
    },
  );
  return { coordinator, service, items, get copies() { return copies; } };
}

test('waits for the private-move lock and rejects an attachment add after the note enters the vault', async () => {
  let ordinary = true;
  const h = harness(() => ordinary);
  let markEntered;
  const entered = new Promise(resolve => { markEntered = resolve; });
  let releaseMove;
  const moveGate = new Promise(resolve => { releaseMove = resolve; });
  const move = h.coordinator.exclusive(async () => {
    markEntered();
    await moveGate;
    ordinary = false;
  });
  await entered;

  const add = h.service.add('note_123', picked);
  releaseMove();
  await move;
  await assert.rejects(add, /not available in Private Notes/);
  assert.equal(h.copies, 0);
  assert.deepEqual(h.items, []);
});

test('allows attachment storage while the note remains ordinary', async () => {
  const h = harness(() => true);
  const stored = await h.service.add('note_123', picked);
  assert.equal(stored.name, 'test.pdf');
  assert.equal(h.copies, 1);
  assert.equal((await h.service.list('note_123')).length, 1);
});
