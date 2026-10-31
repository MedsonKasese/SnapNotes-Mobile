import { MAX_NOTE_HTML_LENGTH, NOTE_CATEGORIES, validateDraft, type Note, type NoteCategory } from './notes.ts';
import { noteHtmlToText, sanitizeNoteHtml } from './noteFormatting.ts';
import { MAX_FOLDERS, MAX_FOLDER_NAME, makeFolderId, normalizeFolderColor, normalizeFolderIcon, type Folder } from './folders.ts';

export type TransferFormat = 'json' | 'markdown' | 'txt';
export type ImportedNote = Omit<Note, 'id'>;
export type ParsedPwaImport = {
  notes: ImportedNote[];
  folders: Folder[];
  privateNotesSkipped: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isPrivateRecord(value: Record<string, unknown>): boolean {
  return value.isPrivate === true || (value.privateData !== undefined && value.privateData !== null);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function normalizedTimestamp(value: unknown, fallback: string): string {
  return validTimestamp(value) ? value : fallback;
}

function parseFolders(value: unknown, now: string): Folder[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const folders: Folder[] = [];
  for (const raw of value.slice(0, MAX_FOLDERS)) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id.trim() || typeof raw.name !== 'string') continue;
    const name = raw.name.trim().replace(/\s+/g, ' ').slice(0, MAX_FOLDER_NAME);
    const lowerName = name.toLocaleLowerCase();
    if (!name || ids.has(raw.id) || names.has(lowerName)) continue;
    ids.add(raw.id);
    names.add(lowerName);
    folders.push({
      id: raw.id,
      name,
      icon: normalizeFolderIcon(raw.icon),
      color: normalizeFolderColor(raw.color),
      createdAt: normalizedTimestamp(raw.createdAt, now),
      updatedAt: normalizedTimestamp(raw.updatedAt, normalizedTimestamp(raw.createdAt, now)),
    });
  }
  return folders;
}

/** Build the same version-1 JSON envelope as the PWA, but only from ordinary notes.
 * Private-vault records and local attachment bytes/paths are deliberately absent.
 */
export function createPwaExportPayload(notes: readonly Note[], folders: readonly Folder[], exportedAt: string) {
  const safeNotes = notes.filter(note => !isPrivateRecord(note as Note & Record<string, unknown>)).map(note => ({
    id: note.id,
    title: note.title,
    text: note.text,
    ...(typeof note.html === 'string' ? { html: note.html } : {}),
    category: note.category,
    pinned: note.pinned,
    archived: note.archived,
    deletedAt: note.deletedAt,
    ...(note.folderId === undefined ? {} : { folderId: note.folderId }),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }));
  const safeFolders = folders.map(folder => ({
    id: folder.id,
    name: folder.name,
    icon: folder.icon,
    color: folder.color,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  }));
  return { app: 'SnapNotes' as const, version: 1 as const, exportedAt, notes: safeNotes, folders: safeFolders };
}

export function serializeNotesForExport(
  format: TransferFormat,
  notes: readonly Note[],
  folders: readonly Folder[],
  exportedAt: string,
): { content: string; extension: string; mimeType: string } {
  const payload = createPwaExportPayload(notes, folders, exportedAt);
  if (format === 'json') {
    return { content: JSON.stringify(payload, null, 2), extension: 'json', mimeType: 'application/json' };
  }
  if (format === 'markdown') {
    const content = payload.notes.map(note => {
      const title = note.title ? `# ${note.title}` : '# Untitled note';
      return `${title}\n\n${note.text || ''}\n\n---`;
    }).join('\n\n');
    return { content, extension: 'md', mimeType: 'text/markdown' };
  }
  const content = payload.notes.map(note => {
    const title = note.title || 'Untitled note';
    return `${title}\n${note.text || ''}`;
  }).join('\n\n====================\n\n');
  return { content, extension: 'txt', mimeType: 'text/plain' };
}

/** Parse PWA JSON exports and legacy JSON arrays. IDs are replaced by the controller
 * with IDs allocated through the private-vault-aware storage guard.
 */
export function parsePwaImport(json: string, now: string): ParsedPwaImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON. Choose a SnapNotes JSON export.');
  }
  const rawNotes = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.notes : null;
  if (!Array.isArray(rawNotes)) {
    throw new Error('This file does not contain a SnapNotes notes array.');
  }

  const folders = isRecord(parsed) ? parseFolders(parsed.folders, now) : [];
  const notes: ImportedNote[] = [];
  let privateNotesSkipped = 0;

  for (const raw of rawNotes) {
    if (!isRecord(raw)) continue;
    if (isPrivateRecord(raw)) {
      privateNotesSkipped += 1;
      continue;
    }

    const title = String(raw.title ?? '').trim();
    const text = String(raw.text ?? '').replace(/\r/g, '').trim();
    let html: string | undefined;
    if (typeof raw.html === 'string' && raw.html.length <= MAX_NOTE_HTML_LENGTH) {
      const sanitized = sanitizeNoteHtml(raw.html);
      if (noteHtmlToText(sanitized).trim() === text) html = sanitized;
    }
    const draft = { title, text, ...(html === undefined ? {} : { html }) };
    const draftError = validateDraft(draft);
    if (draftError) {
      throw new Error(`A note in this file cannot be safely imported: ${draftError}`);
    }

    const deletedAt = validTimestamp(raw.deletedAt) ? raw.deletedAt : null;
    const rawCategory = raw.category;
    const category: NoteCategory = typeof rawCategory === 'string' && (NOTE_CATEGORIES as readonly string[]).includes(rawCategory)
      ? rawCategory as NoteCategory
      : 'general';
    notes.push({
      ...draft,
      category,
      createdAt: normalizedTimestamp(raw.createdAt, now),
      updatedAt: normalizedTimestamp(raw.updatedAt, normalizedTimestamp(raw.createdAt, now)),
      pinned: Boolean(raw.pinned),
      archived: deletedAt === null && Boolean(raw.archived),
      deletedAt,
      ...(typeof raw.folderId === 'string' && raw.folderId.trim() ? { folderId: raw.folderId } : {}),
    });
  }

  return { notes, folders, privateNotesSkipped };
}

export function mergeImportedFolders(existing: readonly Folder[], imported: readonly Folder[], now: string): {
  folders: Folder[];
  idMap: Map<string, string>;
} {
  const folders = [...existing];
  const idMap = new Map<string, string>();
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const byName = new Map(folders.map(folder => [folder.name.toLocaleLowerCase(), folder]));

  for (const folder of imported) {
    const idMatch = byId.get(folder.id);
    if (idMatch) {
      idMap.set(folder.id, idMatch.id);
      continue;
    }
    const nameMatch = byName.get(folder.name.toLocaleLowerCase());
    if (nameMatch) {
      idMap.set(folder.id, nameMatch.id);
      continue;
    }
    if (folders.length >= MAX_FOLDERS) continue;
    const id = byId.has(folder.id) ? makeFolderId(folders, now) : folder.id;
    const added = { ...folder, id };
    folders.push(added);
    byId.set(id, added);
    byName.set(added.name.toLocaleLowerCase(), added);
    idMap.set(folder.id, id);
  }
  return { folders, idMap };
}

export function hasPrivateExportFields(value: unknown): boolean {
  return isRecord(value) && isPrivateRecord(value);
}
