import { createNoteReminderContent, createPrivateReminderContent, NOTE_REMINDER_KIND, PRIVATE_REMINDER_KIND } from './content.ts';
import { getNextReminderOccurrence, normalizeReminderRepeat, type ReminderRepeat } from './recurrence.ts';

const MAX_PENDING_REMINDERS = 60;
const REPEAT_OCCURRENCES_PER_REMINDER = 16;

export type ReminderNote = {
  id: string;
  title: string;
  text: string;
  archived: boolean;
  deletedAt: string | null;
  reminderAt?: string | null;
  reminderNotified?: boolean;
  reminderRepeat?: ReminderRepeat | null;
};
export type PrivateReminderNote = {
  id: string;
  reminderAt?: string | null;
  reminderNotified?: boolean;
  reminderRepeat?: ReminderRepeat | null;
  reminderScheduleKey?: string | null;
};
export type PrivateReminderSummary = {
  reminderAt: string;
  reminderRepeat?: ReminderRepeat | null;
  scheduleKey: string;
};
type NotificationContent = { title: string; body: string; data: Record<string, string> };
type DateTrigger = { type: string; date: Date };
export type ScheduledReminder = {
  identifier: string;
  content: { title?: string | null; body?: string | null; data?: Record<string, unknown> };
  trigger: unknown;
};
export type PresentedReminder = {
  request: { identifier: string; content: { data?: Record<string, unknown> } };
};
export type ReminderStateUpdate = { id: string; reminderAt: string | null; reminderNotified: boolean };
export type ReminderSyncResult = {
  permissionGranted: boolean;
  scheduled: number;
  cancelled: number;
  unscheduled: number;
  stateUpdates: ReminderStateUpdate[];
};
export type ReminderNotificationApi = {
  prepare?(): Promise<void>;
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  getAllScheduledNotificationsAsync(): Promise<ScheduledReminder[]>;
  getPresentedNotificationsAsync(): Promise<PresentedReminder[]>;
  scheduleNotificationAsync(request: { content: NotificationContent; trigger: DateTrigger }): Promise<string>;
  cancelScheduledNotificationAsync(identifier: string): Promise<void>;
  dismissNotificationAsync(identifier: string): Promise<void>;
  maxPendingNotifications?: number;
};

type DesiredRequest = { key: string; at: string; content: NotificationContent };
type OccurrenceResult = {
  occurrences: string[];
  stateUpdate?: { reminderAt: string; reminderNotified: false };
  oneTimeNotified?: boolean;
};

function timestampFromTrigger(trigger: unknown): number | null {
  if (trigger instanceof Date) return Number.isFinite(trigger.getTime()) ? trigger.getTime() : null;
  if (!trigger || typeof trigger !== 'object') return null;
  const value = (trigger as Record<string, unknown>).date;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return Date.parse(value);
  return null;
}

function sameContent(request: ScheduledReminder, content: NotificationContent): boolean {
  const data = request.content.data ?? {};
  return request.content.title === content.title && request.content.body === content.body &&
    Object.keys(content.data).every(key => data[key] === content.data[key]);
}
function dataValue(request: ScheduledReminder, key: string): string | null {
  const value = request.content.data?.[key];
  return typeof value === 'string' ? value : null;
}
function normalPlanKey(noteId: string, occurrence: string): string { return `${NOTE_REMINDER_KIND}|${noteId}|${occurrence}`; }
function privatePlanKey(scheduleKey: string, occurrence: string): string { return `${PRIVATE_REMINDER_KIND}|${scheduleKey}|${occurrence}`; }
function planKeyForRequest(request: ScheduledReminder, kind: string, ownerKey: string): string | null {
  if (dataValue(request, 'kind') !== kind || dataValue(request, ownerKey) === null || dataValue(request, 'occurrenceAt') === null) return null;
  return `${kind}|${dataValue(request, ownerKey)}|${dataValue(request, 'occurrenceAt')}`;
}
function matchingNormal(request: ScheduledReminder, noteId: string): boolean {
  return dataValue(request, 'kind') === NOTE_REMINDER_KIND && dataValue(request, 'noteId') === noteId;
}
function matchingPrivate(request: ScheduledReminder, scheduleKey: string): boolean {
  return dataValue(request, 'kind') === PRIVATE_REMINDER_KIND && dataValue(request, 'scheduleKey') === scheduleKey;
}

