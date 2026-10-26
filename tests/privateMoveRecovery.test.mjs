import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPrivateMoveRecovery } from '../src/privateMoveRecovery.ts';

test('detects duplicate IDs after interrupted ciphertext-first move without mutating inputs', () => {
  const notes = [{ id: 'same' }, { id: 'ordinary' }];
  const vault = [{ id: 'same' }, { id: 'private' }];
  const originalNotes = JSON.stringify(notes);
  const originalVault = JSON.stringify(vault);
  assert.deepEqual(inspectPrivateMoveRecovery(notes, vault), [
    { kind: 'duplicate', id: 'same' },
    { kind: 'vault-only', id: 'private' },
    { kind: 'ordinary-only', id: 'ordinary' },
  ]);
  assert.equal(JSON.stringify(notes), originalNotes);
  assert.equal(JSON.stringify(vault), originalVault);
});

test('empty stores require no recovery', () => {
  assert.deepEqual(inspectPrivateMoveRecovery([], []), []);
});
