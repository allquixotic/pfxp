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

function document(marker: number): PfxpDocument {
  return {
    details: [],
    characters: [{
      orgplayid: 42,
      charid: 700 + marker,
      name: `Test ${marker}`,
      faction: 'Test faction',
      game: 'Starfinder 1e',
    }],
    summary: {},
  };
}

describe('HistoryRepository', () => {
  test('keeps duplicate snapshots and does not re-add on load', async () => {
    const store = new MemoryStore();
    let id = 0;
    const repository = new HistoryRepository({
      store,
      makeId: () => `id-${++id}`,
      now: () => id,
    });
    await repository.add(document(1), 'fetch');
    await repository.add(document(1), 'file');
    expect((await repository.list()).map((entry) => entry.id)).toEqual(['id-2', 'id-1']);
    expect(store.values.has('run:id-1')).toBe(true);
    expect(store.values.has('run:id-2')).toBe(true);

    const before = JSON.stringify(await store.getItem(HISTORY_INDEX_KEY));
    expect((await repository.load('id-2'))?.document).toEqual(document(1));
    expect(JSON.stringify(await store.getItem(HISTORY_INDEX_KEY))).toBe(before);
  });

  test('migrates legacy fetches to canonical account identity and preserves plus aliases', async () => {
    const store = new MemoryStore();
    const repository = new HistoryRepository({ store, makeId: () => 'id-1', now: () => 1 });
    await repository.add(document(1), 'fetch');
    await repository.migrateLegacyAccounts(' Friend+Table @Example.COM ');
    expect(await repository.list()).toContainEqual(expect.objectContaining({
      accountKey: 'friend+table@example.com',
      accountEmail: 'friend+table@example.com',
    }));
    expect((await repository.load('id-1'))?.document.account).toEqual({
      key: 'friend+table@example.com',
      email: 'friend+table@example.com',
    });
  });

  test('round-trips GM recognition blocks with a saved run', async () => {
    const store = new MemoryStore();
    const repository = new HistoryRepository({ store, makeId: () => 'glyph-run', now: () => 1 });
    const value: PfxpDocument = {
      ...document(1),
      gmRecognitions: [{
        nodes: [
          { type: 'text', text: 'You are a ' },
          {
            type: 'img',
            src: 'https://paizo.com/image/content/OrganizedPlay/PFS2GlyphIcon_500.png',
            alt: '*',
            width: 24,
            height: 25,
          },
          { type: 'text', text: ' Pathfinder Society (second edition) GM.' },
        ],
      }],
    };
    await repository.add(value, 'fetch');
    expect((await repository.load('glyph-run'))?.document.gmRecognitions).toEqual(
      value.gmRecognitions,
    );
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
