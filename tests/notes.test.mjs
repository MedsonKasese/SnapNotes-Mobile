import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_NOTE_CHARACTERS,
  characterCount,
  hasUnsavedChanges,
  initialNotesState,
  normalizeDraft,
  notesReducer,
  validateDraft,
} from '../src/notes.ts';

const CREATED_AT = '2025-01-02T03:04:05.000Z';
const UPDATED_AT = '2025-02-03T04:05:06.000Z';

function change(state, field, value) {
  return notesReducer(state, { type: 'change', field, value });
}

function fillDraft(state, { title = '', text = '' }) {
  return change(change(state, 'title', title), 'text', text);
}

function save(state, id = 'note-id', now = CREATED_AT) {
  return notesReducer(state, { type: 'save', id, now });
}

function createNote(id, { title = '', text = '' }, now = CREATED_AT) {
  return save(fillDraft(initialNotesState(), { title, text }), id, now).notes[0];
}

test('initial state is empty with a clean, blank draft', () => {
  const state = initialNotesState();
  assert.deepEqual(state, {
    notes: [],
    draft: { title: '', text: '' },
    editingId: null,
    error: null,
    notice: null,
  });
  assert.deepEqual(state.notes, []);
  assert.deepEqual(state.draft, { title: '', text: '' });
});

test('creates a body-only note with deterministic metadata', () => {
  const state = save(fillDraft(initialNotesState(), { text: 'A body' }), 'body-1', CREATED_AT);
  assert.deepEqual(state.notes, [{
    id: 'body-1',
    category: 'general',
    title: '',
    text: 'A body',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }]);
  assert.equal(state.notice, 'Note created.');
  assert.equal(state.editingId, null);
});

test('creates a title-only note with deterministic metadata', () => {
  const state = save(fillDraft(initialNotesState(), { title: 'A title' }), 'title-1', CREATED_AT);
  assert.equal(state.notes.length, 1);
  assert.equal(state.notes[0].title, 'A title');
  assert.equal(state.notes[0].text, '');
  assert.equal(state.notes[0].id, 'title-1');
  assert.equal(state.notes[0].createdAt, CREATED_AT);
  assert.equal(state.notes[0].updatedAt, CREATED_AT);
});

test('rejects a whitespace-only draft without creating a note', () => {
  const original = fillDraft(initialNotesState(), { title: ' \t\n ', text: ' \n\t ' });
  const state = save(original, 'should-not-exist', CREATED_AT);
  assert.equal(state.error, 'Write a title or note before saving.');
  assert.equal(state.notice, null);
  assert.deepEqual(state.notes, []);
  assert.deepEqual(state.draft, original.draft);
  assert.deepEqual(original.notes, []);
});

test('normalizes title whitespace and removes carriage returns before saving', () => {
  const original = { title: '  A title \t', text: '  first\r\nsecond\rthird  ' };
  assert.deepEqual(normalizeDraft(original), { title: 'A title', text: 'first\nsecondthird' });
  const state = save(fillDraft(initialNotesState(), original), 'normalized-1', CREATED_AT);
  assert.equal(state.notes[0].title, 'A title');
  assert.equal(state.notes[0].text, 'first\nsecondthird');
  assert.deepEqual(original, { title: '  A title \t', text: '  first\r\nsecond\rthird  ' });
});

test('uses one serialized title-plus-body character budget, including marker and newline', () => {
  const atLimit = { title: 't'.repeat(MAX_NOTE_CHARACTERS - 4), text: '' };
  const overLimit = { title: 't'.repeat(MAX_NOTE_CHARACTERS - 3), text: '' };
  assert.equal(characterCount(atLimit), MAX_NOTE_CHARACTERS);
  assert.equal(validateDraft(atLimit), null);
  assert.equal(characterCount(overLimit), MAX_NOTE_CHARACTERS + 1);
  assert.equal(validateDraft(overLimit), `Note is too long. Use ${MAX_NOTE_CHARACTERS} characters or fewer, including the title marker.`);
  assert.equal(validateDraft({ title: 't'.repeat(MAX_NOTE_CHARACTERS - 5), text: 'x' }), null);
});

