import type { GameSystem } from './models';

const COMPACT_GAMES: Record<GameSystem, string> = {
  'Starfinder 2e': 'SF2e',
  'Starfinder Playtest': 'SF2e Test',
  'Pathfinder 2e': 'PF2e',
  'Pathfinder 1e': 'PF1e',
  'Starfinder 1e': 'SF1e',
};

export function compactGameSystem(value: string): string {
  return COMPACT_GAMES[value as GameSystem] ?? value
    .replace(/\bStarfinder\b/giu, 'SF')
    .replace(/\bPathfinder\b/giu, 'PF')
    .replace(/\bSecond Edition\b/giu, '2e')
    .replace(/\bFirst Edition\b/giu, '1e')
    .replace(/\bPlaytest\b/giu, 'Test')
    .replace(/\b(SF|PF)\s+(1e|2e)\b/giu, '$1$2')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Format modern Organized Play dates without timezone rollover. */
export function formatShortDate(value?: string | null): string {
  if (!value) return '';
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/u.exec(value.trim());
  if (isoDate) return `${isoDate[2]}-${isoDate[3]}-${isoDate[1]!.slice(-2)}`;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const year = String(parsed.getFullYear()).slice(-2);
  return `${month}-${day}-${year}`;
}

const LEADING_SYSTEM_CATALOG = /^(?:(?:pathfinder|starfinder)(?:(?:\s+society)|(?:\s+(?:first|second)\s+edition)|(?:\s*\((?:first|second)\s+edition\))|(?:\s+playtest)){0,3}|(?:pfs|sfs)(?:\s*\(\s*2(?:nd|ed)?\s*\)|\s*[12](?:e)?)?|(?:pf|sf)(?:\s*[12]e)?(?:\s+(?:society|test|playtest))*)(?=\s|#|:|$)\s*/iu;
const LEADING_SYSTEM_QUALIFIER = /^(?:(?:first|second)\s+edition|[12]e|playtest|test)\s+(?=(?:scenario|special|intro|bounty|quest|adventure|one[-\s]shot|free\s+rpg\s+day)\b|#)/iu;
const LEADING_SOCIETY = /^society\s+(?=(?:scenario|special|intro|bounty|quest|adventure|one[-\s]shot|free\s+rpg\s+day)\b)/iu;
const SCENARIO_SEGMENT_SEPARATOR = /\s+[-\u2012-\u2015]\s+/u;

function stripCatalogSystem(value: string): string {
  let current = value.trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = current
      .replace(LEADING_SYSTEM_CATALOG, '')
      .replace(LEADING_SYSTEM_QUALIFIER, '')
      .replace(LEADING_SOCIETY, '')
      .trim();
    if (next === current) break;
    current = next;
  }
  return current.replace(/^[:\-]\s*/u, '').replace(/\s+/gu, ' ').trim();
}

interface ScenarioSegment {
  prefix: string;
  title: string;
}

function parseScenarioSegment(value: string): ScenarioSegment | null {
  const separator = value.indexOf(':');
  if (separator < 0) return null;
  const prefix = value.slice(0, separator).trim();
  const title = value.slice(separator + 1).trim();
  return prefix && title ? { prefix, title } : null;
}

function normalizedTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function cleanScenarioSegment(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const separator = normalized.indexOf(':');
  if (separator < 0) return stripCatalogSystem(normalized);

  const prefix = stripCatalogSystem(normalized.slice(0, separator));
  const title = normalized.slice(separator + 1).trim();
  if (!prefix) return title;
  return title ? `${prefix}: ${title}` : prefix;
}

/**
 * Remove redundant system catalog text and merge duplicated Paizo title
 * segments while retaining product, number, and the most specific title suffix.
 */
export function scenarioDisplayName(value: string): string {
  const segments = value
    .split(SCENARIO_SEGMENT_SEPARATOR)
    .map(cleanScenarioSegment)
    .filter(Boolean);
  let current = segments[0] ?? '';
  for (const next of segments.slice(1)) {
    const left = parseScenarioSegment(current);
    const right = parseScenarioSegment(next);
    if (left && right) {
      const leftTitle = normalizedTitle(left.title);
      const rightTitle = normalizedTitle(right.title);
      if (rightTitle.startsWith(leftTitle)) {
        current = `${left.prefix}: ${right.title}`;
        continue;
      }
      if (leftTitle.startsWith(rightTitle)) continue;
    }
    if (normalizedTitle(next).startsWith(normalizedTitle(current))) {
      current = next;
      continue;
    }
    current = `${current} - ${next}`;
  }
  return current;
}

/** Legacy name retained for callers; both densities now share one clutter-free label. */
export function compactScenarioName(value: string): string {
  return scenarioDisplayName(value);
}
