import { initialNotesState, notesReducer, validateDraft } from './notes.ts';
import type { Note, NotesAction, NotesState } from './notes.ts';

export const TRASH_RETENTION_DAYS = 15;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function isExpiredTrash(note: Note, now: number): boolean {
  if (note.deletedAt === null) return false;
  const timestamp = Date.parse(note.deletedAt);
  return Number.isFinite(timestamp) && timestamp + TRASH_RETENTION_MS <= now;
}

export type NotesStorage = {
  load(): Promise<Note[]>;
  save(notes: Note[]): Promise<void>;
  allocateNoteId?(usedIds: readonly string[]): Promise<string>;
};
export type NotesSnapshot = {
  state: NotesState;
  status: 'loading' | 'ready' | 'saving' | 'load-error';
  storageError: string | null;
};

function saveFailureGuidance(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('encrypted vault id')) {
    return 'Private-note protection blocked this write to avoid saving encrypted content as an ordinary note.';
  }
  if (message.includes('private vault') || message.includes('encrypted private vault')) {
    return 'Private Notes storage could not be verified, so this save was blocked to protect private data.';
  }
  if (/quota|disk full|no space|storage full|\bfull\b/.test(message)) {
    return 'Device storage may be full or temporarily unavailable.';
  }
  if (/invalid note|visible text does not match|unsupported or corrupt notes/.test(message)) {
    return 'The saved note data did not pass local validation; your draft remains available.';
  }
  return 'The device did not confirm the local write; your draft remains available.';
}

