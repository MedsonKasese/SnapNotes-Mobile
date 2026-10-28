import { createAttachmentOperationQueue } from './attachmentOperationQueue.ts';
import { addPickedAttachment, detachAttachment, type AttachmentFileOperations, type AttachmentManifestOperations, type AttachmentIdFactory, type PickedAttachment } from './attachmentTransactions.ts';

type AttachmentCoordinator = {
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
};

/** Single application-scoped entry point for safe attachment mutations.
 * Use the same service instance for every picker, remove action and note
 * deletion workflow. Native file and picker adapters are wired separately.
 */
export function createAttachmentService(
  files: AttachmentFileOperations,
  manifest: AttachmentManifestOperations,
  newId: AttachmentIdFactory,
  coordinator: AttachmentCoordinator,
  assertOrdinaryNote: (noteId: string) => Promise<void>,
) {
  const queue = createAttachmentOperationQueue();
  function run<T>(noteId: string, operation: () => Promise<T>): Promise<T> {
    return queue.run(noteId, () => coordinator.exclusive(async () => {
      await assertOrdinaryNote(noteId);
      return operation();
    }));
  }
  return {
    add(noteId: string, picked: PickedAttachment) {
      return run(noteId, () => addPickedAttachment(noteId, picked, files, manifest, newId));
    },
    remove(noteId: string, attachmentId: string) {
      return run(noteId, () => detachAttachment(noteId, attachmentId, files, manifest));
    },
    list(noteId: string) {
      return run(noteId, () => manifest.load(noteId));
    },
  };
}
