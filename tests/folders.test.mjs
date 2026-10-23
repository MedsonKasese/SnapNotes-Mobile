import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FOLDERS, normalizeFolderName, parseFolders, validateFolderName, makeFolderId } from '../src/folders.ts';
import { createNotesController } from '../src/notesController.ts';

const NOW = '2026-10-23T09:00:00.000Z';
const note = { id: 'local-note-1', title: 'Test', text: 'Content', category: 'general', createdAt: NOW, updatedAt: NOW, pinned: false, archived: false, deletedAt: null };
const folder = { id: 'folder-1', name: 'Research', icon: 'folder', color: '', createdAt: NOW, updatedAt: NOW };

test('folder names follow PWA length, whitespace, duplicate and count rules', () => {
  assert.equal(normalizeFolderName('  Research    Notes  '), 'Research Notes');
  assert.equal(normalizeFolderName('x'.repeat(40)).length, 32);
  assert.match(validateFolderName([folder], 'research'), /already exists/);
  assert.equal(validateFolderName([folder], 'Research', folder.id), null);
  assert.match(validateFolderName([], ''), /Enter/);
  assert.match(validateFolderName(Array.from({ length: MAX_FOLDERS }, (_, i) => ({ ...folder, id: String(i), name: String(i) })), 'Another'), /20/);
});

test('folder parsing preserves data and rejects corrupt records', () => {
  assert.deepEqual(parseFolders(null), []);
  assert.deepEqual(parseFolders(JSON.stringify([folder])), [folder]);
  assert.throws(() => parseFolders('{"invalid":true}'));
  assert.throws(() => parseFolders(JSON.stringify([folder, folder])));
  assert.notEqual(makeFolderId([folder], NOW), folder.id);
});

test('moving notes into and out of folders persists without changing edit time', async () => {
  let stored = [note];
  const controller = createNotesController({ async load() { return stored; }, async save(notes) { stored = notes; } });
  await controller.load();
  await controller.moveNoteToFolder(note.id, folder.id);
  assert.equal(stored[0].folderId, folder.id);
  assert.equal(stored[0].updatedAt, NOW);
  await controller.clearFolder(folder.id);
  assert.equal(stored[0].folderId, null);
  assert.equal(stored[0].text, note.text);
});

test('failed unfiling refuses folder deletion and keeps original data', async () => {
  const original = { ...note, folderId: folder.id };
  const controller = createNotesController({ async load() { return [original]; }, async save() { throw Error('storage unavailable'); } });
  await controller.load();
  assert.equal(await controller.clearFolder(folder.id), false);
  assert.deepEqual(controller.getSnapshot().state.notes, [original]);
});
