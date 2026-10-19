import { initialNotesState, notesReducer } from './notes.ts';
import type { Note, NotesAction, NotesState } from './notes.ts';

export type NotesStorage = {
  load(): Promise<Note[]>;
  save(notes: Note[]): Promise<void>;
};
export type NotesSnapshot = {
  state: NotesState;
  status: 'loading' | 'ready' | 'saving' | 'load-error';
  storageError: string | null;
};

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
        publish({ state: { ...initialNotesState(), notes }, status: 'ready', storageError: null });
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

  async function save(now: string) {
    if (snapshot.status !== 'ready') return;
    const previous = snapshot.state;
    // Start after the loaded count and skip any matching ID, including old IDs.
    // This does not rely on a session counter, clock, or probabilistic randomness.
    const ids = new Set(previous.notes.map(note => note.id));
    let sequence = previous.notes.length + 1;
    while (ids.has(`local-note-${sequence}`)) sequence += 1;
    const next = notesReducer(previous, { type: 'save', id: `local-note-${sequence}`, now });
    if (next.notes === previous.notes) {
      publish({ ...snapshot, state: next, storageError: null });
      return;
    }
    publish({ state: previous, status: 'saving', storageError: null });
    try {
      await storage.save(next.notes);
      publish({ state: { ...next, notice: previous.editingId === null ? 'Note saved on this device.' : 'Changes saved on this device.' }, status: 'ready', storageError: null });
    } catch {
      publish({ state: previous, status: 'ready', storageError: 'Could not save on this device. Your draft is still here. Try Save again before closing the app.' });
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load, dispatch, save,
  };
}
