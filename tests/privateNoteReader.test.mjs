import test from 'node:test';
import assert from 'node:assert/strict';
import { readPrivateNotes } from '../src/privateNoteReader.ts';
import { PRIVATE_VERIFIER_ID } from '../src/privateAccess.ts';

const key = {};
const encrypted = [{ id: PRIVATE_VERIFIER_ID, privateData: {} }, { id: 'note-1', privateData: {} }];

test('reader skips verifier and returns authenticated note content', async () => {
  let calls = 0;
  const results = await readPrivateNotes(encrypted, key, async () => {
    calls++;
    return { title: 'Private', text: 'Sensitive', html: '', category: 'general' };
  });
  assert.equal(calls, 1);
  assert.deepEqual(results, [{ id: 'note-1', title: 'Private', text: 'Sensitive', html: '', category: 'general' }]);
});

test('reader fails closed on unrecognized decrypted payload', async () => {
  await assert.rejects(readPrivateNotes(encrypted, key, async () => ({ title: 'bad' })), /unsupported payload/);
});

test('reader propagates authentication failures', async () => {
  await assert.rejects(readPrivateNotes(encrypted, key, async () => { throw Error('authentication failed'); }), /authentication failed/);
});
