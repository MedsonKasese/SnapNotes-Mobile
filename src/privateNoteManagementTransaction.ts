import { NOTE_CATEGORIES, normalizeDraft, validateDraft, type NoteDraft } from './notes.ts';
import { decryptPrivatePayload, encryptPrivatePayload } from './privateCrypto.ts';
import { PRIVATE_VERIFIER_ID } from './privateAccess.ts';
import type { PrivateNotePreview } from './privateNoteReader.ts';
import type { PrivateVaultEntry } from './privateVaultStorage.ts';
import { isValidReminderAt, normalizeReminderRepeat } from './reminders/recurrence.ts';

type Key = Parameters<typeof decryptPrivatePayload>[1];
type Changes = Partial<Pick<NoteDraft, 'title' | 'text' | 'html' | 'reminderAt' | 'reminderNotified' | 'reminderRepeat'>> &
  { pinned?: boolean; reminderScheduleKey?: string | null };
type Dependencies = {
  loadVault(): Promise<PrivateVaultEntry[]>;
  saveVault(entries: PrivateVaultEntry[]): Promise<void>;
  decrypt: typeof decryptPrivatePayload;
  encrypt: typeof encryptPrivatePayload;
  key: Key;
  salt: Uint8Array;
  now?: () => string;
  withExclusiveMutation<T>(operation: () => Promise<T>): Promise<T>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertPrivatePayload(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.text !== 'string' ||
    typeof value.html !== 'string' || typeof value.category !== 'string' ||
    !NOTE_CATEGORIES.includes(value.category as (typeof NOTE_CATEGORIES)[number])) {
    throw new Error('Encrypted private note has an unsupported payload. No changes were made.');
  }
  if ((value.reminderAt !== undefined && !isValidReminderAt(value.reminderAt)) ||
    (value.reminderNotified !== undefined && typeof value.reminderNotified !== 'boolean') ||
    (value.reminderRepeat !== undefined && value.reminderRepeat !== null &&
      (value.reminderAt == null || !normalizeReminderRepeat(value.reminderRepeat, value.reminderAt))) ||
    (value.reminderScheduleKey !== undefined && value.reminderScheduleKey !== null &&
      (typeof value.reminderScheduleKey !== 'string' || !/^private-reminder-[a-z0-9-]+$/.test(value.reminderScheduleKey)))) {
    throw new Error('Encrypted private note has invalid reminder data. No changes were made.');
  }
}

function asPreview(id: string, payload: Record<string, unknown>): PrivateNotePreview {
  assertPrivatePayload(payload);
  return {
    id,
    title: payload.title as string,
    text: payload.text as string,
    html: payload.html as string,
    category: payload.category as string,
    pinned: typeof payload.pinned === 'boolean' ? payload.pinned : false,
    ...(typeof payload.time === 'string' ? { time: payload.time } : {}),
    ...(typeof payload.createdAt === 'string' ? { createdAt: payload.createdAt } : {}),
    ...(typeof payload.updatedAt === 'string' ? { updatedAt: payload.updatedAt } : {}),
    ...(payload.reminderAt === undefined ? {} : { reminderAt: payload.reminderAt as string | null }),
    ...(payload.reminderNotified === undefined ? {} : { reminderNotified: payload.reminderNotified as boolean }),
    ...(payload.reminderRepeat === undefined ? {} : { reminderRepeat: payload.reminderRepeat as PrivateNotePreview['reminderRepeat'] }),
    ...(payload.reminderScheduleKey === undefined ? {} : { reminderScheduleKey: payload.reminderScheduleKey as string | null }),
  };
}

