/** Attachment rules mirrored from the SnapNotes PWA's js/attachments.js.
 * This is a validation-only foundation: it does NOT upload, store or expose files.
 * The PWA requires a signed-in account for attachment uploads; mobile authentication
 * is not yet available. Never claim that local files are cloud-synced.
 */
export const MAX_ATTACHMENTS_PER_NOTE = 5;
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export type AttachmentCandidate = { name: string; size: number; mimeType: string };
export type AttachmentValidationResult = { ok: true } | { ok: false; reason: string };

export function validateAttachmentCandidate(
  file: AttachmentCandidate,
  existingCount: number,
): AttachmentValidationResult {
  if (!Number.isInteger(existingCount) || existingCount < 0) {
    return { ok: false, reason: 'Invalid attachment count.' };
  }
  if (existingCount >= MAX_ATTACHMENTS_PER_NOTE) {
    return { ok: false, reason: 'Each note supports up to 5 attachments.' };
  }
  if (!file || typeof file.name !== 'string' || !file.name.trim() ||
      typeof file.mimeType !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0) {
    return { ok: false, reason: 'Invalid attachment.' };
  }
  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(file.mimeType)) {
    return { ok: false, reason: 'Only images, PDF, and text files are supported.' };
  }
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return { ok: false, reason: 'Each attachment must be 10 MB or smaller.' };
  }
  return { ok: true };
}

export function attachmentPreviewKind(mimeType: string): 'image' | 'pdf' | 'text' | 'unsupported' {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'text/plain') return 'text';
  if ((ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(mimeType) && mimeType.startsWith('image/')) return 'image';
  return 'unsupported';
}
