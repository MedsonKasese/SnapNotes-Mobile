import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCloudLibraryPreviewService, createCloudPreviewRequestGate } from '../src/cloudLibraryPreview.ts';

const ordinaryNote = (overrides = {}) => ({
  id: 'note-1', title: 'Visible title', text: 'Visible note text', category: 'general',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  pinned: false, archived: false, deletedAt: null, ...overrides,
});
const folder = { id: 'folder-1', name: 'Work', icon: 'briefcase', color: 'green', createdAt: '2026-01-01', updatedAt: '2026-01-02' };
const userSnapshot = (data, exists = true) => ({ exists: () => exists, data: () => data });
const page = (data, id = '00000') => ({ id, data: () => data });
function makeService({ user, pages = { docs: [], size: 0 }, failure } = {}) {
  const calls = [];
  const service = createCloudLibraryPreviewService({
    async getUserDocument(uid) {
      calls.push(['getDoc', uid]);
      if (failure === 'user') throw new Error('mock user read failure');
      return user ?? userSnapshot(undefined, false);
    },
    async getLibraryPages(uid, revision) {
      calls.push(['getDocs', uid, revision]);
      if (failure === 'pages') throw new Error('mock page read failure');
      return pages;
    },
  });
  return { calls, service };
}

test('legacy root arrays are previewed without changing device-local notes', async () => {
  const deviceNotes = [ordinaryNote({ id: 'local-only', text: 'Device stays intact' })];
  const originalDeviceNotes = structuredClone(deviceNotes);
  const { calls, service } = makeService({ user: userSnapshot({ notes: [ordinaryNote()], folders: [folder] }) });
  const result = await service.load('uid-1');
  assert.equal(result.source, 'legacy');
  assert.equal(result.schema, 'legacy');
  assert.equal(result.notes.length, 1);
  assert.deepEqual(result.folders, [{ id: 'folder-1', name: 'Work' }]);
  assert.deepEqual(deviceNotes, originalDeviceNotes);
  assert.deepEqual(calls, [['getDoc', 'uid-1']]);
});

test('current active revision requires exact page count and validates every page arrays', async () => {
  const { calls, service } = makeService({
    user: userSnapshot({ activeLibraryRevision: 'rev-a', libraryPageCount: 2, syncVersion: 2 }),
    pages: { size: 2, docs: [page({ notes: [ordinaryNote()], folders: [] }, '00000'), page({ notes: [], folders: [folder] }, '00001')] },
  });
  const result = await service.load('uid-2');
  assert.equal(result.source, 'revision');
  assert.equal(result.schema, 'paged-v2');
  assert.equal(result.pageCount, 2);
  assert.equal(result.notes[0].fields.title, 'Visible title');
  assert.equal(result.folders[0].name, 'Work');
  assert.deepEqual(calls, [['getDoc', 'uid-2'], ['getDocs', 'uid-2', 'rev-a']]);
});

test('schema-v3 preview reads the ordinary revision and accepts only the verified false/null importer markers', async () => {
  const importedOrdinary = ordinaryNote({ isPrivate: false, privateData: null, attachments: [{ storagePath: 'not-read' }] });
  const { calls, service } = makeService({
    user: userSnapshot({
      activeLibraryRevision: 'rev-v3', libraryPageCount: 1, syncVersion: 3,
      privateNotesSchemaRequired: true, privateNotesSeparated: true,
    }),
    pages: { size: 1, docs: [page({ notes: [importedOrdinary], folders: [] })] },
  });
  const result = await service.load('uid-v3');
  assert.equal(result.schema, 'separated-v3');
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].fields.id, 'note-1');
  assert.deepEqual(result.notes[0].unsupportedFields, ['attachments']);
  assert.doesNotMatch(JSON.stringify(result), /privateData|isPrivate|storagePath|not-read/);
  assert.deepEqual(calls, [['getDoc', 'uid-v3'], ['getDocs', 'uid-v3', 'rev-v3']]);
});

