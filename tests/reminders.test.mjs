import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrivateReminderContent, PRIVATE_REMINDER_BODY, PRIVATE_REMINDER_TITLE } from '../src/reminders/content.ts';
import { getNextReminderOccurrence, getReminderCompletionState, normalizeReminderRepeat } from '../src/reminders/recurrence.ts';
import { createReminderScheduler } from '../src/reminders/scheduler.ts';

function fakeNotifications({ granted = true, now = Date.parse('2026-01-01T00:00:00.000Z'), maxPendingNotifications = 60 } = {}) {
  const requests = new Map();
  let nextId = 0;
  let requestCalls = 0;
  let prepareCalls = 0;
  const api = {
    maxPendingNotifications,
    async prepare() { prepareCalls += 1; },
    async hasPermission() { return granted; },
    async requestPermission() { requestCalls += 1; return granted; },
    async getAllScheduledNotificationsAsync() { return [...requests.values()]; },
    async scheduleNotificationAsync(request) {
      const identifier = `local-${++nextId}`;
      requests.set(identifier, { identifier, ...request });
      return identifier;
    },
    async cancelScheduledNotificationAsync(identifier) { requests.delete(identifier); },
  };
  return { api, requests, setNow(value) { now = value; }, getNow() { return now; }, get requestCalls() { return requestCalls; }, get prepareCalls() { return prepareCalls; } };
}

function normalNote(overrides = {}) {
  return {
    id: 'note-1', title: 'Exam plan', text: 'Review the flight planning chapter.', archived: false, deletedAt: null,
    reminderAt: '2026-01-02T09:00:00.000Z', reminderNotified: false, reminderRepeat: null, ...overrides,
  };
}
function dailyRepeat(anchorAt = '2026-01-02T09:00:00.000Z', interval = 1, timeZone = 'UTC') {
  return { frequency: 'daily', interval, timeZone, anchorAt };
}

 test('one-time regular reminders show the note title and a compact body preview', async () => {
  const fake = fakeNotifications();
  const scheduler = createReminderScheduler(fake.api, fake.getNow);
  assert.equal(await scheduler.requestPermission(), true);
  const result = await scheduler.reconcileNotes([normalNote()]);
  const [request] = [...fake.requests.values()];
  assert.equal(result.scheduled, 1);
  assert.equal(request.content.title, 'Exam plan');
  assert.equal(request.content.body, 'Review the flight planning chapter.');
  assert.equal(request.content.data.kind, 'note-reminder');
  assert.equal(request.content.data.noteId, 'note-1');
  assert.equal(request.content.data.occurrenceAt, '2026-01-02T09:00:00.000Z');
  assert.equal(request.trigger.date.toISOString(), '2026-01-02T09:00:00.000Z');
});

test('permission denied does not create local notification requests', async () => {
  const fake = fakeNotifications({ granted: false });
  const scheduler = createReminderScheduler(fake.api, fake.getNow);
  assert.equal(await scheduler.requestPermission(), false);
  const result = await scheduler.reconcileNotes([normalNote()]);
  assert.equal(fake.requestCalls, 1);
  assert.equal(result.permissionGranted, false);
  assert.equal(result.scheduled, 0);
  assert.equal(fake.requests.size, 0);
});

test('edits replace stale notification content and clearing or archiving cancels schedules', async () => {
  const fake = fakeNotifications();
  const scheduler = createReminderScheduler(fake.api, fake.getNow);
  await scheduler.requestPermission();
  await scheduler.reconcileNotes([normalNote()]);
  const edited = normalNote({ title: 'Updated title', text: 'A new preview.', reminderAt: '2026-01-03T10:00:00.000Z' });
  const replaced = await scheduler.reconcileNotes([edited]);
  assert.equal(replaced.cancelled, 1);
  assert.equal(replaced.scheduled, 1);
  assert.equal(fake.requests.size, 1);
  assert.equal([...fake.requests.values()][0].content.title, 'Updated title');
  assert.equal([...fake.requests.values()][0].content.body, 'A new preview.');
  const cleared = await scheduler.reconcileNotes([normalNote({ reminderAt: null })]);
  assert.equal(cleared.cancelled, 1);
  assert.equal(fake.requests.size, 0);
  await scheduler.reconcileNotes([normalNote()]);
  const archived = await scheduler.reconcileNotes([normalNote({ archived: true })]);
  assert.equal(archived.cancelled, 1);
  assert.equal(fake.requests.size, 0);
});

