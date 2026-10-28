import { createAttachmentOperationQueue } from './attachmentOperationQueue.ts';
import { addPickedAttachment, detachAttachment, type AttachmentFileOperations, type AttachmentManifestOperations, type AttachmentIdFactory, type PickedAttachment } from './attachmentTransactions.ts';

/** Single application-scoped entry point for safe attachment mutations.
 * Use the same service instance for every picker, remove action and note
 * deletion workflow. Native file and picker adapters are wired separately.
 */
export function createAttachmentService(
  files: AttachmentFileOperations,
  manifest: AttachmentManifestOperations,
  newId: AttachmentIdFactory,
) {
  const queue = createAttachmentOperationQueue();
  return {
    add(noteId: string, picked: PickedAttachment) {
      return queue.run(noteId, () => addPickedAttachment(noteId, picked, files, manifest, newId));
    },
    remove(noteId: string, attachmentId: string) {
      return queue.run(noteId, () => detachAttachment(noteId, attachmentId, files, manifest));
    },
    list(noteId: string) {
      return queue.run(noteId, () => manifest.load(noteId));
    },
  };
}
