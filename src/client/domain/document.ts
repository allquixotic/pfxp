import {
  GAME_SYSTEMS,
  type Character,
  type CharacterKey,
  type CharacterSummary,
  type GameSystem,
  type LegacyCharacterSummary,
  type PfxpDocument,
  type SessionDetail,
  type ValidationIssue,
  type ValidationResult,
} from './models';
import { isAlreadyPlayedSessionNote } from '../../session-rules';

const gameSystems = new Set<string>(GAME_SYSTEMS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

class DocumentReader {
  readonly issues: ValidationIssue[] = [];

  record(value: unknown, path: string): Record<string, unknown> | null {
    if (isRecord(value)) return value;
    this.issue(path, 'Expected an object');
    return null;
  }

  array(value: unknown, path: string): unknown[] | null {
    if (Array.isArray(value)) return value;
    this.issue(path, 'Expected an array');
    return null;
  }

  string(value: unknown, path: string): string {
    if (typeof value === 'string') return value;
    this.issue(path, 'Expected a string');
    return '';
  }

  optionalString(value: unknown, path: string): string | undefined {
    if (value === undefined) return undefined;
    return this.string(value, path);
  }

  nullableString(value: unknown, path: string): string | null {
    if (value === null) return null;
    return this.string(value, path);
  }

  number(value: unknown, path: string): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    this.issue(path, 'Expected a finite number');
    return 0;
  }

  integer(value: unknown, path: string): number {
    const parsed = this.number(value, path);
    if (Number.isInteger(parsed)) return parsed;
    if (typeof value === 'number' && Number.isFinite(value)) {
      this.issue(path, 'Expected an integer');
    }
    return 0;
  }

  nullableInteger(value: unknown, path: string): number | null {
    if (value === null) return null;
    return this.integer(value, path);
  }

  nullableNumber(value: unknown, path: string): number | null {
    if (value === null) return null;
    return this.number(value, path);
  }

  gameSystem(value: unknown, path: string): GameSystem {
    if (typeof value === 'string' && gameSystems.has(value)) return value as GameSystem;
    this.issue(path, `Expected one of: ${GAME_SYSTEMS.join(', ')}`);
    return 'Pathfinder 2e';
  }

  required(record: Record<string, unknown>, key: string, path: string): unknown {
    if (hasOwn(record, key)) return record[key];
    this.issue(`${path}.${key}`, 'Missing required property');
    return undefined;
  }

  issue(path: string, message: string): void {
    this.issues.push({ path, message });
  }
}

function readCharacter(reader: DocumentReader, value: unknown, path: string): Character {
  const item = reader.record(value, path) ?? {};
  return {
    orgplayid: reader.integer(reader.required(item, 'orgplayid', path), `${path}.orgplayid`),
    charid: reader.integer(reader.required(item, 'charid', path), `${path}.charid`),
    name: reader.string(reader.required(item, 'name', path), `${path}.name`),
    faction: reader.string(reader.required(item, 'faction', path), `${path}.faction`),
    game: reader.gameSystem(reader.required(item, 'game', path), `${path}.game`),
  };
}

