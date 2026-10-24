import type { Note } from './notes.ts';

// Keep this compatible with the PWA's buildPrivatePayload in
// SnapNotes/js/private-note-utils.js. This module does not persist or remove notes.
export function buildMobilePrivatePayload(note: Note) {
  if (note.deletedAt !== null || note.archived) {
    throw new Error('Restore the note before moving it to Private.');
  }
  return {
    title: note.title || '',
    text: note.text || '',
    html: note.html || '',
    category: note.category || 'general',
    tags: [],
    time: '',
    folderId: note.folderId || null,
    reminderAt: null,
    reminderNotified: false,
    reminderRepeat: null,
    attachments: [],
    history: [],
  };
}

export function assertPrivateMoveSafe(notes: Note[], id: string, vaultIds: string[]): Note {
  const matches = notes.filter(note => note.id === id);
  if (matches.length !== 1) throw new Error('The source note is missing or duplicated.');
  if (vaultIds.includes(id)) throw new Error('This note already has a private vault record.');
  const note = matches[0];
  if (note.deletedAt !== null || note.archived) throw new Error('Restore the note before moving it to Private.');
  return note;
}
