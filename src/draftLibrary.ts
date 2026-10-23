// Device-only draft library, independent from the existing single editor recovery key.
// Mirrors PWA js/drafts.js upsert/remove semantics without silently deleting bad data.
export const DRAFT_LIBRARY_KEY = '@snapnotes-mobile/drafts-v1';
export type SavedDraft = {
  id: string;
  title: string;
  text: string;
  html?: string;
  category: string;
  editingId: string | null;
  savedAt: string;
};

export function parseDraftLibrary(raw: string | null): SavedDraft[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw Error('Invalid saved drafts.');
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('Invalid draft record.');
    const draft = item as Record<string, unknown>;
    if (typeof draft.id !== 'string' || !draft.id || ids.has(draft.id) ||
      typeof draft.title !== 'string' || typeof draft.text !== 'string' ||
      (draft.html !== undefined && typeof draft.html !== 'string') ||
      typeof draft.category !== 'string' || !draft.category ||
      !(draft.editingId === null || typeof draft.editingId === 'string') ||
      typeof draft.savedAt !== 'string' || !Number.isFinite(Date.parse(draft.savedAt))) {
      throw Error('Invalid draft record.');
    }
    ids.add(draft.id);
    return {
      id: draft.id, title: draft.title, text: draft.text,
      ...(draft.html === undefined ? {} : { html: draft.html as string }),
      category: draft.category, editingId: draft.editingId as string | null, savedAt: draft.savedAt,
    };
  });
}

export function upsertDraft(drafts: SavedDraft[], draft: SavedDraft): SavedDraft[] {
  const index = drafts.findIndex(item => item.id === draft.id);
  if (index === -1) return [draft, ...drafts];
  return drafts.map(item => item.id === draft.id ? draft : item);
}

export function removeDraft(drafts: SavedDraft[], id: string): SavedDraft[] {
  return drafts.filter(item => item.id !== id);
}

export function newDraftId(drafts: SavedDraft[], timestamp: string): string {
  const ids = new Set(drafts.map(draft => draft.id));
  const prefix = 'local-draft-' + timestamp.replace(/[^0-9]/g, '') + '-';
  let n = 1;
  while (ids.has(prefix + n)) n += 1;
  return prefix + n;
}
