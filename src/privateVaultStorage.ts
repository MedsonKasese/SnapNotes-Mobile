import { validatePrivateCipherRecord, type PrivateCipherRecord } from './privateCrypto.ts';

// Separate from ordinary notes, drafts and search. Only ciphertext and opaque
// identifiers may be written here. No Private Notes UI is enabled by this PR.
export const PRIVATE_VAULT_INDEX_KEY = '@snapnotes-mobile/private-vault/index';
const PRIVATE_VAULT_PREFIX = '@snapnotes-mobile/private-vault/generation/';
const MAX_RECORD_BYTES = 1024 * 1024;
const PRIVATE_CIPHER_FIELDS = new Set([
  'version', 'algorithm', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext',
]);

export type PrivateVaultEntry = {
  id: string;
  privateData: PrivateCipherRecord;
};

type Backend = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validatePrivateVaultEntries(value: unknown): PrivateVaultEntry[] {
  if (!Array.isArray(value)) throw new Error('Invalid encrypted private vault.');
  const ids = new Set<string>();
  return value.map((entry: unknown) => {
    if (!record(entry) || Object.keys(entry).some(key => key !== 'id' && key !== 'privateData') ||
      typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 256 ||
      ids.has(entry.id)) {
      throw new Error('Invalid or duplicate private vault identifier.');
    }
    ids.add(entry.id);
    if (!record(entry.privateData) ||
      Object.keys(entry.privateData).some(key => !PRIVATE_CIPHER_FIELDS.has(key))) {
      throw new Error('Unexpected encrypted private note fields.');
    }
    // Copy only encrypted fields so caller prototypes and toJSON hooks cannot
    // introduce plaintext during serialization. Validate the exact snapshot.
    const privateData = validatePrivateCipherRecord({
      version: entry.privateData.version,
      algorithm: entry.privateData.algorithm,
      kdf: entry.privateData.kdf,
      iterations: entry.privateData.iterations,
      salt: entry.privateData.salt,
      iv: entry.privateData.iv,
      ciphertext: entry.privateData.ciphertext,
    });
    return { id: entry.id, privateData };
  });
}

const queues = new WeakMap<Backend, Promise<void>>();
function serialize<T>(backend: Backend, operation: () => Promise<T>): Promise<T> {
  const next = (queues.get(backend) ?? Promise.resolve()).then(operation);
  queues.set(backend, next.then(() => undefined, () => undefined));
  return next;
}

function generationKey(id: string): string {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid private vault generation.');
  return PRIVATE_VAULT_PREFIX + id;
}

let sequence = 0;

export function createPrivateVaultStorage(backend: Backend) {
  async function loadCommitted(): Promise<PrivateVaultEntry[]> {
    const pointer = await backend.getItem(PRIVATE_VAULT_INDEX_KEY);
    if (pointer === null) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(pointer); }
    catch { throw new Error('Corrupt private vault index.'); }
    if (!record(parsed) || parsed.version !== 1 || typeof parsed.generation !== 'string') {
      throw new Error('Unsupported private vault index.');
    }
    const data = await backend.getItem(generationKey(parsed.generation));
    if (data === null) throw new Error('Committed encrypted private vault is missing.');
    let payload: unknown;
    try { payload = JSON.parse(data); }
    catch { throw new Error('Corrupt encrypted private vault.'); }
    if (!record(payload) || payload.version !== 1) throw new Error('Unsupported encrypted private vault.');
    return validatePrivateVaultEntries(payload.entries);
  }

  return {
    load(): Promise<PrivateVaultEntry[]> {
      return serialize(backend, loadCommitted);
    },
    async save(entries: PrivateVaultEntry[]): Promise<void> {
      // Reject plaintext and unexpected fields before writing anything.
      const safe = validatePrivateVaultEntries(entries);
      const payload = JSON.stringify({ version: 1, entries: safe });
      if (new TextEncoder().encode(payload).byteLength > MAX_RECORD_BYTES) {
        throw new Error('Encrypted private vault exceeds storage limit.');
      }
      return serialize(backend, async () => {
        // Write the immutable generation first, then commit its pointer.
        // A failed write cannot replace the previous committed vault.
        const generation = Date.now().toString(36) + '-' + (++sequence).toString(36) +
          '-' + Math.random().toString(36).slice(2, 10);
        await backend.setItem(generationKey(generation), payload);
        await backend.setItem(PRIVATE_VAULT_INDEX_KEY, JSON.stringify({ version: 1, generation }));
      });
    },
  };
}