function readSession(reader: DocumentReader, value: unknown, path: string): SessionDetail {
  const item = reader.record(value, path) ?? {};
  const points = reader.record(reader.required(item, 'points', path), `${path}.points`) ?? {};
  const event = reader.record(reader.required(item, 'event', path), `${path}.event`) ?? {};
  const player = reader.record(reader.required(item, 'player', path), `${path}.player`) ?? {};
  const character = reader.record(reader.required(item, 'character', path), `${path}.character`) ?? {};
  const faction = reader.record(reader.required(item, 'faction', path), `${path}.faction`) ?? {};
  const prestige = reader.record(
    reader.required(item, 'prestigeReputation', path),
    `${path}.prestigeReputation`,
  ) ?? {};
  const isGm = reader.required(prestige, 'isGM', `${path}.prestigeReputation`);
  if (isGm !== 'yes' && isGm !== 'no') {
    reader.issue(`${path}.prestigeReputation.isGM`, 'Expected "yes" or "no"');
  }
  const date = reader.optionalString(item.date, `${path}.date`);

  const result: SessionDetail = {
    ...(date === undefined ? {} : { date }),
    gm: reader.string(reader.required(item, 'gm', path), `${path}.gm`),
    scenario: reader.string(reader.required(item, 'scenario', path), `${path}.scenario`),
    gameSystem: reader.gameSystem(
      reader.required(item, 'gameSystem', path),
      `${path}.gameSystem`,
    ),
    points: {
      achievementPoints: reader.nullableNumber(
        reader.required(points, 'achievementPoints', `${path}.points`),
        `${path}.points.achievementPoints`,
      ),
      gmCredits: reader.nullableNumber(
        reader.required(points, 'gmCredits', `${path}.points`),
        `${path}.points.gmCredits`,
      ),
    },
    event: {
      id: reader.integer(reader.required(event, 'id', `${path}.event`), `${path}.event.id`),
      name: reader.string(reader.required(event, 'name', `${path}.event`), `${path}.event.name`),
    },
    session: reader.integer(reader.required(item, 'session', path), `${path}.session`),
    player: {
      orgplayid: reader.integer(
        reader.required(player, 'orgplayid', `${path}.player`),
        `${path}.player.orgplayid`,
      ),
      charid: reader.nullableInteger(
        reader.required(player, 'charid', `${path}.player`),
        `${path}.player.charid`,
      ),
    },
    character: {
      name: reader.string(
        reader.required(character, 'name', `${path}.character`),
        `${path}.character.name`,
      ),
    },
    faction: {
      name: reader.string(
        reader.required(faction, 'name', `${path}.faction`),
        `${path}.faction.name`,
      ),
    },
    prestigeReputation: {
      prestigePoints: reader.number(
        reader.required(prestige, 'prestigePoints', `${path}.prestigeReputation`),
        `${path}.prestigeReputation.prestigePoints`,
      ),
      isGM: isGm === 'yes' ? 'yes' : 'no',
    },
    notes: reader.nullableString(reader.required(item, 'notes', path), `${path}.notes`),
    xp: reader.number(reader.required(item, 'xp', path), `${path}.xp`),
  };
  return result;
}

function readLegacySummary(
  reader: DocumentReader,
  value: unknown,
  path: string,
): Record<string, LegacyCharacterSummary> {
  const record = reader.record(value, path) ?? {};
  const result = Object.create(null) as Record<string, LegacyCharacterSummary>;
  for (const [name, raw] of Object.entries(record)) {
    const entryPath = `${path}.${JSON.stringify(name)}`;
    const entry = reader.record(raw, entryPath) ?? {};
    result[name] = {
      xp: reader.number(reader.required(entry, 'xp', entryPath), `${entryPath}.xp`),
    };
  }
  return result;
}

function summarizeSessions(details: SessionDetail[]): Record<string, LegacyCharacterSummary> {
  const summary = Object.create(null) as Record<string, LegacyCharacterSummary>;
  for (const detail of details) {
    const name = detail.character.name;
    const current = hasOwn(summary, name) ? summary[name]!.xp : 0;
    summary[name] = { xp: current + detail.xp };
  }
  return summary;
}

/** Validate unknown input and return a normalized, detached PFXP document. */
export function validatePfxpDocument(input: unknown): ValidationResult<PfxpDocument> {
  const reader = new DocumentReader();
  const root = reader.record(input, '$') ?? {};
  const rawDetails = reader.array(reader.required(root, 'details', '$'), '$.details') ?? [];
  const rawCharacters = reader.array(reader.required(root, 'characters', '$'), '$.characters') ?? [];
  const details = rawDetails
    .map((item, index) => readSession(reader, item, `$.details[${index}]`))
    .filter((session) => !isAlreadyPlayedSessionNote(session.notes));
  const summary = readLegacySummary(reader, reader.required(root, 'summary', '$'), '$.summary');
  const value: PfxpDocument = {
    characters: rawCharacters.map((item, index) =>
      readCharacter(reader, item, `$.characters[${index}]`),
    ),
    details,
    summary: details.length === rawDetails.length ? summary : summarizeSessions(details),
  };

  return reader.issues.length > 0
    ? { ok: false, issues: reader.issues }
    : { ok: true, value };
}

