export const CHARACTER_COLUMN_ORDER = [
  'name',
  'gameSystem',
  'totalXp',
  'effectiveLevel',
  'sessionCount',
  'lastPlayed',
  'orgplayid',
  'charid',
] as const;

export type CharacterColumnId = (typeof CHARACTER_COLUMN_ORDER)[number];
export type CharacterPreset = 'simple' | 'default' | 'full' | 'custom';

export const CHARACTER_COLUMN_LABELS: Readonly<Record<CharacterColumnId, string>> = {
  name: 'Character',
  gameSystem: 'Game system',
  totalXp: 'XP',
  effectiveLevel: 'Level',
  sessionCount: 'Sessions',
  lastPlayed: 'Last played',
  orgplayid: 'Org ID',
  charid: 'Character ID',
};

export const CHARACTER_PRESET_COLUMNS: Readonly<
  Record<Exclude<CharacterPreset, 'custom'>, readonly CharacterColumnId[]>
> = {
  simple: ['name', 'gameSystem', 'totalXp', 'effectiveLevel'],
  default: ['name', 'gameSystem', 'totalXp', 'effectiveLevel', 'sessionCount', 'lastPlayed'],
  full: CHARACTER_COLUMN_ORDER,
};
