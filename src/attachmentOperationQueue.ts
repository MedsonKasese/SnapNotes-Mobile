/**
 * Serialize attachment changes per note, including reads, so two simultaneous
 * picks cannot both observe the same attachment count and overwrite each other.
 * Failed operations must not poison the queue.
 */
export function createAttachmentOperationQueue() {
  const pending = new Map<string, Promise<void>>();
  return {
    run<T>(noteId: string, operation: () => Promise<T>): Promise<T> {
      if (typeof noteId !== 'string' || !noteId.trim()) {
        return Promise.reject(new Error('Missing note ID.'));
      }
      const previous = pending.get(noteId) ?? Promise.resolve();
      const task = previous.then(operation);
      const settled = task.then(() => undefined, () => undefined);
      pending.set(noteId, settled);
      void settled.then(() => {
        if (pending.get(noteId) === settled) pending.delete(noteId);
      });
      return task;
    },
    pendingCount(): number { return pending.size; },
  };
}
