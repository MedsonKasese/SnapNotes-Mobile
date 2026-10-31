import * as DocumentPicker from 'expo-document-picker';
import { ANDROID_DOCUMENT_PICKER_MIME_TYPES, normalizeDocumentSelection } from './androidDocumentSelection.ts';
import type { PickedAttachment } from './attachmentTransactions.ts';

/** Android system picker. copyToCacheDirectory gives FileSystem access to
 * provider files before they are copied into permanent app-private storage.
 * Selection alone never modifies a note.
 */
export async function pickAndroidAttachments(existingCount: number): Promise<PickedAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [...ANDROID_DOCUMENT_PICKER_MIME_TYPES],
    multiple: true,
    copyToCacheDirectory: true,
  });
  return normalizeDocumentSelection(result, existingCount);
}
