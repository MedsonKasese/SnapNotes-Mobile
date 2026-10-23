import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as formatting from '../src/noteFormatting.ts';
import { RICH_EDITOR_DOCUMENT } from '../src/richEditorDocument.ts';

const require = createRequire(import.meta.url);
function loadComponent(file, react, extras = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, setTimeout, clearTimeout, Map, Error, JSON,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return { ...Object.fromEntries(['Pressable', 'ScrollView', 'View', 'Text'].map(name => [name, name])), StyleSheet: { create: styles => styles } };
      if (name === '@expo/vector-icons/FontAwesome') return { __esModule: true, default: 'FontAwesome' };
      if (name in extras) return extras[name];
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return exports;
}
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree?.props) return [];
  return [tree, ...elements(tree.props.children)];
}
function editor(initial = {}) {
  const refs = [], states = [], effects = [], changed = [], readiness = [], selections = [], sent = [];
  let refCursor = 0, stateCursor = 0, effectCursor = 0;
  const handle = { current: null };
  const native = { postMessage: value => sent.push(JSON.parse(value)) };
  const props = { text: 'Hello', editable: true, onChange: value => changed.push(value), onReady: value => readiness.push(value), onSelection: value => selections.push(value), ...initial };
  const { RichNoteEditor } = loadComponent('../src/components/RichNoteEditor.tsx', {
    forwardRef: callback => callback,
    useRef(value) { const index = refCursor++; return refs[index] ??= { current: value }; },
    useState(value) { const index = stateCursor++; if (!(index in states)) states[index] = value; return [states[index], next => { states[index] = next; }]; },
    useCallback: callback => callback,
    useEffect(callback, dependencies) { const index = effectCursor++; const old = effects[index]; if (!old || dependencies.some((dep, i) => dep !== old.dependencies[i])) effects[index] = { callback, dependencies, pending: true, cleanup: old?.cleanup }; },
    useImperativeHandle(ref, create) { ref.current = create(); },
  }, { 'react-native-webview': { WebView: 'WebView' }, '../noteFormatting': formatting, '../richEditorDocument': { RICH_EDITOR_DOCUMENT } });
  let tree;
  function render() {
    refCursor = stateCursor = effectCursor = 0;
    tree = RichNoteEditor(props, handle);
    const web = elements(tree).find(e => e.type === 'WebView');
    if (web) web.props.ref.current = native;
    for (const effect of effects) if (effect.pending) { effect.cleanup?.(); effect.cleanup = effect.callback(); effect.pending = false; }
    return tree;
  }
  render();
  const web = () => elements(tree).find(e => e.type === 'WebView');
  return {
    props, sent, changed, readiness, selections, handle, render, web,
    message(value) { web().props.onMessage({ nativeEvent: { data: typeof value === 'string' ? value : JSON.stringify(value) } }); },
    unmount() { for (const effect of effects) effect.cleanup?.(); },
  };
}

test('six icon-only tools keep PWA order, labels, active state, and 44-point targets', () => {
  const { FormattingToolbar } = loadComponent('../src/components/FormattingToolbar.tsx', {});
  const actions = [];
  const tree = FormattingToolbar({ disabled: false, active: { bold: true }, onAction: action => actions.push(action) });
  const buttons = elements(tree).filter(e => e.type === 'Pressable');
  assert.deepEqual(buttons.map(e => e.props.accessibilityLabel), ['Bold', 'Italics', 'Unordered list', 'Ordered list', 'Checkbox', 'Insert link']);
  assert.equal(buttons[0].props.accessibilityState.selected, true);
  assert.equal(elements(tree).filter(e => e.type === 'Text').length, 0);
  for (const button of buttons) {
    assert.equal(button.props.style({ pressed: false })[0].width, 44);
    assert.equal(button.props.style({ pressed: false })[0].height, 44);
    button.props.onPress();
  }
  assert.deepEqual(actions, ['bold', 'italic', 'insertUnorderedList', 'insertOrderedList', 'checklist', 'link']);
  assert.ok(elements(FormattingToolbar({ disabled: true, active: {}, onAction() {} })).filter(e => e.type === 'Pressable').every(e => e.props.disabled));
});

test('editor initializes from sanitized data and blocks navigation, file access, and popups', () => {
  const app = editor({ html: '<b>Hello</b><script>alert(1)</script>' });
  app.message({ type: 'ready' });
  assert.equal(app.sent.at(-1).html, '<b>Hello</b>');
  assert.equal(app.readiness.at(-1), true);
  const props = app.web().props;
  assert.equal(props.onShouldStartLoadWithRequest({ url: 'about:blank' }), true);
  for (const url of ['https://example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,evil']) assert.equal(props.onShouldStartLoadWithRequest({ url }), false);
  assert.equal(props.allowFileAccess, false);
  assert.equal(props.javaScriptCanOpenWindowsAutomatically, false);
  assert.match(RICH_EDITOR_DOCUMENT, /default-src 'none'/);
  app.unmount();
});

