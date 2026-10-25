import type { Note } from './notes.ts';
import type { PrivateVaultEntry } from './privateVaultStorage.ts';

export type PrivateMoveRecoveryFinding =
  | { kind: 'duplicate'; id: string }
  | { kind: 'vault-only'; id: string }
  | { kind: 'ordinary-only'; id: string };

// Read-only inspection: never deletes plaintext or ciphertext. In particular,
// a duplicate may mean the app stopped between vault commit and source removal.
// The caller must authenticate the ciphertext before offering reconciliation.
export function inspectPrivateMoveRecovery(
  notes: readonly Note[],
  vault: readonly PrivateVaultEntry[],
): PrivateMoveRecoveryFinding[] {
  const ordinaryIds = new Set(notes.map(note => note.id));
  const vaultIds = new Set(vault.map(entry => entry.id));
  const findings: PrivateMoveRecoveryFinding[] = [];
  for (const id of vaultIds) {
    findings.push({ kind: ordinaryIds.has(id) ? 'duplicate' : 'vault-only', id });
  }
  for (const id of ordinaryIds) {
    if (!vaultIds.has(id)) findings.push({ kind: 'ordinary-only', id });
  }
  return findings;
}
