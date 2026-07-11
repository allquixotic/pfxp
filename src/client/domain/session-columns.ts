import type {
  ColDef,
  ICellRendererParams,
  ValueFormatterParams,
} from 'ag-grid-community';

import type { SessionDetail } from './models';
import { compactGameSystem, formatShortDate, scenarioDisplayName } from './display-format';

export const SESSION_COLUMN_ORDER = [
  'date',
  'character.name',
  'gameSystem',
  'scenario',
  'xp',
  'gm',
  'prestigeReputation.isGM',
  'event.name',
  'faction.name',
  'notes',
  'event.id',
  'session',
  'player.orgplayid',
  'player.charid',
  'prestigeReputation.prestigePoints',
  'points.achievementPoints',
  'points.gmCredits',
] as const;

export type SessionColumnId = (typeof SESSION_COLUMN_ORDER)[number];
export type SessionPreset = 'simple' | 'default' | 'full' | 'custom';

export interface SessionColumnMeta {
  id: SessionColumnId;
  label: string;
  description: string;
  fullOnly?: boolean;
}

export const SESSION_COLUMN_META: readonly SessionColumnMeta[] = [
  { id: 'date', label: 'Date', description: 'Date the session was reported' },
  { id: 'character.name', label: 'Character', description: 'Reported character name' },
  { id: 'gameSystem', label: 'Game system', description: 'Pathfinder or Starfinder ruleset' },
  { id: 'scenario', label: 'Scenario', description: 'Scenario or adventure title' },
  { id: 'xp', label: 'XP', description: 'Experience earned from the session' },
  { id: 'gm', label: 'GM', description: 'Game master name' },
  { id: 'prestigeReputation.isGM', label: 'GM?', description: 'Whether this record was GM credit' },
  { id: 'event.name', label: 'Event', description: 'Organized Play event name' },
  { id: 'faction.name', label: 'Faction', description: 'Character faction' },
  { id: 'notes', label: 'Notes', description: 'Reporting notes from Paizo' },
  { id: 'event.id', label: 'Event ID', description: 'Paizo event identifier' },
  { id: 'session', label: 'Session #', description: 'Session number within the event' },
  { id: 'player.orgplayid', label: 'Organized Play ID', description: 'Player Organized Play identifier' },
  { id: 'player.charid', label: 'Character ID', description: 'Character number within the Organized Play account' },
  { id: 'prestigeReputation.prestigePoints', label: 'Prestige / Rep.', description: 'Reported prestige or reputation value' },
  {
    id: 'points.achievementPoints',
    label: 'Achievement Points',
    description: 'Achievement Points awarded by Paizo',
    fullOnly: true,
  },
  {
    id: 'points.gmCredits',
    label: 'GM Credits',
    description: 'Game Master credits awarded by Paizo',
    fullOnly: true,
  },
] as const;

export const SESSION_PRESET_COLUMNS: Readonly<
  Record<Exclude<SessionPreset, 'custom'>, readonly SessionColumnId[]>
> = {
  simple: [
    'date',
    'character.name',
    'gameSystem',
    'scenario',
    'xp',
    'notes',
  ],
  default: [
    'date',
    'character.name',
    'gameSystem',
    'scenario',
    'xp',
    'gm',
    'event.name',
    'faction.name',
    'notes',
  ],
  full: SESSION_COLUMN_ORDER,
};

const TEXT_FILTER_PARAMS = {
  buttons: ['reset'],
  caseSensitive: false,
  debounceMs: 220,
  maxNumConditions: 2,
  trimInput: true,
};

const NUMBER_FILTER_PARAMS = {
  buttons: ['reset'],
  debounceMs: 220,
  maxNumConditions: 2,
};

