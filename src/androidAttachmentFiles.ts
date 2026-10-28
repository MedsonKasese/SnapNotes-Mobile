import { Directory, File, Paths } from 'expo-file-system';
import type { AttachmentFileOperations } from './attachmentTransactions.ts';

const KEY_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const ATTACHMENT_DIRECTORY = 'snapnotes-attachments';

function destinationFor(key: string): File {
  if (!KEY_PATTERN.test(key)) throw new Error('Invalid attachment file identifier.');
  return new File(new Directory(Paths.document, ATTACHMENT_DIRECTORY), key);
}

/**
 * Durable app-private storage for ordinary notes. Never use this adapter for
 * Private Notes: encrypted vault attachments need encryption at rest first.
 * Expo FileSystem's File API copies provider files without base64 encoding
 * the entire document into JavaScript memory.
 */
export function createAndroidAttachmentFiles(): AttachmentFileOperations & {
  fileForPreview(fileKey: string): File;
} {
  return {
    async copyIntoPrivateStorage(sourceUri: string, fileKey: string): Promise<void> {
      if (!/^(content|file):\/\//.test(sourceUri)) {
        throw new Error('Expected a local document picker URI.');
      }
      const directory = new Directory(Paths.document, ATTACHMENT_DIRECTORY);
      directory.create({ idempotent: true, intermediates: true });
      const destination = destinationFor(fileKey);
      if (destination.exists) throw new Error('Attachment file identifier collision.');
      new File(sourceUri).copy(destination);
    },
    async storedFileSize(fileKey: string): Promise<number | null> {
      const file = destinationFor(fileKey);
      return file.exists ? file.size : null;
    },
    async removePrivateFile(fileKey: string): Promise<void> {
      const file = destinationFor(fileKey);
      if (file.exists) file.delete();
    },
    fileForPreview(fileKey: string): File {
      return destinationFor(fileKey);
    },
  };
}
