import { describe, expect, test } from 'bun:test';

import { filterCharacterRows, type CharacterSearchCandidate } from './character-search';

const rows: Array<CharacterSearchCandidate & { id: string }> = [
  {
    id: 'coorbin',
    name: 'Coorbin Norsong',
    gameSystem: 'Pathfinder 2e',
    totalXp: 148,
    effectiveLevel: 13 + 1 / 3,
    sessionCount: 42,
    lastPlayed: '2026-02-22',
    orgplayid: 2436157,
    charid: 2002,
  },
  {
    id: 'mews',
    name: 'Mr. Mews',
    gameSystem: 'Starfinder 2e',
    totalXp: 24,
    effectiveLevel: 3,
    sessionCount: 5,
    lastPlayed: '2026-07-06',
    orgplayid: 2436157,
    charid: 2701,
  },
];

describe('character search', () => {
  test('matches identity and formatted values without relying on grid internals', () => {
    expect(filterCharacterRows(rows, ' coorbin ').map((row) => row.id)).toEqual(['coorbin']);
    expect(filterCharacterRows(rows, '13 1/3').map((row) => row.id)).toEqual(['coorbin']);
    expect(filterCharacterRows(rows, '02-22-26').map((row) => row.id)).toEqual(['coorbin']);
    expect(filterCharacterRows(rows, 'sf2e').map((row) => row.id)).toEqual(['mews']);
  });
});
