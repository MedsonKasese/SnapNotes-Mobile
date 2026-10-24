import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateVaultStorage, PRIVATE_VAULT_INDEX_KEY } from '../src/privateVaultStorage.ts';

function backend() {
  const values = new Map();
  let failKey = null;
  return {
    values,
    failOn(key) { failKey = key; },
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) {
      if (key === failKey) { failKey = null; throw new Error('simulated storage failure'); }
      values.set(key, value);
    },
  };
}

const ciphertext = {
  version: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA-256',
  iterations: 600000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA',
};
const entry = { id: 'private-1', privateData: ciphertext };

test('vault persists only encrypted records and survives reinitialization', async () => {
  const memory = backend();
  const vault = createPrivateVaultStorage(memory);
  await vault.save([entry]);
  assert.deepEqual(await createPrivateVaultStorage(memory).load(), [entry]);
  assert.equal([...memory.values.values()].some(value => value.includes('secret note title')), false);
  assert.equal([...memory.values.keys()].some(key => key.startsWith('@snapnotes-mobile/note/')), false);
});

test('rejects plaintext, unexpected metadata, duplicates and malformed ciphertext', async () => {
  const memory = backend();
  const vault = createPrivateVaultStorage(memory);
  await assert.rejects(vault.save([{ ...entry, title: 'secret note title' }]));
  await assert.rejects(vault.save([entry, entry]));
  await assert.rejects(vault.save([{ id: 'private-2', privateData: { ...ciphertext, iv: 'bad' } }]));
  assert.equal(memory.values.size, 0);
});

test('failed generation commit preserves previously committed encrypted vault', async () => {
  const memory = backend();
  const vault = createPrivateVaultStorage(memory);
  await vault.save([entry]);
  memory.failOn(PRIVATE_VAULT_INDEX_KEY);
  await assert.rejects(vault.save([{ id: 'private-2', privateData: ciphertext }]), /storage failure/);
  assert.deepEqual(await vault.load(), [entry]);
  await vault.save([{ id: 'private-2', privateData: ciphertext }]);
  assert.equal((await vault.load())[0].id, 'private-2');
});

test('missing or corrupt committed vault fails closed instead of returning empty notes', async () => {
  const memory = backend();
  const vault = createPrivateVaultStorage(memory);
  await vault.save([entry]);
  const pointer = JSON.parse(memory.values.get(PRIVATE_VAULT_INDEX_KEY));
  memory.values.delete('@snapnotes-mobile/private-vault/generation/' + pointer.generation);
  await assert.rejects(vault.load(), /missing/);
});

test('shared backend serializes overlapping saves without interleaving commits', async () => {
  const memory = backend();
  const a = createPrivateVaultStorage(memory);
  const b = createPrivateVaultStorage(memory);
  await Promise.all([a.save([entry]), b.save([{ id: 'private-2', privateData: ciphertext }])]);
  assert.equal((await a.load())[0].id, 'private-2');
});

test('invalid saves reject asynchronously without changing committed data or blocking later saves', async () => {
  const memory = backend();
  const vault = createPrivateVaultStorage(memory);
  await vault.save([entry]);
  const committed = new Map(memory.values);
  for (const invalid of [null, {}, [{ ...entry, title: 'plaintext' }], [entry, entry],
    [{ ...entry, privateData: { ...ciphertext, iv: 'bad' } }]]) {
    let pending;
    assert.doesNotThrow(() => { pending = vault.save(invalid); });
    assert.ok(pending instanceof Promise);
    await assert.rejects(pending);
    assert.deepEqual(memory.values, committed);
  }
  assert.deepEqual(await vault.load(), [entry]);
  const replacement = { id: 'private-2', privateData: ciphertext };
  await vault.save([replacement]);
  assert.deepEqual(await vault.load(), [replacement]);
});

test('rejects nested plaintext and serialization hooks before any storage write', async () => {
  const memory = backend();
  const vault = createPrivateVaultStorage(memory);
  for (const extra of [{ title: 'secret note title' }, { content: 'secret note body' },
    { html: '<p>secret</p>' }, { attachments: ['private-file.pdf'] },
    { toJSON() { return { plaintext: 'secret note body' }; } }]) {
    await assert.rejects(vault.save([{ ...entry, privateData: { ...ciphertext, ...extra } }]),
      /Unexpected encrypted private note fields/);
    assert.equal(memory.values.size, 0);
  }
});

test('committed records containing nested plaintext fail closed on load', async () => {
  const memory = backend();
  const vault = createPrivateVaultStorage(memory);
  await vault.save([entry]);
  const { generation } = JSON.parse(memory.values.get(PRIVATE_VAULT_INDEX_KEY));
  const key = '@snapnotes-mobile/private-vault/generation/' + generation;
  const payload = JSON.parse(memory.values.get(key));
  payload.entries[0].privateData.title = 'secret note title';
  memory.values.set(key, JSON.stringify(payload));
  await assert.rejects(vault.load(), /Unexpected encrypted private note fields/);
});

test('queued saves snapshot encrypted fields without invoking inherited serialization hooks', async () => {
  const memory = backend();
  const vault = createPrivateVaultStorage(memory);
  const privateData = Object.assign(Object.create({
    toJSON() { throw new Error('must not serialize caller objects'); },
  }), ciphertext);
  const pending = vault.save([{ id: entry.id, privateData }]);
  privateData.iv = 'bad';
  await pending;
  assert.deepEqual(await vault.load(), [entry]);
});
