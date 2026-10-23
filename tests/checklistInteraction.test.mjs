import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../src/notesController.ts', import.meta.url), 'utf8');

test('checklist preview keeps native and accessible states in sync during writes and in Trash', () => {
  // Scope assertions to the checkbox, not an unrelated button's disabled prop.
  const checkbox = source.match(/<Pressable\b[^>]*accessibilityRole="checkbox"[\s\S]*?style=\{styles\.checklistRow\}>/)?.[0];
  assert.ok(checkbox, 'the checklist preview renders a checkbox');
  const accessibleState = checkbox.match(/accessibilityState=\{(\{[^\n]*\})\}/)?.[1];
  const disabled = checkbox.match(/\n\s+disabled=\{([^}]+)\}/)?.[1];
  assert.ok(accessibleState, 'checkbox exposes an accessibility state');
  assert.ok(disabled, 'checkbox has a native disabled prop');

  for (const view of ['library', 'archive', 'trash']) {
    for (const saving of [false, true]) {
      for (const checked of [false, true]) {
        const context = { view, saving, checked };
        const expectedDisabled = saving || view === 'trash';
        const state = runInNewContext(`(${accessibleState})`, context);
        const label = `${view}, saving=${saving}, checked=${checked}`;
        assert.equal(state.checked, checked, label);
        assert.equal(state.disabled, expectedDisabled, label);
        assert.equal(runInNewContext(disabled, context), expectedDisabled, label);
      }
    }
  }
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
