import type { Note } from './notes.ts';
import type { PrivateVaultEntry } from './privateVaultStorage.ts';

// Share ONE instance between the ordinary notes controller and private moves.
// Transaction callbacks use the raw stores while holding the exclusive gate;
// calling a gated adapter from inside withExclusiveMove would deadlock.
export function createPrivateMoveCoordinator(
  notes: { load(): Promise<Note[]>; save(value: Note[]): Promise<void> },
  vault: { load(): Promise<PrivateVaultEntry[]>; save(value: PrivateVaultEntry[]): Promise<void> },
) {
  let tail: Promise<void> = Promise.resolve();
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  return {
    // Pass this adapter to createNotesController, not the raw notes store.
    controllerNotesStorage: {
      load: () => exclusive(() => notes.load()),
      save: (value: Note[]) => exclusive(() => notes.save(value)),
    },
    // Pass these raw-store callbacks to moveNoteToPrivateTransaction.
    // Its withExclusiveMove holds the gate across BOTH stores and readback.
    transactionStorage: {
      loadNotes: () => notes.load(),
      saveNotes: (value: Note[]) => notes.save(value),
      loadVault: () => vault.load(),
      saveVault: (value: PrivateVaultEntry[]) => vault.save(value),
      withExclusiveMove: exclusive,
    },
  };
}