test('edits are invisible until save; save preserves identity metadata and leaves other notes untouched', () => {
  const first = createNote('first-id', { title: 'First', text: 'Original body' }, CREATED_AT);
  const second = createNote('second-id', { text: 'Other note' }, '2024-12-01T00:00:00.000Z');
  const state = { ...initialNotesState(), notes: [first, second] };
  const editing = notesReducer(state, { type: 'edit', id: first.id });
  const changed = fillDraft(editing, { title: 'Updated title', text: 'Updated body' });

  assert.equal(state.notes[0], first);
  assert.equal(state.notes[1], second);
  assert.equal(editing.notes[0], first);
  assert.equal(changed.notes[0], first);
  assert.equal(first.title, 'First');
  assert.equal(first.text, 'Original body');
  assert.equal(hasUnsavedChanges(changed), true);

  const updated = save(changed, 'unused-create-id', UPDATED_AT);
  assert.deepEqual(updated.notes[0], {
    ...first,
    title: 'Updated title',
    text: 'Updated body',
    updatedAt: UPDATED_AT,
  });
  assert.equal(updated.notes[0].id, first.id);
  assert.equal(updated.notes[0].createdAt, CREATED_AT);
  assert.equal(updated.notes[0].category, 'general');
  assert.equal(updated.notes[1], second);
  assert.deepEqual(second, createNote('second-id', { text: 'Other note' }, '2024-12-01T00:00:00.000Z'));
  assert.equal(first.title, 'First');
  assert.equal(first.text, 'Original body');
  assert.equal(state.notes[0], first);
  assert.equal(updated.notice, 'Note updated.');
});

test('reset cancels an edit, clears the draft, and retains original notes unchanged', () => {
  const originalNote = createNote('original-id', { title: 'Original', text: 'Body' });
  const base = { ...initialNotesState(), notes: [originalNote] };
  const editing = notesReducer(base, { type: 'edit', id: originalNote.id });
  const changed = fillDraft(editing, { title: 'Unsaved title', text: 'Unsaved body' });
  const reset = notesReducer(changed, { type: 'reset' });

  assert.deepEqual(reset.draft, { title: '', text: '' });
  assert.equal(reset.editingId, null);
  assert.equal(reset.error, null);
  assert.equal(reset.notice, null);
  assert.equal(reset.notes[0], originalNote);
  assert.deepEqual(originalNote, {
    id: 'original-id', category: 'general', title: 'Original', text: 'Body',
    createdAt: CREATED_AT, updatedAt: CREATED_AT,
  });
  assert.deepEqual(base.notes, [originalNote]);
});

test('dirty detection tracks draft changes relative to the selected note', () => {
  const note = createNote('dirty-id', { title: 'Saved title', text: 'Saved body' });
  const base = { ...initialNotesState(), notes: [note] };
  assert.equal(hasUnsavedChanges(base), false);
  const editing = notesReducer(base, { type: 'edit', id: note.id });
  assert.equal(hasUnsavedChanges(editing), false);
  const changed = change(editing, 'title', 'Changed title');
  assert.equal(hasUnsavedChanges(changed), true);
  const reverted = change(changed, 'title', 'Saved title');
  assert.equal(hasUnsavedChanges(reverted), false);
  assert.equal(hasUnsavedChanges(change(initialNotesState(), 'text', 'New note')), true);
});

test('switching edit targets clones the selected note into the draft and discards prior draft edits', () => {
  const one = createNote('one', { title: 'One', text: 'First body' });
  const two = createNote('two', { title: 'Two', text: 'Second body' });
  const state = { ...initialNotesState(), notes: [one, two] };
  const firstEdit = notesReducer(state, { type: 'edit', id: one.id });
  const dirty = change(firstEdit, 'text', 'Unsaved change');
  const secondEdit = notesReducer(dirty, { type: 'edit', id: two.id });

  assert.equal(secondEdit.editingId, two.id);
  assert.deepEqual(secondEdit.draft, { title: 'Two', text: 'Second body' });
  assert.notEqual(secondEdit.draft, two);
  assert.equal(secondEdit.notes[0], one);
  assert.equal(secondEdit.notes[1], two);
  assert.equal(two.text, 'Second body');
  const changedAgain = change(secondEdit, 'title', 'Draft only');
  assert.equal(two.title, 'Two');
  assert.equal(changedAgain.draft.title, 'Draft only');
});

