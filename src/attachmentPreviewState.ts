import type { attachmentPreviewKind } from './attachmentRules.ts';

export type AttachmentPreviewKind = ReturnType<typeof attachmentPreviewKind>;

export type AttachmentPreviewLoadState = {
  fileKey: string;
  kind: AttachmentPreviewKind;
  textContent: string | null;
  error: string | null;
};

export type AttachmentPreviewDisplayState =
  | { status: 'loading'; textContent: null; error: null }
  | { status: 'error'; textContent: null; error: string }
  | { status: 'image'; textContent: null; error: null }
  | { status: 'text'; textContent: string; error: null };

const PDF_PREVIEW_UNAVAILABLE =
  'PDF page rendering is not yet supported in the Android viewer. Your file remains safely stored.';
const UNSUPPORTED_PREVIEW = 'No in-app preview is available for this file type.';

/**
 * Only expose async preview results for the attachment and kind that produced them.
 * A new file shows a loading state immediately, before its effect has run.
 */
export function getAttachmentPreviewDisplayState(
  kind: AttachmentPreviewKind,
  fileKey: string,
  loaded: AttachmentPreviewLoadState | null,
): AttachmentPreviewDisplayState {
  const current = loaded?.fileKey === fileKey && loaded.kind === kind ? loaded : null;

  if (current?.error !== null && current?.error !== undefined) {
    return { status: 'error', textContent: null, error: current.error };
  }
  if (kind === 'image') return { status: 'image', textContent: null, error: null };
  if (kind === 'pdf') return { status: 'error', textContent: null, error: PDF_PREVIEW_UNAVAILABLE };
  if (kind === 'unsupported') return { status: 'error', textContent: null, error: UNSUPPORTED_PREVIEW };
  if (current === null) return { status: 'loading', textContent: null, error: null };
  return { status: 'text', textContent: current.textContent ?? '', error: null };
}
