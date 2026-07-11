import { describe, expect, test } from 'bun:test';
import {
  aggregateCharacterSummaries,
  characterKey,
  effectiveLevel,
  formatEffectiveLevel,
  parsePfxpDocument,
  validatePfxpDocument,
} from './document';
import type { PfxpDocument, SessionDetail } from './models';
import type { GmRecognitionBlock } from '../../gm-recognition';

function session(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    date: '2026-01-01',
    gm: 'GM',
    scenario: 'Scenario',
    gameSystem: 'Pathfinder 2e',
    points: { achievementPoints: 4, gmCredits: null },
    event: { id: 1, name: 'Event' },
    session: 1,
    player: { orgplayid: 42, charid: 2001 },
    character: { name: 'Echo' },
    faction: { name: 'Envoys Alliance' },
    prestigeReputation: { prestigePoints: 2, isGM: 'no' },
    notes: null,
    xp: 4,
    ...overrides,
  };
}

describe('PFXP document domain', () => {
  test('validates and detaches complete documents', () => {
    const raw: PfxpDocument = {
      characters: [{
        orgplayid: 42,
        charid: 2001,
        name: 'Echo',
        faction: 'Envoys Alliance',
        game: 'Pathfinder 2e',
      }],
      details: [session()],
      summary: { Echo: { xp: 4 } },
    };
    const result = validatePfxpDocument(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(raw);
      expect(result.value).not.toBe(raw);
      expect(result.value.details[0]).not.toBe(raw.details[0]);
    }
  });

  test('keeps already-played rows but normalizes their XP to zero', () => {
    const parsed = parsePfxpDocument({
      characters: [],
      details: [
        session({ scenario: 'Keep me', notes: 'Ordinary reporting note' }),
        session({
          scenario: 'Duplicate credit',
          notes: '  PLAYER HAS ALREADY PLAYED this scenario at another event.',
        }),
        session({
          scenario: 'Keep later mention',
          notes: 'Review note: player has already played was entered in error.',
        }),
      ],
      summary: { Echo: { xp: 12 } },
    });

    expect(parsed.details.map((detail) => detail.scenario)).toEqual([
      'Keep me',
      'Duplicate credit',
      'Keep later mention',
    ]);
    expect(parsed.details.map((detail) => detail.xp)).toEqual([4, 0, 4]);
    expect(parsed.summary).toEqual({ Echo: { xp: 8 } });
  });

  test('V13: normalizes legacy Starfinder 2e eight-XP rows and their summary', () => {
    const parsed = parsePfxpDocument({
      characters: [],
      details: [session({
        scenario: 'SFS2 #1-23: Psychic Echoes',
        gameSystem: 'Starfinder 2e',
        player: { orgplayid: 42, charid: 2701 },
        xp: 8,
      })],
      summary: { Echo: { xp: 8 } },
    });

    expect(parsed.details[0]?.xp).toBe(4);
    expect(parsed.summary).toEqual({ Echo: { xp: 4 } });
  });

  test('keeps safe GM recognition blocks, omits unsafe blocks, and accepts legacy runs', () => {
    const safeBlock: GmRecognitionBlock = {
      nodes: [
        { type: 'text', text: 'You are a ' },
        {
          type: 'span',
          classes: ['referenceable'],
          children: [{
            type: 'img',
            src: 'https://paizo.com/image/content/OrganizedPlay/PFS2GlyphIcon_500.png',
            alt: '*',
            width: 24,
            height: 25,
          }],
        },
        { type: 'text', text: ' Pathfinder Society (second edition) GM.' },
      ],
    };
    const parsed = parsePfxpDocument({
      characters: [],
      details: [],
      summary: {},
      gmRecognitions: [
        safeBlock,
        {
          nodes: [
            { type: 'text', text: 'You are a ' },
            { type: 'script', text: 'alert(1)' },
            { type: 'text', text: ' Pathfinder Society GM.' },
          ],
        },
      ],
    });
    expect(parsed.gmRecognitions).toEqual([safeBlock]);
    expect(parsed.gmRecognitions?.[0]).not.toBe(safeBlock);

    const legacy = parsePfxpDocument({ characters: [], details: [], summary: {} });
    expect(legacy.gmRecognitions).toBeUndefined();
  });

  test('returns paths for malformed nested data', () => {
    const result = validatePfxpDocument({ details: [{ xp: 'four' }], characters: [], summary: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === '$.details[0].xp')).toBe(true);
      expect(result.issues.some((issue) => issue.path === '$.details[0].player')).toBe(true);
    }
    expect(() => parsePfxpDocument('{not json')).toThrow('Invalid PFXP document');
  });

  test('preserves hostile summary keys without mutating object prototypes', () => {
    const parsed = parsePfxpDocument(JSON.parse(
      '{"characters":[],"details":[],"summary":{"__proto__":{"xp":1}}}',
    ));
    expect(Object.hasOwn(parsed.summary, '__proto__')).toBe(true);
    expect(parsed.summary.__proto__?.xp).toBe(1);
    expect(({} as { xp?: number }).xp).toBeUndefined();
  });

  test('uses edition-specific effective-level progress', () => {
    expect(effectiveLevel(6, 'Pathfinder 1e')).toBe(3);
    expect(effectiveLevel(6, 'Starfinder 1e')).toBe(3);
    expect(effectiveLevel(18, 'Pathfinder 2e')).toBe(2.5);
    expect(effectiveLevel(18, 'Starfinder 2e')).toBe(2.5);
    expect(effectiveLevel(18, 'Starfinder Playtest')).toBe(2.5);
    expect(formatEffectiveLevel(41, 'Pathfinder 2e')).toBe('4 5/12');
    expect(formatEffectiveLevel(18, 'Pathfinder 2e')).toBe('2 1/2');
    expect(formatEffectiveLevel(6, 'Starfinder 1e')).toBe('3');
  });

  test('aggregates by org ID, character ID, and game instead of name', () => {
    const document: PfxpDocument = {
      characters: [
        { orgplayid: 42, charid: 2001, name: 'Echo', faction: 'A', game: 'Pathfinder 2e' },
        { orgplayid: 99, charid: 2001, name: 'Echo', faction: 'B', game: 'Pathfinder 2e' },
        { orgplayid: 42, charid: 702, name: 'No Sessions', faction: 'C', game: 'Starfinder 1e' },
      ],
      details: [
        session({ date: '2025-12-01', xp: 4 }),
        session({ date: '2026-02-01', xp: 8, session: 2 }),
        session({
          date: '2026-01-15',
          player: { orgplayid: 99, charid: 2001 },
          character: { name: 'Echo' },
          faction: { name: 'B' },
          xp: 4,
        }),
      ],
      summary: { Echo: { xp: 16 } },
    };
    const rows = aggregateCharacterSummaries(document);
    const first = rows.find((row) => row.key === characterKey(42, 2001, 'Pathfinder 2e'));
    const second = rows.find((row) => row.key === characterKey(99, 2001, 'Pathfinder 2e'));
    const empty = rows.find((row) => row.charid === 702);
    expect(first).toMatchObject({ totalXp: 12, sessionCount: 2, lastPlayed: '2026-02-01', effectiveLevel: 2 });
    expect(second).toMatchObject({ totalXp: 4, sessionCount: 1, lastPlayed: '2026-01-15' });
    expect(empty).toMatchObject({ totalXp: 0, sessionCount: 0, lastPlayed: null, effectiveLevel: 1 });
  });
});
