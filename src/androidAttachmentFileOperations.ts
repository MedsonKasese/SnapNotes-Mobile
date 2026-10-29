import type { AttachmentFileOperations } from './attachmentTransactions.ts';

type NativeDestinationFile = {
  exists: boolean;
  size: number | null;
  delete(): void;
};

type AndroidAttachmentFileSystem<TFile extends NativeDestinationFile> = {
  ensureDirectory(): void;
  sourceFile(uri: string): { copy(destination: TFile): Promise<void> };
  destinationFile(key: string): TFile;
};

/**
 * Bind Expo's native file objects to the attachment transaction contract.
 * Awaiting copy here is essential: callers verify the destination immediately
 * after this promise resolves and may roll it back if verification fails.
 */
export function createAndroidAttachmentFileOperations<TFile extends NativeDestinationFile>(
  fileSystem: AndroidAttachmentFileSystem<TFile>,
): AttachmentFileOperations {
  return {
    async copyIntoPrivateStorage(sourceUri, fileKey) {
      if (!/^(content|file):\/\//.test(sourceUri)) {
        throw new Error('Expected a local document picker URI.');
      }
      fileSystem.ensureDirectory();
      const destination = fileSystem.destinationFile(fileKey);
      if (destination.exists) throw new Error('Attachment file identifier collision.');
      await fileSystem.sourceFile(sourceUri).copy(destination);
    },
    async storedFileSize(fileKey) {
      const file = fileSystem.destinationFile(fileKey);
      return file.exists ? file.size : null;
    },
    async removePrivateFile(fileKey) {
      const file = fileSystem.destinationFile(fileKey);
      if (file.exists) file.delete();
    },
  };
}