test('incomplete schema-v3 fence blocks before reading any revision pages', async () => {
  const { calls, service } = makeService({
    user: userSnapshot({
      activeLibraryRevision: 'rev-paused', libraryPageCount: 1, syncVersion: 3,
      privateNotesSchemaRequired: true,
    }),
    pages: { size: 1, docs: [page({ notes: [ordinaryNote()], folders: [] })] },
  });
  await assert.rejects(service.load('uid-paused'), /separation is incomplete/);
  assert.deepEqual(calls, [['getDoc', 'uid-paused']]);
});

test('unsupported and inconsistent schema metadata blocks before page reads', async (t) => {
  const cases = [
    { name: 'unknown future version', user: { syncVersion: 4 }, match: /version is unsupported/ },
    { name: 'v3 missing separation flag', user: { syncVersion: 3, privateNotesSchemaRequired: true }, match: /separation is incomplete/ },
    { name: 'separation flag on v2', user: { syncVersion: 2, privateNotesSeparated: true }, match: /separation is incomplete/ },
    { name: 'separated v3 without active pointer', user: { syncVersion: 3, privateNotesSchemaRequired: true, privateNotesSeparated: true }, match: /no active revision/ },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const { calls, service } = makeService({ user: userSnapshot(item.user) });
      await assert.rejects(service.load('uid-schema'), item.match);
      assert.deepEqual(calls, [['getDoc', 'uid-schema']]);
    });
  }
});

test('private or ambiguous records in schema-v3 ordinary pages fail closed before payload projection', async () => {
  const privateNote = ordinaryNote({ isPrivate: true });
  Object.defineProperty(privateNote, 'privateData', { enumerable: true, get() { throw new Error('private payload read'); } });
  const { service } = makeService({
    user: userSnapshot({
      activeLibraryRevision: 'rev-v3', libraryPageCount: 1, syncVersion: 3,
      privateNotesSchemaRequired: true, privateNotesSeparated: true,
    }),
    pages: { size: 1, docs: [page({ notes: [privateNote], folders: [] })] },
  });
  await assert.rejects(service.load('uid-v3-invalid'), /private or ambiguous note/);
});

test('missing user document is an empty library and does not read pages', async () => {
  const { calls, service } = makeService({ user: userSnapshot(undefined, false) });
  assert.deepEqual(await service.load('uid-empty'), { source: 'legacy', schema: 'legacy', pageCount: 0, notes: [], folders: [] });
  assert.deepEqual(calls, [['getDoc', 'uid-empty']]);
});

test('a recorded zero page count with zero pages is a valid empty active revision', async () => {
  const { service } = makeService({
    user: userSnapshot({ activeLibraryRevision: 'empty-rev', libraryPageCount: 0 }),
    pages: { docs: [], size: 0 },
  });
  assert.deepEqual(await service.load('uid-empty-rev'), { source: 'revision', schema: 'legacy', pageCount: 0, notes: [], folders: [] });
});

test('an active revision without a recorded count accepts only a nonempty page collection', async () => {
  const empty = makeService({ user: userSnapshot({ activeLibraryRevision: 'rev-a' }), pages: { docs: [], size: 0 } });
  await assert.rejects(empty.service.load('uid-a'), /no pages/);
  const nonempty = makeService({
    user: userSnapshot({ activeLibraryRevision: 'rev-a' }),
    pages: { docs: [page({ notes: [], folders: [] })], size: 1 },
  });
  assert.equal((await nonempty.service.load('uid-a')).pageCount, 1);
});

