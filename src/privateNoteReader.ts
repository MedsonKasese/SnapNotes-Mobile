import { decryptPrivatePayload } from './privateCrypto.ts';
import { PRIVATE_VERIFIER_ID } from './privateAccess.ts';
import type { PrivateVaultEntry } from './privateVaultStorage.ts';

export type PrivateNotePreview = { id: string; title: string; text: string; html: string; category: string; pinned: boolean; createdAt?: string; updatedAt?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// The PWA shows the count while locked; count opaque vault records without
// decrypting them or exposing note content. The verifier is not a note.
export function countPrivateVaultNotes(entries: readonly PrivateVaultEntry[]): number {
  return entries.filter(entry => entry.id !== PRIVATE_VERIFIER_ID).length;
}

// Decrypted values are kept in memory only. Do not cache previews, put them in
// ordinary notes storage, or log them. Reject malformed payloads rather than
// accidentally rendering an unrecognized vault record.
export async function readPrivateNotes(
  entries: readonly PrivateVaultEntry[],
  key: Parameters<typeof decryptPrivatePayload>[1],
  decrypt: typeof decryptPrivatePayload = decryptPrivatePayload,
): Promise<PrivateNotePreview[]> {
  const results: PrivateNotePreview[] = [];
  for (const entry of entries) {
    if (entry.id === PRIVATE_VERIFIER_ID) continue;
    const payload = await decrypt(entry.privateData, key);
    if (!isRecord(payload) || typeof payload.title !== 'string' ||
      typeof payload.text !== 'string' || typeof payload.html !== 'string' ||
      typeof payload.category !== 'string') {
      throw new Error('Encrypted private note has an unsupported payload. No changes were made.');
    }
    results.push({ id: entry.id, title: payload.title, text: payload.text,
      html: payload.html, category: payload.category,
      pinned: typeof payload.pinned === 'boolean' ? payload.pinned : false,
      ...(typeof payload.createdAt === 'string' ? { createdAt: payload.createdAt } : {}),
      ...(typeof payload.updatedAt === 'string' ? { updatedAt: payload.updatedAt } : {}) });
  }
  return results;
}
