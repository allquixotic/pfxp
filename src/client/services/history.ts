import localforage from 'localforage';
import { parsePfxpDocument, type PfxpDocument } from '../domain';
import { createPaizoAccountIdentity } from '../../account';

/** Legacy-compatible history index key. */
export const HISTORY_INDEX_KEY = 'runs:index';

/** Metadata stored in the `runs:index` array. */
export interface HistoryEntry {
  id: string;
  ts: number;
  source: string;
  hash: string;
  label: string;
  accountKey: string | null;
  accountEmail: string | null;
}

/** A saved history entry paired with its validated document. */
export interface SavedRun {
  entry: HistoryEntry;
  document: PfxpDocument;
}

/** localForage-compatible storage subset used by the repository. */
export interface HistoryStore {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<T>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Testable dependencies and limits for a history repository. */
export interface HistoryRepositoryOptions {
  store?: HistoryStore;
  maxRuns?: number;
  now?: () => number;
  makeId?: () => string;
  hash?: (serializedDocument: string) => Promise<string>;
}

/** Error raised when a saved blob exists but is not a valid PFXP document. */
export class CorruptHistoryEntryError extends Error {
  readonly id: string;

  constructor(id: string, cause?: unknown) {
    super(`Saved run ${id} is not a valid PFXP document`, { cause });
    this.name = 'CorruptHistoryEntryError';
    this.id = id;
  }
}

function runKey(id: string): string {
  return `run:${id}`;
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string'
    && entry.id.length > 0
    && typeof entry.ts === 'number'
    && Number.isFinite(entry.ts)
    && typeof entry.source === 'string'
    && typeof entry.hash === 'string'
    && entry.hash.length > 0;
}

function defaultRunLabel(source: string): string {
  if (source === 'fetch') return 'Paizo account fetch';
  if (source === 'file') return 'PFXP JSON import';
  return 'Saved run';
}

function normalizeHistoryEntry(value: unknown): HistoryEntry | null {
  if (!isHistoryEntry(value)) return null;
  const raw = value as unknown as Record<string, unknown>;
  const accountEmail = typeof raw.accountEmail === 'string' && raw.accountEmail
    ? createPaizoAccountIdentity(raw.accountEmail).email
    : null;
  return {
    id: value.id,
    ts: value.ts,
    source: value.source,
    hash: value.hash,
    label: typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim()
      : defaultRunLabel(value.source),
    accountKey: accountEmail,
    accountEmail,
  };
}

/** SHA-256 hash format used by the legacy history implementation. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Persistent run history compatible with `runs:index` and `run:<id>`. */
export class HistoryRepository {
  private readonly store: HistoryStore;
  private readonly maxRuns: number;
  private readonly now: () => number;
  private readonly makeId: () => string;
  private readonly hash: (serializedDocument: string) => Promise<string>;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: HistoryRepositoryOptions = {}) {
    this.store = options.store ?? localforage.createInstance({ name: 'pfxp' });
    this.maxRuns = options.maxRuns === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(1, Math.floor(options.maxRuns));
    this.now = options.now ?? Date.now;
    this.makeId = options.makeId ?? (() => globalThis.crypto.randomUUID());
    this.hash = options.hash ?? sha256Hex;
  }

  /** List newest-first metadata without loading every JSON blob. */
  async list(): Promise<HistoryEntry[]> {
    const raw = await this.store.getItem<unknown>(HISTORY_INDEX_KEY);
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeHistoryEntry)
      .filter((entry): entry is HistoryEntry => entry !== null)
      .sort((left, right) => right.ts - left.ts);
  }

  /**
   * Load and validate a saved run without re-adding, duplicating, or reordering it.
   */
  async load(id: string): Promise<SavedRun | null> {
    const index = await this.list();
    const entry = index.find((candidate) => candidate.id === id);
    if (!entry) return null;
    const blob = await this.store.getItem<unknown>(runKey(id));
    if (blob === null) return null;
    try {
      const parsed = parsePfxpDocument(blob);
      const document = parsed.account || !entry.accountEmail
        ? parsed
        : { ...parsed, account: createPaizoAccountIdentity(entry.accountEmail) };
      return { entry, document };
    } catch (error) {
      throw new CorruptHistoryEntryError(id, error);
    }
  }

  /** Save every run until the user explicitly removes it. */
  add(document: PfxpDocument, source: string, label = defaultRunLabel(source)): Promise<HistoryEntry> {
    return this.mutate(async () => {
      const serialized = JSON.stringify(document);
      const hash = await this.hash(serialized);
      const entry: HistoryEntry = {
        id: this.makeId(),
        ts: this.now(),
        source,
        hash,
        label,
        accountKey: document.account?.key ?? null,
        accountEmail: document.account?.email ?? null,
      };
      const previous = await this.list();
      const next = [entry, ...previous].slice(0, this.maxRuns);
      const nextIds = new Set(next.map((candidate) => candidate.id));
      const staleIds = new Set(
        previous
          .filter((candidate) => !nextIds.has(candidate.id))
          .map((candidate) => candidate.id),
      );

      await this.store.setItem(runKey(entry.id), serialized);
      try {
        await this.store.setItem(HISTORY_INDEX_KEY, next);
      } catch (error) {
        await this.store.removeItem(runKey(entry.id));
        throw error;
      }
      await Promise.all([...staleIds].map((id) => this.store.removeItem(runKey(id))));
      return entry;
    });
  }

  /** Attach pre-account-model fetches to the last saved email without losing runs. */
  migrateLegacyAccounts(fallbackEmail: string): Promise<void> {
    return this.mutate(async () => {
      const previous = await this.list();
      const fallback = fallbackEmail ? createPaizoAccountIdentity(fallbackEmail) : null;
      let changed = false;
      const next: HistoryEntry[] = [];

      for (const entry of previous) {
        if (entry.accountKey) {
          next.push(entry);
          continue;
        }
        const blob = await this.store.getItem<unknown>(runKey(entry.id));
        if (blob === null) {
          next.push(entry);
          continue;
        }
        try {
          const document = parsePfxpDocument(blob);
          const account = document.account ?? (entry.source === 'fetch' ? fallback : null);
          if (!account) {
            next.push(entry);
            continue;
          }
          const migrated = document.account ? document : { ...document, account };
          const serialized = JSON.stringify(migrated);
          await this.store.setItem(runKey(entry.id), serialized);
          next.push({
            ...entry,
            hash: await this.hash(serialized),
            accountKey: account.key,
            accountEmail: account.email,
          });
          changed = true;
        } catch {
          next.push(entry);
        }
      }
      if (changed) await this.store.setItem(HISTORY_INDEX_KEY, next);
    });
  }

  /** Delete a saved run and its JSON blob. */
  remove(id: string): Promise<boolean> {
    return this.mutate(async () => {
      const previous = await this.list();
      const next = previous.filter((entry) => entry.id !== id);
      if (next.length === previous.length) return false;
      await this.store.setItem(HISTORY_INDEX_KEY, next);
      await this.store.removeItem(runKey(id));
      return true;
    });
  }

  /** Delete the history index plus referenced or orphaned `run:*` blobs. */
  clear(): Promise<void> {
    return this.mutate(async () => {
      const keys = await this.store.keys();
      await Promise.all(
        keys
          .filter((key) => key === HISTORY_INDEX_KEY || key.startsWith('run:'))
          .map((key) => this.store.removeItem(key)),
      );
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}
