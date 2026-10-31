import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as attachmentRules from '../src/attachmentRules.ts';
import { getNoteActionsMenuLayout } from '../src/noteActionsMenu.ts';

const require = createRequire(import.meta.url);
const attachments = [
  { id: 'attachment_image_1', fileKey: 'file_image_1', name: 'diagram.png', size: 2048, mimeType: 'image/png' },
  { id: 'attachment_pdf_1', fileKey: 'file_pdf_1', name: 'brief.pdf', size: 4096, mimeType: 'application/pdf' },
];
const source = readFileSync(new URL('../src/components/NoteAttachments.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});

function createAttachmentRenderer(componentName, { fileForPreview = () => null, onPreviewVisibilityChange = () => {} } = {}) {
  let hookIndex = 0;
  const hookState = [];
  const exports = {};
  const service = {
    async list() { return attachments; },
    async add() {},
    async remove() {},
    async rename() {},
  };
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name === 'react') return {
        useState(initialValue) {
          const index = hookIndex++;
          if (!(index in hookState)) {
            hookState[index] = index === 0 ? attachments : componentName === 'NoteAttachmentSummary' && index === 1 ? true : initialValue;
          }
          return [hookState[index], value => {
            hookState[index] = typeof value === 'function' ? value(hookState[index]) : value;
          }];
        },
        useRef(initialValue) {
          const index = hookIndex++;
          if (!(index in hookState)) hookState[index] = { current: initialValue };
          return hookState[index];
        },
        useEffect() {},
        useCallback: callback => callback,
      };
      if (name === 'react-native') return {
        Alert: { alert() {} }, Image: 'Image', Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView',
        StyleSheet: { absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, create: styles => styles },
        Text: 'Text', TextInput: 'TextInput', View: 'View',
      };
      if (name === 'react-native-safe-area-context') return { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' };
      if (name === '@expo/vector-icons/FontAwesome') return { __esModule: true, default: 'FontAwesome' };
      if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: {} };
      if (name === 'expo-crypto') return { __esModule: true, randomUUID: () => 'generated_id' };
      if (name === 'expo-sharing') return { isAvailableAsync: async () => true, shareAsync: async () => {} };
      if (name === '../androidAttachmentFiles') return { createAndroidAttachmentFiles: () => ({ fileForPreview }) };
      if (name === '../attachmentSharing') return { shareAttachmentWithTemporaryCopy: async () => {} };
      if (name === '../noteActionsMenu') return { getNoteActionsMenuLayout };
      if (name === './AttachmentPreview') return {
        AttachmentPreview: ({ attachment, onClose }) => ({ type: 'AttachmentPreview', props: { attachment, onClose } }),
      };
      if (name === '../androidAttachmentPicker') return { pickAndroidAttachments: async () => [] };
      if (name === '../attachmentManifestStorage') return { createAttachmentManifestStorage: () => ({}) };
      if (name === '../attachmentService') return { createAttachmentService: () => service };
      if (name === '../attachmentRules') return attachmentRules;
      if (name === '../deviceNotesStorage') return { deviceNotesStorage: { load: async () => [] } };
      if (name === '../privateSharedCoordinator') return { privateSharedCoordinator: { exclusive: callback => callback() } };
      if (name === '../privateVaultStorage') return { createPrivateVaultStorage: () => ({ load: async () => [] }) };
      if (name === 'react/jsx-runtime') return require(name);
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return () => {
    hookIndex = 0;
    return componentName === 'NoteAttachmentSummary'
      ? exports.NoteAttachmentSummary({ noteId: 'ordinary-note-7', onPreviewVisibilityChange })
      : exports.NoteAttachments({ noteId: 'ordinary-note-7' });
  };
}

function renderSummary(options) {
  return createAttachmentRenderer('NoteAttachmentSummary', options)();
}

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  if (typeof tree.type === 'function') return elements(tree.type(tree.props));
  return [tree, ...elements(tree.props.children)];
}

function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree?.props) return text(typeof tree.type === 'function' ? tree.type(tree.props) : tree.props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}

function buttonLabels(tree) {
  return elements(tree).filter(element => element.type === 'Pressable')
    .map(element => element.props.accessibilityLabel).filter(Boolean);
}

function openActions(render, name) {
  const trigger = elements(render()).find(element => element.props.accessibilityLabel === 'Attachment actions for ' + name);
  assert.ok(trigger, `missing actions trigger for ${name}`);
  trigger.props.onPress();
  return render();
}

const menuActions = name => ['Preview ' + name, 'Share ' + name, 'Rename ' + name, 'Remove ' + name];

test('saved-note attachment summary keeps local-only storage messaging and compact per-file action triggers', () => {
  const summary = renderSummary();
  const renderedText = text(summary);
  assert.match(renderedText, /Attachments \(2\)/);
  assert.match(renderedText, /diagram\.png/);
  assert.match(renderedText, /brief\.pdf/);
  assert.match(renderedText, /Stored on this device only\. Not synced to the web app\./);
  assert.deepEqual(elements(summary).filter(element => element.type === 'FontAwesome').map(element => element.props.name)
    .filter(name => name.startsWith('file-')), ['file-image-o', 'file-pdf-o']);
  assert.deepEqual(buttonLabels(summary), [
    'Attachment actions for diagram.png', 'Attachment actions for brief.pdf',
  ], 'each attachment row exposes one compact action-menu trigger instead of inline buttons');
});

