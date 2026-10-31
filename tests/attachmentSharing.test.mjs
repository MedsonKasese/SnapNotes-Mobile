import assert from 'node:assert/strict';
import test from 'node:test';
import { shareAttachmentWithTemporaryCopy } from '../src/attachmentSharing.ts';

const attachment = {
  fileKey: 'opaque_attachment_key',
  name: 'meeting-notes-2026.pdf',
  mimeType: 'application/pdf',
};

function createTemporaryCopy() {
  const state = { cleaned: false };
  return {
    state,
    async createShareCopy(fileKey, name) {
      assert.equal(fileKey, attachment.fileKey);
      assert.equal(name, attachment.name);
      return {
        uri: `file:///cache/unique/${name}`,
        cleanup() { state.cleaned = true; },
      };
    },
  };
}

test('shares the temporary URI named exactly like the attachment and then cleans it up', async () => {
  const temp = createTemporaryCopy();
  let shared;
  await shareAttachmentWithTemporaryCopy(attachment, temp.createShareCopy, async (uri, options) => {
    shared = { uri, options };
  });

  assert.equal(shared.uri, `file:///cache/unique/${attachment.name}`);
  assert.deepEqual(shared.options, {
    mimeType: 'application/pdf',
    dialogTitle: attachment.name,
    UTI: 'com.adobe.pdf',
  });
  assert.equal(temp.state.cleaned, true);
});

test('cleans the temporary copy after the Android chooser is cancelled or rejects', async () => {
  const temp = createTemporaryCopy();
  const cancellation = new Error('share chooser cancelled');
  await assert.rejects(
    shareAttachmentWithTemporaryCopy(attachment, temp.createShareCopy, async () => { throw cancellation; }),
    error => error === cancellation,
  );
  assert.equal(temp.state.cleaned, true);
});
