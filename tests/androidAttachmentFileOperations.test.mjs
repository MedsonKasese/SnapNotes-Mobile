import assert from 'node:assert/strict';
import test from 'node:test';
import { createAndroidAttachmentFileOperations } from '../src/androidAttachmentFileOperations.ts';
import { addPickedAttachment } from '../src/attachmentTransactions.ts';

const picked = { uri: 'content://picker/1', name: 'test.pdf', size: 100, mimeType: 'application/pdf' };

test('waits for the Android file copy before verifying size or committing the manifest', async () => {
  let completeCopy;
  let markCopyStarted;
  const copyStarted = new Promise(resolve => { markCopyStarted = resolve; });
  let destinationExists = false;
  let destinationSize = 0;
  let sizeReads = 0;
  const destination = {
    get exists() { return destinationExists; },
    get size() { sizeReads++; return destinationSize; },
    delete() { destinationExists = false; destinationSize = 0; },
  };
  const files = createAndroidAttachmentFileOperations({
    ensureDirectory() {},
    sourceFile(uri) {
      assert.equal(uri, picked.uri);
      return {
        copy(file) {
          assert.equal(file, destination);
          markCopyStarted();
          return new Promise(resolve => {
            completeCopy = () => {
              destinationExists = true;
              destinationSize = picked.size;
              resolve();
            };
          });
        },
      };
    },
    destinationFile(key) {
      assert.equal(key, 'opaque_key_2');
      return destination;
    },
  });
  const items = [];
  const manifest = {
    async load() { return [...items]; },
    async save(_noteId, next) { items.splice(0, items.length, ...next); },
  };
  let sequence = 0;
  const adding = addPickedAttachment('note_123', picked, files, manifest, () => `opaque_key_${++sequence}`);

  await copyStarted;
  let settled = false;
  void adding.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, 'the transaction must remain pending while the native copy is pending');
  assert.equal(sizeReads, 0, 'destination size must not be checked before the copy resolves');
  assert.deepEqual(items, [], 'manifest must remain unchanged before copy completion');

  completeCopy();
  const stored = await adding;
  assert.equal(stored.size, picked.size);
  assert.equal(sizeReads, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].fileKey, 'opaque_key_2');
});
