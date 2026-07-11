import { describe, expect, test } from 'bun:test';

import type { SessionDetail } from './models';
import { searchSessionRows } from './session-search';

function session(gameSystem: SessionDetail['gameSystem'], scenario: string): SessionDetail {
  return {
    date: '2026-07-10',
    gm: 'Test GM',
    scenario,
    gameSystem,
    points: { achievementPoints: null, gmCredits: null },
    event: { id: 1, name: 'Test event' },
    session: 1,
    player: { orgplayid: 100, charid: 200 },
    character: { name: 'Test character' },
    faction: { name: 'Test faction' },
    prestigeReputation: { prestigePoints: 0, isGM: 'no' },
    notes: null,
    xp: 4,
  } as SessionDetail;
}

describe('session search', () => {
  const pathfinder = session('Pathfinder 2e', 'The Mosquito Witch');
  const starfinder = session('Starfinder 2e', 'Sloughscar Summit');
  const rows = [pathfinder, starfinder];

  test('prefers exact text over similar fuzzy matches', () => {
    expect(searchSessionRows(rows, 'Starfinder 2e')).toEqual([starfinder]);
    expect(searchSessionRows(rows, 'Sloughscar Summit')).toEqual([starfinder]);
  });

  test('falls back to typo-tolerant matching', () => {
    expect(searchSessionRows(rows, 'Sloughscar Sumit')).toEqual([starfinder]);
  });
});
