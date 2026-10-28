import { validateAttachmentCandidate, type AttachmentCandidate } from './attachmentRules.ts';
import { validateStoredAttachments, type StoredAttachment } from './attachmentManifest.ts';

export type PickedAttachment = AttachmentCandidate & { uri: string };
export type AttachmentFileOperations = {
  /** Copy bytes into an app-private durable location addressed by opaque key. */
  copyIntoPrivateStorage(sourceUri: string, fileKey: string): Promise<void>;
  /** Confirm the destination exists and has the expected byte length. */
  storedFileSize(fileKey: string): Promise<number | null>;
  removePrivateFile(fileKey: string): Promise<void>;
};
export type AttachmentManifestOperations = {
  load(noteId: string): Promise<StoredAttachment[]>;
  save(noteId: string, attachments: StoredAttachment[]): Promise<void>;
};
export type AttachmentIdFactory = () => string;

/**
 * Copy-first attachment transaction. The manifest is only updated after
 * verifying the durable copy. If manifest save fails, a best-effort rollback
 * removes the unreferenced file; the original picker URI is never persisted.
 *
 * Callers MUST serialize operations per note and coordinate note deletion
 * with manifest writes; do not expose this as a UI action until then.
 */
export async function addPickedAttachment(
  noteId: string,
  picked: PickedAttachment,
  files: AttachmentFileOperations,
  manifest: AttachmentManifestOperations,
  newId: AttachmentIdFactory,
): Promise<StoredAttachment> {
  if (typeof noteId !== 'string' || !noteId.trim()) throw new Error('Missing note ID.');
  if (typeof picked.uri !== 'string' || !/^(content|file):\/\//.test(picked.uri)) {
    throw new Error('Picker did not return a supported local file URI.');
  }
  const existing = validateStoredAttachments(await manifest.load(noteId));
  const validation = validateAttachmentCandidate(picked, existing.length);
  if (!validation.ok) throw new Error(validation.reason);
  const id = newId();
  const fileKey = newId();
  const entry = validateStoredAttachments([...existing, {
    id, fileKey, name: picked.name, size: picked.size, mimeType: picked.mimeType,
  }]).at(-1)!;
  if (existing.some(item => item.id === id || item.fileKey === fileKey) || id === fileKey) {
    throw new Error('Attachment ID collision.');
  }
  let copied = false;
  try {
    await files.copyIntoPrivateStorage(picked.uri, fileKey);
    copied = true;
    const size = await files.storedFileSize(fileKey);
    if (size !== picked.size) throw new Error('Copied attachment could not be verified.');
    await manifest.save(noteId, [...existing, entry]);
    return entry;
  } catch (error) {
    // A copy may have succeeded before an I/O exception was reported.
    // Never allow rollback failure to mask the original error.
    try { await files.removePrivateFile(fileKey); } catch { /* orphan cleanup must retry */ }
    throw error;
  }
}

/** Remove the manifest reference first; cleanup failures leave only an orphan
 * rather than a broken attachment reference. Caller must queue orphan cleanup.
 */
export async function detachAttachment(
  noteId: string,
  attachmentId: string,
  files: AttachmentFileOperations,
  manifest: AttachmentManifestOperations,
): Promise<boolean> {
  const existing = validateStoredAttachments(await manifest.load(noteId));
  const target = existing.find(item => item.id === attachmentId);
  if (!target) return false;
  await manifest.save(noteId, existing.filter(item => item.id !== attachmentId));
  try { await files.removePrivateFile(target.fileKey); }
  catch { /* caller must arrange orphan cleanup */ }
  return true;
}
