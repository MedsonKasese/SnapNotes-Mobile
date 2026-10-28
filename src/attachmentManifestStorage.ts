import type { StoredAttachment } from './attachmentManifest.ts';
import { validateStoredAttachments } from './attachmentManifest.ts';
import type { AttachmentManifestOperations } from './attachmentTransactions.ts';

const PREFIX = '@snapnotes-mobile/attachments/';
type Backend = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

function noteKey(noteId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(noteId)) throw new Error('Invalid note identifier.');
  return PREFIX + noteId;
}

/** Durable metadata adapter only. File bytes belong in app-private file storage.
 * Callers must serialize changes per note; this adapter does not provide a mutex.
 */
export function createAttachmentManifestStorage(backend: Backend): AttachmentManifestOperations {
  return {
    async load(noteId: string): Promise<StoredAttachment[]> {
      const raw = await backend.getItem(noteKey(noteId));
      if (raw === null) return [];
      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { throw new Error('Corrupt attachment manifest.'); }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
          (parsed as Record<string, unknown>).version !== 1) {
        throw new Error('Unsupported attachment manifest version.');
      }
      return validateStoredAttachments((parsed as Record<string, unknown>).attachments);
    },
    async save(noteId: string, attachments: StoredAttachment[]): Promise<void> {
      const validated = validateStoredAttachments(attachments);
      await backend.setItem(noteKey(noteId), JSON.stringify({ version: 1, attachments: validated }));
    },
  };
}