// Write through on explicit Save, never from an effect or while hydrating. A save
// is acknowledged only after storage succeeds; failures retain the original draft.
export function createNotesController(storage: NotesStorage) {
  let snapshot: NotesSnapshot = { state: initialNotesState(), status: 'loading', storageError: null };
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;

  function publish(next: NotesSnapshot) {
    snapshot = next;
    listeners.forEach(listener => listener());
  }

  function load(): Promise<void> {
    if (loading) return loading;
    if (snapshot.status !== 'loading' && snapshot.status !== 'load-error') return Promise.resolve();
    publish({ ...snapshot, status: 'loading', storageError: null });
    loading = (async () => {
      try {
        const notes = await storage.load();
        const now = Date.now();
        const retained = notes.filter(note => !isExpiredTrash(note, now));
        if (retained.length !== notes.length) {
          try {
            await storage.save(retained);
            publish({ state: { ...initialNotesState(), notes: retained }, status: 'ready', storageError: null });
          } catch {
            // Keep expired records visible and recoverable if cleanup could not be persisted.
            publish({ state: { ...initialNotesState(), notes }, status: 'ready', storageError: 'Expired Trash could not be cleared on this device. Your notes have not been changed.' });
          }
        } else {
          publish({ state: { ...initialNotesState(), notes }, status: 'ready', storageError: null });
        }
      } catch {
        publish({ ...snapshot, status: 'load-error', storageError: 'Could not load notes from this device. Existing storage has not been changed. Retry to load your notes.' });
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function dispatch(action: Exclude<NotesAction, { type: 'save' }>) {
    if (snapshot.status !== 'ready') return;
    publish({ ...snapshot, state: notesReducer(snapshot.state, action) });
  }

  async function updateNoteText(id: string, text: string, now: string, html?: string) {
    if (snapshot.status !== 'ready') return;
    const previous = snapshot.state;
    if (!previous.notes.some(note => note.id === id)) {
      publish({ ...snapshot, state: { ...previous, error: 'This note could not be found.' } });
      return;
    }

    const notes = previous.notes.map(note => note.id === id
      ? { ...note, text, ...(html !== undefined ? { html } : {}), updatedAt: now }
      : note);
    publish({ ...snapshot, status: 'saving', state: previous, storageError: null });
    try {
      await storage.save(notes);
      publish({
        state: { ...previous, notes, error: null, notice: 'Checklist updated.' },
        status: 'ready',
        storageError: null,
      });
    } catch {
      publish({
        state: previous,
        status: 'ready',
        storageError: 'Could not save this checklist change on this device. Your saved note has not been changed. Please try again.',
      });
    }
  }

  async function togglePin(id: string, now: string) {
    if (snapshot.status !== 'ready') return;
    const previous = snapshot.state;
    const target = previous.notes.find(note => note.id === id);
    if (!target) {
      publish({ ...snapshot, state: { ...previous, error: 'This note could not be found.' } });
      return;
    }

    const pinned = !target.pinned;
    const notes = previous.notes.map(note => note.id === id
      ? { ...note, pinned }
      : note);
    publish({ ...snapshot, status: 'saving', storageError: null });
    try {
      await storage.save(notes);
      publish({
        state: { ...previous, notes, error: null, notice: pinned ? 'Note pinned.' : 'Note unpinned.' },
        status: 'ready',
        storageError: null,
      });
    } catch {
      publish({
        state: previous,
        status: 'ready',
        storageError: 'Could not save the pin change on this device. Your note has not been changed. Please try again.',
      });
    }
  }

  async function setArchived(id: string, archived: boolean, now: string) {
    if (snapshot.status !== 'ready') return;
    const previous = snapshot.state;
    const target = previous.notes.find(note => note.id === id);
    if (!target) {
      publish({ ...snapshot, state: { ...previous, error: 'This note could not be found.' } });
      return;
    }
    if (target.archived === archived) return;

    const notes = previous.notes.map(note => note.id === id
      ? { ...note, archived, updatedAt: now }
      : note);
    publish({ ...snapshot, status: 'saving', storageError: null });
    try {
      await storage.save(notes);
      publish({
        state: { ...previous, notes, error: null, notice: archived ? 'Note archived.' : 'Note restored.' },
        status: 'ready',
        storageError: null,
      });
    } catch {
      publish({
        state: previous,
        status: 'ready',
        storageError: `Could not ${archived ? 'archive' : 'restore'} this note on this device. Your saved note has not been changed. Please try again.`,
      });
    }
  }

  async function moveToTrash(id: string, now: string) {
    if (snapshot.status !== 'ready') return;
    const previous = snapshot.state;
    const target = previous.notes.find(note => note.id === id && note.deletedAt === null);
    if (!target) return;
    const notes = previous.notes.map(note => note.id === id
      ? { ...note, deletedAt: now, archived: false, updatedAt: now } : note);
    publish({ ...snapshot, status: 'saving', storageError: null });
    try {
      await storage.save(notes);
      publish({ state: { ...previous, notes, error: null, notice: 'Note moved to Trash.' }, status: 'ready', storageError: null });
    } catch {
      publish({ state: previous, status: 'ready', storageError: 'Could not move this note to Trash. Your saved note has not been changed.' });
    }
  }

  async function restoreFromTrash(id: string, now: string) {
    if (snapshot.status !== 'ready') return;
    const previous = snapshot.state;
    if (!previous.notes.some(note => note.id === id && note.deletedAt !== null)) return;
    const notes = previous.notes.map(note => note.id === id
      ? { ...note, deletedAt: null, archived: false, updatedAt: now } : note);
    publish({ ...snapshot, status: 'saving', storageError: null });
    try {
      await storage.save(notes);
      publish({ state: { ...previous, notes, error: null, notice: 'Note restored.' }, status: 'ready', storageError: null });
    } catch {
      publish({ state: previous, status: 'ready', storageError: 'Could not restore this note. Your saved note has not been changed.' });
    }
  }

  async function permanentlyDelete(id: string) {
    if (snapshot.status !== 'ready') return;
    const previous = snapshot.state;
    if (!previous.notes.some(note => note.id === id && note.deletedAt !== null)) return;
    const notes = previous.notes.filter(note => note.id !== id);
    publish({ ...snapshot, status: 'saving', storageError: null });
    try {
      await storage.save(notes);
      publish({ state: { ...previous, notes, error: null, notice: 'Note permanently deleted.' }, status: 'ready', storageError: null });
    } catch {
      publish({ state: previous, status: 'ready', storageError: 'Could not permanently delete this note. It remains in Trash.' });
    }
  }

  async function duplicateNote(id: string, now: string) {
    if (snapshot.status !== 'ready') return;
    const previous = snapshot.state;
    const source = previous.notes.find(note => note.id === id && note.deletedAt === null);
    if (!source) {
      publish({ ...snapshot, state: { ...previous, error: 'This note could not be duplicated.' } });
      return;
    }
    // Follow the PWA: copies retain content/category but start unpinned, unarchived,
    // with fresh creation/edit timestamps. Avoid collisions with imported/local IDs.
    const ids = new Set(previous.notes.map(note => note.id));
    let sequence = previous.notes.length + 1;
    while (ids.has(`local-note-${sequence}`)) sequence += 1;
    const copy: Note = {
      ...source,
      id: `local-note-${sequence}`,
      title: source.title ? `Copy of ${source.title}` : 'Copy of Untitled note',
      createdAt: now,
      updatedAt: now,
      pinned: false,
      archived: false,
      deletedAt: null,
    };
    if (validateDraft(copy)) {
      publish({ ...snapshot, storageError: 'This note is too long to duplicate. Shorten it before duplicating.' });
      return;
    }
    const notes = [copy, ...previous.notes];
    publish({ ...snapshot, status: 'saving', storageError: null });
    try {
      await storage.save(notes);
      publish({ state: { ...previous, notes, error: null, notice: 'Note duplicated.' }, status: 'ready', storageError: null });
    } catch {
      publish({ state: previous, status: 'ready', storageError: 'Could not duplicate this note. The original note has not been changed.' });
    }
  }

  async function moveNoteToFolder(id: string, folderId: string | null) {
    if (snapshot.status !== 'ready') return;
    const previous = snapshot.state;
    const note = previous.notes.find(item => item.id === id && item.deletedAt === null);
    if (!note) return;
    if ((note.folderId ?? null) === folderId) return;
    const notes = previous.notes.map(item => item.id === id ? { ...item, folderId } : item);
    publish({ ...snapshot, status: 'saving', storageError: null });
    try {
      await storage.save(notes);
      publish({ state: { ...previous, notes, error: null, notice: folderId ? 'Note moved to folder.' : 'Note removed from folder.' }, status: 'ready', storageError: null });
    } catch {
      publish({ state: previous, status: 'ready', storageError: 'Could not change folder. Your note is unchanged.' });
    }
  }

  async function clearFolder(folderId: string): Promise<boolean> {
    if (snapshot.status !== 'ready') return false;
    const previous = snapshot.state;
    const notes = previous.notes.map(note => note.folderId === folderId ? { ...note, folderId: null } : note);
    if (notes.every((note, index) => note === previous.notes[index])) return true;
    publish({ ...snapshot, status: 'saving', storageError: null });
    try {
      await storage.save(notes);
      publish({ state: { ...previous, notes, error: null, notice: 'Notes safely removed from folder.' }, status: 'ready', storageError: null });
      return true;
    } catch {
      publish({ state: previous, status: 'ready', storageError: 'Could not unfile notes; folder has not been deleted.' });
      return false;
    }
  }

  async function emptyTrash() {
    if (snapshot.status !== 'ready') return;
    const previous = snapshot.state;
    if (!previous.notes.some(note => note.deletedAt !== null)) return;
    const notes = previous.notes.filter(note => note.deletedAt === null);
    publish({ ...snapshot, status: 'saving', storageError: null });
    try {
      await storage.save(notes);
      publish({ state: { ...previous, notes, error: null, notice: 'Trash emptied.' }, status: 'ready', storageError: null });
    } catch {
      publish({ state: previous, status: 'ready', storageError: 'Could not empty Trash. Your trashed notes are still here.' });
    }
  }

  async function save(now: string) {
    if (snapshot.status !== 'ready') return;
    const previous = snapshot.state;
    // Start after the loaded count and skip any matching ID, including old IDs.
    // This does not rely on a session counter, clock, or probabilistic randomness.
    const ids = new Set(previous.notes.map(note => note.id));
    let sequence = previous.notes.length + 1;
    while (ids.has(`local-note-${sequence}`)) sequence += 1;
    const fallbackId = `local-note-${sequence}`;
    const preflight = notesReducer(previous, { type: 'save', id: fallbackId, now });
    if (preflight.notes === previous.notes) {
      publish({ ...snapshot, state: preflight, storageError: null });
      return;
    }
    publish({ state: previous, status: 'saving', storageError: null });
    try {
      // The encrypted vault shares the opaque note-ID namespace. Ask the guarded
      // adapter to skip private IDs; the save guard still checks under its lock.
      const id = storage.allocateNoteId ? await storage.allocateNoteId([...ids]) : fallbackId;
      const next = notesReducer(previous, { type: 'save', id, now });
      if (next.notes === previous.notes) {
        publish({ state: next, status: 'ready', storageError: null });
        return;
      }
      await storage.save(next.notes);
      publish({ state: { ...next, notice: previous.editingId === null ? 'Note saved on this device.' : 'Changes saved on this device.' }, status: 'ready', storageError: null });
    } catch (cause) {
      publish({ state: previous, status: 'ready', storageError: `Could not save on this device. Your draft is still here. ${saveFailureGuidance(cause)} Try Save again before closing the app.` });
    }
  }

  // Reconcile after an external encrypted-vault transfer. Never replace an
  // active editor draft or overwrite a write in progress.
  async function refreshAfterPrivateTransfer(): Promise<void> {
    if (snapshot.status !== 'ready' || snapshot.state.editingId !== null ||
      snapshot.state.draft.title !== '' || snapshot.state.draft.text !== '') {
      throw new Error('Close the editor before refreshing notes after a private transfer.');
    }
    const notes = await storage.load();
    if (snapshot.status !== 'ready') throw new Error('Notes changed while refreshing.');
    publish({ ...snapshot, state: { ...snapshot.state, notes }, storageError: null });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load, refreshAfterPrivateTransfer, dispatch, save, updateNoteText, togglePin, setArchived, moveToTrash, restoreFromTrash, permanentlyDelete, duplicateNote, moveNoteToFolder, clearFolder, emptyTrash,
  };
}
