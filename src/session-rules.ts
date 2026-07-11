/** Paizo reports duplicate credit with this leading note text. */
const ALREADY_PLAYED_NOTE = /^\s*player has already played/i;

const SEGMENT_START = String.raw`(?:^|\s+[-\u2012-\u2015]\s+)`;
const SYSTEM_PREFIX = String.raw`(?:(?:(?:pathfinder|starfinder)(?:(?:\s+society)|(?:\s+(?:first|second)\s+edition)|(?:\s+playtest)){0,3}|(?:pfs|sfs)(?:\s*\([^)]{1,20}\)|\s*[12](?:e)?)?|(?:pf|sf)(?:\s*[12]e)?(?:\s+society)?)\s+)?`;

export type SessionProductClass =
  | 'adventure-path'
  | 'bounty'
  | 'quest'
  | 'scenario'
  | 'adventure'
  | 'special'
  | 'intro'
  | 'one-shot'
  | 'standard';

export interface SessionXpFields {
  scenario: string;
  prestigePoints: number;
  gameSystem: string;
  notes?: string | null;
}

function hasExplicitProductShape(scenario: string, product: string): boolean {
  return new RegExp(
    `${SEGMENT_START}${SYSTEM_PREFIX}${product}(?=\\s*(?:#|:|\\(|$))`,
    'i',
  ).test(scenario);
}

/** Classify Paizo product types without matching incidental words in scenario titles. */
export function classifySessionProduct(scenario: string): SessionProductClass {
  const normalized = scenario.trim();
  if (hasExplicitProductShape(normalized, String.raw`Adventure\s+Path`)) return 'adventure-path';
  if (hasExplicitProductShape(normalized, 'Bounty')) return 'bounty';
  if (hasExplicitProductShape(normalized, 'Quest')) return 'quest';
  if (hasExplicitProductShape(normalized, 'Scenario')) return 'scenario';
  if (hasExplicitProductShape(normalized, 'Special')) return 'special';
  if (hasExplicitProductShape(normalized, 'Intro')) return 'intro';
  if (hasExplicitProductShape(normalized, String.raw`One[-\s]Shot`)) return 'one-shot';
  if (
    hasExplicitProductShape(normalized, 'Adventure')
    || hasExplicitProductShape(normalized, String.raw`Free\s+RPG\s+Day`)
  ) return 'adventure';
  return 'standard';
}

function gameEdition(fields: SessionXpFields): 'first' | 'second' | 'playtest' {
  if (fields.gameSystem === 'Starfinder Playtest') return 'playtest';
  if (fields.gameSystem === 'Pathfinder 1e' || fields.gameSystem === 'Starfinder 1e') {
    return 'first';
  }
  if (fields.gameSystem === 'Pathfinder 2e' || fields.gameSystem === 'Starfinder 2e') {
    return 'second';
  }
  throw new Error(`Unsupported game system: ${fields.gameSystem}`);
}

/** Calculate XP from the explicit product class and game edition. */
export function calculateSessionXp(fields: SessionXpFields): number {
  if (isAlreadyPlayedSessionNote(fields.notes)) return 0;
  const edition = gameEdition(fields);
  if (edition === 'playtest') return 0;

  const product = classifySessionProduct(fields.scenario);
  if (product === 'adventure-path') return 12;
  if (product === 'bounty') return edition === 'second' ? 1 : 0.25;
  if (product === 'quest') {
    if (fields.prestigePoints <= 0) return 0;
    return edition === 'second'
      ? Math.min(fields.prestigePoints, 2)
      : 0.5;
  }
  return edition === 'second' ? 4 : 1;
}

/** True when Paizo marks a row as duplicate credit that earns no XP. */
export function isAlreadyPlayedSessionNote(notes: string | null | undefined): boolean {
  return typeof notes === 'string' && ALREADY_PLAYED_NOTE.test(notes);
}
