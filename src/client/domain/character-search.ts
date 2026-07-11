import type { GameSystem } from './models';
import { formatEffectiveLevel } from './document';
import { compactGameSystem, formatShortDate } from './display-format';

/** Minimum character-summary shape needed by the shared desktop/mobile search. */
export interface CharacterSearchCandidate {
  name: string;
  gameSystem: GameSystem;
  totalXp: number;
  effectiveLevel: number | null;
  sessionCount: number;
  lastPlayed?: string | null;
  orgplayid?: number;
  charid?: number | null;
}

/** Filter character summaries using the same formatted values the user sees. */
export function filterCharacterRows<Row extends CharacterSearchCandidate>(
  rows: readonly Row[],
  rawQuery: string,
): Row[] {
  const needle = rawQuery.trim().toLocaleLowerCase();
  if (!needle) return [...rows];

  return rows.filter((row) => [
    row.name,
    row.gameSystem,
    compactGameSystem(row.gameSystem),
    row.orgplayid,
    row.charid,
    row.totalXp,
    row.effectiveLevel,
    formatEffectiveLevel(row.totalXp, row.gameSystem),
    row.sessionCount,
    row.lastPlayed,
    formatShortDate(row.lastPlayed),
  ].join(' ').toLocaleLowerCase().includes(needle));
}
