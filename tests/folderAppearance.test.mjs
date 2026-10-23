import test from 'node:test';
import assert from 'node:assert/strict';
import { FOLDER_ICON_NAMES, FOLDER_COLOR_VALUES, normalizeFolderIcon, normalizeFolderColor, parseFolders } from '../src/folders.ts';
const timestamp = '2026-10-23T12:00:00.000Z';
test('PWA folder icon and color choices are supported', () => {
  assert.deepEqual(FOLDER_ICON_NAMES, ['folder', 'book', 'flask', 'code', 'lightbulb', 'briefcase', 'heart', 'star', 'cloud']);
  assert.equal(Object.keys(FOLDER_COLOR_VALUES).length, 6);
  assert.equal(normalizeFolderIcon('star'), 'star');
  assert.equal(normalizeFolderColor('teal'), 'teal');
});
test('unknown appearance values safely fall back and preserve folder identity', () => {
  const original = { id: 'f1', name: 'Ideas', icon: 'unsafe-icon', color: 'unsafe-color', createdAt: timestamp, updatedAt: timestamp };
  const [folder] = parseFolders(JSON.stringify([original]));
  assert.equal(folder.id, 'f1');
  assert.equal(folder.name, 'Ideas');
  assert.equal(folder.icon, 'folder');
  assert.equal(folder.color, '');
});
test('chosen appearance survives serialized folder reload', () => {
  const folder = { id: 'f2', name: 'Work', icon: 'briefcase', color: 'blue', createdAt: timestamp, updatedAt: timestamp };
  assert.deepEqual(parseFolders(JSON.stringify([folder])), [folder]);
});
