import { validateDraft as validateNoteDraft, type Note } from './notes.ts';

export const NOTES_STORAGE_KEY = '@snapnotes-mobile/notes';

const STORAGE_VERSION = 1;

type AsyncKeyValueBackend = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

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
  const { id, category, title, text, createdAt, updatedAt } = value;
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`Invalid note at index ${index}: id must be a nonempty string.`);
  }
  if (ids.has(id)) {
    throw new Error(`Invalid note at index ${index}: duplicate id "${id}".`);
  }
  if (category !== 'general') {
    throw new Error(`Invalid note at index ${index}: category must be "general".`);
  }
  if (typeof title !== 'string' || typeof text !== 'string') {
    throw new Error(`Invalid note at index ${index}: title and text must be strings.`);
  }
  validateTimestamp(createdAt, 'createdAt', index);
  validateTimestamp(updatedAt, 'updatedAt', index);
  validateDraft({ title, text }, index);

  ids.add(id);
  return { id, category, title, text, createdAt, updatedAt };
}

function validateNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid notes payload: notes must be an array.');
  }
  const ids = new Set<string>();
  return value.map((note, index) => validateNote(note, index, ids));
}

export function createNotesStorage(backend: AsyncKeyValueBackend) {
  return {
    async load(): Promise<Note[]> {
      const stored = await backend.getItem(NOTES_STORAGE_KEY);
      if (stored === null) return [];

      let payload: unknown;
      try {
        payload = JSON.parse(stored);
      } catch {
        throw new Error('Invalid notes payload: malformed JSON.');
      }
      if (!isRecord(payload) || payload.version !== STORAGE_VERSION) {
        throw new Error(`Unsupported or invalid notes payload version; expected ${STORAGE_VERSION}.`);
      }
      return validateNotes(payload.notes);
    },

    async save(notes: Note[]): Promise<void> {
      const validatedNotes = validateNotes(notes);
      const payload = JSON.stringify({ version: STORAGE_VERSION, notes: validatedNotes });
      await backend.setItem(NOTES_STORAGE_KEY, payload);
    },
  };
}