test('malformed active revision, page count, arrays, or mismatched page count fail closed', async (t) => {
  const cases = [
    { name: 'revision type', user: { activeLibraryRevision: 7, libraryPageCount: 0 }, pages: { docs: [], size: 0 }, match: /revision is malformed/ },
    { name: 'negative count', user: { activeLibraryRevision: 'rev', libraryPageCount: -1 }, pages: { docs: [], size: 0 }, match: /page count is malformed/ },
    { name: 'fraction count', user: { activeLibraryRevision: 'rev', libraryPageCount: 0.5 }, pages: { docs: [], size: 0 }, match: /page count is malformed/ },
    { name: 'missing page', user: { activeLibraryRevision: 'rev', libraryPageCount: 2 }, pages: { docs: [page({ notes: [], folders: [] })], size: 1 }, match: /does not match/ },
    { name: 'malformed page arrays', user: { activeLibraryRevision: 'rev', libraryPageCount: 1 }, pages: { docs: [page({ notes: {}, folders: [] })], size: 1 }, match: /notes must be an array/ },
    { name: 'mismatched query size', user: { activeLibraryRevision: 'rev', libraryPageCount: 2 }, pages: { docs: [page({ notes: [], folders: [] })], size: 2 }, match: /page collection is incomplete/ },
    { name: 'malformed legacy arrays', user: { notes: [], folders: null }, pages: { docs: [], size: 0 }, match: /folders must be an array/ },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const { service } = makeService({ user: userSnapshot(item.user), pages: item.pages });
      await assert.rejects(service.load('uid-invalid'), item.match);
    });
  }
});

test('active revision failure never falls back to valid-looking legacy root arrays', async () => {
  const { service } = makeService({
    user: userSnapshot({ activeLibraryRevision: 'rev-broken', libraryPageCount: 1, notes: [ordinaryNote()], folders: [folder] }),
    pages: { docs: [], size: 0 },
  });
  await assert.rejects(service.load('uid-broken'), /does not match/);
});

test('private notes are excluded before field enumeration and payload access', async () => {
  const privateByFlag = ordinaryNote({ isPrivate: 'yes' });
  Object.defineProperty(privateByFlag, 'privateData', { enumerable: true, get() { throw new Error('private payload read'); } });
  const privateByOwnPayload = ordinaryNote();
  Object.defineProperty(privateByOwnPayload, 'privateData', { enumerable: true, get() { throw new Error('private payload read'); } });
  const { service } = makeService({ user: userSnapshot({ notes: [privateByFlag, privateByOwnPayload, ordinaryNote()], folders: [] }) });
  const result = await service.load('uid-private');
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].fields.id, 'note-1');
  assert.doesNotMatch(JSON.stringify(result), /privateData|private payload/);
});

test('ordinary note projection includes only Mobile-supported fields and names unknown/attachment fields without reading values', async () => {
  const note = ordinaryNote({ cloudOnlyFlag: true });
  Object.defineProperty(note, 'attachments', { enumerable: true, get() { throw new Error('attachment URL/path read'); } });
  const { service } = makeService({ user: userSnapshot({ notes: [note], folders: [] }) });
  const result = await service.load('uid-fields');
  assert.deepEqual(result.notes[0].unsupportedFields.sort(), ['attachments', 'cloudOnlyFlag']);
  assert.equal(Object.hasOwn(result.notes[0].fields, 'cloudOnlyFlag'), false);
  assert.equal(Object.hasOwn(result.notes[0].fields, 'attachments'), false);
});

test('Firestore read failures reject instead of being represented as an empty library', async (t) => {
  await t.test('user document read', async () => {
    const { service } = makeService({ failure: 'user' });
    await assert.rejects(service.load('uid-error'), /mock user read failure/);
  });
  await t.test('pages read', async () => {
    const { service } = makeService({ user: userSnapshot({ activeLibraryRevision: 'rev', libraryPageCount: 1 }), failure: 'pages' });
    await assert.rejects(service.load('uid-error'), /mock page read failure/);
  });
});

test('request gate prevents reads unless explicitly started for a verified identity and rejects stale UID results', async () => {
  const gate = createCloudPreviewRequestGate();
  const calls = [];
  const uid = 'uid-a';
  gate.setVerifiedUid(null); // auth restoration/sign-out observer changes do not invoke the loader
  assert.equal(calls.length, 0);
  gate.setVerifiedUid(uid);
  assert.equal(calls.length, 0);
  const requestId = gate.begin(uid); // this is the UI explicit-click boundary
  assert.notEqual(requestId, null);
  calls.push(['getDoc', uid], ['getDocs', uid]);
  gate.setVerifiedUid(null);
  gate.setVerifiedUid('uid-b');
  assert.equal(gate.isCurrent(uid, requestId), false);
  assert.deepEqual(calls, [['getDoc', uid], ['getDocs', uid]]);
});

