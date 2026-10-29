import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as attachmentRules from '../src/attachmentRules.ts';

const require = createRequire(import.meta.url);
const attachments = [
  { id: 'attachment_image_1', fileKey: 'file_image_1', name: 'diagram.png', size: 2048, mimeType: 'image/png' },
  { id: 'attachment_pdf_1', fileKey: 'file_pdf_1', name: 'brief.pdf', size: 4096, mimeType: 'application/pdf' },
];
const source = readFileSync(new URL('../src/components/NoteAttachments.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});

function renderSummary() {
  let hookIndex = 0;
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name === 'react') return {
        useState() {
          const index = hookIndex++;
          return [index === 0 ? attachments : index === 1 ? true : null, () => {}];
        },
        useEffect() {},
        useCallback: callback => callback,
      };
      if (name === 'react-native') return { Alert: { alert() {} }, Pressable: 'Pressable', Text: 'Text', View: 'View' };
      if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: {} };
      if (name === 'expo-crypto') return { __esModule: true, randomUUID: () => 'generated_id' };
      if (name === '../androidAttachmentFiles') return { createAndroidAttachmentFiles: () => ({}) };
      if (name === '../androidAttachmentPicker') return { pickAndroidAttachments: async () => [] };
      if (name === '../attachmentManifestStorage') return { createAttachmentManifestStorage: () => ({}) };
      if (name === '../attachmentService') return { createAttachmentService: () => ({ list: async () => attachments }) };
      if (name === '../attachmentRules') return attachmentRules;
      if (name === '../deviceNotesStorage') return { deviceNotesStorage: { load: async () => [] } };
      if (name === '../privateSharedCoordinator') return { privateSharedCoordinator: { exclusive: callback => callback() } };
      if (name === '../privateVaultStorage') return { createPrivateVaultStorage: () => ({ load: async () => [] }) };
      if (name === 'react/jsx-runtime') return require(name);
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports.NoteAttachmentSummary({ noteId: 'ordinary-note-7' });
}

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  return [tree, ...elements(tree.props.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree?.props) return text(tree.props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}

test('saved-note attachment summary renders its local file list without enabling cloud sync', () => {
  const summary = renderSummary();
  const renderedText = text(summary);
  assert.match(renderedText, /Attachments \(2\)/);
  assert.match(renderedText, /Image/);
  assert.match(renderedText, /PDF/);
  assert.match(renderedText, /diagram\.png/);
  assert.match(renderedText, /brief\.pdf/);
  assert.match(renderedText, /Stored on this device only\. Not synced to the web app\./);
  assert.equal(elements(summary).some(element => element.type === 'Pressable'), false, 'the library summary is read-only');
});
