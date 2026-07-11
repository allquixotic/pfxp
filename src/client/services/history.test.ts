import { describe, expect, test } from 'bun:test';
import type { PfxpDocument } from '../domain';
import {
  HISTORY_INDEX_KEY,
  HistoryRepository,
  type HistoryStore,
} from './history';

class MemoryStore implements HistoryStore {
  readonly values = new Map<string, unknown>();

  async getItem<T>(key: string): Promise<T | null> {
    return (this.values.has(key) ? this.values.get(key) : null) as T | null;
  }

  async setItem<T>(key: string, value: T): Promise<T> {
    this.values.set(key, value);
    return value;
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.values.keys()];
  }
}

function document(xp: number): PfxpDocument {
  return { details: [], characters: [], summary: { Test: { xp } } };
}

describe('HistoryRepository', () => {
  test('deduplicates hashes, deletes old blobs, and does not re-add on load', async () => {
    const store = new MemoryStore();
    let id = 0;
    const repository = new HistoryRepository({
      store,
      makeId: () => `id-${++id}`,
      now: () => id,
    });
    await repository.add(document(1), 'fetch');
    await repository.add(document(1), 'file');
    expect((await repository.list()).map((entry) => entry.id)).toEqual(['id-2']);
    expect(store.values.has('run:id-1')).toBe(false);
    expect(store.values.has('run:id-2')).toBe(true);

    const before = JSON.stringify(await store.getItem(HISTORY_INDEX_KEY));
    expect((await repository.load('id-2'))?.document).toEqual(document(1));
    expect(JSON.stringify(await store.getItem(HISTORY_INDEX_KEY))).toBe(before);
  });

  test('prunes blobs that fall beyond the configured cap', async () => {
    const store = new MemoryStore();
    let id = 0;
    const repository = new HistoryRepository({
      store,
      maxRuns: 2,
      makeId: () => `id-${++id}`,
      now: () => id,
    });
    await repository.add(document(1), 'fetch');
    await repository.add(document(2), 'fetch');
    await repository.add(document(3), 'fetch');
    expect((await repository.list()).map((entry) => entry.id)).toEqual(['id-3', 'id-2']);
    expect(store.values.has('run:id-1')).toBe(false);
  });
});
