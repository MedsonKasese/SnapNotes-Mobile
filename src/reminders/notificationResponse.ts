export type ReminderNotificationTarget =
  | { kind: 'note'; noteId: string }
  | { kind: 'private'; scheduleKey: string }
  | { kind: 'private-note'; noteId: string };

export type PrivateReminderNavigationTarget = Extract<ReminderNotificationTarget, { kind: 'private' | 'private-note' }>;

function isOpaqueValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

// Notification content is untrusted input. Return only the minimal routing value;
// never copy title/body or any other notification metadata into app state.
export function parseReminderNotificationData(data: unknown): ReminderNotificationTarget | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.kind === 'note-reminder' && isOpaqueValue(record.noteId)) {
    return { kind: 'note', noteId: record.noteId };
  }
  if (record.kind === 'private-note-reminder' && isOpaqueValue(record.scheduleKey) &&
    /^private-reminder-[a-z0-9-]+$/.test(record.scheduleKey)) {
    return { kind: 'private', scheduleKey: record.scheduleKey };
  }
  return null;
}

export function reminderTargetKey(target: ReminderNotificationTarget): string {
  if (target.kind === 'note') return `note:${target.noteId}`;
  if (target.kind === 'private-note') return `private-note:${target.noteId}`;
  return `private:${target.scheduleKey}`;
}

type NotificationResponseLike = {
  actionIdentifier?: unknown;
  notification?: { request?: { identifier?: unknown; content?: { data?: unknown } } };
};

export type ReminderNotificationResponseApi = {
  defaultActionIdentifier: string;
  addListener: (listener: (response: unknown) => void) => { remove: () => void };
  getLastResponse: () => unknown;
  clearLastResponse: () => void;
};

// Handles both live taps and the last response cached across a cold start.
// Response payloads are parsed to minimal targets and never logged or retained.
export function registerReminderNotificationResponseHandler(
  api: ReminderNotificationResponseApi,
  onTarget: (target: ReminderNotificationTarget) => void,
): () => void {
  let active = true;
  const handledResponses = new Set<string>();
  const handleResponse = (value: unknown) => {
    if (!active || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const response = value as NotificationResponseLike;
    if (response.actionIdentifier !== api.defaultActionIdentifier) return;
    const target = parseReminderNotificationData(response.notification?.request?.content?.data);
    if (!target) return;
    const requestId = response.notification?.request?.identifier;
    const responseKey = typeof requestId === 'string' && requestId.length > 0
      ? `${requestId}:${api.defaultActionIdentifier}`
      : `${reminderTargetKey(target)}:${api.defaultActionIdentifier}`;
    if (!handledResponses.has(responseKey)) {
      handledResponses.add(responseKey);
      onTarget(target);
    }
    try {
      api.clearLastResponse();
    } catch {
      // A failed native clear must not block routing or expose response data.
    }
  };

  const subscription = api.addListener(handleResponse);
  try {
    handleResponse(api.getLastResponse());
  } catch {
    // Live responses remain available if the native cold-start cache is unavailable.
  }
  return () => {
    active = false;
    subscription.remove();
  };
}

export type ReminderReadCoordinator = {
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
};

export type RegularReminderDestination = 'regular' | 'private' | 'moving';

// Serialize the membership check with vault transfers. A move intent is also
// checked inside the critical section so a queued tap cannot open a stale
// cleartext copy after the transfer has started.
export async function resolveRegularReminderDestination(
  noteId: string,
  coordinator: ReminderReadCoordinator,
  loadVaultEntries: () => Promise<readonly { id: string }[]>,
  isMovePending: (noteId: string) => boolean,
): Promise<RegularReminderDestination> {
  if (isMovePending(noteId)) return 'moving';
  const belongsToPrivateVault = await coordinator.exclusive(async () => {
    if (isMovePending(noteId)) return null;
    const entries = await loadVaultEntries();
    return entries.some(entry => entry.id === noteId);
  });
  if (belongsToPrivateVault === true) return 'private';
  if (belongsToPrivateVault === null || isMovePending(noteId)) return 'moving';
  return 'regular';
}
