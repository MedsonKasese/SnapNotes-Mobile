import assert from 'node:assert/strict';
import test from 'node:test';
import { ANDROID_DOCUMENT_PICKER_MIME_TYPES, normalizeDocumentSelection } from '../src/androidDocumentSelection.ts';

const pdf = { uri: 'content://documents/12', name: 'lecture.pdf', size: 100, mimeType: 'application/pdf' };

test('handles cancel without mutating attachments', () => {
  assert.deepEqual(normalizeDocumentSelection({ canceled: true }, 0), []);
});

test('normalizes permitted Android document picker assets', () => {
  assert.deepEqual(normalizeDocumentSelection({ canceled: false, assets: [pdf] }, 0), [pdf]);
  assert.equal(ANDROID_DOCUMENT_PICKER_MIME_TYPES.length, 6);
});

test('rejects provider metadata gaps and unsafe picker results', () => {
  for (const change of [
    { mimeType: null }, { size: null }, { size: undefined }, { size: 11 * 1024 * 1024 },
    { mimeType: 'application/zip' }, { uri: 'https://example.com/file' }, { uri: '../file' },
  ]) {
    assert.throws(() => normalizeDocumentSelection({ canceled: false, assets: [{ ...pdf, ...change }] }, 0));
  }
});

test('enforces aggregate count before copying any selected file', () => {
  assert.throws(() => normalizeDocumentSelection({ canceled: false, assets: [pdf, pdf] }, 4), /up to 5/);
});
