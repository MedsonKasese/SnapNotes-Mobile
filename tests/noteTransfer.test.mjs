import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPwaExportPayload,
  hasPrivateExportFields,
  mergeImportedFolders,
  parsePwaImport,
  serializeNotesForExport,
} from '../src/noteTransfer.ts';

const CREATED = '2026-10-20T08:15:00.000Z';
const UPDATED = '2026-10-21T09:30:00.000Z';
const EXPORTED = '2026-10-31T12:00:00.000Z';
const note = {
  id: 'note-1', title: 'Trip plan', text: 'Book tickets', category: 'ideas',
  createdAt: CREATED, updatedAt: UPDATED, pinned: true, archived: false,
  deletedAt: null, folderId: 'folder-1',
};
const folder = {
  id: 'folder-1', name: 'Travel', icon: 'book', color: 'blue',
  createdAt: CREATED, updatedAt: UPDATED,
};

test('JSON export uses the PWA version-1 envelope and preserves timestamps and folder metadata', () => {
  const payload = createPwaExportPayload([note], [folder], EXPORTED);
  assert.equal(payload.app, 'SnapNotes');
  assert.equal(payload.version, 1);
  assert.equal(payload.exportedAt, EXPORTED);
  assert.deepEqual(payload.notes[0], note);
  assert.equal(payload.folders[0].id, folder.id);
  assert.equal(payload.folders[0].createdAt, CREATED);
  const serialized = serializeNotesForExport('json', [note], [folder], EXPORTED);
  assert.equal(serialized.extension, 'json');
  assert.equal(serialized.mimeType, 'application/json');
  assert.deepEqual(JSON.parse(serialized.content), payload);
});

test('exports omit Private Notes, encrypted payload fields, and local attachment references', () => {
  const privateNote = {
    ...note, id: 'private-1', isPrivate: true,
    privateData: { ciphertext: 'never-export-this' },
    attachments: [{ fileKey: 'local-secret-file' }],
  };
  const ordinaryNoteWithUnexpectedFields = {
    ...note, privateData: null,
    attachments: [{ fileKey: 'local-secret-file', uri: 'file:///private/path' }],
  };
  const payload = createPwaExportPayload([privateNote, ordinaryNoteWithUnexpectedFields], [], EXPORTED);
  assert.equal(payload.notes.length, 1);
  assert.equal(payload.notes[0].id, note.id);
  assert.equal(JSON.stringify(payload).includes('never-export-this'), false);
  assert.equal(JSON.stringify(payload).includes('local-secret-file'), false);
  assert.equal(JSON.stringify(payload).includes('file:///private/path'), false);
  assert.equal(hasPrivateExportFields(privateNote), true);
});

test('Markdown and TXT output match the PWA text formatting', () => {
  const markdown = serializeNotesForExport('markdown', [note], [], EXPORTED);
  assert.equal(markdown.extension, 'md');
  assert.equal(markdown.mimeType, 'text/markdown');
  assert.equal(markdown.content, '# Trip plan\n\nBook tickets\n\n---');
  const text = serializeNotesForExport('txt', [note, { ...note, id: 'note-2', title: '', text: 'Second note' }], [], EXPORTED);
  assert.equal(text.extension, 'txt');
  assert.equal(text.mimeType, 'text/plain');
  assert.equal(text.content, 'Trip plan\nBook tickets\n\n====================\n\nUntitled note\nSecond note');
});

test('PWA import preserves supported state and timestamps while discarding attachments and private records', () => {
  const imported = parsePwaImport(JSON.stringify({
    app: 'SnapNotes', version: 1,
    notes: [
      { ...note, html: '<p>Book tickets</p><script>malicious()</script>', attachments: [{ downloadUrl: 'https://example.test/file' }] },
      { id: 'private-note', title: 'Secret', text: 'hidden', isPrivate: true, privateData: { ciphertext: 'secret' } },
      { id: 'legacy', title: 'Legacy', text: 'Body', category: 'unknown', createdAt: 'not-a-date' },
    ],
    folders: [folder],
  }), EXPORTED);
  assert.equal(imported.notes.length, 2);
  assert.equal(imported.privateNotesSkipped, 1);
  assert.equal(imported.notes[0].title, note.title);
  assert.equal(imported.notes[0].createdAt, CREATED);
  assert.equal(imported.notes[0].updatedAt, UPDATED);
  assert.equal(imported.notes[0].pinned, true);
  assert.equal(imported.notes[0].folderId, folder.id);
  assert.equal(imported.notes[0].html.includes('<script'), false);
  assert.equal('attachments' in imported.notes[0], false);
  assert.equal(imported.notes[1].category, 'general');
  assert.equal(imported.notes[1].createdAt, EXPORTED);
  assert.equal(imported.folders[0].createdAt, CREATED);
});

