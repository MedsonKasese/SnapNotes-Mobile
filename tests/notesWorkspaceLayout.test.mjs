import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('NotesWorkspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function styleName(node) {
  if (!ts.isJsxElement(node)) return null;
  const style = node.openingElement.attributes.properties.find(attribute =>
    ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'style');
  return style?.initializer?.expression?.getText(tree) ?? null;
}

test('search controls sit after the storage warning and directly above the note editor', () => {
  let header;
  function visit(node) {
    if (styleName(node) === 'styles.header') header = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(header, 'Workspace list header must exist');
  const children = header.children.filter(child => !ts.isJsxText(child));
  const warningIndex = children.findIndex(child => styleName(child) === 'styles.warning');
  const searchIndex = children.findIndex(child => styleName(child) === 'styles.searchRow');
  const editorIndex = children.findIndex(child => styleName(child) === 'styles.editor');
  assert.ok(warningIndex >= 0, 'Keep the on-device storage warning visible');
  assert.equal(searchIndex, warningIndex + 1);
  assert.equal(editorIndex, searchIndex + 2, 'Only the conditional match count should separate search and editor');
  assert.ok(ts.isJsxExpression(children[searchIndex + 1]));
  assert.match(children[searchIndex + 1].getText(tree), /notes match/);
  assert.match(children[searchIndex].getText(tree), /accessibilityLabel="Search saved notes"/);
});
