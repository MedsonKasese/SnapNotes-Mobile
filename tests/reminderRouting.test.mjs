import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReminderNotificationData,
  registerReminderNotificationResponseHandler,
  resolveRegularReminderDestination,
  reminderTargetKey,
} from '../src/reminders/notificationResponse.ts';
import { getAndroidReminderDelivery } from '../src/reminders/androidDelivery.ts';
import { createPrivateWriteCoordinator } from '../src/privateWriteCoordinator.ts';

const DEFAULT_ACTION = 'default-tap';
function response(identifier, data, actionIdentifier = DEFAULT_ACTION) {
  return { actionIdentifier, notification: { request: { identifier, content: { data } } } };
}

test('regular reminder response returns only its note ID', () => {
  assert.deepEqual(parseReminderNotificationData({
    kind: 'note-reminder', noteId: 'note-42', title: 'Do not copy', body: 'Do not copy', occurrenceAt: '2026-11-07T19:00:00.000Z',
  }), { kind: 'note', noteId: 'note-42' });
});

test('private reminder response returns only its opaque schedule key', () => {
  assert.deepEqual(parseReminderNotificationData({
    kind: 'private-note-reminder', scheduleKey: 'private-reminder-abc-1-random',
    noteId: 'must-not-route-by-id', title: 'Private title', body: 'Private body', occurrenceAt: '2026-11-07T19:00:00.000Z',
  }), { kind: 'private', scheduleKey: 'private-reminder-abc-1-random' });
});

test('unsupported, malformed, and oversized notification data cannot create a navigation target', () => {
  assert.equal(parseReminderNotificationData(null), null);
  assert.equal(parseReminderNotificationData([]), null);
  assert.equal(parseReminderNotificationData({ kind: 'unknown', noteId: 'note-1' }), null);
  assert.equal(parseReminderNotificationData({ kind: 'note-reminder', noteId: '   ' }), null);
  assert.equal(parseReminderNotificationData({ kind: 'private-note-reminder', scheduleKey: 'private\u0000key' }), null);
  assert.equal(parseReminderNotificationData({ kind: 'private-note-reminder', scheduleKey: 'private-note-42' }), null);
  assert.equal(parseReminderNotificationData({ kind: 'note-reminder', noteId: 'x'.repeat(257) }), null);
});

test('navigation target keys distinguish regular, private-key, and private-ID routes', () => {
  assert.notEqual(
    reminderTargetKey({ kind: 'note', noteId: 'same' }),
    reminderTargetKey({ kind: 'private-note', noteId: 'same' }),
  );
  assert.equal(reminderTargetKey({ kind: 'private', scheduleKey: 'opaque-key' }), 'private:opaque-key');
});

test('regular reminder routing waits for a concurrent private move and then targets the vault copy', async () => {
  const coordinator = createPrivateWriteCoordinator();
  let vaultEntries = [];
  let releaseMove;
  const moveBarrier = new Promise(resolve => { releaseMove = resolve; });
  const move = coordinator.exclusive(async () => {
    await moveBarrier;
    vaultEntries = [{ id: 'note-1' }];
  });
  let routeResolved = false;
  const route = resolveRegularReminderDestination('note-1', coordinator,
    async () => vaultEntries, () => false).then(destination => {
    routeResolved = true;
    return destination;
  });
  await Promise.resolve();
  assert.equal(routeResolved, false, 'the tap must wait behind the in-flight vault transaction');

  releaseMove();
  await move;
  assert.equal(await route, 'private');
});

test('a pending move intent blocks regular navigation even before the vault copy is visible', async () => {
  let vaultRead = false;
  const destination = await resolveRegularReminderDestination('note-1', createPrivateWriteCoordinator(),
    async () => { vaultRead = true; return []; }, noteId => noteId === 'note-1');
  assert.equal(destination, 'moving');
  assert.equal(vaultRead, false);
});

test('regular reminder routing stays on the regular path when the vault does not contain the note', async () => {
  const destination = await resolveRegularReminderDestination('note-1', createPrivateWriteCoordinator(),
    async () => [], () => false);
  assert.equal(destination, 'regular');
});

test('cold-start and live notification taps route once, clear response state, and unsubscribe cleanly', () => {
  const targets = [];
  let listener;
  let clearCount = 0;
  let removed = false;
  const coldStartResponse = response('request-1', { kind: 'note-reminder', noteId: 'note-1' });
  const api = {
    defaultActionIdentifier: DEFAULT_ACTION,
    addListener(callback) { listener = callback; return { remove() { removed = true; } }; },
    getLastResponse() { return coldStartResponse; },
    clearLastResponse() { clearCount += 1; },
  };
  const cleanup = registerReminderNotificationResponseHandler(api, target => targets.push(target));
  assert.deepEqual(targets, [{ kind: 'note', noteId: 'note-1' }]);
  assert.equal(clearCount, 1);

  listener(coldStartResponse);
  listener(response('request-2', { kind: 'private-note-reminder', scheduleKey: 'private-reminder-key' }));
  listener(response('ignored', { kind: 'note-reminder', noteId: 'note-ignored' }, 'dismiss'));
  assert.deepEqual(targets, [
    { kind: 'note', noteId: 'note-1' },
    { kind: 'private', scheduleKey: 'private-reminder-key' },
  ]);
  assert.equal(clearCount, 3);
  cleanup();
  assert.equal(removed, true);
  listener(response('request-3', { kind: 'note-reminder', noteId: 'note-3' }));
  assert.equal(targets.length, 2, 'unmounted handler ignores later events');
});

test('Android 9–11 local reminders opt into alarmClock delivery', () => {
  for (const apiLevel of [28, 29, 30]) {
    assert.equal(getAndroidReminderDelivery('android', apiLevel), 'alarmClock');
  }
});

test('Android 12+ and iOS retain the permission-aware default delivery behavior', () => {
  assert.equal(getAndroidReminderDelivery('android', 31), undefined);
  assert.equal(getAndroidReminderDelivery('android', 35), undefined);
  assert.equal(getAndroidReminderDelivery('ios', 18), undefined);
  assert.equal(getAndroidReminderDelivery('android', 'unknown'), undefined);
});
