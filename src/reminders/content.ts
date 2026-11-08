export const PRIVATE_REMINDER_TITLE = 'Private Note';
export const PRIVATE_REMINDER_BODY = 'You set a reminder for this private note.';
export const PRIVATE_REMINDER_KIND = 'private-note-reminder';
export const NOTE_REMINDER_KIND = 'note-reminder';
const MAX_PREVIEW_CHARACTERS = 160;

export type LocalReminderContent = {
  title: string;
  body: string;
  data: Record<string, string>;
};

export function createNoteReminderContent(note: { id: string; title: string; text: string }, occurrenceAt: string): LocalReminderContent {
  const title = note.title.trim() || 'Untitled note';
  const source = note.text.replace(/\s+/g, ' ').trim();
  const body = source.length > MAX_PREVIEW_CHARACTERS
    ? source.slice(0, MAX_PREVIEW_CHARACTERS - 1).trimEnd() + '…'
    : source || 'No note description.';
  return { title, body, data: { kind: NOTE_REMINDER_KIND, noteId: note.id, occurrenceAt } };
}

// Private notifications deliberately accept only an opaque scheduling key and
// the scheduled instant. Never pass a private note or its identifier here.
export function createPrivateReminderContent(scheduleKey: string, occurrenceAt: string): LocalReminderContent {
  return {
    title: PRIVATE_REMINDER_TITLE,
    body: PRIVATE_REMINDER_BODY,
    data: { kind: PRIVATE_REMINDER_KIND, scheduleKey, occurrenceAt },
  };
}