test('repeat reminders queue future occurrences and restart reconciliation avoids duplicates', async () => {
  const fake = fakeNotifications();
  await createReminderScheduler(fake.api, fake.getNow).requestPermission();
  const firstScheduler = createReminderScheduler(fake.api, fake.getNow);
  const note = normalNote({ reminderRepeat: dailyRepeat() });
  const first = await firstScheduler.reconcileNotes([note]);
  assert.equal(first.scheduled, 16);
  assert.equal(fake.requests.size, 16);
  const dates = [...fake.requests.values()].map(request => request.trigger.date.toISOString()).sort();
  assert.equal(dates[0], '2026-01-02T09:00:00.000Z');
  assert.equal(dates[15], '2026-01-17T09:00:00.000Z');

  // A newly created scheduler models app restart with OS-persisted requests.
  const restartedScheduler = createReminderScheduler(fake.api, fake.getNow);
  const restarted = await restartedScheduler.reconcileNotes([note]);
  assert.equal(restarted.scheduled, 0);
  assert.equal(restarted.cancelled, 0);
  assert.equal(fake.requests.size, 16);

  // Once the first OS request is consumed while the app is closed, opening the
  // app advances encrypted/local reminderAt and extends the rolling queue.
  const firstRequest = [...fake.requests.values()].find(request => request.trigger.date.toISOString() === dates[0]);
  fake.requests.delete(firstRequest.identifier);
  fake.setNow(Date.parse('2026-01-02T10:00:00.000Z'));
  const resumed = await restartedScheduler.reconcileNotes([note]);
  assert.equal(resumed.stateUpdates.length, 1);
  assert.equal(resumed.stateUpdates[0].reminderAt, '2026-01-03T09:00:00.000Z');
  assert.equal(resumed.scheduled, 1);
  assert.equal(fake.requests.size, 16);
});

test('repeating queue respects a conservative device-wide pending-notification budget', async () => {
  const fake = fakeNotifications({ maxPendingNotifications: 2 });
  const scheduler = createReminderScheduler(fake.api, fake.getNow);
  await scheduler.requestPermission();
  const result = await scheduler.reconcileNotes([normalNote({ reminderRepeat: dailyRepeat() })]);
  assert.equal(result.scheduled, 2);
  assert.equal(result.unscheduled, 14);
  assert.equal(fake.requests.size, 2);
});

test('overdue one-time reminders complete once without being rescheduled', async () => {
  const fake = fakeNotifications({ now: Date.parse('2026-01-05T00:00:00.000Z') });
  const scheduler = createReminderScheduler(fake.api, fake.getNow);
  const result = await scheduler.reconcileNotes([normalNote()]);
  assert.equal(result.stateUpdates.length, 1);
  assert.deepEqual(result.stateUpdates[0], { id: 'note-1', reminderAt: '2026-01-02T09:00:00.000Z', reminderNotified: true });
  assert.equal(fake.requests.size, 0);
});

test('repeat recurrence preserves local time across DST and uses the saved time zone', () => {
  const repeat = { frequency: 'daily', interval: 1, timeZone: 'America/New_York', anchorAt: '2025-03-08T14:30:00.000Z' };
  assert.equal(getNextReminderOccurrence(repeat.anchorAt, repeat, Date.parse('2025-03-09T05:00:00.000Z')),
    '2025-03-09T13:30:00.000Z');
});

test('spring-forward nonexistent local times shift forward by the DST gap', () => {
  const repeat = { frequency: 'daily', interval: 1, timeZone: 'America/New_York', anchorAt: '2025-03-08T07:30:00.000Z' };
  assert.equal(getNextReminderOccurrence(repeat.anchorAt, repeat, Date.parse('2025-03-08T12:00:00.000Z')),
    '2025-03-09T07:30:00.000Z');
});

test('fall-back repeated local times choose the earlier instant', () => {
  const repeat = { frequency: 'daily', interval: 1, timeZone: 'America/New_York', anchorAt: '2025-11-01T05:30:00.000Z' };
  assert.equal(getNextReminderOccurrence(repeat.anchorAt, repeat, Date.parse('2025-11-02T00:00:00.000Z')),
    '2025-11-02T05:30:00.000Z');
});

test('monthly repeats clamp short months without drifting the original anchor day', () => {
  const repeat = { frequency: 'monthly', interval: 1, timeZone: 'UTC', anchorAt: '2025-01-31T08:00:00.000Z' };
  const february = getNextReminderOccurrence(repeat.anchorAt, repeat, Date.parse('2025-01-31T09:00:00.000Z'));
  assert.equal(february, '2025-02-28T08:00:00.000Z');
  assert.equal(getNextReminderOccurrence(february, repeat, Date.parse('2025-02-28T09:00:00.000Z')),
    '2025-03-31T08:00:00.000Z');
});

test('custom intervals are frequency-plus-interval and time zones are strictly validated', () => {
  const custom = { frequency: 'weekly', interval: 3, timeZone: 'Pacific/Chatham', anchorAt: '2026-01-02T09:00:00.000Z' };
  assert.deepEqual(normalizeReminderRepeat(custom, custom.anchorAt), custom);
  assert.equal(getNextReminderOccurrence(custom.anchorAt, custom, Date.parse(custom.anchorAt)),
    '2026-01-23T09:00:00.000Z');
  assert.equal(normalizeReminderRepeat({ ...custom, timeZone: 'Not/AZone' }, custom.anchorAt), null);
});

