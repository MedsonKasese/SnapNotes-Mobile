import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPrivateAccess } from './privateAccess.ts';
import { deviceNotesStorage } from './deviceNotesStorage.ts';
import { createPrivateVaultStorage } from './privateVaultStorage.ts';
import { privateSharedCoordinator } from './privateSharedCoordinator.ts';
import { decryptPrivatePayload } from './privateCrypto.ts';
import { restorePrivateNoteTransaction } from './privateRestoreTransaction.ts';

const access = createPrivateAccess(AsyncStorage);
const vault = createPrivateVaultStorage(AsyncStorage);

// Only the transaction can write a plaintext ID that currently exists in the
// encrypted vault. It holds the SAME exclusive queue as ordinary save guards,
// and verifies the ordinary copy before deleting ciphertext.
export function restoreDevicePrivateNote(id: string, password: string) {
  return access.withAuthenticatedKey(password, key =>
    restorePrivateNoteTransaction(id, {
      loadNotes: () => deviceNotesStorage.load(),
      saveNotes: notes => deviceNotesStorage.save(notes),
      loadVault: () => vault.load(),
      saveVault: entries => vault.save(entries),
      decrypt: decryptPrivatePayload,
      key,
      withExclusiveRestore: operation => privateSharedCoordinator.exclusive(operation),
    }),
  );
}
