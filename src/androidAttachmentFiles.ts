import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { AttachmentFileOperations } from './attachmentTransactions.ts';
import { createAndroidAttachmentFileOperations, createAndroidAttachmentShareOperations, type PreparedAttachmentShareFile } from './androidAttachmentFileOperations.ts';

const KEY_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const ATTACHMENT_DIRECTORY = 'snapnotes-attachments';
const SHARE_DIRECTORY = 'snapnotes-attachment-sharing';

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
  createShareCopy(fileKey: string, attachmentName: string): Promise<PreparedAttachmentShareFile>;
} {
  const operations = createAndroidAttachmentFileOperations({
    ensureDirectory() {
      const directory = new Directory(Paths.document, ATTACHMENT_DIRECTORY);
      directory.create({ idempotent: true, intermediates: true });
    },
    sourceFile(uri) {
      return new File(uri);
    },
    destinationFile(key) {
      return destinationFor(key);
    },
  });
  const shareOperations = createAndroidAttachmentShareOperations({
    sourceFile(fileKey) {
      return destinationFor(fileKey);
    },
    temporaryDirectory() {
      return new Directory(Paths.cache, SHARE_DIRECTORY, Crypto.randomUUID());
    },
    temporaryFile(directory, name) {
      return new File(directory, name);
    },
  });
  return {
    ...operations,
    ...shareOperations,
    fileForPreview(fileKey: string): File {
      return destinationFor(fileKey);
    },
  };
}
