export type ReminderFrequency = 'daily' | 'weekly' | 'monthly';
export type ReminderRepeat = {
  frequency: ReminderFrequency;
  interval: number;
  timeZone: string;
  anchorAt: string;
};

const REMINDER_FREQUENCIES = new Set<ReminderFrequency>(['daily', 'weekly', 'monthly']);
const REMINDER_ISO_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2}))?$/i;
const reminderFormatterCache = new Map<string, Intl.DateTimeFormat>();
let reminderKeyCounter = 0;

type CivilParts = { year: number; month: number; day: number; hour?: number; minute?: number; second?: number };

function reminderInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !REMINDER_ISO_RE.test(value)) return null;
  if (!reminderUtcDateParts(value.slice(0, 10))) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isValidReminderAt(value: unknown): boolean {
  return value === null || reminderInstant(value) !== null;
}

function reminderFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = reminderFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    reminderFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function reminderZonedParts(timestamp: number, timeZone: string): CivilParts {
  const values: Record<string, number> = {};
  for (const part of reminderFormatter(timeZone).formatToParts(new Date(timestamp))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return { year: values.year, month: values.month, day: values.day,
    hour: values.hour, minute: values.minute, second: values.second };
}

function reminderUtcDateParts(dateString: string): CivilParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

function reminderAnchorParts(anchorAt: string, timeZone: string): CivilParts | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(anchorAt)) return reminderUtcDateParts(anchorAt);
  const timestamp = reminderInstant(anchorAt);
  return timestamp === null ? null : reminderZonedParts(timestamp, timeZone);
}

export function normalizeReminderRepeat(value: unknown, reminderAt: unknown): ReminderRepeat | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const repeat = value as Record<string, unknown>;
  if (typeof repeat.frequency !== 'string' || !REMINDER_FREQUENCIES.has(repeat.frequency as ReminderFrequency) ||
    !Number.isInteger(repeat.interval) || (repeat.interval as number) < 1 || (repeat.interval as number) > 365 ||
    typeof repeat.timeZone !== 'string' || !repeat.timeZone.trim()) return null;
  const timeZone = repeat.timeZone.trim();
  try { reminderFormatter(timeZone); } catch { return null; }
  const anchorAt = repeat.anchorAt ?? reminderAt;
  if (typeof anchorAt !== 'string' || !REMINDER_ISO_RE.test(anchorAt)) return null;
  const dateOnlyAnchor = /^\d{4}-\d{2}-\d{2}$/.test(anchorAt);
  const anchorTimestamp = dateOnlyAnchor ? null : reminderInstant(anchorAt);
  const anchorParts = reminderAnchorParts(anchorAt, timeZone);
  if (anchorParts === null || (anchorTimestamp === null && !dateOnlyAnchor)) return null;
  const normalizedAnchor = anchorTimestamp === null ? anchorAt : new Date(anchorTimestamp).toISOString();
  return { frequency: repeat.frequency as ReminderFrequency, interval: repeat.interval as number, timeZone, anchorAt: normalizedAnchor };
}

function reminderCivilTimestamp(parts: CivilParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
}

function reminderLocalToInstant(parts: CivilParts, timeZone: string): number {
  const target = reminderCivilTimestamp(parts);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = target + hours * 3_600_000;
    const local = reminderZonedParts(sample, timeZone);
    offsets.add(reminderCivilTimestamp(local) - Math.floor(sample / 1000) * 1000);
  }
  const candidates: number[] = [];
  for (const offset of offsets) {
    const instant = target - offset;
    if (reminderCivilTimestamp(reminderZonedParts(instant, timeZone)) === target) candidates.push(instant);
  }
  if (candidates.length) return Math.min(...candidates);
  // Shift nonexistent spring-forward wall times by the DST gap, preserving minutes.
  const after: { instant: number; delta: number }[] = [];
  for (const offset of offsets) {
    const instant = target - offset;
    const localValue = reminderCivilTimestamp(reminderZonedParts(instant, timeZone));
    if (localValue > target) after.push({ instant, delta: localValue - target });
  }
  if (after.length) return after.sort((a, b) => a.delta - b.delta || a.instant - b.instant)[0].instant;
  return target;
}

