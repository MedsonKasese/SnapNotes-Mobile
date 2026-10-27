import { NOTE_CATEGORIES, normalizeDraft, validateDraft, type NoteDraft } from './notes.ts';
import { decryptPrivatePayload, encryptPrivatePayload } from './privateCrypto.ts';
import { PRIVATE_VERIFIER_ID } from './privateAccess.ts';
import type { PrivateNotePreview } from './privateNoteReader.ts';
import type { PrivateVaultEntry } from './privateVaultStorage.ts';

type Key = Parameters<typeof decryptPrivatePayload>[1];
type Changes = Partial<Pick<NoteDraft, 'title' | 'text' | 'html'>> & { pinned?: boolean };
type Dependencies = {
  loadVault(): Promise<PrivateVaultEntry[]>;
  saveVault(entries: PrivateVaultEntry[]): Promise<void>;
  decrypt: typeof decryptPrivatePayload;
  encrypt: typeof encryptPrivatePayload;
  key: Key;
  salt: Uint8Array;
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
