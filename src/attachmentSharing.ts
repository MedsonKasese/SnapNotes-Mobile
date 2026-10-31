import type { PreparedAttachmentShareFile } from './androidAttachmentFileOperations.ts';

type ShareableAttachment = {
  fileKey: string;
  name: string;
  mimeType: string;
};

type ShareOptions = {
  mimeType: string;
  dialogTitle: string;
  UTI?: string;
};

/** Share a uniquely staged copy, then remove that copy whether the chooser succeeds, is cancelled, or rejects. */
export async function shareAttachmentWithTemporaryCopy(
  attachment: ShareableAttachment,
  createShareCopy: (fileKey: string, attachmentName: string) => Promise<PreparedAttachmentShareFile>,
  shareAsync: (uri: string, options: ShareOptions) => Promise<void>,
): Promise<void> {
  const temporary = await createShareCopy(attachment.fileKey, attachment.name);
  try {
    await shareAsync(temporary.uri, {
      mimeType: attachment.mimeType,
      dialogTitle: attachment.name,
      UTI: attachment.mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined,
    });
  } finally {
    try { temporary.cleanup(); } catch { /* do not replace the share result with a cache-cleanup failure */ }
  }
}
