import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { characterCount, MAX_NOTE_CHARACTERS, validateDraft } from '../src/notes.ts';
import { noteHtmlToText } from '../src/noteFormatting.ts';

const source = readFileSync(new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');
const toolbar = readFileSync(new URL('../src/components/FormattingToolbar.tsx', import.meta.url), 'utf8');

test('toolbar Checkbox action bridges to the rich editor checklist command', () => {
  assert.match(source, /<FormattingToolbar disabled=\{saving \|\| !editorReady\} active=\{formattingState\} onAction=\{formatNote\} \/>/);
  assert.match(source, /function formatNote\(action: FormattingAction\)[\s\S]*?else bodyEditor\.current\?\.command\(action\)/);
  assert.match(toolbar, /\{ action: 'checklist', label: 'Checkbox'/);
  assert.doesNotMatch(source, /\+ Checklist item/);
});

test('character count and validation use visible text from formatted content', () => {
  const visibleText = noteHtmlToText(`<div><strong>${'x'.repeat(MAX_NOTE_CHARACTERS)}</strong></div>`);
  const atLimit = { title: '', text: visibleText, html: `<div><strong>${'x'.repeat(MAX_NOTE_CHARACTERS)}</strong></div>` };
  assert.equal(visibleText.length, MAX_NOTE_CHARACTERS);
  assert.equal(characterCount(atLimit), MAX_NOTE_CHARACTERS);
  assert.equal(validateDraft(atLimit), null);

  const overLimitText = noteHtmlToText(`<div><strong>${'x'.repeat(MAX_NOTE_CHARACTERS + 1)}</strong></div>`);
  const overLimit = { title: '', text: overLimitText, html: `<div><strong>${'x'.repeat(MAX_NOTE_CHARACTERS + 1)}</strong></div>` };
  assert.equal(characterCount(overLimit), MAX_NOTE_CHARACTERS + 1);
  assert.match(validateDraft(overLimit), /Note is too long/);
});
