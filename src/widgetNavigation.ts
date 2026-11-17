export const NEW_NOTE_WIDGET_URL = 'snapnotes://widget/new-note';

export function isNewNoteWidgetUrl(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const base = value.trim().toLowerCase().split(/[?#]/, 1)[0].replace(/\/+$/, '');
  return base === NEW_NOTE_WIDGET_URL;
}