function isVisibleForPreset(id: SessionColumnId, preset: SessionPreset): boolean {
  const resolvedPreset = preset === 'custom' ? 'default' : preset;
  return SESSION_PRESET_COLUMNS[resolvedPreset].includes(id);
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function formatNumber(params: ValueFormatterParams<SessionDetail, number | null>): string {
  return params.value == null ? '' : String(params.value);
}

function makeBadge(label: string, className: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = className;
  badge.textContent = label;
  return badge;
}

function systemRenderer(params: ICellRendererParams<SessionDetail, string>): HTMLSpanElement | string {
  const rawValue = text(params.value);
  const value = text(params.valueFormatted ?? params.value);
  if (!rawValue) return '';

  const tone = rawValue.toLowerCase().includes('starfinder')
    ? 'starfinder'
    : value.toLowerCase().includes('pathfinder')
      ? 'pathfinder'
      : 'neutral';

  return makeBadge(value, `session-cell-badge session-cell-badge--${tone}`);
}

function gmCreditRenderer(params: ICellRendererParams<SessionDetail, string>): HTMLSpanElement | string {
  const value = text(params.value);
  if (!value) return '';

  const tone = value === 'Yes' ? 'positive' : 'neutral';
  return makeBadge(value, `session-cell-badge session-cell-badge--${tone}`);
}

/**
 * Stable client-side identity used by GridState row selection restoration.
 * The source has no single session primary key, so all server identifiers are
 * included before the human-readable scenario fallback.
 */
export function getSessionRowId(detail: SessionDetail): string {
  return [
    detail.date ?? '',
    detail.event.id,
    detail.session,
    detail.player.orgplayid,
    detail.player.charid ?? 'gm',
    detail.character.name,
    detail.scenario,
  ].join('::');
}

/**
 * Creates the complete Community-edition column model. Presets only control
 * initial visibility; widths, ordering, sorting, filtering, resizing, and
 * pinning remain normal AG Grid state and are persisted by SessionsGrid.
 */
export function createSessionColumnDefs(
  preset: SessionPreset = 'default',
  options: { compact?: () => boolean } = {},
): ColDef<SessionDetail>[] {
  const hidden = (id: SessionColumnId) => !isVisibleForPreset(id, preset);
  const compact = () => options.compact?.() === true;

  return [
    {
      colId: 'date',
      headerName: 'Date',
      valueGetter: ({ data }) => data?.date,
      valueFormatter: ({ value }) => compact() ? formatShortDate(value) : text(value),
      cellDataType: 'dateString',
      filter: 'agDateColumnFilter',
      filterParams: {
        browserDatePicker: true,
        buttons: ['reset'],
        debounceMs: 120,
        maxNumConditions: 2,
      },
      sort: 'desc',
      sortIndex: 0,
      width: 126,
      minWidth: 28,
      hide: hidden('date'),
      tooltipValueGetter: ({ value }) => text(value),
    },
    {
      colId: 'character.name',
      headerName: 'Character',
      valueGetter: ({ data }) => data?.character.name ?? '',
      cellDataType: 'text',
      filter: 'agTextColumnFilter',
      filterParams: TEXT_FILTER_PARAMS,
      width: 196,
      minWidth: 28,
      hide: hidden('character.name'),
      tooltipValueGetter: ({ data, value }) => {
        if (!data) return text(value);
        const characterId = data.player.charid ?? '—';
        return `${text(value)}\nOP ID ${data.player.orgplayid}·${characterId}`;
      },
    },
    {
      colId: 'gameSystem',
      headerName: 'Game System',
      valueGetter: ({ data }) => data?.gameSystem ?? '',
      cellDataType: 'text',
      filter: 'agTextColumnFilter',
      filterParams: TEXT_FILTER_PARAMS,
      cellRenderer: systemRenderer,
      valueFormatter: ({ value }) => compact() ? compactGameSystem(text(value)) : text(value),
      width: 172,
      minWidth: 28,
      hide: hidden('gameSystem'),
      tooltipValueGetter: ({ value }) => text(value),
    },
    {
      colId: 'scenario',
      headerName: 'Scenario',
      valueGetter: ({ data }) => data?.scenario ?? '',
      cellDataType: 'text',
      filter: 'agTextColumnFilter',
      filterParams: TEXT_FILTER_PARAMS,
      valueFormatter: ({ value }) => scenarioDisplayName(text(value)),
      width: 330,
      minWidth: 28,
      hide: hidden('scenario'),
      tooltipValueGetter: ({ value }) => scenarioDisplayName(text(value)),
    },
    {
      colId: 'xp',
      headerName: 'XP',
      valueGetter: ({ data }) => data?.xp ?? null,
      cellDataType: 'number',
      filter: 'agNumberColumnFilter',
      filterParams: NUMBER_FILTER_PARAMS,
      valueFormatter: formatNumber,
      type: 'numericColumn',
      width: 88,
      minWidth: 28,
      hide: hidden('xp'),
    },
    {
      colId: 'gm',
      headerName: 'GM',
      valueGetter: ({ data }) => data?.gm ?? '',
      cellDataType: 'text',
      filter: 'agTextColumnFilter',
      filterParams: TEXT_FILTER_PARAMS,
      width: 180,
      minWidth: 28,
      hide: hidden('gm'),
      tooltipValueGetter: ({ value }) => text(value),
    },
    {
      colId: 'prestigeReputation.isGM',
      headerName: 'GM?',
      headerTooltip: 'Whether this row represents Game Master credit',
      valueGetter: ({ data }) => {
        const value: unknown = data?.prestigeReputation.isGM;
        if (value === 'yes' || value === true) return 'Yes';
        if (value === 'no' || value === false) return 'No';
        return '';
      },
      cellDataType: 'text',
      filter: 'agTextColumnFilter',
      filterParams: TEXT_FILTER_PARAMS,
      cellRenderer: gmCreditRenderer,
      width: 96,
      minWidth: 28,
      hide: hidden('prestigeReputation.isGM'),
    },
    {
      colId: 'event.name',
      headerName: 'Event',
      valueGetter: ({ data }) => data?.event.name ?? '',
      cellDataType: 'text',
      filter: 'agTextColumnFilter',
      filterParams: TEXT_FILTER_PARAMS,
      width: 240,
      minWidth: 28,
      hide: hidden('event.name'),
      tooltipValueGetter: ({ data, value }) => data
        ? `${text(value)}\nEvent ID ${data.event.id}`
        : text(value),
    },
    {
      colId: 'faction.name',
      headerName: 'Faction',
      valueGetter: ({ data }) => data?.faction.name ?? '',
      cellDataType: 'text',
      filter: 'agTextColumnFilter',
      filterParams: TEXT_FILTER_PARAMS,
      width: 190,
      minWidth: 28,
      hide: hidden('faction.name'),
      tooltipValueGetter: ({ value }) => text(value),
    },
    {
      colId: 'notes',
      headerName: 'Notes',
      valueGetter: ({ data }) => data?.notes ?? '',
      cellDataType: 'text',
      filter: 'agTextColumnFilter',
      filterParams: TEXT_FILTER_PARAMS,
      width: 300,
      minWidth: 28,
      hide: hidden('notes'),
      tooltipValueGetter: ({ value }) => text(value),
    },
    {
      colId: 'event.id',
      headerName: 'Event ID',
      valueGetter: ({ data }) => data?.event.id ?? null,
      cellDataType: 'number',
      filter: 'agNumberColumnFilter',
      filterParams: NUMBER_FILTER_PARAMS,
      valueFormatter: formatNumber,
      type: 'numericColumn',
      width: 120,
      minWidth: 28,
      hide: hidden('event.id'),
    },
    {
      colId: 'session',
      headerName: 'Session #',
      valueGetter: ({ data }) => data?.session ?? null,
      cellDataType: 'number',
      filter: 'agNumberColumnFilter',
      filterParams: NUMBER_FILTER_PARAMS,
      valueFormatter: formatNumber,
      type: 'numericColumn',
      width: 116,
      minWidth: 28,
      hide: hidden('session'),
    },
    {
      colId: 'player.orgplayid',
      headerName: 'Organized Play ID',
      valueGetter: ({ data }) => data?.player.orgplayid ?? null,
      cellDataType: 'number',
      filter: 'agNumberColumnFilter',
      filterParams: NUMBER_FILTER_PARAMS,
      valueFormatter: formatNumber,
      type: 'numericColumn',
      width: 162,
      minWidth: 28,
      hide: hidden('player.orgplayid'),
    },
    {
      colId: 'player.charid',
      headerName: 'Character ID',
      valueGetter: ({ data }) => data?.player.charid ?? null,
      cellDataType: 'number',
      filter: 'agNumberColumnFilter',
      filterParams: NUMBER_FILTER_PARAMS,
      valueFormatter: formatNumber,
      type: 'numericColumn',
      width: 132,
      minWidth: 28,
      hide: hidden('player.charid'),
    },
    {
      colId: 'prestigeReputation.prestigePoints',
      headerName: 'Prestige / Rep.',
      valueGetter: ({ data }) => data?.prestigeReputation.prestigePoints ?? null,
      cellDataType: 'number',
      filter: 'agNumberColumnFilter',
      filterParams: NUMBER_FILTER_PARAMS,
      valueFormatter: formatNumber,
      type: 'numericColumn',
      width: 148,
      minWidth: 28,
      hide: hidden('prestigeReputation.prestigePoints'),
    },
    {
      colId: 'points.achievementPoints',
      headerName: 'Achievement Points',
      valueGetter: ({ data }) => data?.points.achievementPoints ?? null,
      cellDataType: 'number',
      filter: 'agNumberColumnFilter',
      filterParams: NUMBER_FILTER_PARAMS,
      valueFormatter: formatNumber,
      type: 'numericColumn',
      width: 170,
      minWidth: 28,
      hide: hidden('points.achievementPoints'),
    },
    {
      colId: 'points.gmCredits',
      headerName: 'GM Credits',
      valueGetter: ({ data }) => data?.points.gmCredits ?? null,
      cellDataType: 'number',
      filter: 'agNumberColumnFilter',
      filterParams: NUMBER_FILTER_PARAMS,
      valueFormatter: formatNumber,
      type: 'numericColumn',
      width: 130,
      minWidth: 28,
      hide: hidden('points.gmCredits'),
    },
  ];
}
