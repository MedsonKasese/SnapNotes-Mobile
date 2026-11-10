export type PreviewNote = {
  fields: Record<string, unknown>;
  unsupportedFields: string[];
};

export type PreviewFolder = { id: string; name: string };

export type CloudLibrarySchema = 'legacy' | 'paged-v2' | 'separated-v3';

export type CloudLibraryPreview = {
  source: 'legacy' | 'revision';
  schema: CloudLibrarySchema;
  pageCount: number;
  notes: PreviewNote[];
  folders: PreviewFolder[];
};

type DocumentSnapshotLike = {
  id?: string;
  exists: () => boolean;
  data: () => unknown;
};

type PageSnapshotLike = { id?: string; data: () => unknown };
type PagesSnapshotLike = { docs: readonly PageSnapshotLike[]; size?: number };

export type CloudLibraryPreviewReads = {
  getUserDocument: (uid: string) => Promise<DocumentSnapshotLike>;
  getLibraryPages: (uid: string, revision: string) => Promise<PagesSnapshotLike>;
};

export function createCloudPreviewRequestGate() {
  let verifiedUid: string | null = null;
  let generation = 0;
  return {
    setVerifiedUid(uid: string | null): void {
      if (verifiedUid !== uid) {
        verifiedUid = uid;
        generation += 1;
      }
    },
    begin(uid: string): number | null {
      if (verifiedUid !== uid) return null;
      generation += 1;
      return generation;
    },
    isCurrent(uid: string, requestId: number): boolean {
      return verifiedUid === uid && generation === requestId;
    },
  };
}

