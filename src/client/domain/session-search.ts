import Fuse from 'fuse.js';

import type { SessionDetail } from './models';

const searchKeys = [
  'date', 'gm', 'scenario', 'gameSystem', 'event.name', 'event.id', 'session',
  'player.orgplayid', 'player.charid', 'character.name', 'faction.name',
  'prestigeReputation.prestigePoints', 'prestigeReputation.isGM', 'notes', 'xp',
];

function searchableValues(row: SessionDetail): unknown[] {
  return [
    row.date,
    row.gm,
    row.scenario,
    row.gameSystem,
    row.event?.name,
    row.event?.id,
    row.session,
    row.player?.orgplayid,
    row.player?.charid,
    row.character?.name,
    row.faction?.name,
    row.prestigeReputation?.prestigePoints,
    row.prestigeReputation?.isGM,
    row.notes,
    row.xp,
  ];
}

function containsExactText(row: SessionDetail, normalizedQuery: string): boolean {
  return searchableValues(row).some((value) => String(value ?? '').toLocaleLowerCase().includes(normalizedQuery));
}

/** Prefer predictable substring matches, falling back to typo-tolerant Fuse search. */
export function searchSessionRows(
  rows: SessionDetail[],
  rawQuery: string,
  options: { threshold?: number; shouldSort?: boolean } = {},
): SessionDetail[] {
  const query = rawQuery.trim();
  if (!query) return rows;

  const normalizedQuery = query.toLocaleLowerCase();
  const exactMatches = rows.filter((row) => containsExactText(row, normalizedQuery));
  if (exactMatches.length) return exactMatches;

  return new Fuse(rows, {
    threshold: options.threshold ?? 0.28,
    ignoreLocation: true,
    shouldSort: options.shouldSort ?? true,
    keys: searchKeys,
  }).search(query).map((result) => result.item);
}
