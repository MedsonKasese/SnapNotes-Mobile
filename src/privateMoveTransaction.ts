import type { Note } from './notes.ts';
import type { PrivateVaultEntry } from './privateVaultStorage.ts';
import { buildMobilePrivatePayload, assertPrivateMoveSafe } from './privateMovePreparation.ts';
import { decryptPrivatePayload, encryptPrivatePayload } from './privateCrypto.ts';

// Transaction core only: the UI/controller must supply exclusive coordination
// with ordinary-note writes, a live unlocked key, and durable storage adapters.
// A successful vault write followed by a failed source write leaves BOTH copies;
// never silently delete ciphertext as "rollback". The caller must reconcile this
// separately; this entry point rejects existing vault IDs rather than retrying.
type MoveDependencies = {
  loadNotes(): Promise<Note[]>;
  saveNotes(notes: Note[]): Promise<void>;
  loadVault(): Promise<PrivateVaultEntry[]>;
  saveVault(entries: PrivateVaultEntry[]): Promise<void>;
  assertNoUnencryptedAttachments(noteId: string): Promise<void>;
  encrypt: typeof encryptPrivatePayload;
  decrypt: typeof decryptPrivatePayload;
  key: Parameters<typeof encryptPrivatePayload>[1];
  salt: Uint8Array;
  // The controller must lock all ordinary-note and vault mutations throughout.
  withExclusiveMove<T>(operation: () => Promise<T>): Promise<T>;
};

export type PrivateMoveResult =
  | { status: 'moved' }
  | { status: 'needs-recovery'; reason: string };

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function moveNoteToPrivateTransaction(
  id: string,
  deps: MoveDependencies,
): Promise<PrivateMoveResult> {
  return deps.withExclusiveMove(async () => {
    await deps.assertNoUnencryptedAttachments(id);
    const notes = await deps.loadNotes();
    const vault = await deps.loadVault();
    const source = assertPrivateMoveSafe(notes, id, vault.map(entry => entry.id));
    const payload = buildMobilePrivatePayload(source);

    // Abort rather than discard metadata added by future note-model changes.
    const supported = new Set([
      'id', 'title', 'text', 'html', 'category', 'createdAt', 'updatedAt',
      'pinned', 'archived', 'deletedAt', 'folderId',
    ]);
    if (Object.keys(source).some(field => !supported.has(field))) {
      throw new Error('This note contains data that cannot yet be moved safely to Private.');
    }

    const ciphertext = await deps.encrypt(payload, deps.key, deps.salt);
    const decrypted = await deps.decrypt(ciphertext, deps.key);
    if (!sameJson(decrypted, payload)) throw new Error('Encrypted private note verification failed.');

    try {
      await deps.saveVault([...vault, { id, privateData: ciphertext }]);
      const committed = await deps.loadVault();
      const matches = committed.filter(entry => entry.id === id);
      if (matches.length !== 1 || !sameJson(matches[0].privateData, ciphertext) ||
        !sameJson(await deps.decrypt(matches[0].privateData, deps.key), payload)) {
        return { status: 'needs-recovery', reason: 'Private vault verification failed; original note retained.' };
      }
    } catch {
      // A rejected write can still have committed. Readback and authentication
      // errors are also ambiguous: retain the source and never roll back vault data.
      return { status: 'needs-recovery', reason: 'Private vault commit or verification failed; original note retained and recovery required.' };
    }

    try {
      // Exclusive coordination must cover the entire read/verify/write cycle.
      const current = await deps.loadNotes();
      const live = current.filter(note => note.id === id);
      if (live.length !== 1 || !sameJson(live[0], source)) {
        return { status: 'needs-recovery', reason: 'Source note changed; both copies retained.' };
      }
      await deps.saveNotes(current.filter(note => note.id !== id));
      const remaining = await deps.loadNotes();
      if (remaining.some(note => note.id === id)) {
        return { status: 'needs-recovery', reason: 'Source removal not confirmed; both copies may remain.' };
      }
    } catch {
      return { status: 'needs-recovery', reason: 'Source removal failed; original note retained or recovery required.' };
    }
    return { status: 'moved' };
  });
}
