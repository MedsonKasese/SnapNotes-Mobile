import assert from 'node:assert/strict';
import test from 'node:test';
import { searchNotes } from '../src/noteSearch.ts';

const notes = [
  { id: '1', category: 'general', title: 'Flight Planning', text: 'Airport demand', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: '2', category: 'general', title: 'Study Notes', text: 'Tourism development', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
  { id: '3', category: 'general', title: '', text: 'Plan a flight route', createdAt: '2026-01-03', updatedAt: '2026-01-03' },
];

test('empty and whitespace queries preserve order without returning original array', () => {
  assert.deepEqual(searchNotes(notes, ''), notes);
  assert.deepEqual(searchNotes(notes, '  '), notes);
  assert.notStrictEqual(searchNotes(notes, ''), notes);
});

test('search matches title or body without case sensitivity', () => {
  assert.deepEqual(searchNotes(notes, 'FLIGHT').map(note => note.id), ['1', '3']);
  assert.deepEqual(searchNotes(notes, 'DEVELOPMENT').map(note => note.id), ['2']);
});

test('multiple terms must all match, across title and body', () => {
  assert.deepEqual(searchNotes(notes, '  flight   DEMAND ').map(note => note.id), ['1']);
  assert.deepEqual(searchNotes(notes, 'flight missing'), []);
});

test('search never modifies the saved collection', () => {
  const before = JSON.stringify(notes);
  searchNotes(notes, 'flight');
  assert.equal(JSON.stringify(notes), before);
});
