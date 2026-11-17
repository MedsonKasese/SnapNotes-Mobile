import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNoteShareText } from '../src/noteSharing.ts';
import { isNewNoteWidgetUrl, NEW_NOTE_WIDGET_URL } from '../src/widgetNavigation.ts';
import { initialNotesState, notesReducer, MAX_NOTE_VERSIONS } from '../src/notes.ts';

const createdAt = '2026-10-19T18:00:00.000Z';

test('recognizes only the SnapNotes New Note widget link', () => {
  assert.equal(isNewNoteWidgetUrl(NEW_NOTE_WIDGET_URL), true);
  assert.equal(isNewNoteWidgetUrl('SNAPNOTES://WIDGET/NEW-NOTE/?source=launcher'), true);
  assert.equal(isNewNoteWidgetUrl('snapnotes://widget/other'), false);
  assert.equal(isNewNoteWidgetUrl('https://snapnotes.example/widget/new-note'), false);
  assert.equal(isNewNoteWidgetUrl(null), false);
});

test('share text matches the PWA title/body format', () => {
  assert.equal(buildNoteShareText({ title: '  Trip plan ', text: '  Book tickets\r\nPack a bag  ' }), 'Trip plan\n\nBook tickets\nPack a bag');
  assert.equal(buildNoteShareText({ title: '', text: ' Body ' }), 'Body');
});

test('ordinary note edits keep the previous snapshot, avoid duplicates, and cap history at 20', () => {
  let state = notesReducer(initialNotesState(), { type: 'change', field: 'title', value: 'Revision 0' });
  state = notesReducer(state, { type: 'change', field: 'text', value: 'Body 0' });
  state = notesReducer(state, { type: 'save', id: 'note-1', now: createdAt });

  for (let revision = 1; revision <= 22; revision += 1) {
    state = notesReducer(state, { type: 'edit', id: 'note-1' });
    state = notesReducer(state, { type: 'change', field: 'title', value: `Revision ${revision}` });
    state = notesReducer(state, { type: 'change', field: 'text', value: `Body ${revision}` });
    state = notesReducer(state, { type: 'save', id: 'unused-id', now: new Date(Date.parse(createdAt) + revision * 1000).toISOString() });
  }

  const saved = state.notes[0];
  assert.equal(saved.title, 'Revision 22');
  assert.equal(saved.versions.length, MAX_NOTE_VERSIONS);
  assert.equal(saved.versions[0].title, 'Revision 2');
  assert.equal(saved.versions.at(-1).title, 'Revision 21');
  assert.equal(saved.versions.at(-1).text, 'Body 21');
  assert.equal(saved.versions.at(-1).time, createdAt);

  state = notesReducer(state, { type: 'edit', id: 'note-1' });
  state = notesReducer(state, { type: 'save', id: 'unused-id', now: new Date(Date.parse(createdAt) + 30_000).toISOString() });
  assert.equal(state.notes[0].versions.length, MAX_NOTE_VERSIONS);
  assert.equal(state.notes[0].versions.at(-1).title, 'Revision 21');
});
