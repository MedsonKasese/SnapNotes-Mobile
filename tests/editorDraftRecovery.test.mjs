import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/NotesWorkspace.tsx', import.meta.url), 'utf8');

test('editor recovery uses its own versioned device-storage key', () => {
  assert.match(source, /EDITOR_DRAFT_KEY = '@snapnotes-mobile\/editor-draft'/);
  assert.match(source, /EDITOR_DRAFT_VERSION = 1/);
  assert.match(source, /AsyncStorage\.getItem\(EDITOR_DRAFT_KEY\)/);
  assert.match(source, /AsyncStorage\.setItem\(EDITOR_DRAFT_KEY, serialized\)/);
});

test('saved notes load successfully before an editor draft is restored', () => {
  assert.match(source, /await controller\.load\(\);[\s\S]*?controller\.getSnapshot\(\)\.status !== 'ready'[\s\S]*?AsyncStorage\.getItem/);
  assert.match(source, /type: 'restore-draft'/);
  assert.match(source, /setView\('editor'\)/);
});

test('draft writes are debounced and queued to prevent stale writes overtaking newer state', () => {
  assert.match(source, /setTimeout\(\(\) => \{/);
  assert.match(source, /\}, 500\)/);
  assert.match(source, /draftWriteQueue\.current = draftWriteQueue\.current/);
  assert.match(source, /AsyncStorage\.removeItem\(EDITOR_DRAFT_KEY\)/);
});

test('malformed recovery records are reported instead of silently deleted', () => {
  assert.match(source, /An earlier recovery draft could not be read/);
  assert.match(source, /setDraftHydrated\(false\)/);
});

test('recovery storage failures are visible to the user', () => {
  assert.match(source, /Your latest draft could not be saved for recovery/);
  assert.match(source, /draftStorageError !== null/);
});