/** True when a value is a complete, valid PFXP document. */
export function isPfxpDocument(input: unknown): input is PfxpDocument {
  return validatePfxpDocument(input).ok;
}

/** Error thrown by {@link parsePfxpDocument} for invalid imported data. */
export class PfxpDocumentValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    const first = issues[0];
    super(first ? `Invalid PFXP document at ${first.path}: ${first.message}` : 'Invalid PFXP document');
    this.name = 'PfxpDocumentValidationError';
    this.issues = issues;
  }
}

/** Parse JSON text or unknown data, throwing a detailed validation error on failure. */
export function parsePfxpDocument(input: string | unknown): PfxpDocument {
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Malformed JSON';
      throw new PfxpDocumentValidationError([{ path: '$', message }]);
    }
  }
  const result = validatePfxpDocument(parsed);
  if (!result.ok) throw new PfxpDocumentValidationError(result.issues);
  return result.value;
}

/** Build a stable character identity from org ID, character ID, and game. */
export function characterKey(
  orgplayid: number,
  charid: number | null,
  game: GameSystem,
): CharacterKey {
  return `${orgplayid}:${charid === null ? 'none' : charid}:${game}`;
}

/** Calculate the fractional effective level used by organized play. */
export function effectiveLevel(totalXp: number, game: GameSystem): number | null {
  let xpPerLevel: number;
  if (game === 'Pathfinder 2e' || game === 'Starfinder 2e') xpPerLevel = 12;
  else if (game === 'Pathfinder 1e' || game === 'Starfinder 1e') xpPerLevel = 3;
  else return null;
  return Math.round((1 + totalXp / xpPerLevel) * 100) / 100;
}

function laterDate(current: string | null, candidate: string | undefined): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentTime = Date.parse(current);
  const candidateTime = Date.parse(candidate);
  if (Number.isFinite(currentTime) && Number.isFinite(candidateTime)) {
    return candidateTime > currentTime ? candidate : current;
  }
  return candidate.localeCompare(current) > 0 ? candidate : current;
}

/** Aggregate roster and session data without conflating same-named characters. */
export function aggregateCharacterSummaries(document: PfxpDocument): CharacterSummary[] {
  const summaries = new Map<CharacterKey, CharacterSummary>();

  for (const character of document.characters) {
    const key = characterKey(character.orgplayid, character.charid, character.game);
    summaries.set(key, {
      key,
      orgplayid: character.orgplayid,
      charid: character.charid,
      character: character.name,
      faction: character.faction,
      game: character.game,
      totalXp: 0,
      effectiveLevel: effectiveLevel(0, character.game),
      sessionCount: 0,
      lastPlayed: null,
    });
  }

  for (const session of document.details) {
    const key = characterKey(
      session.player.orgplayid,
      session.player.charid,
      session.gameSystem,
    );
    const existing = summaries.get(key);
    const summary: CharacterSummary = existing ?? {
      key,
      orgplayid: session.player.orgplayid,
      charid: session.player.charid,
      character: session.character.name,
      faction: session.faction.name,
      game: session.gameSystem,
      totalXp: 0,
      effectiveLevel: effectiveLevel(0, session.gameSystem),
      sessionCount: 0,
      lastPlayed: null,
    };

    summary.totalXp += session.xp;
    summary.sessionCount += 1;
    summary.lastPlayed = laterDate(summary.lastPlayed, session.date);
    if (!summary.character && session.character.name) summary.character = session.character.name;
    if (!summary.faction && session.faction.name) summary.faction = session.faction.name;
    summary.effectiveLevel = effectiveLevel(summary.totalXp, summary.game);
    summaries.set(key, summary);
  }

  return [...summaries.values()].sort((left, right) =>
    left.character.localeCompare(right.character, undefined, { sensitivity: 'base', numeric: true })
      || left.game.localeCompare(right.game)
      || left.orgplayid - right.orgplayid
      || (left.charid ?? -1) - (right.charid ?? -1),
  );
}