export async function updatePrivateNoteTransaction(
  id: string,
  changes: Changes,
  deps: Dependencies,
): Promise<PrivateNotePreview> {
  return deps.withExclusiveMutation(async () => {
    if (id === PRIVATE_VERIFIER_ID) throw new Error('Cannot edit a vault verifier.');
    const vault = await deps.loadVault();
    const matches = vault.filter(entry => entry.id === id);
    if (matches.length !== 1) throw new Error('Encrypted note not found.');

    const current = await deps.decrypt(matches[0].privateData, deps.key);
    assertPrivatePayload(current);
    const next: Record<string, unknown> = { ...current };
    const hasContentChange = changes.title !== undefined || changes.text !== undefined || changes.html !== undefined;
    const hasReminderChange = changes.reminderAt !== undefined || changes.reminderNotified !== undefined ||
      changes.reminderRepeat !== undefined || changes.reminderScheduleKey !== undefined;
    if (hasContentChange) {
      const draft: NoteDraft = {
        title: changes.title ?? current.title as string,
        text: changes.text ?? current.text as string,
        html: changes.html ?? current.html as string,
        category: current.category as NoteDraft['category'],
      };
      const error = validateDraft(draft);
      if (error) throw new Error(error);
      const normalized = normalizeDraft(draft);
      next.title = normalized.title;
      next.text = normalized.text;
      next.html = normalized.html ?? '';
    }
    if (changes.reminderAt !== undefined) {
      if (!isValidReminderAt(changes.reminderAt)) throw new Error('Choose a valid reminder date and time.');
      next.reminderAt = changes.reminderAt;
      if (changes.reminderAt === null) {
        next.reminderRepeat = null;
        next.reminderNotified = false;
        next.reminderScheduleKey = null;
      }
    }
    if (changes.reminderNotified !== undefined) {
      if (typeof changes.reminderNotified !== 'boolean') throw new Error('Invalid private reminder state.');
      next.reminderNotified = changes.reminderNotified;
    }
    if (changes.reminderRepeat !== undefined) {
      const reminderAt = changes.reminderAt === undefined ? current.reminderAt : changes.reminderAt;
      if (changes.reminderRepeat !== null && (reminderAt == null || !normalizeReminderRepeat(changes.reminderRepeat, reminderAt))) {
        throw new Error('Choose a valid repeat schedule.');
      }
      next.reminderRepeat = changes.reminderRepeat === null ? null : normalizeReminderRepeat(changes.reminderRepeat, reminderAt);
    }
    if (changes.reminderScheduleKey !== undefined) {
      if (changes.reminderScheduleKey !== null && (typeof changes.reminderScheduleKey !== 'string' ||
        !/^private-reminder-[a-z0-9-]+$/.test(changes.reminderScheduleKey))) throw new Error('Invalid private reminder state.');
      next.reminderScheduleKey = changes.reminderScheduleKey;
    }
    if (hasContentChange || hasReminderChange) next.updatedAt = deps.now?.() ?? new Date().toISOString();
    if (changes.pinned !== undefined) {
      if (typeof changes.pinned !== 'boolean') throw new Error('Invalid private note pin state.');
      next.pinned = changes.pinned;
    }

    const privateData = await deps.encrypt(next, deps.key, deps.salt);
    const verified = await deps.decrypt(privateData, deps.key);
    if (!isRecord(verified) || JSON.stringify(verified) !== JSON.stringify(next)) {
      throw new Error('Encrypted private note verification failed. No changes were made.');
    }
    const replacement = { id, privateData };
    const nextVault = vault.map(entry => entry.id === id ? replacement : entry);
    let writeError: unknown;
    try { await deps.saveVault(nextVault); } catch (cause) { writeError = cause; }

    // A storage rejection can be ambiguous. Accept only a committed record that
    // decrypts to the exact verified payload; otherwise keep the UI unchanged.
    const committed = await deps.loadVault();
    const committedMatches = committed.filter(entry => entry.id === id);
    if (committedMatches.length === 1) {
      const saved = await deps.decrypt(committedMatches[0].privateData, deps.key);
      if (isRecord(saved) && JSON.stringify(saved) === JSON.stringify(next)) return asPreview(id, saved);
    }
    if (writeError) throw new Error('The private-note edit could not be confirmed. Your existing note was kept.');
    throw new Error('The private-note edit could not be verified. Your existing note was kept.');
  });
}

export async function deletePrivateNoteTransaction(id: string, deps: Dependencies): Promise<void> {
  return deps.withExclusiveMutation(async () => {
    if (id === PRIVATE_VERIFIER_ID) throw new Error('Cannot delete the vault verifier.');
    const vault = await deps.loadVault();
    const matches = vault.filter(entry => entry.id === id);
    if (matches.length !== 1) throw new Error('Encrypted note not found.');
    // Authenticate the live session against the target record before removal.
    const payload = await deps.decrypt(matches[0].privateData, deps.key);
    assertPrivatePayload(payload);
    let writeError: unknown;
    try { await deps.saveVault(vault.filter(entry => entry.id !== id)); } catch (cause) { writeError = cause; }
    const committed = await deps.loadVault();
    if (committed.some(entry => entry.id === id)) {
      throw new Error(writeError ? 'The private note could not be deleted. No change was confirmed.' : 'The private note deletion could not be verified.');
    }
  });
}
