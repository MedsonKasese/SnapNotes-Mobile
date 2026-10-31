import assert from 'node:assert/strict';
import test from 'node:test';
import { createAndroidAttachmentShareOperations } from '../src/androidAttachmentFileOperations.ts';

function shareFileSystem({ copyFails = false } = {}) {
  const directory = {
    exists: false,
    create(options) {
      assert.deepEqual(options, { idempotent: false, intermediates: true });
      this.exists = true;
    },
    delete() { this.exists = false; },
  };
  const persisted = {
    exists: true,
    size: 12,
    uri: 'file:///documents/snapnotes-attachments/opaque_attachment_key',
    contents: 'persisted bytes',
    copy(destination) {
      destination.contents = this.contents;
      destination.exists = true;
      if (copyFails) throw new Error('copy failed');
    },
    delete() { this.exists = false; },
  };
  let temporary = null;
  let requestedName = null;
  const operations = createAndroidAttachmentShareOperations({
    sourceFile(fileKey) {
      assert.equal(fileKey, 'opaque_attachment_key');
      return persisted;
    },
    temporaryDirectory() { return directory; },
    temporaryFile(parent, name) {
      assert.equal(parent, directory);
      requestedName = name;
      temporary = {
        exists: false,
        size: null,
        uri: `file:///cache/snapnotes-attachment-sharing/unique/${name}`,
        contents: '',
        delete() { this.exists = false; },
        copy() { throw new Error('temporary file should only be the copy destination'); },
      };
      return temporary;
    },
  });
  return { operations, directory, persisted, get temporary() { return temporary; }, get requestedName() { return requestedName; } };
}

test('stages a disposable share copy under the exact original filename without moving or renaming stored bytes', async () => {
  const f = shareFileSystem();
  const originalName = 'meeting-notes-2026.pdf';
  const staged = await f.operations.createShareCopy('opaque_attachment_key', originalName);

  assert.equal(f.requestedName, originalName);
  assert.equal(staged.uri, `file:///cache/snapnotes-attachment-sharing/unique/${originalName}`);
  assert.equal(f.temporary.contents, f.persisted.contents);
  assert.equal(f.persisted.uri, 'file:///documents/snapnotes-attachments/opaque_attachment_key');
  assert.equal(f.persisted.exists, true);
  assert.equal(f.persisted.contents, 'persisted bytes');

  staged.cleanup();
  assert.equal(f.temporary.exists, false);
  assert.equal(f.directory.exists, false);
  assert.equal(f.persisted.exists, true);
  assert.equal(f.persisted.contents, 'persisted bytes');
});

test('rejects path-like filenames before creating a temporary path', async () => {
  const f = shareFileSystem();
  await assert.rejects(f.operations.createShareCopy('opaque_attachment_key', '../outside.pdf'), /invalid file name/i);
  assert.equal(f.directory.exists, false);
  assert.equal(f.temporary, null);
  assert.equal(f.persisted.exists, true);
});

test('removes a partially created temporary copy if staging fails', async () => {
  const f = shareFileSystem({ copyFails: true });
  await assert.rejects(f.operations.createShareCopy('opaque_attachment_key', 'meeting-notes.pdf'), /copy failed/);
  assert.equal(f.temporary.exists, false);
  assert.equal(f.directory.exists, false);
  assert.equal(f.persisted.exists, true);
  assert.equal(f.persisted.contents, 'persisted bytes');
});
