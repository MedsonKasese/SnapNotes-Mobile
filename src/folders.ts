export const MAX_FOLDERS = 20;
export const FOLDER_ICON_NAMES = ['folder', 'book', 'flask', 'code', 'lightbulb', 'briefcase', 'heart', 'star', 'cloud'] as const;
export type FolderIcon = typeof FOLDER_ICON_NAMES[number];
export const FOLDER_COLOR_VALUES = { green: '#5b8c43', blue: '#4b78b5', purple: '#8561ad', orange: '#c77a32', rose: '#bb5e73', teal: '#3b8983' } as const;
export type FolderColor = keyof typeof FOLDER_COLOR_VALUES | '';
export function normalizeFolderIcon(value: unknown): FolderIcon { return typeof value === 'string' && (FOLDER_ICON_NAMES as readonly string[]).includes(value) ? value as FolderIcon : 'folder'; }
export function normalizeFolderColor(value: unknown): FolderColor { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FOLDER_COLOR_VALUES, value) ? value as keyof typeof FOLDER_COLOR_VALUES : ''; }
export const MAX_FOLDER_NAME = 32;
export type Folder = { id: string; name: string; icon: FolderIcon; color: FolderColor; createdAt: string; updatedAt: string };
export const FOLDERS_KEY = '@snapnotes-mobile/folders-v1';

export function normalizeFolderName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_FOLDER_NAME);
}

export function validateFolderName(folders: Folder[], name: string, exceptId?: string): string | null {
  if (!name) return 'Enter a folder name.';
  if (folders.some(folder => folder.id !== exceptId && folder.name.toLowerCase() === name.toLowerCase())) {
    return 'A folder with that name already exists.';
  }
  if (!exceptId && folders.length >= MAX_FOLDERS) return 'You can create up to 20 folders.';
  return null;
}

export function parseFolders(raw: string | null): Folder[] {
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > MAX_FOLDERS) throw Error('Invalid saved folders.');
  const ids = new Set<string>();
  const names = new Set<string>();
  return parsed.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid folder record.');
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
      typeof item.name !== 'string' || !item.name.trim() || item.name.length > MAX_FOLDER_NAME ||
      names.has(item.name.toLowerCase()) || typeof item.createdAt !== 'string' ||
      typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) ||
      !Number.isFinite(Date.parse(item.updatedAt))) throw Error('Invalid folder record.');
    ids.add(item.id);
    names.add(item.name.toLowerCase());
    return { id: item.id, name: item.name, icon: normalizeFolderIcon(item.icon),
      color: normalizeFolderColor(item.color), createdAt: item.createdAt, updatedAt: item.updatedAt };
  });
}

export function makeFolderId(folders: Folder[], now: string): string {
  const ids = new Set(folders.map(folder => folder.id));
  let index = 1;
  const prefix = 'local-folder-' + now.replace(/[^0-9]/g, '') + '-';
  while (ids.has(prefix + index)) index += 1;
  return prefix + index;
}