test('completion state advances repeats and marks one-time reminders notified', () => {
  const at = '2026-01-02T09:00:00.000Z';
  assert.deepEqual(getReminderCompletionState({ reminderAt: at, reminderRepeat: dailyRepeat(at) }, Date.parse('2026-01-02T10:00:00.000Z')),
    { reminderAt: '2026-01-03T09:00:00.000Z', reminderNotified: false });
  assert.deepEqual(getReminderCompletionState({ reminderAt: at, reminderRepeat: null }, Date.parse('2026-01-02T10:00:00.000Z')),
    { reminderAt: at, reminderNotified: true });
});

test('private reminder payload always uses exact generic text and excludes private IDs and content', async () => {
  const secret = { id: 'private-id-secret', title: 'Private exam title', text: 'Private medical detail', reminderAt: '2026-01-02T09:00:00.000Z' };
  const key = 'private-reminder-opaque-key';
  const content = createPrivateReminderContent(key, secret.reminderAt);
  assert.equal(content.title, PRIVATE_REMINDER_TITLE);
  assert.equal(content.body, PRIVATE_REMINDER_BODY);
  assert.deepEqual(content.data, { kind: 'private-note-reminder', scheduleKey: key, occurrenceAt: secret.reminderAt });
  assert.equal(JSON.stringify(content).includes(secret.id), false);
  assert.equal(JSON.stringify(content).includes(secret.title), false);
  assert.equal(JSON.stringify(content).includes(secret.text), false);

  const fake = fakeNotifications();
  const scheduler = createReminderScheduler(fake.api, fake.getNow);
  await scheduler.requestPermission();
  await scheduler.reconcilePrivateNotes([{ id: secret.id, reminderAt: secret.reminderAt, reminderNotified: false, reminderScheduleKey: key }]);
  const request = [...fake.requests.values()][0];
  assert.equal(request.content.title, 'Private Note');
  assert.equal(request.content.body, 'You set a reminder for this private note.');
  assert.deepEqual(Object.keys(request.content.data).sort(), ['kind', 'occurrenceAt', 'scheduleKey']);
  const serialized = JSON.stringify(request);
  for (const privateValue of [secret.id, secret.title, secret.text]) assert.equal(serialized.includes(privateValue), false);
  assert.equal(await scheduler.cancelPrivateReminder(key), 1);
  assert.equal(fake.requests.size, 0);
});

test('private move summary cannot prune unrelated private reminders', async () => {
  const fake = fakeNotifications();
  const scheduler = createReminderScheduler(fake.api, fake.getNow);
  await scheduler.requestPermission();
  await scheduler.reconcilePrivateNotes([
    { id: 'one', reminderAt: '2026-01-03T09:00:00.000Z', reminderScheduleKey: 'private-reminder-one' },
    { id: 'two', reminderAt: '2026-01-04T09:00:00.000Z', reminderScheduleKey: 'private-reminder-two' },
  ]);
  const summary = { reminderAt: '2026-01-05T09:00:00.000Z', reminderRepeat: null, scheduleKey: 'private-reminder-three' };
  await scheduler.schedulePrivateSummary(summary);
  assert.equal(fake.requests.size, 3);
  assert.equal([...fake.requests.values()].filter(request => request.content.data.scheduleKey === 'private-reminder-one').length, 1);
  assert.equal([...fake.requests.values()].filter(request => request.content.data.scheduleKey === 'private-reminder-two').length, 1);
  assert.equal([...fake.requests.values()].filter(request => request.content.data.scheduleKey === 'private-reminder-three').length, 1);
});


test('a note ID represented in the encrypted vault is excluded from ordinary cleartext reminders', async () => {
  const fake = fakeNotifications();
  const scheduler = createReminderScheduler(fake.api, fake.getNow);
  await scheduler.requestPermission();
  await scheduler.reconcileNotes([normalNote()]);
  const result = await scheduler.reconcileNotes([normalNote()], ['note-1']);
  assert.equal(result.cancelled, 1);
  assert.equal(result.scheduled, 0);
  assert.equal(fake.requests.size, 0);
});


test('private repeat reminders retain generic redaction across the rolling occurrence queue', async () => {
  const fake = fakeNotifications();
  const scheduler = createReminderScheduler(fake.api, fake.getNow);
  await scheduler.requestPermission();
  await scheduler.reconcilePrivateNotes([{
    id: 'private-note-id-never-sent', reminderAt: '2026-01-02T09:00:00.000Z',
    reminderRepeat: dailyRepeat(), reminderNotified: false, reminderScheduleKey: 'private-reminder-repeat-key',
  }]);
  assert.equal(fake.requests.size, 16);
  for (const request of fake.requests.values()) {
    assert.equal(request.content.title, 'Private Note');
    assert.equal(request.content.body, 'You set a reminder for this private note.');
    assert.deepEqual(Object.keys(request.content.data).sort(), ['kind', 'occurrenceAt', 'scheduleKey']);
    assert.equal(JSON.stringify(request).includes('private-note-id-never-sent'), false);
  }
});