test('saved-note summary uses an available local image thumbnail and falls back to the file icon when unavailable', () => {
  const localUri = 'file:///app/snapnotes-attachments/file_image_1';
  const summary = renderSummary({
    fileForPreview: fileKey => fileKey === 'file_image_1' ? { exists: true, uri: localUri } : null,
  });
  const images = elements(summary).filter(element => element.type === 'Image');
  assert.equal(images.length, 1);
  assert.equal(images[0].props.source.uri, localUri);
  assert.deepEqual(elements(summary).filter(element => element.type === 'FontAwesome').map(element => element.props.name)
    .filter(name => name.startsWith('file-')), ['file-pdf-o']);
});

test('All Notes and the note editor expose the same four per-attachment actions from a compact row', () => {
  for (const componentName of ['NoteAttachmentSummary', 'NoteAttachments']) {
    const render = createAttachmentRenderer(componentName);
    const menu = openActions(render, 'diagram.png');
    const labels = buttonLabels(menu).filter(label => /^(Preview|Share|Rename|Remove) /.test(label));
    assert.deepEqual(labels, menuActions('diagram.png'), `${componentName} should provide the same actions in the same order`);
    assert.match(text(menu), /Preview/);
    assert.match(text(menu), /Share/);
    assert.match(text(menu), /Rename/);
    assert.match(text(menu), /Remove/);
  }
});

test('note-card attachment preview visibility is cleared when the preview closes from its action menu', async () => {
  const visibilityChanges = [];
  const render = createAttachmentRenderer('NoteAttachmentSummary', {
    onPreviewVisibilityChange: visible => visibilityChanges.push(visible),
  });
  const menu = openActions(render, 'diagram.png');
  const previewButton = elements(menu).find(element => element.props.accessibilityLabel === 'Preview diagram.png');
  assert.ok(previewButton);
  previewButton.props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(visibilityChanges, [true]);

  const preview = elements(render()).find(element => element.type === 'AttachmentPreview');
  assert.ok(preview);
  preview.props.onClose();
  assert.deepEqual(visibilityChanges, [true, false]);
});

function flatStyle(style) {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]));
}

test('attachment actions use the compact note popup layout and preserve all four per-file actions', () => {
  for (const componentName of ['NoteAttachmentSummary', 'NoteAttachments']) {
    const render = createAttachmentRenderer(componentName);
    const trigger = elements(render()).find(element => element.props.accessibilityLabel === 'Attachment actions for diagram.png');
    assert.ok(trigger);
    trigger.props.ref({ measureInWindow: callback => callback(320, 600, 42, 42) });
    trigger.props.onPress();

    const openMenu = render();
    const layer = elements(openMenu).find(element => element.props.testID === 'attachment-actions-layer');
    layer.props.ref.current = { measureInWindow: callback => callback(8, 28, 364, 700) };
    const modal = elements(openMenu).find(element => element.type === 'Modal' && element.props.visible);
    modal.props.onShow();
    const unmeasuredPopup = elements(render()).find(element => element.props.testID === 'attachment-actions-menu');
    unmeasuredPopup.props.onLayout({ nativeEvent: { layout: { height: 200 } } });

    const popup = elements(render()).find(element => element.props.testID === 'attachment-actions-menu');
    const style = flatStyle(popup.props.style);
    const expected = getNoteActionsMenuLayout(
      { x: 320, y: 600, width: 42, height: 42 },
      { x: 8, y: 28, width: 364, height: 700 },
      200,
    );
    assert.deepEqual({ left: style.left, top: style.top, width: style.width, maxHeight: style.maxHeight }, expected);
    assert.equal(style.position, 'absolute');
    assert.equal(style.borderRadius, 14);
    assert.equal(popup.props.pointerEvents, 'auto');
    assert.equal(popup.props.accessibilityViewIsModal, true);
    assert.equal(popup.props.accessibilityElementsHidden, false);

    const buttons = elements(popup).filter(element => element.type === 'Pressable');
    assert.deepEqual(buttons.map(button => button.props.accessibilityLabel), [
      'Preview diagram.png', 'Share diagram.png', 'Rename diagram.png', 'Remove diagram.png',
    ]);
    assert.deepEqual(elements(popup).filter(element => element.type === 'FontAwesome').map(icon => icon.props.name), [
      'eye', 'share-alt', 'pencil', 'trash-o',
    ]);
    const remove = elements(popup).find(element => element.type === 'Text' && text(element) === 'Remove');
    assert.equal(flatStyle(remove.props.style).color, '#b3261e');
    assert.doesNotMatch(text(popup), /Cancel|diagram\.png/);
    for (const button of buttons) assert.ok(flatStyle(button.props.style({ pressed: false })).minHeight >= 44);
  }
});
