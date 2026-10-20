import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');

test('native checklist button invokes the editor insertion action', () => {
  assert.match(source, /label="\+ Checklist item" secondary disabled=\{saving\} onPress=\{insertChecklistItem\}/);
});

test('checklist insertion uses PWA text marker and preserves existing content', () => {
  assert.match(source, /const current = state\.draft\.text/);
  assert.match(source, /current\.endsWith\('\\n'\)/);
  assert.match(source, /current \+ separator \+ '☐ '/);
  assert.match(source, /changeDraft\('text', next\)/);
});

test('insertion checks the existing note character limit', () => {
  assert.match(source, /characterCount\(\{ \.\.\.state\.draft, text: next \}\) > MAX_NOTE_CHARACTERS/);
});