test('duplicate create id is rejected without overwriting existing notes', () => {
  const existing = createNote('duplicate-id', { title: 'Keep me' });
  const state = { ...initialNotesState(), notes: [existing] };
  const attempted = save(fillDraft(state, { title: 'Do not replace' }), 'duplicate-id', UPDATED_AT);

  assert.equal(attempted.error, 'Could not create a unique note. Please try saving again.');
  assert.equal(attempted.notice, null);
  assert.equal(attempted.notes.length, 1);
  assert.equal(attempted.notes[0], existing);
  assert.equal(existing.title, 'Keep me');
});

test('rejects editing or saving against a missing edit id', () => {
  const blank = initialNotesState();
  const missingEdit = notesReducer(blank, { type: 'edit', id: 'missing-id' });
  assert.equal(missingEdit.error, 'This note could not be found.');
  assert.equal(missingEdit.editingId, null);
  assert.deepEqual(missingEdit.draft, blank.draft);
  assert.deepEqual(blank, initialNotesState());

  const staleEdit = { ...fillDraft(blank, { title: 'Draft' }), editingId: 'missing-id' };
  const rejectedSave = save(staleEdit, 'irrelevant-id', UPDATED_AT);
  assert.equal(rejectedSave.error, 'This note could not be found.');
  assert.equal(rejectedSave.notice, null);
  assert.deepEqual(rejectedSave.notes, []);
  assert.deepEqual(staleEdit.notes, []);
});

test('a second blank save after successful creation is rejected and cannot duplicate the note', () => {
  const created = save(fillDraft(initialNotesState(), { text: 'Saved once' }), 'only-id', CREATED_AT);
  const notesAfterCreate = created.notes;
  const savedAgain = save(created, 'second-id', UPDATED_AT);

  assert.equal(savedAgain.error, 'Write a title or note before saving.');
  assert.equal(savedAgain.notice, null);
  assert.equal(savedAgain.notes, notesAfterCreate);
  assert.equal(savedAgain.notes.length, 1);
  assert.equal(savedAgain.notes[0].id, 'only-id');
  assert.equal(created.notes.length, 1);
  assert.deepEqual(created.draft, { title: '', text: '' });
});

test('body-only boundary accepts 1500 and rejects 1501 without dropping the draft', () => {
  const exact = fillDraft(initialNotesState(), { text: 'x'.repeat(MAX_NOTE_CHARACTERS) });
  assert.equal(characterCount(exact.draft), MAX_NOTE_CHARACTERS);
  assert.equal(save(exact, 'exact').notes[0].text.length, MAX_NOTE_CHARACTERS);
  const overflow = fillDraft(initialNotesState(), { text: 'x'.repeat(MAX_NOTE_CHARACTERS + 1) });
  const rejected = save(overflow, 'overflow');
  assert.equal(rejected.notes.length, 0);
  assert.equal(rejected.draft, overflow.draft);
  assert.ok(rejected.error);
});

test('new notes prepend; editing an older note neither duplicates nor reorders notes', () => {
  const first = save(fillDraft(initialNotesState(), { text: 'First' }), 'first');
  const second = save(fillDraft(first, { text: 'Second' }), 'second');
  assert.deepEqual(second.notes.map(note => note.id), ['second', 'first']);
  const edit = notesReducer(second, { type: 'edit', id: 'first' });
  const saved = save(change(edit, 'text', 'First updated'), 'ignored', UPDATED_AT);
  assert.deepEqual(saved.notes.map(note => note.id), ['second', 'first']);
  assert.equal(saved.notes[1].text, 'First updated');
  assert.equal(saved.notes[0], second.notes[0]);
});

test('invalid edits preserve the saved original and remain editable', () => {
  const original = createNote('original', { title: 'Keep', text: 'Original' });
  const edit = notesReducer({ ...initialNotesState(), notes: [original] }, { type: 'edit', id: 'original' });
  const invalid = save(fillDraft(edit, { title: '', text: '' }), 'unused', UPDATED_AT);
  assert.ok(invalid.error);
  assert.equal(invalid.editingId, 'original');
  assert.equal(invalid.notes[0], original);
  const corrected = save(change(invalid, 'text', 'Corrected'), 'unused', UPDATED_AT);
  assert.equal(corrected.notes.length, 1);
  assert.equal(corrected.notes[0].id, 'original');
  assert.equal(corrected.notes[0].text, 'Corrected');
});
