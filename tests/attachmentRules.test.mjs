import assert from 'node:assert/strict';
import test from 'node:test';
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_SIZE, attachmentPreviewKind, validateAttachmentCandidate } from '../src/attachmentRules.ts';

test('PWA-compatible supported file types and preview routing', () => {
  assert.deepEqual(ALLOWED_ATTACHMENT_TYPES, ['application/pdf', 'text/plain', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  for (const mimeType of ALLOWED_ATTACHMENT_TYPES) {
    assert.deepEqual(validateAttachmentCandidate({ name: 'file', size: 1, mimeType }, 0), { ok: true });
  }
  assert.equal(attachmentPreviewKind('application/pdf'), 'pdf');
  assert.equal(attachmentPreviewKind('text/plain'), 'text');
  assert.equal(attachmentPreviewKind('image/webp'), 'image');
  assert.equal(attachmentPreviewKind('text/html'), 'unsupported');
});

test('rejects unsupported, oversized and sixth attachments', () => {
  const file = { name: 'test.pdf', size: MAX_ATTACHMENT_SIZE, mimeType: 'application/pdf' };
  assert.deepEqual(validateAttachmentCandidate(file, 4), { ok: true });
  assert.equal(validateAttachmentCandidate(file, 5).ok, false);
  assert.equal(validateAttachmentCandidate({ ...file, size: MAX_ATTACHMENT_SIZE + 1 }, 0).ok, false);
  assert.equal(validateAttachmentCandidate({ ...file, mimeType: 'text/html' }, 0).ok, false);
  assert.equal(validateAttachmentCandidate({ ...file, name: '' }, 0).ok, false);
  assert.equal(validateAttachmentCandidate({ ...file, size: -1 }, 0).ok, false);
  assert.equal(validateAttachmentCandidate(file, -1).ok, false);
});
