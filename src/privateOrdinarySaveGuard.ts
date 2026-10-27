import type { NotesStorage } from './notesController.ts';
import type { PrivateVaultEntry } from './privateVaultStorage.ts';
import type { PrivateWriteCoordinator } from './privateWriteCoordinator.ts';

// This is a fail-closed safety boundary, not a substitute for controller refresh.
// After a move, a stale controller snapshot must never restore a private note
// into ordinary plaintext storage. Check inside the exclusive write lock.
export function createPrivateOrdinarySaveGuard(
  coordinator: PrivateWriteCoordinator,
  ordinary: NotesStorage,
  vault: { load(): Promise<PrivateVaultEntry[]> },
): NotesStorage {
  return {
    load: () => ordinary.load(),
    save: notes => coordinator.exclusive(async () => {
      const encryptedIds = new Set((await vault.load()).map(entry => entry.id));
      if (notes.some(note => encryptedIds.has(note.id))) {
        throw new Error('Ordinary notes contain an encrypted vault ID. Save blocked to protect private data.');
      }
      await ordinary.save(notes);
    }),
  };
}
