/** Paizo reports duplicate credit with this leading note text. */
const ALREADY_PLAYED_NOTE = /^\s*player has already played/i;

const ADVENTURE_PATH = /\badventure\s+path\b|\bAP\s*#/i;

export type SessionProductClass = 'adventure-path' | 'bounty' | 'quest' | 'standard';

export interface SessionXpFields {
  scenario: string;
  prestigePoints: number;
  pointsText?: string;
  gameSystem: string;
}

function hasExplicitProductShape(scenario: string, product: 'Bounty' | 'Quest'): boolean {
  const escapedProduct = product.toLowerCase();
  const atStart = new RegExp(
    `^\\s*(?:(?:pathfinder|starfinder)(?:\\s+society)?\\s+)?${escapedProduct}\\b`,
    'i',
  );
  const numberedProduct = new RegExp(
    `\\b${escapedProduct}(?:\\s*\\([^)]{0,40}\\))?\\s*#`,
    'i',
  );
  return atStart.test(scenario) || numberedProduct.test(scenario);
}

/** Classify Paizo product types without matching incidental words in scenario titles. */
export function classifySessionProduct(scenario: string): SessionProductClass {
  if (ADVENTURE_PATH.test(scenario)) return 'adventure-path';
  if (hasExplicitProductShape(scenario, 'Bounty')) return 'bounty';
  if (hasExplicitProductShape(scenario, 'Quest')) return 'quest';
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

  const source = `${fields.scenario} ${fields.pointsText ?? ''}`;
  if (/PFS\(2ed\)|\b(?:PFS2|SFS2)\b|(?:Pathfinder|Starfinder).*\b(?:2e|second edition)\b/i.test(source)) {
    return 'second';
  }
  return 'first';
}

/** Calculate XP from the explicit product class and game edition. */
export function calculateSessionXp(fields: SessionXpFields): number {
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

/** Repair persisted results from the retired Starfinder 2e eight-XP fallback. */
export function normalizeLegacyEightXp(fields: SessionXpFields & { xp: number }): number {
  return fields.xp === 8 ? calculateSessionXp(fields) : fields.xp;
}

/** True when Paizo marks a row as duplicate credit that earns no XP. */
export function isAlreadyPlayedSessionNote(notes: string | null | undefined): boolean {
  return typeof notes === 'string' && ALREADY_PLAYED_NOTE.test(notes);
}
