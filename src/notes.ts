import { noteHtmlToText, sanitizeNoteHtml } from './noteFormatting.ts';

export const MAX_NOTE_CHARACTERS = 1500;
export const MAX_NOTE_HTML_LENGTH = 100_000;

export const NOTE_CATEGORIES = ['general', 'work', 'personal', 'ideas', 'important'] as const;
export type NoteCategory = typeof NOTE_CATEGORIES[number];
export function normalizeCategory(value: unknown): NoteCategory {
  return typeof value === 'string' && (NOTE_CATEGORIES as readonly string[]).includes(value) ? value as NoteCategory : 'general';
}
export type NoteDraft = { title: string; text: string; category?: NoteCategory; html?: string };
export type Note = NoteDraft & {
  id: string;
  category: NoteCategory;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  deletedAt: string | null;
  folderId?: string | null;
};
export type NotesState = {
  notes: Note[];
  draft: NoteDraft;
  editingId: string | null;
  error: string | null;
  notice: string | null;
};
export type NotesAction =
  | { type: 'change'; field: 'title' | 'text'; value: string }
  | { type: 'rich-change'; text: string; html: string }
  | { type: 'category'; category: NoteCategory }
  | { type: 'edit'; id: string }
  | { type: 'reset' }
  | { type: 'restore-draft'; draft: NoteDraft; editingId: string | null }
  | { type: 'save'; id: string; now: string };

export function sortNotesPinnedFirst(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return b.pinned ? 1 : -1;
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

export function initialNotesState(): NotesState {
  return { notes: [], draft: { title: '', text: '' }, editingId: null, error: null, notice: null };
}

export function normalizeDraft(draft: NoteDraft): NoteDraft {
  if (draft.html !== undefined && (typeof draft.html !== 'string' || draft.html.length > MAX_NOTE_HTML_LENGTH)) {
    throw new Error(`Rich note HTML exceeds the supported ${MAX_NOTE_HTML_LENGTH} character limit.`);
  }
  const html = draft.html === undefined ? undefined : sanitizeNoteHtml(draft.html);
  if (html !== undefined && html.length > MAX_NOTE_HTML_LENGTH) {
    throw new Error(`Rich note HTML exceeds the supported ${MAX_NOTE_HTML_LENGTH} character limit.`);
  }
  return {
    title: draft.title.trim(),
    text: draft.text.replace(/\r/g, '').trim(),
    ...(html === undefined ? {} : { html }),
  };
}

// Match the PWA inline editor's serialized title + body budget, not two separate limits.
export function characterCount(draft: NoteDraft): number {
  const title = draft.title.trim();
  const text = draft.text.replace(/\r/g, '').trim();
  return `${title ? `## ${title}\n` : ''}${text}`.length;
}

export function validateDraft(draft: NoteDraft): string | null {
  if (draft.html !== undefined && (typeof draft.html !== 'string' || draft.html.length > MAX_NOTE_HTML_LENGTH)) {
    return `Rich note HTML exceeds the supported ${MAX_NOTE_HTML_LENGTH} character limit.`;
  }
  if (draft.html !== undefined && sanitizeNoteHtml(draft.html).length > MAX_NOTE_HTML_LENGTH) {
    return `Rich note HTML exceeds the supported ${MAX_NOTE_HTML_LENGTH} character limit.`;
  }
  if (draft.html !== undefined && noteHtmlToText(draft.html).trim() !== draft.text.replace(/\r/g, '').trim()) {
    return 'Rich note HTML does not match the note text.';
  }
  const { title, text } = normalizeDraft(draft);
  if (!title && !text) return 'Write a title or note before saving.';
  if (characterCount(draft) > MAX_NOTE_CHARACTERS) {
    return `Note is too long. Use ${MAX_NOTE_CHARACTERS} characters or fewer, including the title marker.`;
  }
  return null;
}

export function hasUnsavedChanges(state: NotesState): boolean {
  const original = state.notes.find(note => note.id === state.editingId);
  const draftHtml = state.draft.html === undefined ? undefined : sanitizeNoteHtml(state.draft.html);
  const originalHtml = original?.html === undefined ? undefined : sanitizeNoteHtml(original.html);
  return state.draft.title !== (original?.title ?? '') || state.draft.text !== (original?.text ?? '') ||
    draftHtml !== originalHtml || normalizeCategory(state.draft.category) !== normalizeCategory(original?.category);
}

export function notesReducer(state: NotesState, action: NotesAction): NotesState {
  switch (action.type) {
    case 'category':
      return { ...state, draft: { ...state.draft, category: action.category }, error: null, notice: null };
    case 'change':
      if (action.field === 'text') {
        const { html: _discardedHtml, ...plainDraft } = state.draft;
        return { ...state, draft: { ...plainDraft, text: action.value }, error: null, notice: null };
      }
      return { ...state, draft: { ...state.draft, title: action.value }, error: null, notice: null };
    case 'rich-change': {
      const html = sanitizeNoteHtml(action.html);
      return { ...state, draft: { ...state.draft, text: noteHtmlToText(html).trim(), html }, error: null, notice: null };
    }
    case 'edit': {
      const note = state.notes.find(item => item.id === action.id);
      if (!note) return { ...state, error: 'This note could not be found.' };
      return { ...state, draft: { title: note.title, text: note.text, category: normalizeCategory(note.category), ...(note.html === undefined ? {} : { html: sanitizeNoteHtml(note.html) }) }, editingId: note.id, error: null, notice: null };
    }
    case 'reset':
      return { ...initialNotesState(), notes: state.notes };
    case 'restore-draft': {
      const editingId = action.editingId !== null && state.notes.some(note => note.id === action.editingId)
        ? action.editingId
        : null;
      return {
        ...state,
        draft: { title: action.draft.title, text: action.draft.text, category: normalizeCategory(action.draft.category), ...(action.draft.html === undefined ? {} : { html: sanitizeNoteHtml(action.draft.html) }) },
        editingId,
        error: null,
        notice: 'Recovered unsaved draft from this device.',
      };
    }
    case 'save': {
      const error = validateDraft(state.draft);
      if (error) return { ...state, error, notice: null };
      const draft = normalizeDraft(state.draft);
      let notes: Note[];
      if (state.editingId !== null) {
        if (!state.notes.some(note => note.id === state.editingId)) {
          return { ...state, error: 'This note could not be found.', notice: null };
        }
        notes = state.notes.map(note => {
          if (note.id !== state.editingId) return note;
          const { html: _previousHtml, ...withoutPreviousHtml } = note;
          return { ...withoutPreviousHtml, ...draft, category: normalizeCategory(state.draft.category), updatedAt: action.now };
        });
      } else {
        if (state.notes.some(note => note.id === action.id)) {
          return { ...state, error: 'Could not create a unique note. Please try saving again.', notice: null };
        }
        notes = [{ ...draft, id: action.id, category: normalizeCategory(state.draft.category), createdAt: action.now, updatedAt: action.now, pinned: false, archived: false, deletedAt: null }, ...state.notes];
      }
      return {
        ...initialNotesState(), notes,
        notice: state.editingId === null ? 'Note created.' : 'Note updated.',
      };
    }
  }
}
