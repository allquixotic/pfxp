import type { PaizoAccountIdentity } from '../../account';

/** Game systems emitted by the scraper and understood by the client. */
export const GAME_SYSTEMS = [
  'Pathfinder 1e',
  'Pathfinder 2e',
  'Starfinder 1e',
  'Starfinder 2e',
  'Starfinder Playtest',
] as const;

/** A canonical Paizo organized-play game system name. */
export type GameSystem = (typeof GAME_SYSTEMS)[number];

/** A character scraped from the user's organized-play roster. */
export interface Character {
  orgplayid: number;
  charid: number;
  name: string;
  faction: string;
  game: GameSystem;
}

/** One reported organized-play session. */
export interface SessionDetail {
  date?: string;
  gm: string;
  scenario: string;
  gameSystem: GameSystem;
  points: {
    achievementPoints: number | null;
    gmCredits: number | null;
  };
  event: {
    id: number;
    name: string;
  };
  session: number;
  player: {
    orgplayid: number;
    charid: number | null;
  };
  character: {
    name: string;
  };
  faction: {
    name: string;
  };
  prestigeReputation: {
    prestigePoints: number;
    isGM: 'yes' | 'no';
  };
  notes: string | null;
  xp: number;
}

/** The legacy scraper summary value retained in full JSON documents. */
export interface LegacyCharacterSummary {
  xp: number;
}

/** A complete, re-importable scraper result. */
export interface PfxpDocument {
  account?: PaizoAccountIdentity;
  characters: Character[];
  details: SessionDetail[];
  summary: Record<string, LegacyCharacterSummary>;
}

/** Stable identity for a character within a specific game system. */
export type CharacterKey = string;

/** A UI-ready character summary derived from roster and session data. */
export interface CharacterSummary {
  key: CharacterKey;
  orgplayid: number;
  charid: number | null;
  character: string;
  faction: string;
  game: GameSystem;
  totalXp: number;
  effectiveLevel: number | null;
  sessionCount: number;
  lastPlayed: string | null;
}

/** One actionable validation problem in an imported document. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** Result of validating and normalizing an unknown JSON value. */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };
