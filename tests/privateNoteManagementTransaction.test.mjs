import test from 'node:test';
import assert from 'node:assert/strict';
import { deletePrivateNoteTransaction, updatePrivateNoteTransaction } from '../src/privateNoteManagementTransaction.ts';
import { PRIVATE_VERIFIER_ID } from '../src/privateAccess.ts';

const key = {};
const salt = new Uint8Array(16);
const payload = {
  title: 'Private title', text: 'Private body', html: '<p>Private body</p>', category: 'personal',
  tags: ['keep'], attachments: [{ id: 'encrypted-attachment-reference' }], pinned: false,
};
function fixture({ failSave = false } = {}) {
  let counter = 0;
  const records = new Map([['old', structuredClone(payload)]]);
  let vault = [
    { id: PRIVATE_VERIFIER_ID, privateData: { ciphertext: 'verifier' } },
    { id: 'note-1', privateData: { ciphertext: 'old' } },
  ];
  const events = [];
  const deps = {
    key, salt,
    async loadVault() { return structuredClone(vault); },
    async saveVault(next) { events.push('save'); if (failSave) throw Error('disk failure'); vault = structuredClone(next); },
    async decrypt(record) {
      const value = records.get(record.ciphertext);
      if (!value) throw Error('unknown encrypted record');
      return structuredClone(value);
    },
    async encrypt(value) {
      events.push('encrypt');
      const ciphertext = 'new-' + (++counter);
      records.set(ciphertext, structuredClone(value));
      return { ciphertext };
    },
    withExclusiveMutation(operation) { events.push('exclusive'); return operation(); },
  };
  return { deps, events, state: () => structuredClone(vault), payloads: records };
}

test('editing changes the encrypted title/body while retaining other private payload fields', async () => {
  const f = fixture();
  const before = structuredClone(payload);
  const updated = await updatePrivateNoteTransaction('note-1', {
    title: 'Changed title', text: 'Edited body', html: '<p>Edited body</p>',
  }, f.deps);
  assert.equal(updated.title, 'Changed title');
  assert.equal(updated.text, 'Edited body');
  assert.equal(f.state().find(entry => entry.id === 'note-1').privateData.ciphertext, 'new-1');
  assert.deepEqual(f.payloads.get('new-1'), {
    ...before, title: 'Changed title', text: 'Edited body', html: '<p>Edited body</p>',
  });
  assert.deepEqual(payload, before);
  assert.deepEqual(f.events, ['exclusive', 'encrypt', 'save']);
});

test('pin updates are persisted in ciphertext and returned for card ordering', async () => {
  const f = fixture();
  const updated = await updatePrivateNoteTransaction('note-1', { pinned: true }, f.deps);
  assert.equal(updated.pinned, true);
  assert.equal(f.payloads.get('new-1').pinned, true);
  assert.equal(f.payloads.get('new-1').text, payload.text);
});

test('invalid edit content is rejected before writing', async () => {
  const f = fixture();
  await assert.rejects(updatePrivateNoteTransaction('note-1', {
    title: 'Changed', text: 'not body', html: '<p>different</p>',
  }, f.deps), /does not match/);
  assert.deepEqual(f.events, ['exclusive']);
  assert.equal(f.state().find(entry => entry.id === 'note-1').privateData.ciphertext, 'old');
});

test('ambiguous edit storage failure is accepted only if readback proves the exact new ciphertext', async () => {
  const f = fixture({ failSave: true });
  await assert.rejects(updatePrivateNoteTransaction('note-1', { pinned: true }, f.deps), /could not be confirmed/);
  assert.equal(f.state().find(entry => entry.id === 'note-1').privateData.ciphertext, 'old');
});

test('delete removes only the selected encrypted note and never the verifier', async () => {
  const f = fixture();
  await deletePrivateNoteTransaction('note-1', f.deps);
  assert.deepEqual(f.state().map(entry => entry.id), [PRIVATE_VERIFIER_ID]);
  await assert.rejects(deletePrivateNoteTransaction(PRIVATE_VERIFIER_ID, f.deps), /Cannot delete/);
});

test('unconfirmed delete write leaves the encrypted private note in the active vault', async () => {
  const f = fixture({ failSave: true });
  await assert.rejects(deletePrivateNoteTransaction('note-1', f.deps), /could not be deleted/);
  assert.deepEqual(f.state().map(entry => entry.id), [PRIVATE_VERIFIER_ID, 'note-1']);
});
