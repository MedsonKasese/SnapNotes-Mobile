import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStoredAttachments } from '../src/attachmentManifest.ts';

const valid = {
  id: 'attachment_1234', fileKey: 'file_abcdef1234',
  name: 'photo.png', size: 1024, mimeType: 'image/png',
};

test('accepts durable, app-owned manifest entries', () => {
  assert.deepEqual(validateStoredAttachments([valid]), [valid]);
  assert.deepEqual(validateStoredAttachments([]), []);
});

test('rejects transient paths, URL references and malformed records', () => {
  for (const fileKey of ['file:///tmp/a', 'content://picker/1', 'https://example.com/a', '../escape', 'data:image/png;base64,abc', '']) {
    assert.throws(() => validateStoredAttachments([{ ...valid, fileKey }]));
  }
  assert.throws(() => validateStoredAttachments([{ ...valid, size: -1 }]));
  assert.throws(() => validateStoredAttachments([{ ...valid, mimeType: 'text/html' }]));
  assert.throws(() => validateStoredAttachments([valid, valid]));
  assert.throws(() => validateStoredAttachments(Array(6).fill({ ...valid })));
  assert.throws(() => validateStoredAttachments({ attachments: [] }));
});
