import assert from 'node:assert/strict';
import test from 'node:test';
import { getAttachmentPreviewDisplayState } from '../src/attachmentPreviewState.ts';

test('switching attachments does not expose the previous text while the next preview loads', () => {
  const previous = {
    fileKey: 'file_text_previous',
    kind: 'text',
    textContent: 'previous attachment contents',
    error: null,
  };

  assert.deepEqual(
    getAttachmentPreviewDisplayState('text', 'file_private_note_2', previous),
    { status: 'loading', textContent: null, error: null },
  );
});

test('a loaded text preview is shown only for its matching file key and kind', () => {
  const loaded = {
    fileKey: 'file_text_1',
    kind: 'text',
    textContent: 'current attachment contents',
    error: null,
  };

  assert.deepEqual(
    getAttachmentPreviewDisplayState('text', 'file_text_1', loaded),
    { status: 'text', textContent: 'current attachment contents', error: null },
  );
  assert.deepEqual(
    getAttachmentPreviewDisplayState('image', 'file_text_1', loaded),
    { status: 'image', textContent: null, error: null },
  );
});
