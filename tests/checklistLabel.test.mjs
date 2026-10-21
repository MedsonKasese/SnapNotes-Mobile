import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/components/ChecklistLabel.tsx', import.meta.url), 'utf8');

// Exercise component output/events with native primitives stubbed out. This is
// not a native layout test; Android still needs visual/font-scaling verification.
function renderLabel() {
  let state = null;
  const exports = {};
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name === 'react') return { useState: () => [state, value => { state = value; }] };
      if (name === 'react-native') return {
        Text: 'Text', View: 'View',
        StyleSheet: { create: styles => styles, absoluteFill: { position: 'absolute' } },
      };
      if (name === 'react/jsx-runtime') return require(name);
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return props => exports.ChecklistLabel(props);
}

const labelText = tree => tree.props.children[0];
const overlay = tree => tree.props.children[1];

test('checked labels are italic and render a two-point stroke for each nonblank wrapped line', () => {
  const render = renderLabel();
  let tree = render({ text: 'Buy groceries today', checked: true });
  assert.equal(labelText(tree).props.style[1].fontStyle, 'italic');
  assert.equal(tree.props.style[0].flex, 1);
  assert.equal(tree.props.style[0].minWidth, 0);
  labelText(tree).props.onTextLayout({ nativeEvent: { lines: [
    { text: 'Buy groceries', x: 0, y: 0, width: 90, height: 21 },
    { text: 'today', x: 0, y: 21, width: 35, height: 21 },
    { text: ' ', x: 0, y: 42, width: 4, height: 21 },
  ] } });
  tree = render({ text: 'Buy groceries today', checked: true });
  const strokes = overlay(tree).props.children;
  assert.equal(strokes.length, 2);
  assert.equal(strokes[0].props.style[0].height, 2);
  assert.equal(strokes[0].props.style[1].width, 90);
  assert.equal(strokes[1].props.style[1].width, 35);
  assert.equal(strokes[1].props.style[1].top, 30.5);
  assert.equal(overlay(tree).props.pointerEvents, 'none');
  assert.equal(overlay(tree).props.accessible, false);
});

test('unchecking immediately removes italic styling and all strokes', () => {
  const render = renderLabel();
  const checked = render({ text: 'Task', checked: true });
  labelText(checked).props.onTextLayout({ nativeEvent: { lines: [
    { text: 'Task', x: 0, y: 0, width: 30, height: 21 },
  ] } });
  const unchecked = render({ text: 'Task', checked: false });
  assert.equal(labelText(unchecked).props.style[1], false);
  assert.equal(labelText(unchecked).props.onTextLayout, undefined);
  assert.equal(overlay(unchecked).props.children.length, 0);
});

test('changed text never reuses stale stroke widths while awaiting native layout', () => {
  const render = renderLabel();
  const first = render({ text: 'Task', checked: true });
  labelText(first).props.onTextLayout({ nativeEvent: { lines: [
    { text: 'Task', x: 0, y: 0, width: 30, height: 21 },
  ] } });
  const next = render({ text: 'A longer task', checked: true });
  assert.equal(overlay(next).props.children.length, 0);
});