function getOccurrences(reminderAt: string | null | undefined, repeat: unknown, now: number,
  hasMatchingDue: boolean): OccurrenceResult {
  if (!reminderAt || !Number.isFinite(Date.parse(reminderAt))) return { occurrences: [] };
  const due = Date.parse(reminderAt);
  const normalizedRepeat = normalizeReminderRepeat(repeat, reminderAt);
  if (!normalizedRepeat) {
    if (due > now || hasMatchingDue) return { occurrences: [reminderAt] };
    return { occurrences: [], oneTimeNotified: true };
  }

  const first = due > now || hasMatchingDue ? reminderAt : getNextReminderOccurrence(reminderAt, normalizedRepeat, now);
  if (!first) return { occurrences: [] };
  const occurrences = [first];
  let cursor = first;
  for (let index = 1; index < REPEAT_OCCURRENCES_PER_REMINDER; index++) {
    const next = getNextReminderOccurrence(cursor, normalizedRepeat, Date.parse(cursor));
    if (!next) break;
    occurrences.push(next);
    cursor = next;
  }
  return { occurrences, ...(first !== reminderAt ? { stateUpdate: { reminderAt: first, reminderNotified: false as const } } : {}) };
}

function dateTrigger(at: string): DateTrigger { return { type: 'date', date: new Date(at) }; }
function desiredNormal(note: ReminderNote, now: number, matches: ScheduledReminder[]): { plans: DesiredRequest[]; update?: ReminderStateUpdate } {
  const reminderAt = note.reminderAt;
  if (note.archived || note.deletedAt !== null || !reminderAt) return { plans: [] };
  const dueNow = Date.parse(reminderAt) <= now;
  const hasMatchingDue = dueNow && matches.some(request => timestampFromTrigger(request.trigger) === Date.parse(reminderAt));
  const result = getOccurrences(reminderAt, note.reminderRepeat, now, hasMatchingDue);
  const update = result.oneTimeNotified && !note.reminderNotified
    ? { id: note.id, reminderAt, reminderNotified: true }
    : result.stateUpdate ? { id: note.id, ...result.stateUpdate } : undefined;
  return {
    plans: result.occurrences.map(at => {
      const content = createNoteReminderContent(note, at);
      return { key: normalPlanKey(note.id, at), at, content };
    }),
    ...(update ? { update } : {}),
  };
}
function desiredPrivate(note: PrivateReminderNote, now: number, matches: ScheduledReminder[]): { plans: DesiredRequest[]; update?: ReminderStateUpdate } {
  const reminderAt = note.reminderAt;
  const scheduleKey = note.reminderScheduleKey;
  if (!reminderAt || !scheduleKey) return { plans: [] };
  const dueNow = Date.parse(reminderAt) <= now;
  const hasMatchingDue = dueNow && matches.some(request => timestampFromTrigger(request.trigger) === Date.parse(reminderAt));
  const result = getOccurrences(reminderAt, note.reminderRepeat, now, hasMatchingDue);
  const update = result.oneTimeNotified && !note.reminderNotified
    ? { id: note.id, reminderAt, reminderNotified: true }
    : result.stateUpdate ? { id: note.id, ...result.stateUpdate } : undefined;
  return {
    plans: result.occurrences.map(at => {
      const content = createPrivateReminderContent(scheduleKey, at);
      return { key: privatePlanKey(scheduleKey, at), at, content };
    }),
    ...(update ? { update } : {}),
  };
}