test('PWA import accepts legacy arrays, rejects malformed files and does not accept invalid notes', () => {
  const legacy = parsePwaImport(JSON.stringify([{ title: 'Legacy', text: 'Body' }]), EXPORTED);
  assert.equal(legacy.notes.length, 1);
  assert.equal(legacy.notes[0].updatedAt, EXPORTED);
  assert.throws(() => parsePwaImport('{broken', EXPORTED), /valid JSON/);
  assert.throws(() => parsePwaImport(JSON.stringify({ notes: 'not an array' }), EXPORTED), /notes array/);
  assert.throws(() => parsePwaImport(JSON.stringify({ notes: [{ title: 'Too long', text: 'x'.repeat(1600) }] }), EXPORTED), /cannot be safely imported/);
});

test('folder merge reuses existing IDs or names and maps imported IDs for note references', () => {
  const existing = [folder];
  const incoming = [
    { ...folder, id: 'same-id', name: 'Travel' },
    { ...folder, id: 'folder-1', name: 'Different name' },
    { ...folder, id: 'new-folder', name: 'Work' },
  ];
  const merged = mergeImportedFolders(existing, incoming, EXPORTED);
  assert.equal(merged.folders.length, 2);
  assert.equal(merged.idMap.get('same-id'), 'folder-1');
  assert.equal(merged.idMap.get('folder-1'), 'folder-1');
  assert.equal(merged.idMap.get('new-folder'), 'new-folder');
  assert.equal(merged.folders[1].name, 'Work');
});


test('ordinary reminder metadata round-trips through JSON while private scheduling keys stay excluded', () => {
  const reminderAt = '2026-10-30T09:00:00.000Z';
  const reminderRepeat = { frequency: 'weekly', interval: 2, timeZone: 'Africa/Blantyre', anchorAt: reminderAt };
  const ordinary = { ...note, reminderAt, reminderNotified: false, reminderRepeat, reminderScheduleKey: 'must-not-be-exported' };
  const privateNote = { ...ordinary, id: 'private-note', isPrivate: true, privateData: { ciphertext: 'private-ciphertext' } };
  const payload = createPwaExportPayload([ordinary, privateNote], [], EXPORTED);
  assert.equal(payload.notes.length, 1);
  assert.equal(payload.notes[0].reminderAt, reminderAt);
  assert.equal(payload.notes[0].reminderNotified, false);
  assert.deepEqual(payload.notes[0].reminderRepeat, reminderRepeat);
  assert.equal('reminderScheduleKey' in payload.notes[0], false);
  assert.equal(JSON.stringify(payload).includes('must-not-be-exported'), false);
  assert.equal(JSON.stringify(payload).includes('private-ciphertext'), false);

  const imported = parsePwaImport(JSON.stringify(payload), EXPORTED);
  assert.equal(imported.notes[0].reminderAt, reminderAt);
  assert.equal(imported.notes[0].reminderNotified, false);
  assert.deepEqual(imported.notes[0].reminderRepeat, reminderRepeat);
});

test('malformed repeating reminder metadata is rejected during PWA import', () => {
  const bad = { ...note, reminderAt: '2026-10-30T09:00:00.000Z',
    reminderRepeat: { frequency: 'daily', interval: 0, timeZone: 'UTC', anchorAt: '2026-10-30T09:00:00.000Z' } };
  assert.throws(() => parsePwaImport(JSON.stringify([bad]), EXPORTED), /repeat schedule/);
});
