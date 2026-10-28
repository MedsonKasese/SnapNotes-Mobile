import assert from 'node:assert/strict';
import test from 'node:test';
import { createAttachmentManifestStorage } from '../src/attachmentManifestStorage.ts';

const attachment = { id: 'attachment_1234', fileKey: 'file_abcdef1234', name: 'photo.png', size: 1024, mimeType: 'image/png' };
function harness() {
  const records = new Map();
  const storage = createAttachmentManifestStorage({
    async getItem(key) { return records.get(key) ?? null; },
    async setItem(key, value) { records.set(key, value); },
  });
  return { records, storage };
}

test('versioned attachment metadata survives adapter recreation', async () => {
  const h = harness();
  assert.deepEqual(await h.storage.load('note_1'), []);
  await h.storage.save('note_1', [attachment]);
  assert.deepEqual(await h.storage.load('note_1'), [attachment]);
  assert.equal(h.records.size, 1);
});

test('rejects corrupt and unsupported manifest instead of silently dropping attachments', async () => {
  const h = harness();
  h.records.set('@snapnotes-mobile/attachments/note_1', '{broken');
  await assert.rejects(h.storage.load('note_1'), /Corrupt/);
  h.records.set('@snapnotes-mobile/attachments/note_1', JSON.stringify({ version: 2, attachments: [] }));
  await assert.rejects(h.storage.load('note_1'), /Unsupported/);
  await assert.rejects(h.storage.load('../escape'), /Invalid note/);
});

test('invalid metadata cannot overwrite committed manifest', async () => {
  const h = harness();
  await h.storage.save('note_1', [attachment]);
  const previous = [...h.records.values()][0];
  await assert.rejects(h.storage.save('note_1', [{ ...attachment, fileKey: '../escape' }]));
  assert.equal([...h.records.values()][0], previous);
});
