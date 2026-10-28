import { validateAttachmentCandidate, type AttachmentCandidate } from './attachmentRules.ts';

/**
 * Persistent attachment manifest schema. Only app-owned relative file IDs are
 * accepted: transient picker URIs, absolute paths, remote URLs and data URLs
 * must never be persisted as durable attachment references.
 */
export type StoredAttachment = AttachmentCandidate & {
  id: string;
  fileKey: string;
};

const SAFE_KEY = /^[a-zA-Z0-9_-]{8,128}$/;

export function validateStoredAttachments(value: unknown): StoredAttachment[] {
  if (!Array.isArray(value)) throw new Error('Invalid attachment manifest.');
  if (value.length > 5) throw new Error('Too many attachments.');
  const ids = new Set<string>();
  const keys = new Set<string>();
  return value.map((entry: unknown, index: number) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('Invalid attachment metadata.');
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || !SAFE_KEY.test(record.id) ||
        typeof record.fileKey !== 'string' || !SAFE_KEY.test(record.fileKey)) {
      throw new Error('Attachment IDs must be app-owned opaque identifiers.');
    }
    if (ids.has(record.id) || keys.has(record.fileKey)) {
      throw new Error('Duplicate attachment identifier.');
    }
    const candidate: AttachmentCandidate = {
      name: record.name as string,
      size: record.size as number,
      mimeType: record.mimeType as string,
    };
    const result = validateAttachmentCandidate(candidate, index);
    if (!result.ok) throw new Error(result.reason);
    ids.add(record.id);
    keys.add(record.fileKey);
    return { id: record.id, fileKey: record.fileKey, ...candidate };
  });
}
