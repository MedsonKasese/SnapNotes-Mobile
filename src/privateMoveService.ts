import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPrivateAccess } from './privateAccess.ts';
import { deviceNotesStorage } from './deviceNotesStorage.ts';
import { createPrivateVaultStorage } from './privateVaultStorage.ts';
import { privateSharedCoordinator } from './privateSharedCoordinator.ts';
import { encryptPrivatePayload, decryptPrivatePayload } from './privateCrypto.ts';
import { createAttachmentManifestStorage } from './attachmentManifestStorage.ts';
import { moveNoteToPrivateTransaction } from './privateMoveTransaction.ts';

const access = createPrivateAccess(AsyncStorage);
const rawVault = createPrivateVaultStorage(AsyncStorage);
const attachmentManifest = createAttachmentManifestStorage(AsyncStorage);

// This uses RAW adapters inside the outer exclusive transaction. Wrapping them
// again with coordinated adapters would deadlock the shared queue.
export async function moveDeviceNoteToPrivate(id: string, password: string) {
  return access.withAuthenticatedKey(password, (key, salt) =>
    moveNoteToPrivateTransaction(id, {
      loadNotes: () => deviceNotesStorage.load(),
      saveNotes: notes => deviceNotesStorage.save(notes),
      loadVault: () => rawVault.load(),
      saveVault: entries => rawVault.save(entries),
      assertNoUnencryptedAttachments: async noteId => {
        if ((await attachmentManifest.load(noteId)).length > 0) {
          throw new Error('Remove local attachments before moving this note to Private. Private attachments are not encrypted.');
        }
      },
      encrypt: encryptPrivatePayload,
      decrypt: decryptPrivatePayload,
      key,
      salt,
      withExclusiveMove: operation => privateSharedCoordinator.exclusive(operation),
    }),
  );
}
