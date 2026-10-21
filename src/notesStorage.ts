import { normalizeCategory, NOTE_CATEGORIES, validateDraft as validateNoteDraft, type Note, type NoteCategory } from './notes.ts';

export const NOTES_STORAGE_KEY = '@snapnotes-mobile/notes';

const STORAGE_VERSION = 1;
const INDEX_KEY = '@snapnotes-mobile/notes-index';
const NOTE_PREFIX = '@snapnotes-mobile/note/';
const MAX_ENTRY_BYTES = 1024 * 1024;
let generationCounter = 0;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length &&
      value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

function bounded(value: string, label: string): string {
  if (utf8ByteLength(value) > MAX_ENTRY_BYTES) {
    throw new Error(label + ' exceeds the supported storage entry size.');
  }
  return value;
}
function parseObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error('Invalid stored record.');
  return parsed;
}
function noteKey(generation: string, index: number): string {
  return NOTE_PREFIX + generation + '/' + index;
}


type AsyncKeyValueBackend = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: string[]): Promise<void>;
};

// Reads also clean up records, so they must share the commit queue. Sharing by
// backend protects multiple storage/controller instances in the same runtime.
const operationQueues = new WeakMap<AsyncKeyValueBackend, Promise<void>>();

function enqueue<T>(backend: AsyncKeyValueBackend, operation: () => Promise<T>): Promise<T> {
  const pending = (operationQueues.get(backend) ?? Promise.resolve()).then(operation);
  // Neither a failed read nor a failed save may poison later operations.
  operationQueues.set(backend, pending.then(() => undefined, () => undefined));
  return pending;
}

type NoteDraft = Pick<Note, 'title' | 'text'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTimestamp(value: unknown, field: string, index: number): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${field} on note at index ${index}: expected an ISO timestamp.`);
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid ${field} on note at index ${index}: expected an ISO timestamp.`);
  }

  const [, year, month, day, hour, minute, second, zone] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const min = Number(minute);
  const sec = Number(second);
  const daysInMonth = m === 2
    ? (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28)
    : ([4, 6, 9, 11].includes(m) ? 30 : 31);
  let validZone = true;
  if (typeof zone !== 'string') {
    throw new Error(`Invalid ${field} on note at index ${index}: expected an ISO timestamp.`);
  }
  if (zone !== 'Z') {
    const [offsetHours, offsetMinutes] = zone.slice(1).split(':').map(Number);
    validZone = offsetHours <= 23 && offsetMinutes <= 59;
  }
  if (
    m < 1 || m > 12 || d < 1 || d > daysInMonth || h > 23 || min > 59 || sec > 59 ||
    !validZone || !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`Invalid ${field} on note at index ${index}: expected an ISO timestamp.`);
  }
}

function validateDraft(draft: NoteDraft, index: number): void {
  const error = validateNoteDraft(draft);
  if (error) {
    throw new Error(`Invalid note at index ${index}: ${error}`);
  }
}

function validateNote(value: unknown, index: number, ids: Set<string>): Note {
  if (!isRecord(value)) {
    throw new Error(`Invalid note at index ${index}: expected an object.`);
  }
  const { id, category: rawCategory, title, text, createdAt, updatedAt, pinned: rawPinned, archived: rawArchived } = value;
  const category = normalizeCategory(rawCategory);
  const pinned = rawPinned === undefined ? false : rawPinned;
  const archived = rawArchived === undefined ? false : rawArchived;
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`Invalid note at index ${index}: id must be a nonempty string.`);
  }
  if (ids.has(id)) {
    throw new Error(`Invalid note at index ${index}: duplicate id "${id}".`);
  }
  if (rawCategory !== undefined && (typeof rawCategory !== 'string' || !NOTE_CATEGORIES.includes(rawCategory as NoteCategory))) {
    throw new Error(`Invalid note at index ${index}: category is unsupported.`);
  }
  if (typeof pinned !== 'boolean') {
    throw new Error(`Invalid note at index ${index}: pinned must be a boolean.`);
  }
  if (typeof archived !== 'boolean') {
    throw new Error(`Invalid note at index ${index}: archived must be a boolean.`);
  }
  if (typeof title !== 'string' || typeof text !== 'string') {
    throw new Error(`Invalid note at index ${index}: title and text must be strings.`);
  }
  validateTimestamp(createdAt, 'createdAt', index);
  validateTimestamp(updatedAt, 'updatedAt', index);
  validateDraft({ title, text }, index);

  ids.add(id);
  return { id, category, title, text, createdAt, updatedAt, pinned, archived };
}

function validateNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid notes payload: notes must be an array.');
  }
  const ids = new Set<string>();
  return value.map((note, index) => validateNote(note, index, ids));
}

export function createNotesStorage(backend: AsyncKeyValueBackend) {
  async function cleanupExcept(activeGeneration: string | null): Promise<void> {
    try {
      const activePrefix = activeGeneration === null ? null : NOTE_PREFIX + activeGeneration + '/';
      const keys = await backend.getAllKeys();
      const obsolete = keys.filter(key =>
        key.startsWith(NOTE_PREFIX) && (activePrefix === null || !key.startsWith(activePrefix))
      );
      if (obsolete.length > 0) await backend.multiRemove(obsolete);
    } catch {
      // Cleanup is best-effort. Never turn a committed save into a reported failure.
    }
  }

  return {
    load(): Promise<Note[]> {
      return enqueue(backend, async () => {
        const rawIndex = await backend.getItem(INDEX_KEY);
        if (rawIndex !== null) {
          const index = parseObject(rawIndex);
          if (index.version !== 2 || typeof index.generation !== 'string' ||
            !/^[a-z0-9-]+$/.test(index.generation) || !Array.isArray(index.ids) ||
            index.ids.some(id => typeof id !== 'string')) {
            throw new Error('Unsupported or corrupt notes index.');
          }
          const records: unknown[] = [];
          for (let i = 0; i < index.ids.length; i++) {
            const raw = await backend.getItem(noteKey(index.generation, i));
            if (raw === null) throw new Error('A saved note is missing.');
            const record = parseObject(raw);
            if (record.id !== index.ids[i]) throw new Error('Saved note ID mismatch.');
            records.push(record);
          }
          const notes = validateNotes(records);
          await cleanupExcept(index.generation);
          return notes;
        }
        // Legacy PR #3 snapshot is retained and never overwritten during migration.
        const legacy = await backend.getItem(NOTES_STORAGE_KEY);
        if (legacy === null) {
          await cleanupExcept(null);
          return [];
        }
        let payload: unknown;
        try { payload = JSON.parse(legacy); }
        catch { throw new Error('Invalid notes payload: malformed JSON.'); }
        if (!isRecord(payload) || payload.version !== STORAGE_VERSION) {
          throw new Error('Unsupported or invalid notes payload version; expected 1.');
        }
        const notes = validateNotes(payload.notes);
        await cleanupExcept(null);
        return notes;
      });
    },
    async save(notes: Note[]): Promise<void> {
      const validated = validateNotes(notes);
      return enqueue(backend, async () => {
        const generation = Date.now().toString(36) + '-' +
          (++generationCounter).toString(36) + '-' + Math.random().toString(36).slice(2, 12);
        const index = bounded(JSON.stringify({
          version: 2, generation, ids: validated.map(note => note.id),
        }), 'Notes index');

        // Write a complete immutable generation before switching the committed pointer.
        for (let i = 0; i < validated.length; i++) {
          await backend.setItem(noteKey(generation, i),
            bounded(JSON.stringify(validated[i]), 'Note'));
        }
        await backend.setItem(INDEX_KEY, index);

        // The index is now committed. Only now is it safe to remove older generations.
        await cleanupExcept(generation);
      });
    },
  };
}
