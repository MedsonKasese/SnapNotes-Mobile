import type { Note } from './notes.ts';

// Search is display-only: it never mutates, reorders, or persists the collection.
export function searchNotes(notes: readonly Note[], query: string): Note[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return [...notes];
  return notes.filter(note => {
    const haystack = `${note.title}\n${note.text}`.toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}
