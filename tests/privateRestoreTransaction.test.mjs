import test from 'node:test';
import assert from 'node:assert/strict';
import { restorePrivateNoteTransaction } from '../src/privateRestoreTransaction.ts';
import { createNotesStorage } from '../src/notesStorage.ts';

const payload = { title: 'Private', text: 'Secret', html: '<p>Secret</p>', category: 'general', folderId: null };
function notesBackend() {
  const values = new Map();
  return {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async getAllKeys() { return [...values.keys()]; },
    async multiRemove(keys) { for (const key of keys) values.delete(key); },
  };
}
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

test('restore verifies the saved note through the real notes storage adapter', async () => {
  const notes = createNotesStorage(notesBackend());
  let vault = [{ id: 'n1', privateData: { ciphertext: 'opaque' } }];
  const deps = {
    loadNotes: () => notes.load(),
    saveNotes: saved => notes.save(saved),
    loadVault: async () => [...vault],
    saveVault: async saved => { vault = saved; },
    decrypt: async () => payload,
    key: {},
    withExclusiveRestore: operation => operation(),
  };
  assert.equal(await restorePrivateNoteTransaction('n1', deps), 'restored');
  const restored = (await notes.load())[0];
  assert.equal(restored.title, payload.title);
  assert.equal(restored.text, payload.text);
  assert.equal(restored.html, payload.html);
  assert.equal(vault.length, 0);
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

test('inconsistent decrypted HTML is rejected without changing either copy', async () => {
  const h = harness();
  h.deps.decrypt = async () => ({ ...payload, html: '<p>Different</p>' });
  await assert.rejects(restorePrivateNoteTransaction('n1', h.deps), /Unsupported private note payload/);
  assert.equal(h.state().notes.length, 0);
  assert.equal(h.state().vault.length, 1);
});
