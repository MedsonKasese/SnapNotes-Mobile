import type { NotesStorage } from './notesController.ts';
import type { Note } from './notes.ts';
import type { PrivateVaultEntry } from './privateVaultStorage.ts';
import type { PrivateWriteCoordinator } from './privateWriteCoordinator.ts';

// A single coordinator instance must be shared by BOTH storage adapters.
// The move transaction takes the outer lock and uses the raw adapters,
// never these wrappers, to avoid reentrant deadlock.
export function createCoordinatedPrivateStores(
  coordinator: PrivateWriteCoordinator,
  ordinary: NotesStorage,
  vault: {
    load(): Promise<PrivateVaultEntry[]>;
    save(entries: PrivateVaultEntry[]): Promise<void>;
  },
) {
  const notes: NotesStorage = {
    load: () => ordinary.load(),
    save: (next: Note[]) => coordinator.exclusive(() => ordinary.save(next)),
  };
  const privateVault = {
    load: () => vault.load(),
    save: (entries: PrivateVaultEntry[]) => coordinator.exclusive(() => vault.save(entries)),
  };
  return {
    notes,
    privateVault,
    // Use only inside a higher-level transaction that owns the entire lock.
    // Never call notes.save/privateVault.save from inside this callback.
    withExclusiveMove: <T>(operation: () => Promise<T>) => coordinator.exclusive(operation),
    transactionStores: { notes: ordinary, privateVault: vault },
  };
}
