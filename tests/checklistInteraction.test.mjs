import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../src/notesController.ts', import.meta.url), 'utf8');

test('checklist preview exposes accessible checked and disabled states during writes', () => {
  assert.match(source, /accessibilityRole="checkbox"/);
  assert.match(source, /accessibilityState=\{\{ checked, disabled: saving \}\}/);
  assert.match(source, /disabled=\{saving\}/);
});

test('toggling a checklist item persists directly without opening the editor', () => {
  assert.match(source, /function toggleChecklistItem/);
  assert.match(source, /controller\.updateNoteText\(noteId, lines\.join\('\\n'\), new Date\(\)\.toISOString\(\)\)/);
  assert.doesNotMatch(source.slice(source.indexOf('function toggleChecklistItem'), source.indexOf('function saveNote')), /setView\('editor'\)/);
  assert.match(controller, /async function updateNoteText\(id: string, text: string, now: string\)/);
  assert.match(controller, /await storage\.save\(notes\)/);
  assert.match(controller, /Could not save this checklist change on this device/);
});

test('checklist rows remove excess height and keep wrapped labels aligned', () => {
  assert.match(source, /notePreview: \{ gap: 0 \}/);
  assert.match(source, /checklistRow: \{[^}]*minHeight: 28, paddingVertical: 2/);
  assert.match(source, /checklistRow: \{[^}]*alignItems: 'flex-start'/);
  assert.match(source, /checkboxGlyph: \{[^}]*includeFontPadding: false, flexShrink: 0/);
  assert.match(source, /<ChecklistLabel text=\{checklist\[4\]\} checked=\{checked\}/);
});

test('checklist parser uses whitespace regexes rather than literal backslashes', () => {
  assert.match(source, /const match = \/\^\(\\s\*\)\(☐\|☑\)\(\\s\)\//);
  assert.match(source, /const checklist = \/\^\(\\s\*\)\(☐\|☑\)\(\\s\)\(\.\*\)\$\//);
});
