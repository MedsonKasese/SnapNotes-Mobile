export const MAX_NOTE_CHARACTERS = 1500;

export const NOTE_CATEGORIES = ['general', 'work', 'personal', 'ideas', 'important'] as const;
export type NoteCategory = typeof NOTE_CATEGORIES[number];
export function normalizeCategory(value: unknown): NoteCategory {
  return typeof value === 'string' && (NOTE_CATEGORIES as readonly string[]).includes(value) ? value as NoteCategory : 'general';
}
export type NoteDraft = { title: string; text: string; category?: NoteCategory };
export type Note = NoteDraft & {
  id: string;
  category: NoteCategory;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
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
  return { title: draft.title.trim(), text: draft.text.replace(/\r/g, '').trim() };
}

// Match the PWA inline editor's serialized title + body budget, not two separate limits.
export function characterCount(draft: NoteDraft): number {
  const { title, text } = normalizeDraft(draft);
  return `${title ? `## ${title}\n` : ''}${text}`.length;
}

export function validateDraft(draft: NoteDraft): string | null {
  const { title, text } = normalizeDraft(draft);
  if (!title && !text) return 'Write a title or note before saving.';
  if (characterCount(draft) > MAX_NOTE_CHARACTERS) {
    return `Note is too long. Use ${MAX_NOTE_CHARACTERS} characters or fewer, including the title marker.`;
  }
  return null;
}

export function hasUnsavedChanges(state: NotesState): boolean {
  const original = state.notes.find(note => note.id === state.editingId);
  return state.draft.title !== (original?.title ?? '') || state.draft.text !== (original?.text ?? '') || normalizeCategory(state.draft.category) !== normalizeCategory(original?.category);
}

export function notesReducer(state: NotesState, action: NotesAction): NotesState {
  switch (action.type) {
    case 'category':
      return { ...state, draft: { ...state.draft, category: action.category }, error: null, notice: null };
    case 'change':
      return { ...state, draft: { ...state.draft, [action.field]: action.value }, error: null, notice: null };
    case 'edit': {
      const note = state.notes.find(item => item.id === action.id);
      if (!note) return { ...state, error: 'This note could not be found.' };
      return { ...state, draft: { title: note.title, text: note.text, category: normalizeCategory(note.category) }, editingId: note.id, error: null, notice: null };
    }
    case 'reset':
      return { ...initialNotesState(), notes: state.notes };
    case 'restore-draft': {
      const editingId = action.editingId !== null && state.notes.some(note => note.id === action.editingId)
        ? action.editingId
        : null;
      return {
        ...state,
        draft: { title: action.draft.title, text: action.draft.text, category: normalizeCategory(action.draft.category) },
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
        notes = state.notes.map(note => note.id === state.editingId
          ? { ...note, ...draft, category: normalizeCategory(state.draft.category), updatedAt: action.now }
          : note);
      } else {
        if (state.notes.some(note => note.id === action.id)) {
          return { ...state, error: 'Could not create a unique note. Please try saving again.', notice: null };
        }
        notes = [{ ...draft, id: action.id, category: normalizeCategory(state.draft.category), createdAt: action.now, updatedAt: action.now, pinned: false }, ...state.notes];
      }
      return {
        ...initialNotesState(), notes,
        notice: state.editingId === null ? 'Note created.' : 'Note updated.',
      };
    }
  }
}
