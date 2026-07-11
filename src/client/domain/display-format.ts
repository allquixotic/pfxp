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

function abbreviateScenarioWords(value: string): string {
  return value
    .replace(/[\u2012-\u2015]/gu, '-')
    .replace(/\bStarfinder\b/giu, 'SF')
    .replace(/\bPathfinder\b/giu, 'PF')
    .replace(/\bSecond Edition\b/giu, '2e')
    .replace(/\bFirst Edition\b/giu, '1e')
    .replace(/\bPlaytest\b/giu, 'Test')
    .replace(/\b(SF|PF)\s+(1e|2e)\b/giu, '$1$2')
    .replace(/\s*:\s*/gu, ': ')
    .replace(/\s+-\s+/gu, ' - ')
    .replace(/\s+/gu, ' ')
    .trim();
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

/**
 * Abbreviate scenario boilerplate and merge duplicated catalog prefixes while
 * retaining the most specific title suffix (chapter, part, table, etc.).
 */
export function compactScenarioName(value: string): string {
  const compact = abbreviateScenarioWords(value);
  if (!compact.includes(' - ')) return compact;

  const segments = compact.split(' - ').map((segment) => segment.trim()).filter(Boolean);
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
