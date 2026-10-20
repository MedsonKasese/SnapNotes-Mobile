import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');
test('checklist preview exposes checkbox accessibility state', () => {
  assert.match(source, /accessibilityRole="checkbox"/);
  assert.match(source, /accessibilityState=\{\{ checked \}\}/);
});
test('toggling opens editor draft rather than silently changing saved data', () => {
  assert.match(source, /function toggleChecklistItem/);
  assert.match(source, /dispatch\(\{ type: 'edit', id: noteId \}\)/);
  assert.match(source, /dispatch\(\{ type: 'change', field: 'text', value: lines\.join\('\\n'\) \}\)/);
});

test('checklist parser uses whitespace regexes rather than literal backslashes', () => {
  assert.match(source, /const match = \/\^\(\\s\*\)\(☐\|☑\)\(\\s\)\//);
  assert.match(source, /const checklist = \/\^\(\\s\*\)\(☐\|☑\)\(\\s\)\(\.\*\)\$\//);
});
