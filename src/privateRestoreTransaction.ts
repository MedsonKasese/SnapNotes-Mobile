import { NOTE_CATEGORIES, type Note } from './notes.ts';
import { noteHtmlToText, sanitizeNoteHtml } from './noteFormatting.ts';
import type { PrivateVaultEntry } from './privateVaultStorage.ts';
import { decryptPrivatePayload } from './privateCrypto.ts';
import { PRIVATE_VERIFIER_ID } from './privateAccess.ts';

export type PrivateRestoreDependencies = {
  loadNotes(): Promise<Note[]>;
  saveNotes(notes: Note[]): Promise<void>;
  loadVault(): Promise<PrivateVaultEntry[]>;
  saveVault(entries: PrivateVaultEntry[]): Promise<void>;
  decrypt: typeof decryptPrivatePayload;
  key: Parameters<typeof decryptPrivatePayload>[1];
  withExclusiveRestore<T>(operation: () => Promise<T>): Promise<T>;
};

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
      !NOTE_CATEGORIES.includes(data.category as Note['category']) ||
      noteHtmlToText(data.html).trim() !== data.text.replace(/\r/g, '').trim()) {
      throw Error('Unsupported private note payload.');
    }
    const now = new Date().toISOString();
    const note: Note = { id, title: data.title, text: data.text, html: data.html,
      category: data.category as Note['category'], createdAt: now, updatedAt: now,
      pinned: typeof data.pinned === 'boolean' ? data.pinned : false, archived: false, deletedAt: null,
      folderId: typeof data.folderId === 'string' ? data.folderId : null };
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
