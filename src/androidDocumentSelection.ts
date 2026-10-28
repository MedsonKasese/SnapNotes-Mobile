import { validateAttachmentCandidate, type AttachmentCandidate } from './attachmentRules.ts';
import type { PickedAttachment } from './attachmentTransactions.ts';

export type NativeDocumentAsset = {
  uri: string;
  name: string;
  size?: number | null;
  mimeType?: string | null;
};
export type NativeDocumentSelection =
  | { canceled: true; assets?: never }
  | { canceled: false; assets: NativeDocumentAsset[] };

export const ANDROID_DOCUMENT_PICKER_MIME_TYPES = [
  'application/pdf', 'text/plain', 'image/jpeg', 'image/png', 'image/gif', 'image/webp',
] as const;

/**
 * Validate document picker output without trusting extension or filename as a
 * MIME-type substitute. An Android provider may omit size or MIME metadata:
 * reject ambiguous files rather than bypassing PWA upload restrictions.
 */
export function normalizeDocumentSelection(
  selection: NativeDocumentSelection,
  existingCount: number,
): PickedAttachment[] {
  if (selection.canceled) return [];
  if (!Array.isArray(selection.assets)) throw new Error('Document picker returned invalid files.');
  if (selection.assets.length + existingCount > 5) {
    throw new Error('Each note supports up to 5 attachments.');
  }
  const files: PickedAttachment[] = [];
  for (const asset of selection.assets) {
    if (!asset || typeof asset.uri !== 'string' || !/^(content|file):\/\//.test(asset.uri)) {
      throw new Error('The selected file is unavailable. Please select it again.');
    }
    const candidate: AttachmentCandidate = {
      name: asset.name,
      size: asset.size as number,
      mimeType: asset.mimeType as string,
    };
    const validation = validateAttachmentCandidate(candidate, existingCount + files.length);
    if (!validation.ok) throw new Error(validation.reason);
    files.push({ ...candidate, uri: asset.uri });
  }
  return files;
}
