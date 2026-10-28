import assert from 'node:assert/strict';
import test from 'node:test';
import { addPickedAttachment, detachAttachment } from '../src/attachmentTransactions.ts';

function harness() {
  const blobs = new Map();
  let items = [];
  let saves = 0;
  let failSave = false;
  const files = {
    async copyIntoPrivateStorage(uri, key) { assert.equal(uri, 'content://picker/1'); blobs.set(key, 100); },
    async storedFileSize(key) { return blobs.get(key) ?? null; },
    async removePrivateFile(key) { blobs.delete(key); },
  };
  const manifest = {
    async load() { return items; },
    async save(_noteId, next) { if (failSave) throw new Error('manifest failed'); items = next; saves++; },
  };
  let sequence = 0;
  const newId = () => 'opaque_key_' + (++sequence);
  return { blobs, files, manifest, newId, get items() { return items; }, get saves() { return saves; }, fail() { failSave = true; } };
}
const picked = { uri: 'content://picker/1', name: 'test.pdf', size: 100, mimeType: 'application/pdf' };

test('copies and verifies bytes before persisting metadata; detaches safely', async () => {
  const h = harness();
  const added = await addPickedAttachment('note1', picked, h.files, h.manifest, h.newId);
  assert.equal(h.items.length, 1);
  assert.equal(h.items[0].fileKey, added.fileKey);
  assert.equal(h.blobs.size, 1);
  assert.equal(await detachAttachment('note1', added.id, h.files, h.manifest), true);
  assert.equal(h.items.length, 0);
  assert.equal(h.blobs.size, 0);
});

test('rolls back copied bytes when manifest commit fails', async () => {
  const h = harness();
  h.fail();
  await assert.rejects(addPickedAttachment('note1', picked, h.files, h.manifest, h.newId), /manifest failed/);
  assert.equal(h.items.length, 0);
  assert.equal(h.blobs.size, 0);
});

test('rejects invalid file before copying', async () => {
  const h = harness();
  await assert.rejects(addPickedAttachment('note1', { ...picked, mimeType: 'text/html' }, h.files, h.manifest, h.newId), /Only images/);
  assert.equal(h.blobs.size, 0);
  assert.equal(h.saves, 0);
});

test('does not commit if copied file size differs', async () => {
  const h = harness();
  await assert.rejects(addPickedAttachment('note1', { ...picked, size: 101 }, h.files, h.manifest, h.newId), /could not be verified/);
  assert.equal(h.blobs.size, 0);
  assert.equal(h.items.length, 0);
});
