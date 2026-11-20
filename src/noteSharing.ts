import type { Note } from './notes.ts';

export function buildNoteShareText(note: Pick<Note, 'title' | 'text'>): string {
  return [note.title.trim(), note.text.replace(/\r/g, '').trim()].filter(Boolean).join('\n\n');
}
