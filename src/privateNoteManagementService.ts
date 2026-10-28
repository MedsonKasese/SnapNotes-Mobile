import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPrivateVaultStorage } from './privateVaultStorage.ts';
import { privateSharedCoordinator } from './privateSharedCoordinator.ts';
import { decryptPrivatePayload, encryptPrivatePayload } from './privateCrypto.ts';
import type { AuthenticatedPrivateSession } from './privateAccess.ts';
import { deletePrivateNoteTransaction, updatePrivateNoteTransaction } from './privateNoteManagementTransaction.ts';
import type { NoteDraft } from './notes.ts';

const vault = createPrivateVaultStorage(AsyncStorage);
const dependencies = (session: AuthenticatedPrivateSession) => ({
  loadVault: () => vault.load(),
  saveVault: (entries: Parameters<typeof vault.save>[0]) => vault.save(entries),
  decrypt: decryptPrivatePayload,
  encrypt: encryptPrivatePayload,
  key: session.key,
  salt: session.salt,
  withExclusiveMutation: <T>(operation: () => Promise<T>) => privateSharedCoordinator.exclusive(operation),
});

export function updateDevicePrivateNote(
  id: string,
  session: AuthenticatedPrivateSession,
  changes: Partial<Pick<NoteDraft, 'title' | 'text' | 'html'>> & { pinned?: boolean },
) {
  return updatePrivateNoteTransaction(id, changes, dependencies(session));
}

export function deleteDevicePrivateNote(id: string, session: AuthenticatedPrivateSession) {
  return deletePrivateNoteTransaction(id, dependencies(session));
}
