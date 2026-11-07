import { NOTE_CATEGORIES, type Note } from './notes.ts';
import { noteHtmlToText, sanitizeNoteHtml } from './noteFormatting.ts';
import type { PrivateVaultEntry } from './privateVaultStorage.ts';
import { decryptPrivatePayload } from './privateCrypto.ts';
import { PRIVATE_VERIFIER_ID } from './privateAccess.ts';
import { isValidReminderAt, normalizeReminderRepeat } from './reminders/recurrence.ts';

export type PrivateRestoreDependencies = {
  loadNotes(): Promise<Note[]>;
  saveNotes(notes: Note[]): Promise<void>;
  loadVault(): Promise<PrivateVaultEntry[]>;
  saveVault(entries: PrivateVaultEntry[]): Promise<void>;
  decrypt: typeof decryptPrivatePayload;
  key: Parameters<typeof decryptPrivatePayload>[1];
  now?: () => string;
  withExclusiveRestore<T>(operation: () => Promise<T>): Promise<T>;
};

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const h = Number(hour), min = Number(minute), sec = Number(second);
  const daysInMonth = m === 2 ? (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28)
    : ([4, 6, 9, 11].includes(m) ? 30 : 31);
  const offset = zone === 'Z' ? [0, 0] : zone.slice(1).split(':').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth && h <= 23 && min <= 59 && sec <= 59 &&
    offset[0] <= 23 && offset[1] <= 59 && Number.isFinite(Date.parse(value));
}

function matchesRestoredNote(actual: Note | undefined, expected: Note): boolean {
  if (!actual) return false;
  const expectedHtml = expected.html === undefined ? undefined : sanitizeNoteHtml(expected.html);
  return actual.id === expected.id &&
    actual.title === expected.title &&
    actual.text === expected.text &&
    actual.html === expectedHtml &&
    actual.category === expected.category &&
    actual.createdAt === expected.createdAt &&
    actual.updatedAt === expected.updatedAt &&
    actual.pinned === expected.pinned &&
    actual.archived === expected.archived &&
    actual.deletedAt === expected.deletedAt &&
    (actual.reminderAt ?? null) === (expected.reminderAt ?? null) &&
    Boolean(actual.reminderNotified) === Boolean(expected.reminderNotified) &&
    JSON.stringify(actual.reminderRepeat ?? null) === JSON.stringify(expected.reminderRepeat ?? null) &&
    (actual.folderId ?? null) === (expected.folderId ?? null);
}

// Ordinary-first: verify the restored copy before removing ciphertext.
// Any uncertain commit keeps the encrypted copy for explicit recovery.
export async function restorePrivateNoteTransaction(id: string, deps: PrivateRestoreDependencies): Promise<'restored' | 'needs-recovery'> {
  return deps.withExclusiveRestore(async () => {
    if (id === PRIVATE_VERIFIER_ID) throw Error('Cannot restore a vault verifier.');
    const ordinary = await deps.loadNotes();
    const vault = await deps.loadVault();
    if (ordinary.some(note => note.id === id)) throw Error('An ordinary copy already exists. Resolve the duplicate before restoring.');
    const matches = vault.filter(entry => entry.id === id);
    if (matches.length !== 1) throw Error('Encrypted note not found.');
    const payload = await deps.decrypt(matches[0].privateData, deps.key);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid decrypted private note.');
    const data = payload as Record<string, unknown>;
    if (typeof data.title !== 'string' || typeof data.text !== 'string' || typeof data.html !== 'string' ||
      typeof data.category !== 'string' ||
      (data.createdAt !== undefined && !isIsoTimestamp(data.createdAt)) ||
      (data.updatedAt !== undefined && !isIsoTimestamp(data.updatedAt)) ||
      !NOTE_CATEGORIES.includes(data.category as Note['category']) ||
      noteHtmlToText(data.html).trim() !== data.text.replace(/\r/g, '').trim()) {
      throw Error('Unsupported private note payload.');
    }
    if ((data.reminderAt !== undefined && !isValidReminderAt(data.reminderAt)) ||
      (data.reminderNotified !== undefined && typeof data.reminderNotified !== 'boolean')) {
      throw Error('Unsupported private reminder data.');
    }
    let reminderRepeat: Note['reminderRepeat'] = undefined;
    if (data.reminderRepeat === null) reminderRepeat = null;
    else if (data.reminderRepeat !== undefined) {
      reminderRepeat = data.reminderAt == null ? null : normalizeReminderRepeat(data.reminderRepeat, data.reminderAt);
      if (reminderRepeat === null) throw Error('Unsupported private reminder data.');
    }
    const now = deps.now?.() ?? new Date().toISOString();
    const note: Note = { id, title: data.title, text: data.text, html: data.html,
      category: data.category as Note['category'],
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : now,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : now,
      pinned: typeof data.pinned === 'boolean' ? data.pinned : false, archived: false, deletedAt: null,
      folderId: typeof data.folderId === 'string' ? data.folderId : null,
      ...(data.reminderAt === undefined ? {} : { reminderAt: data.reminderAt as string | null }),
      ...(data.reminderNotified === undefined ? {} : { reminderNotified: data.reminderNotified as boolean }),
      ...(data.reminderRepeat === undefined ? {} : { reminderRepeat }),
    };
    try {
      await deps.saveNotes([...ordinary, note]);
      const confirmed = await deps.loadNotes();
      if (!matchesRestoredNote(confirmed.find(item => item.id === id), note)) return 'needs-recovery';
    } catch { return 'needs-recovery'; }
    try {
      await deps.saveVault(vault.filter(entry => entry.id !== id));
      if ((await deps.loadVault()).some(entry => entry.id === id)) return 'needs-recovery';
    } catch { return 'needs-recovery'; }
    return 'restored';
  });
}
