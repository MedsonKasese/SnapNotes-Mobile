import type { AttachmentFileOperations } from './attachmentTransactions.ts';

type NativeDestinationFile = {
  exists: boolean;
  size: number | null;
  delete(): void;
};

type AndroidAttachmentFileSystem<TFile extends NativeDestinationFile> = {
  ensureDirectory(): void;
  sourceFile(uri: string): { copy(destination: TFile): Promise<void> | void };
  destinationFile(key: string): TFile;
};

export type PreparedAttachmentShareFile = {
  uri: string;
  cleanup(): void;
};

type ShareCopyFile = NativeDestinationFile & {
  uri: string;
  copy(destination: ShareCopyFile): Promise<void> | void;
};

type ShareCopyDirectory = {
  exists: boolean;
  create(options: { idempotent: boolean; intermediates: boolean }): void;
  delete(): void;
};

type AndroidAttachmentShareFileSystem<TDirectory extends ShareCopyDirectory> = {
  sourceFile(fileKey: string): ShareCopyFile;
  temporaryDirectory(): TDirectory;
  temporaryFile(directory: TDirectory, name: string): ShareCopyFile;
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

function validateShareFileName(name: string): string {
  if (typeof name !== 'string' || name.trim().length === 0 || name === '.' || name === '..' ||
      /[\\/\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('This attachment has an invalid file name and cannot be shared safely.');
  }
  return name;
}

/** Creates a disposable, human-named copy for Android's content-provider share intent. */
export function createAndroidAttachmentShareOperations<TDirectory extends ShareCopyDirectory>(
  fileSystem: AndroidAttachmentShareFileSystem<TDirectory>,
) {
  return {
    async createShareCopy(fileKey: string, attachmentName: string): Promise<PreparedAttachmentShareFile> {
      const name = validateShareFileName(attachmentName);
      const source = fileSystem.sourceFile(fileKey);
      if (!source.exists) throw new Error('This attachment is missing from this device.');

      const directory = fileSystem.temporaryDirectory();
      let copy: ShareCopyFile | null = null;
      const cleanup = () => {
        try { if (copy?.exists) copy.delete(); } catch { /* best-effort cleanup of this temporary copy */ }
        try { if (directory.exists) directory.delete(); } catch { /* cache files remain disposable if cleanup is unavailable */ }
      };

      try {
        copy = fileSystem.temporaryFile(directory, name);
        directory.create({ idempotent: false, intermediates: true });
        await source.copy(copy);
        if (!copy.exists) throw new Error('Temporary attachment copy could not be verified.');
        return { uri: copy.uri, cleanup };
      } catch (error) {
        cleanup();
        throw error;
      }
    },
  };
}
