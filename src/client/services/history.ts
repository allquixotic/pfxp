import localforage from 'localforage';
import { parsePfxpDocument, type PfxpDocument } from '../domain';

/** Legacy-compatible history index key. */
export const HISTORY_INDEX_KEY = 'runs:index';

/** Maximum number of saved scraper results. */
export const MAX_HISTORY_RUNS = 25;

/** Metadata stored in the legacy `runs:index` array. */
export interface HistoryEntry {
  id: string;
  ts: number;
  source: string;
  hash: string;
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
    this.maxRuns = Math.min(
      MAX_HISTORY_RUNS,
      Math.max(1, Math.floor(options.maxRuns ?? MAX_HISTORY_RUNS)),
    );
    this.now = options.now ?? Date.now;
    this.makeId = options.makeId ?? (() => globalThis.crypto.randomUUID());
    this.hash = options.hash ?? sha256Hex;
  }

  /** List newest-first metadata without loading every JSON blob. */
  async list(): Promise<HistoryEntry[]> {
    const raw = await this.store.getItem<unknown>(HISTORY_INDEX_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isHistoryEntry);
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
      const document = parsePfxpDocument(blob);
      return { entry, document };
    } catch (error) {
      throw new CorruptHistoryEntryError(id, error);
    }
  }

  /** Save a run, replacing same-hash entries and pruning history to 25 items. */
  add(document: PfxpDocument, source: string): Promise<HistoryEntry> {
    return this.mutate(async () => {
      const serialized = JSON.stringify(document);
      const hash = await this.hash(serialized);
      const entry: HistoryEntry = {
        id: this.makeId(),
        ts: this.now(),
        source,
        hash,
      };
      const previous = await this.list();
      const retained = previous.filter((candidate) => candidate.hash !== hash);
      const next = [entry, ...retained].slice(0, this.maxRuns);
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
