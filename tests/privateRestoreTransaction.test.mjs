import test from 'node:test';
import assert from 'node:assert/strict';
import { restorePrivateNoteTransaction } from '../src/privateRestoreTransaction.ts';

const payload = { title: 'Private', text: 'Secret', html: '', category: 'general', folderId: null };
function harness(failAt) {
  let notes = [];
  let vault = [{ id: 'n1', privateData: { ciphertext: 'opaque' } }];
  const deps = {
    loadNotes: async () => notes.map(n => ({ ...n })),
    saveNotes: async next => { if (failAt === 'ordinary') throw Error('disk'); notes = next; },
    loadVault: async () => [...vault],
    saveVault: async next => { if (failAt === 'vault') throw Error('disk'); vault = next; },
    decrypt: async () => payload,
    key: {},
    withExclusiveRestore: operation => operation(),
  };
  return { deps, state: () => ({ notes, vault }) };
}

test('restores ordinary copy and only then removes ciphertext', async () => {
  const h = harness();
  assert.equal(await restorePrivateNoteTransaction('n1', h.deps), 'restored');
  assert.equal(h.state().notes.length, 1);
  assert.equal(h.state().vault.length, 0);
});

test('failed ordinary write retains encrypted record', async () => {
  const h = harness('ordinary');
  assert.equal(await restorePrivateNoteTransaction('n1', h.deps), 'needs-recovery');
  assert.equal(h.state().vault.length, 1);
});

test('failed vault write leaves both copies for recovery', async () => {
  const h = harness('vault');
  assert.equal(await restorePrivateNoteTransaction('n1', h.deps), 'needs-recovery');
  assert.equal(h.state().notes.length, 1);
  assert.equal(h.state().vault.length, 1);
});
