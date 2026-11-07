import type { Note } from './notes.ts';
import type { PrivateVaultEntry } from './privateVaultStorage.ts';
import { buildMobilePrivatePayload } from './privateMovePreparation.ts';
import { inspectPrivateMoveRecovery } from './privateMoveRecovery.ts';
import { decryptPrivatePayload } from './privateCrypto.ts';

function withoutReminderScheduleKey(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (key !== 'reminderScheduleKey') result[key] = field;
  }
  return result;
}

// Recovery never deletes either copy. Authentication and payload equality are
// required before the UI can offer to finish an interrupted migration.
export async function inspectAuthenticatedPrivateRecovery(
  notes: readonly Note[],
  vault: readonly PrivateVaultEntry[],
  key: Parameters<typeof decryptPrivatePayload>[1],
  decrypt: typeof decryptPrivatePayload = decryptPrivatePayload,
) {
  const findings = inspectPrivateMoveRecovery(notes as Note[], vault as PrivateVaultEntry[]);
  const results: { id: string; status: 'verified-duplicate' | 'conflict' | 'unreadable' }[] = [];
  for (const finding of findings) {
    if (finding.kind !== 'duplicate') continue;
    const note = notes.find(item => item.id === finding.id);
    const encrypted = vault.find(item => item.id === finding.id);
    if (!note || !encrypted) continue;
    try {
      const actual = await decrypt(encrypted.privateData, key);
      const expected = buildMobilePrivatePayload(note);
      results.push({ id: finding.id, status: JSON.stringify(withoutReminderScheduleKey(actual)) === JSON.stringify(withoutReminderScheduleKey(expected))
        ? 'verified-duplicate' : 'conflict' });
    } catch {
      results.push({ id: finding.id, status: 'unreadable' });
    }
  }
  return results;
}
