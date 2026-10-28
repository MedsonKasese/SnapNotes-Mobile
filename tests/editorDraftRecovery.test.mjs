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
  assert.match(source, /const restoreEditorDraft = useCallback\(async \(\) => \{\s*if \(controller\.getSnapshot\(\)\.status !== 'ready'\) return;[\s\S]*?AsyncStorage\.getItem/);
  assert.match(source, /type: 'restore-draft'/);
  assert.match(source, /setView\('editor'\)/);
});

test('startup restores React state only after notes loading completes', async () => {
  const effect = source.match(/useEffect\(\(\) => \{\s*\/\/ Restore React state from the storage completion callback, not the effect body\.\s*([\s\S]*?)\s*\}, \[controller, restoreEditorDraft\]\);/);
  assert.ok(effect, 'startup effect must subscribe to notes-load completion');
  let finishLoad;
  const loading = new Promise(resolve => { finishLoad = resolve; });
  let loads = 0;
  let restores = 0;
  const controller = { load() { loads += 1; return loading; } };
  const runEffect = new Function('controller', 'restoreEditorDraft', effect[1]);

  runEffect(controller, () => { restores += 1; });
  assert.equal(loads, 1);
  assert.equal(restores, 0, 'restoration must not run synchronously in the effect');
  finishLoad();
  await loading;
  assert.equal(restores, 1);
});

test('retry loading notes also waits for completion before restoring the draft', () => {
  assert.match(source, /label="Retry loading notes" onPress=\{\(\) => \{ void controller\.load\(\)\.then\(restoreEditorDraft\); \}\}/);
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
