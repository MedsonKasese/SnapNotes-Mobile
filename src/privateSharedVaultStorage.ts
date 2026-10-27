import { createPrivateVaultStorage } from './privateVaultStorage.ts';
import { privateSharedCoordinator } from './privateSharedCoordinator.ts';

// All public vault mutations share the workspace write queue. Reads retain
// the underlying storage's generation-pointer consistency guarantees.
// Transactions holding the outer lock must use their raw storage adapter.
export function createPrivateSharedVaultStorage(
  backend: Parameters<typeof createPrivateVaultStorage>[0],
) {
  const raw = createPrivateVaultStorage(backend);
  return {
    load: () => raw.load(),
    save: (entries: Parameters<typeof raw.save>[0]) =>
      privateSharedCoordinator.exclusive(() => raw.save(entries)),
    initializeIfEmpty: (entries: Parameters<typeof raw.initializeIfEmpty>[0]) =>
      privateSharedCoordinator.exclusive(() => raw.initializeIfEmpty(entries)),
  };
}