const NOTE_FIELDS = new Set([
  'id', 'category', 'title', 'text', 'html', 'createdAt', 'updatedAt', 'pinned', 'archived', 'deletedAt', 'folderId',
  'reminderAt', 'reminderNotified', 'reminderRepeat',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid cloud library: ${label} must be an array.`);
  return value;
}

function isSafeSeparatedOrdinaryNote(record: Record<string, unknown>): boolean {
  const hasPrivateFlag = hasOwn(record, 'isPrivate');
  const hasPrivatePayload = hasOwn(record, 'privateData');
  if (!hasPrivateFlag && !hasPrivatePayload) return true;
  if (!hasPrivateFlag || !hasPrivatePayload) return false;
  try {
    // The PWA importer may retain this exact, non-private compatibility shape.
    // Any other privacy marker in an ordinary v3 page is ambiguous and blocks preview.
    return record.isPrivate === false && record.privateData === null;
  } catch {
    return false;
  }
}

function projectNotes(records: unknown[], schema: CloudLibrarySchema): PreviewNote[] {
  const projected: PreviewNote[] = [];
  for (const raw of records) {
    if (schema === 'separated-v3') {
      if (!isRecord(raw) || !isSafeSeparatedOrdinaryNote(raw)) {
        throw new Error('Invalid cloud library: an ordinary v3 page contains a private or ambiguous note.');
      }
    } else if (isRecord(raw) && (hasOwn(raw, 'privateData') || Boolean(raw.isPrivate))) {
      // Legacy pages can be mixed; exclude private records before enumerating or projecting fields.
      continue;
    }
    if (!isRecord(raw)) throw new Error('Invalid cloud library: a note record is malformed.');

    const keys = Object.keys(raw);
    const unsupportedFields = keys.filter((key) => !NOTE_FIELDS.has(key) && key !== 'isPrivate' && key !== 'privateData');
    const fields: Record<string, unknown> = {};
    for (const key of NOTE_FIELDS) {
      if (hasOwn(raw, key)) fields[key] = raw[key];
    }
    if (typeof fields.id !== 'string' || !fields.id || typeof fields.title !== 'string' || typeof fields.text !== 'string') {
      throw new Error('Invalid cloud library: a note record is malformed.');
    }
    projected.push({ fields, unsupportedFields });
  }
  return projected;
}

function projectFolders(records: unknown[]): PreviewFolder[] {
  return records.map((raw) => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string') {
      throw new Error('Invalid cloud library: a folder record is malformed.');
    }
    // The preview only needs these display fields; never retain the raw folder object.
    return { id: raw.id, name: raw.name };
  });
}

function classifyCloudLibrarySchema(userData: Record<string, unknown>): CloudLibrarySchema {
  const hasSyncVersion = hasOwn(userData, 'syncVersion');
  const syncVersion = userData.syncVersion;
  if (hasSyncVersion && syncVersion !== 2 && syncVersion !== 3) {
    throw new Error('Invalid cloud library: sync schema version is unsupported.');
  }

  const hasSchemaFence = hasOwn(userData, 'privateNotesSchemaRequired') || hasOwn(userData, 'privateNotesSeparated');
  if (syncVersion === 3 || hasSchemaFence) {
    if (syncVersion !== 3 || userData.privateNotesSchemaRequired !== true || userData.privateNotesSeparated !== true) {
      throw new Error('Cloud library is fenced for schema v3 but private-note separation is incomplete.');
    }
    return 'separated-v3';
  }

  return syncVersion === 2 ? 'paged-v2' : 'legacy';
}

function collectArrays(value: unknown, label: string): { notes: unknown[]; folders: unknown[] } {
  if (!isRecord(value)) throw new Error('Invalid cloud library: user or page data is malformed.');
  return {
    notes: requireArray(value.notes, `${label} notes`),
    folders: requireArray(value.folders, `${label} folders`),
  };
}

export function createCloudLibraryPreviewService(reads: CloudLibraryPreviewReads) {
  return {
    async load(uid: string): Promise<CloudLibraryPreview> {
      if (!uid) throw new Error('A signed-in account is required.');
      const userSnapshot = await reads.getUserDocument(uid);
      if (!userSnapshot.exists()) {
        return { source: 'legacy', schema: 'legacy', pageCount: 0, notes: [], folders: [] };
      }
      const userData = userSnapshot.data();
      if (!isRecord(userData)) throw new Error('Invalid cloud library: user data is malformed.');
      const schema = classifyCloudLibrarySchema(userData);
      if (schema === 'separated-v3' && !hasOwn(userData, 'activeLibraryRevision')) {
        throw new Error('Invalid cloud library: separated schema has no active revision.');
      }

      if (hasOwn(userData, 'activeLibraryRevision')) {
        const revision = userData.activeLibraryRevision;
        if (typeof revision !== 'string' || !revision.trim()) {
          throw new Error('Invalid cloud library: active revision is malformed.');
        }
        const hasRecordedCount = hasOwn(userData, 'libraryPageCount');
        const recordedCount = userData.libraryPageCount;
        if (hasRecordedCount && (typeof recordedCount !== 'number' || !Number.isInteger(recordedCount) || recordedCount < 0)) {
          throw new Error('Invalid cloud library: page count is malformed.');
        }

        const pageSnapshot = await reads.getLibraryPages(uid, revision);
        if (!Array.isArray(pageSnapshot.docs)) throw new Error('Invalid cloud library: page collection is malformed.');
        const docs = [...pageSnapshot.docs].sort((left, right) => (left.id ?? '').localeCompare(right.id ?? ''));
        const pageCount = pageSnapshot.size;
        if (typeof pageCount !== 'number' || !Number.isInteger(pageCount) || pageCount < 0 || pageCount !== docs.length) {
          throw new Error('Invalid cloud library: page collection is incomplete.');
        }
        if (hasRecordedCount && pageCount !== recordedCount) {
          throw new Error('Invalid cloud library: page count does not match the active revision.');
        }
        if (!hasRecordedCount && pageCount === 0) {
          throw new Error('Invalid cloud library: active revision has no pages.');
        }

        const notes: unknown[] = [];
        const folders: unknown[] = [];
        for (const page of docs) {
          const arrays = collectArrays(page.data(), 'page');
          notes.push(...arrays.notes);
          folders.push(...arrays.folders);
        }
        return { source: 'revision', schema, pageCount, notes: projectNotes(notes, schema), folders: projectFolders(folders) };
      }

      const arrays = collectArrays(userData, 'legacy user');
      return { source: 'legacy', schema, pageCount: 0, notes: projectNotes(arrays.notes, schema), folders: projectFolders(arrays.folders) };
    },
  };
}