test('typing emits sanitized HTML and visible text without replacing the editor document', () => {
  const app = editor();
  app.message({ type: 'ready' });
  const source = app.web().props.source;
  app.message({ type: 'change', html: '<b>Hello</b><img src="https://bad.test/x" onerror="alert(1)">' });
  assert.equal(app.changed.at(-1).html, '<b>Hello</b>');
  assert.equal(app.changed.at(-1).text, 'Hello');
  app.props.html = '<b>Hello</b>';
  app.props.text = 'Hello';
  app.render();
  assert.equal(app.web().props.source, source);
  assert.equal(app.sent.filter(m => m.type === 'set-content').length, 1);
  for (const malformed of ['{', 'null', '[]', JSON.stringify({ type: 'change', html: 42 }), 'x'.repeat(200001)]) app.message(malformed);
  assert.equal(app.changed.length, 1);
  app.unmount();
});

test('bridge preserves command order and snapshot waits for its matching response', async () => {
  const app = editor();
  await assert.rejects(app.handle.current.getContent(), /not ready/);
  app.handle.current.command('bold');
  assert.equal(app.sent.length, 0);
  app.message({ type: 'ready' });
  app.handle.current.rememberSelection();
  app.handle.current.command('bold');
  app.handle.current.command('link', 'https://example.com/');
  let resolved = false;
  const content = app.handle.current.getContent().then(value => { resolved = true; return value; });
  const request = app.sent.at(-1);
  assert.deepEqual(app.sent.slice(-4).map(m => m.type), ['remember', 'command', 'command', 'snapshot']);
  app.message({ type: 'snapshot', id: request.id - 1, html: 'stale' });
  await Promise.resolve();
  assert.equal(resolved, false);
  app.message({ type: 'snapshot', id: request.id, html: '<i>Final edit</i>' });
  assert.equal((await content).html, '<i>Final edit</i>');
  assert.equal(app.changed.length, 0, 'snapshot does not race editor ownership by dispatching a change itself');
  app.unmount();
});

test('editor failure rejects an outstanding save and offers reload with the draft retained', async () => {
  const app = editor({ text: 'Keep my draft' });
  app.message({ type: 'ready' });
  const content = app.handle.current.getContent();
  app.web().props.onRenderProcessGone();
  await assert.rejects(content, /draft has been kept/);
  assert.equal(app.readiness.at(-1), false);
  const tree = app.render();
  const retry = elements(tree).find(e => e.props.accessibilityLabel === 'Reload note editor');
  assert.ok(retry);
  retry.props.onPress();
  app.render();
  app.message({ type: 'ready' });
  assert.match(app.sent.at(-1).html, /Keep my draft/);
  app.unmount();
});

test('typing undo/redo use ordered bridge commands only while the editor is ready and editable', () => {
  const app = editor();
  app.handle.current.undo();
  app.handle.current.redo();
  assert.equal(app.sent.length, 0);
  app.message({ type: 'ready' });
  app.handle.current.undo();
  app.handle.current.redo();
  const commands = app.sent.filter(message => message.type === 'command');
  assert.deepEqual(commands.map(message => message.command), ['undo', 'redo']);
  assert.ok(commands[0].id < commands[1].id);
  app.message({ type: 'change', html: '<i>Restored body</i>' });
  assert.equal(app.changed.at(-1).text, 'Restored body');
  assert.equal(app.changed.at(-1).html, '<i>Restored body</i>');
  app.props.editable = false;
  app.render();
  app.handle.current.undo();
  app.handle.current.redo();
  assert.equal(app.sent.filter(message => message.type === 'command').length, 2);
  app.props.editable = true;
  app.render();
  app.web().props.onRenderProcessGone();
  app.handle.current.undo();
  app.handle.current.redo();
  assert.equal(app.sent.filter(message => message.type === 'command').length, 2);
  app.unmount();
});

test('offline document executes undo/redo once per bridge id and reports the resulting body', () => {
  const events = {}, sent = [], commands = [];
  const selection = { rangeCount: 0, removeAllRanges() {}, addRange() {} };
  const range = { selectNodeContents() {}, collapse() {} };
  const body = {
    innerHTML: '<b>After</b>', contentEditable: 'true',
    addEventListener() {}, focus() {}, contains() { return false; },
  };
  const document = {
    getElementById() { return body; },
    addEventListener(name, callback) { events[name] = callback; },
    createRange() { return range; },
    queryCommandState() { return false; },
    execCommand(command) {
      commands.push(command);
      body.innerHTML = command === 'undo' ? '<i>Before</i>' : '<b>After</b>';
    },
  };
  const window = {
    getSelection() { return selection; },
    addEventListener(name, callback) { events[`window:${name}`] = callback; },
    ReactNativeWebView: { postMessage(value) { sent.push(JSON.parse(value)); } },
  };
  const script = RICH_EDITOR_DOCUMENT.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, { window, document });
  const undo = { data: JSON.stringify({ type: 'command', command: 'undo', id: 1 }) };
  events.message(undo);
  events['window:message'](undo);
  assert.deepEqual(commands, ['undo']);
  assert.equal(sent.at(-1).type, 'change');
  assert.equal(sent.at(-1).html, '<i>Before</i>');
  events.message({ data: JSON.stringify({ type: 'command', command: 'redo', id: 2 }) });
  assert.deepEqual(commands, ['undo', 'redo']);
  assert.equal(sent.at(-1).html, '<b>After</b>');
  body.contentEditable = 'false';
  events.message({ data: JSON.stringify({ type: 'command', command: 'undo', id: 3 }) });
  assert.deepEqual(commands, ['undo', 'redo']);
});