function reminderDateAtIndex(anchor: CivilParts, frequency: ReminderFrequency, interval: number, index: number): CivilParts {
  if (frequency === 'monthly') {
    const monthIndex = anchor.year * 12 + anchor.month - 1 + interval * index;
    const year = Math.floor(monthIndex / 12), month = ((monthIndex % 12) + 12) % 12 + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { year, month, day: Math.min(anchor.day, lastDay) };
  }
  const step = interval * (frequency === 'weekly' ? 7 : 1) * index;
  const date = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + step));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function getNextReminderOccurrence(reminderAt: unknown, repeat: unknown, now: number | Date = Date.now()): string | null {
  const start = reminderInstant(reminderAt);
  const normalized = normalizeReminderRepeat(repeat, reminderAt);
  if (start === null || !normalized) return null;
  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowTimestamp)) return null;
  const anchor = reminderAnchorParts(normalized.anchorAt, normalized.timeZone);
  if (!anchor) return null;
  const anchorTimestamp = reminderInstant(normalized.anchorAt);
  const clock = reminderZonedParts(anchorTimestamp === null ? start : anchorTimestamp, normalized.timeZone);
  const localNow = reminderZonedParts(nowTimestamp, normalized.timeZone);
  const localDay = (parts: CivilParts) => Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
  let index = 0;
  if (normalized.frequency === 'monthly') {
    const monthDelta = (localNow.year - anchor.year) * 12 + localNow.month - anchor.month;
    index = Math.max(0, Math.floor(monthDelta / normalized.interval) - 1);
  } else {
    const days = localDay(localNow) - localDay(anchor);
    const period = normalized.interval * (normalized.frequency === 'weekly' ? 7 : 1);
    index = Math.max(0, Math.floor(days / period) - 1);
  }
  // Calendar-based estimation keeps catch-up constant-time for very old reminders.
  for (let attempts = 0; attempts < 5; attempts++, index++) {
    const date = reminderDateAtIndex(anchor, normalized.frequency, normalized.interval, index);
    const occurrence = reminderLocalToInstant({ ...date, hour: clock.hour, minute: clock.minute, second: 0 }, normalized.timeZone);
    if (occurrence > nowTimestamp) return new Date(occurrence).toISOString();
  }
  return null;
}

export function formatReminderRepeat(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const repeat = value as Record<string, unknown>;
  const normalized = normalizeReminderRepeat(value, repeat.anchorAt);
  if (!normalized) return '';
  const unit = normalized.frequency === 'daily' ? 'day' : normalized.frequency === 'weekly' ? 'week' : 'month';
  return `Every ${normalized.interval === 1 ? '' : `${normalized.interval} `}${unit}${normalized.interval === 1 ? '' : 's'}`;
}

export function getReminderCompletionState(note: { reminderAt?: string | null; reminderRepeat?: unknown }, now: number | Date = Date.now()): {
  reminderAt: string | null;
  reminderNotified: boolean;
} {
  const currentReminderAt = note.reminderAt ?? null;
  const repeat = normalizeReminderRepeat(note.reminderRepeat, currentReminderAt);
  const next = repeat ? getNextReminderOccurrence(currentReminderAt, repeat, now) : null;
  return { reminderAt: next || currentReminderAt, reminderNotified: !next };
}

// This opaque scheduling key contains no note ID, title, or body. It is stored
// only inside the encrypted private payload and echoed in the OS notification
// data solely to let the app reconcile/cancel that reminder after unlock.
export function createOpaqueReminderKey(now = Date.now(), random = Math.random): string {
  reminderKeyCounter += 1;
  return `private-reminder-${now.toString(36)}-${reminderKeyCounter.toString(36)}-${random().toString(36).slice(2, 14)}`;
}