export function createReminderScheduler(api: ReminderNotificationApi, now: () => number = Date.now) {
  async function prepare() { await api.prepare?.(); }

  async function requestPermission(): Promise<boolean> {
    await prepare();
    try { return await api.requestPermission(); }
    catch { throw new Error('Notification permission could not be checked on this device.'); }
  }

  async function cancelRequests(requests: ScheduledReminder[]): Promise<number> {
    let cancelled = 0;
    for (const request of requests) {
      try { await api.cancelScheduledNotificationAsync(request.identifier); cancelled += 1; }
      catch { throw new Error('A local reminder could not be cancelled on this device.'); }
    }
    return cancelled;
  }

  async function dismissPresentedMatches(kind: string, ownerKey: 'noteId' | 'scheduleKey', ownerValue: string): Promise<void> {
    let presented: PresentedReminder[];
    try { presented = await api.getPresentedNotificationsAsync(); }
    catch { throw new Error('A displayed local reminder could not be checked on this device.'); }
    const matches = presented.filter(notification => {
      const data = notification.request.content.data ?? {};
      return data.kind === kind && data[ownerKey] === ownerValue;
    });
    for (const notification of matches) {
      try { await api.dismissNotificationAsync(notification.request.identifier); }
      catch { throw new Error('A displayed local reminder could not be dismissed on this device.'); }
    }
  }

  async function reconcilePlans(plans: DesiredRequest[], managedRequests: ScheduledReminder[], allRequests: ScheduledReminder[],
    permissionGranted: boolean, kind: string, ownerKey: 'noteId' | 'scheduleKey'): Promise<{ scheduled: number; cancelled: number; unscheduled: number }> {
    const desired = new Map(plans.map(plan => [plan.key, plan]));
    const existingByKey = new Map<string, ScheduledReminder>();
    const stale: ScheduledReminder[] = [];
    for (const request of managedRequests) {
      const requestKey = planKeyForRequest(request, kind, ownerKey);
      const plan = requestKey ? desired.get(requestKey) : undefined;
      const expectedAt = plan ? Date.parse(plan.at) : NaN;
      if (!plan || timestampFromTrigger(request.trigger) !== expectedAt || !sameContent(request, plan.content) || existingByKey.has(requestKey!)) {
        stale.push(request);
      } else {
        existingByKey.set(requestKey!, request);
      }
    }
    const cancelled = await cancelRequests(stale);
    const cancelledIds = new Set(stale.map(request => request.identifier));
    let occupancy = allRequests.length - cancelledIds.size;
    const maxPending = api.maxPendingNotifications ?? MAX_PENDING_REMINDERS;
    let scheduled = 0;
    let unscheduled = 0;
    const orderedPlans = [...plans].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    for (const plan of orderedPlans) {
      if (existingByKey.has(plan.key)) continue;
      if (!permissionGranted) continue;
      if (occupancy >= maxPending) { unscheduled += 1; continue; }
      try {
        await api.scheduleNotificationAsync({ content: plan.content, trigger: dateTrigger(plan.at) });
        scheduled += 1;
        occupancy += 1;
      } catch {
        throw new Error('A local reminder could not be scheduled on this device.');
      }
    }
    return { scheduled, cancelled, unscheduled };
  }

  async function reconcileNotes(notes: readonly ReminderNote[], excludedNoteIds: readonly string[] = []): Promise<ReminderSyncResult> {
    await prepare();
    let permissionGranted = false;
    try { permissionGranted = await api.hasPermission(); } catch { permissionGranted = false; }
    const allRequests = await api.getAllScheduledNotificationsAsync();
    const normalRequests = allRequests.filter(request => dataValue(request, 'kind') === NOTE_REMINDER_KIND);
    const excluded = new Set(excludedNoteIds);
    const eligibleNotes = notes.filter(note => !excluded.has(note.id));
    const byId = new Map(eligibleNotes.map(note => [note.id, note]));
    const orphaned = normalRequests.filter(request => {
      const noteId = dataValue(request, 'noteId');
      const note = noteId ? byId.get(noteId) : undefined;
      return !note || note.archived || note.deletedAt !== null || !note.reminderAt;
    });
    const activeRequests = normalRequests.filter(request => !orphaned.includes(request));
    const plans: DesiredRequest[] = [];
    const stateUpdates: ReminderStateUpdate[] = [];
    for (const note of eligibleNotes) {
      const matches = activeRequests.filter(request => matchingNormal(request, note.id));
      const result = desiredNormal(note, now(), matches);
      plans.push(...result.plans);
      if (result.update) stateUpdates.push(result.update);
    }
    const result = await reconcilePlans(plans, normalRequests, allRequests, permissionGranted, NOTE_REMINDER_KIND, 'noteId');
    return { permissionGranted, ...result, stateUpdates };
  }

  async function reconcilePrivateNotes(notes: readonly PrivateReminderNote[], pruneOrphans = true): Promise<ReminderSyncResult> {
    await prepare();
    let permissionGranted = false;
    try { permissionGranted = await api.hasPermission(); } catch { permissionGranted = false; }
    const allRequests = await api.getAllScheduledNotificationsAsync();
    const privateRequests = allRequests.filter(request => dataValue(request, 'kind') === PRIVATE_REMINDER_KIND);
    const summaries = notes.filter(note => note.reminderAt && note.reminderScheduleKey);
    const keys = new Set(summaries.map(note => note.reminderScheduleKey!));
    const orphaned = pruneOrphans ? privateRequests.filter(request => {
      const key = dataValue(request, 'scheduleKey');
      return key === null || !keys.has(key);
    }) : [];
    const activeRequests = privateRequests.filter(request => !orphaned.includes(request));
    const plans: DesiredRequest[] = [];
    const stateUpdates: ReminderStateUpdate[] = [];
    for (const note of notes) {
      const matches = note.reminderScheduleKey
        ? activeRequests.filter(request => matchingPrivate(request, note.reminderScheduleKey!))
        : [];
      const result = desiredPrivate(note, now(), matches);
      plans.push(...result.plans);
      if (result.update) stateUpdates.push(result.update);
    }
    const managedRequests = pruneOrphans ? privateRequests : privateRequests.filter(request =>
      typeof request.content.data?.scheduleKey === 'string' && keys.has(request.content.data.scheduleKey));
    const result = await reconcilePlans(plans, managedRequests, allRequests, permissionGranted, PRIVATE_REMINDER_KIND, 'scheduleKey');
    return { permissionGranted, ...result, stateUpdates };
  }

  async function schedulePrivateSummary(summary: PrivateReminderSummary): Promise<ReminderSyncResult> {
    return reconcilePrivateNotes([{
      id: '', reminderAt: summary.reminderAt, reminderRepeat: summary.reminderRepeat ?? null,
      reminderNotified: false, reminderScheduleKey: summary.scheduleKey,
    }], false);
  }

  async function cancelPrivateReminder(scheduleKey: string | null | undefined): Promise<number> {
    if (!scheduleKey) return 0;
    const scheduled = await api.getAllScheduledNotificationsAsync();
    const matches = scheduled.filter(request => matchingPrivate(request, scheduleKey));
    const cancelled = await cancelRequests(matches);
    await dismissPresentedMatches(PRIVATE_REMINDER_KIND, 'scheduleKey', scheduleKey);
    await dismissPresentedMatches(PRIVATE_REMINDER_KIND, 'scheduleKey', scheduleKey);
    return cancelled;
  }

  async function cancelNoteReminder(noteId: string | null | undefined): Promise<number> {
    if (!noteId) return 0;
    const scheduled = await api.getAllScheduledNotificationsAsync();
    const matches = scheduled.filter(request => matchingNormal(request, noteId));
    const cancelled = await cancelRequests(matches);
    // Sweep twice after cancelling alarms so a notification delivered during the
    // cancellation boundary cannot retain a cleartext title/body in the tray.
    await dismissPresentedMatches(NOTE_REMINDER_KIND, 'noteId', noteId);
    await dismissPresentedMatches(NOTE_REMINDER_KIND, 'noteId', noteId);
    return cancelled;
  }

  return { requestPermission, reconcileNotes, reconcilePrivateNotes, schedulePrivateSummary, cancelPrivateReminder, cancelNoteReminder };
}