test('service surface is read-only; adapter is limited to getDoc/getDocs on the Auth app and UI fetch is button-triggered', async () => {
  const { service } = makeService();
  assert.deepEqual(Object.keys(service), ['load']);
  const adapter = await readFile(new URL('../src/cloudLibraryPreviewFirebase.ts', import.meta.url), 'utf8');
  assert.match(adapter, /import \{ collection, doc, getDoc, getDocs, getFirestore \} from 'firebase\/firestore'/);
  assert.match(adapter, /getFirestore\(auth\.app\)/);
  assert.match(adapter, /'libraries', revision, 'pages'/);
  assert.match(adapter, /auth\.currentUser\?\.uid !== uid/);
  assert.doesNotMatch(adapter, /setDoc|updateDoc|deleteDoc|runTransaction|localStorage|AsyncStorage|attachments|privateNotes|privateNoteVersions/i);
  const modal = await readFile(new URL('../src/components/AccountAccessModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /const loadCloudPreview = async \(\) => \{[\s\S]*?state\.user\.emailVerified[\s\S]*?cloudLibraryPreviewService\.load\(uid\)/);
  assert.match(modal, /onPress=\{\(\) => \{ void loadCloudPreview\(\); \}\}/);
  assert.match(modal, /useEffect\(\(\) => \{\s*cloudPreviewGate\.current\.setVerifiedUid\(verifiedPreviewUid\);\s*\}, \[verifiedPreviewUid\]\);/);
  const effect = modal.slice(modal.indexOf('useEffect(() => {\n    cloudPreviewGate.current.setVerifiedUid'), modal.indexOf('}, [verifiedPreviewUid])') + 40);
  assert.doesNotMatch(effect, /setCloudPreview|cloudLibraryPreviewService\.load/);
  assert.match(modal, /cloudPreview\.uid === verifiedPreviewUid/);
  assert.match(modal, /cloudPreview\.sessionKey === state/);
  const projection = modal.slice(modal.indexOf('const activeCloudPreview'), modal.indexOf('const verificationUserId'));
  assert.doesNotMatch(projection, /\.current/);
  assert.match(modal, /const preview = await cloudLibraryPreviewService\.load\(uid\);\s*if \(!cloudPreviewGate\.current\.isCurrent\(uid, requestId\)\) return;/);
  assert.doesNotMatch(modal, /deviceNotesStorage|notesStorage|AsyncStorage|PrivateVaultStorage/);
});

test('Mobile auth observer and sign-out do not trigger preview reads or note-storage writes', async () => {
  const provider = await readFile(new URL('../src/auth/AuthStateProvider.tsx', import.meta.url), 'utf8');
  const authService = await readFile(new URL('../src/auth/authService.ts', import.meta.url), 'utf8');
  assert.match(provider, /onAuthStateChanged/);
  assert.doesNotMatch(provider, /cloudLibraryPreviewService|deviceNotesStorage|notesStorage|AsyncStorage|setDoc|updateDoc|deleteDoc/);
  assert.doesNotMatch(authService, /cloudLibraryPreviewService|deviceNotesStorage|notesStorage|AsyncStorage|firebase\/firestore|setDoc|updateDoc|deleteDoc/);
  const modal = await readFile(new URL('../src/components/AccountAccessModal.tsx', import.meta.url), 'utf8');
  const signOutStart = modal.indexOf('const handleSignOut = async () => {');
  const signOutEnd = modal.indexOf('\n  };', signOutStart);
  assert.ok(signOutStart >= 0 && signOutEnd > signOutStart);
  assert.doesNotMatch(modal.slice(signOutStart, signOutEnd), /cloudLibraryPreviewService|deviceNotesStorage|notesStorage|AsyncStorage/);
});
