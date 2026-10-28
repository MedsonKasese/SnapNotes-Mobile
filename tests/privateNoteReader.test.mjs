import test from 'node:test';
import assert from 'node:assert/strict';
import { countPrivateVaultNotes, readPrivateNotes } from '../src/privateNoteReader.ts';
import { PRIVATE_VERIFIER_ID } from '../src/privateAccess.ts';

const key = {};
const encrypted = [{ id: PRIVATE_VERIFIER_ID, privateData: {} }, { id: 'note-1', privateData: {} }];

test('reader skips verifier and returns authenticated note content', async () => {
  let calls = 0;
  const results = await readPrivateNotes(encrypted, key, async () => {
    calls++;
    return { title: 'Private', text: 'Sensitive', html: '', category: 'general', pinned: true,
      time: '9:30 AM',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
  });
  assert.equal(calls, 1);
  assert.deepEqual(results, [{ id: 'note-1', title: 'Private', text: 'Sensitive', html: '', category: 'general', pinned: true,
    time: '9:30 AM',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }]);
});

test('vault count excludes the verifier without decrypting note records', () => {
  assert.equal(countPrivateVaultNotes(encrypted), 1);
  assert.equal(countPrivateVaultNotes([encrypted[0]]), 0);
});

test('reader defaults older encrypted payloads to unpinned', async () => {
  const results = await readPrivateNotes(encrypted, key, async () => ({ title: 'Legacy', text: 'Body', html: '', category: 'general' }));
  assert.equal(results[0].pinned, false);
});

test('reader fails closed on unrecognized decrypted payload', async () => {
  await assert.rejects(readPrivateNotes(encrypted, key, async () => ({ title: 'bad' })), /unsupported payload/);
});

test('reader propagates authentication failures', async () => {
  await assert.rejects(readPrivateNotes(encrypted, key, async () => { throw Error('authentication failed'); }), /authentication failed/);
});
