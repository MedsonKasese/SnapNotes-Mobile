import test from 'node:test';
import assert from 'node:assert/strict';
import { moveNoteToPrivateTransaction } from '../src/privateMoveTransaction.ts';

const source = Object.freeze({
  id: 'n1', title: 'Secret', text: 'Content', category: 'general',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  pinned: false, archived: false, deletedAt: null,
});
const cipher = {
  version: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA-256',
  iterations: 600000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA',
};
function fixture(overrides = {}) {
  let notes = [{ ...source }], vault = [], encryptedPayload;
  const events = [];
  const deps = {
    loadNotes: async () => structuredClone(notes),
    saveNotes: async next => { events.push('notes-save'); notes = structuredClone(next); },
    loadVault: async () => structuredClone(vault),
    saveVault: async next => { events.push('vault-save'); vault = structuredClone(next); },
    encrypt: async payload => { encryptedPayload = structuredClone(payload); events.push('encrypt'); return cipher; },
    decrypt: async () => structuredClone(encryptedPayload),
    key: new Uint8Array(32), salt: new Uint8Array(16),
    withExclusiveMove: async callback => callback(),
    ...overrides,
  };
  return { deps, events, getNotes: () => notes, getVault: () => vault };
}

test('encrypts and verifies durable vault before removing source', async () => {
  const f = fixture();
  assert.deepEqual(await moveNoteToPrivateTransaction('n1', f.deps), { status: 'moved' });
  assert.deepEqual(f.events, ['encrypt', 'vault-save', 'notes-save']);
  assert.equal(f.getNotes().length, 0);
  assert.equal(f.getVault().length, 1);
});

test('failed vault write retains ordinary note', async () => {
  const f = fixture({ saveVault: async () => { throw Error('disk full'); } });
  await assert.rejects(moveNoteToPrivateTransaction('n1', f.deps), /disk full/);
  assert.equal(f.getNotes().length, 1);
});

test('failed source removal reports recovery, never deletes vault', async () => {
  const f = fixture({ saveNotes: async () => { throw Error('disk full'); } });
  assert.equal((await moveNoteToPrivateTransaction('n1', f.deps)).status, 'needs-recovery');
  assert.equal(f.getNotes().length, 1);
  assert.equal(f.getVault().length, 1);
});

test('corrupted vault readback retains source', async () => {
  let calls = 0;
  const f = fixture({ loadVault: async () => ++calls === 1 ? [] : [] });
  assert.equal((await moveNoteToPrivateTransaction('n1', f.deps)).status, 'needs-recovery');
  assert.equal(f.getNotes().length, 1);
});

test('changed source after vault commit is not removed', async () => {
  const f = fixture();
  const originalLoad = f.deps.loadNotes;
  let reads = 0;
  f.deps.loadNotes = async () => {
    const notes = await originalLoad();
    if (++reads === 2) notes[0].text = 'Edited while moving';
    return notes;
  };
  assert.equal((await moveNoteToPrivateTransaction('n1', f.deps)).status, 'needs-recovery');
  assert.equal(f.getNotes().length, 1);
});

test('unsupported metadata cannot silently disappear', async () => {
  const f = fixture({ loadNotes: async () => [{ ...source, attachments: [{ id: 'a' }] }] });
  await assert.rejects(moveNoteToPrivateTransaction('n1', f.deps), /cannot yet be moved safely/);
  assert.equal(f.getVault().length, 0);
});

test('duplicate vault ID is rejected before encryption', async () => {
  const f = fixture({ loadVault: async () => [{ id: 'n1', privateData: cipher }] });
  await assert.rejects(moveNoteToPrivateTransaction('n1', f.deps), /already has a private vault record/);
  assert.equal(f.events.length, 0);
});
