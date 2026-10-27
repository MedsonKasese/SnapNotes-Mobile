import type { Note } from './notes.ts';
import type { PrivateVaultEntry } from './privateVaultStorage.ts';
import { buildMobilePrivatePayload } from './privateMovePreparation.ts';
import { inspectPrivateMoveRecovery } from './privateMoveRecovery.ts';
import { decryptPrivatePayload } from './privateCrypto.ts';

// Recovery never deletes either copy. Authentication and payload equality are
// required before the UI can offer to finish an interrupted migration.
export async function inspectAuthenticatedPrivateRecovery(
  notes: readonly Note[],
  vault: readonly PrivateVaultEntry[],
  key: Parameters<typeof decryptPrivatePayload>[1],
  decrypt: typeof decryptPrivatePayload = decryptPrivatePayload,
) {
  const findings = inspectPrivateMoveRecovery(notes as Note[], vault as PrivateVaultEntry[]);
  const results: Array<{ id: string; status: 'verified-duplicate' | 'conflict' | 'unreadable' }> = [];
  for (const finding of findings) {
    if (finding.kind !== 'duplicate') continue;
    const note = notes.find(item => item.id === finding.id);
    const encrypted = vault.find(item => item.id === finding.id);
    if (!note || !encrypted) continue;
    try {
      const actual = await decrypt(encrypted.privateData, key);
      const expected = buildMobilePrivatePayload(note);
      results.push({ id: finding.id, status: JSON.stringify(actual) === JSON.stringify(expected)
        ? 'verified-duplicate' : 'conflict' });
    } catch {
      results.push({ id: finding.id, status: 'unreadable' });
    }
  }
  return results;
}
