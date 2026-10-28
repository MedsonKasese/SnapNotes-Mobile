import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { moveNoteToPrivateTransaction } from '../src/privateMoveTransaction.ts';
import { encryptPrivatePayload, decryptPrivatePayload } from '../src/privateCrypto.ts';
import { createPrivateVaultStorage } from '../src/privateVaultStorage.ts';

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

test('failed vault write reports recovery and retains ordinary note', async () => {
  const f = fixture({ saveVault: async () => { throw Error('disk full'); } });
  assert.equal((await moveNoteToPrivateTransaction('n1', f.deps)).status, 'needs-recovery');
  assert.equal(f.getNotes().length, 1);
  assert.equal(f.getVault().length, 0);
  assert.deepEqual(f.events, ['encrypt']);
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

test('vault commit followed by write rejection reports recovery and retains both copies', async () => {
  const f = fixture();
  const save = f.deps.saveVault;
  f.deps.saveVault = async entries => {
    await save(entries);
    throw Error('commit acknowledgement lost');
  };
  assert.equal((await moveNoteToPrivateTransaction('n1', f.deps)).status, 'needs-recovery');
  assert.equal(f.getNotes().length, 1);
  assert.equal(f.getVault().length, 1);
  assert.deepEqual(f.events, ['encrypt', 'vault-save']);
});

test('vault readback rejection after commit reports recovery without removing source', async () => {
  const f = fixture();
  const load = f.deps.loadVault;
  let reads = 0;
  f.deps.loadVault = async () => {
    if (++reads === 2) throw Error('vault read unavailable');
    return load();
  };
  assert.equal((await moveNoteToPrivateTransaction('n1', f.deps)).status, 'needs-recovery');
  assert.equal(f.getNotes().length, 1);
  assert.equal(f.getVault().length, 1);
  assert.deepEqual(f.events, ['encrypt', 'vault-save']);
});

test('vault decrypt rejection after commit reports recovery without removing source', async () => {
  const f = fixture();
  const decrypt = f.deps.decrypt;
  let decryptions = 0;
  f.deps.decrypt = async (...args) => {
    if (++decryptions === 2) throw Error('ciphertext authentication failed');
    return decrypt(...args);
  };
  assert.equal((await moveNoteToPrivateTransaction('n1', f.deps)).status, 'needs-recovery');
  assert.equal(f.getNotes().length, 1);
  assert.equal(f.getVault().length, 1);
  assert.deepEqual(f.events, ['encrypt', 'vault-save']);
});

for (const phase of ['encrypt', 'decrypt']) {
  test(`${phase} failure before commit rejects without storage writes`, async () => {
    const f = fixture({ [phase]: async () => { throw Error('precommit crypto failed'); } });
    await assert.rejects(moveNoteToPrivateTransaction('n1', f.deps), /precommit crypto failed/);
    assert.equal(f.getNotes().length, 1);
    assert.equal(f.getVault().length, 0);
    assert.ok(!f.events.includes('vault-save'));
    assert.ok(!f.events.includes('notes-save'));
  });
}

test('real encryption and vault storage preserve content and unrelated records under the guard', async () => {
  const data = new Map();
  let locked = false;
  const storage = createPrivateVaultStorage({
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
  });
  const key = webcrypto.getRandomValues(new Uint8Array(32));
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const note = {
    ...source, title: 'Unique private title', text: 'Unique private body',
    html: '<p>Unique private body</p>', category: 'personal', folderId: 'folder-1',
  };
  const unrelated = { ...source, id: 'n2', title: 'Keep ordinary' };
  const existing = {
    id: 'already-private',
    privateData: await encryptPrivatePayload({ text: 'Existing private record' }, key, salt, webcrypto),
  };
  await storage.save([existing]);
  let notes = [note, unrelated];
  function guarded() { assert.equal(locked, true); }
  const result = await moveNoteToPrivateTransaction(note.id, {
    loadNotes: async () => { guarded(); return structuredClone(notes); },
    saveNotes: async next => { guarded(); notes = structuredClone(next); },
    loadVault: async () => { guarded(); return storage.load(); },
    saveVault: async next => { guarded(); await storage.save(next); },
    encrypt: async (...args) => { guarded(); return encryptPrivatePayload(...args, webcrypto); },
    decrypt: async (...args) => { guarded(); return decryptPrivatePayload(...args, webcrypto); },
    key, salt,
    withExclusiveMove: async operation => {
      assert.equal(locked, false);
      locked = true;
      try { return await operation(); }
      finally { locked = false; }
    },
  });
  assert.deepEqual(result, { status: 'moved' });
  assert.equal(locked, false);
  assert.deepEqual(notes, [unrelated]);
  const vault = await storage.load();
  assert.equal(vault.length, 2);
  assert.deepEqual(vault[0], existing);
  assert.deepEqual(await decryptPrivatePayload(vault[1].privateData, key, webcrypto), {
    title: note.title, text: note.text, html: note.html, category: note.category,
    createdAt: note.createdAt, updatedAt: note.updatedAt,
    pinned: note.pinned, tags: [], time: '', folderId: note.folderId, reminderAt: null,
    reminderNotified: false, reminderRepeat: null, attachments: [], history: [],
  });
  const persisted = JSON.stringify([...data]);
  assert.ok(!persisted.includes(note.title));
  assert.ok(!persisted.includes(note.text));
  assert.ok(!persisted.includes(note.html));
});

test('retry after partial commit fails closed until separate recovery reconciles both copies', async () => {
  const f = fixture({ saveNotes: async () => { throw Error('disk full'); } });
  assert.equal((await moveNoteToPrivateTransaction('n1', f.deps)).status, 'needs-recovery');
  const retainedNotes = structuredClone(f.getNotes());
  const retainedVault = structuredClone(f.getVault());
  const events = [...f.events];
  await assert.rejects(moveNoteToPrivateTransaction('n1', f.deps), /already has a private vault record/);
  assert.deepEqual(f.getNotes(), retainedNotes);
  assert.deepEqual(f.getVault(), retainedVault);
  assert.deepEqual(f.events, events);
});
