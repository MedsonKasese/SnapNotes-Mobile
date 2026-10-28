import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectAuthenticatedPrivateRecovery } from '../src/privateAuthenticatedRecovery.ts';

const note = { id: 'a', title: 'Secret', text: 'Body', html: '', category: 'general', folderId: null, deletedAt: null, archived: false };
const vault = [{ id: 'a', privateData: { ciphertext: 'opaque' } }];
const key = {};

test('matching authenticated duplicate can be identified without deletion', async () => {
  const decrypt = async () => ({ title: 'Secret', text: 'Body', html: '', category: 'general', pinned: false, tags: [], time: '', folderId: null, reminderAt: null, reminderNotified: false, reminderRepeat: null, attachments: [], history: [] });
  assert.deepEqual(await inspectAuthenticatedPrivateRecovery([note], vault, key, decrypt), [{ id: 'a', status: 'verified-duplicate' }]);
});

test('mismatched duplicate is a conflict', async () => {
  const result = await inspectAuthenticatedPrivateRecovery([note], vault, key, async () => ({ title: 'Different' }));
  assert.equal(result[0].status, 'conflict');
});

test('authentication failure is unreadable, not safe to delete', async () => {
  const result = await inspectAuthenticatedPrivateRecovery([note], vault, key, async () => { throw Error('authentication failed'); });
  assert.equal(result[0].status, 'unreadable');
});
