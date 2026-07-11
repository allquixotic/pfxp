<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { copyToClipboard as copyTextToClipboard, useQuasar } from 'quasar';
import { AgGridVue } from 'ag-grid-vue3';
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  colorSchemeLight,
  themeQuartz,
  type CellKeyDownEvent,
  type ColDef,
  type Column,
  type ColumnMovedEvent,
  type ColumnResizedEvent,
  type ColumnVisibleEvent,
  type FilterChangedEvent,
  type FilterModel,
  type FirstDataRenderedEvent,
  type GetRowIdFunc,
  type GridApi,
  type GridReadyEvent,
  type GridState,
  type ICellRendererParams,
  type ModelUpdatedEvent,
  type RowSelectionOptions,
  type SelectionChangedEvent,
  type StateUpdatedEvent,
  type ValueFormatterParams,
} from 'ag-grid-community';
import localforage from 'localforage';

import ContextActionMenu from './ContextActionMenu.vue';
import type { ContextMenuAction, ContextMenuTrigger } from './context-menu-model';
import type { CharacterSummaryView } from './CharacterSummary.vue';
import {
  CHARACTER_COLUMN_LABELS,
  CHARACTER_COLUMN_ORDER,
  CHARACTER_PRESET_COLUMNS,
  compactGameSystem,
  formatEffectiveLevel,
  formatShortDate,
  type CharacterColumnId,
  type CharacterPreset,
} from '../domain';
import {
  AutoColumnSizer,
  downloadTableViewCsv,
  downloadTableViewXlsx,
  getGridTableExportView,
  type TableExportView,
} from '../services';

ModuleRegistry.registerModules([AllCommunityModule]);

const props = withDefaults(defineProps<{
  rows: CharacterSummaryView[];
  dark?: boolean;
  density?: 'compact' | 'comfortable';
  preset?: CharacterPreset;
}>(), {
  dark: false,
  density: 'comfortable',
  preset: 'default',
});

const emit = defineEmits<{
  select: [row: CharacterSummaryView];
  presetCustomized: [];
  filterModelChanged: [model: FilterModel];
  filteredCount: [count: number];
}>();
const $q = useQuasar();
const characterPreferences = localforage.createInstance({ name: 'pfxp' });
const gridApi = shallowRef<GridApi<CharacterSummaryView> | null>(null);
const gridRoot = ref<HTMLElement | null>(null);
const contextMenu = ref<InstanceType<typeof ContextActionMenu> | null>(null);
const persistedState = shallowRef<GridState>();
const stateReady = ref(false);
const contextRevision = ref(0);
const STATE_KEY = 'pfxp:v3:characterGridState';
const LEGACY_STATE_KEY = 'pfxp:v2:characterGridState';
const floatingFiltersVisible = ref(false);
const restoredManualColumns = ref<string[]>([]);

interface StoredCharacterGridState {
  state: GridState;
  manualColumns: string[];
}

interface CharacterContextTarget {
  anchor: HTMLElement;
  kind: 'cell' | 'header' | 'row' | 'grid';
  columnId: string | null;
  row: CharacterSummaryView | null;
  cellText: string;
}

const contextTarget = shallowRef<CharacterContextTarget | null>(null);

const densityMetrics = computed(() => props.density === 'compact'
  ? {
      rowHeight: 32,
      headerHeight: 38,
      floatingFilterHeight: 34,
      fontSize: 12,
      spacing: 5,
      cellHorizontalPadding: 10,
    }
  : {
      rowHeight: 42,
      headerHeight: 44,
      floatingFilterHeight: 40,
      fontSize: 13,
      spacing: 7,
      cellHorizontalPadding: 14,
    });

const columnSizer = new AutoColumnSizer<CharacterSummaryView>({
  api: () => gridApi.value,
  root: () => gridRoot.value,
  fontSize: () => densityMetrics.value.fontSize,
  horizontalPadding: () => densityMetrics.value.cellHorizontalPadding,
  onManualColumnsChanged: () => {
    const state = gridApi.value?.getState();
    if (state) scheduleStateWrite(state);
  },
});

const gridTheme = computed(() => {
  const colors = props.dark
    ? {
        backgroundColor: '#111823',
        chromeBackgroundColor: '#151e2b',
        foregroundColor: '#e5eaf2',
        headerBackgroundColor: '#172231',
        headerTextColor: '#b9c4d4',
        borderColor: '#2b3748',
        oddRowBackgroundColor: '#131c28',
        rowHoverColor: 'rgba(122, 162, 255, 0.12)',
        selectedRowBackgroundColor: 'rgba(122, 162, 255, 0.2)',
      }
    : {
        backgroundColor: '#ffffff',
        chromeBackgroundColor: '#f7f9fc',
        foregroundColor: '#172033',
        headerBackgroundColor: '#f4f7fb',
        headerTextColor: '#475569',
        borderColor: '#dce3ec',
        oddRowBackgroundColor: '#fbfcfe',
        rowHoverColor: 'rgba(21, 84, 232, 0.07)',
        selectedRowBackgroundColor: 'rgba(21, 84, 232, 0.13)',
      };

  const baseTheme = props.dark
    ? themeQuartz.withPart(colorSchemeDark)
    : themeQuartz.withPart(colorSchemeLight);

  return baseTheme.withParams({
    ...colors,
    accentColor: props.dark ? '#7aa2ff' : '#1554e8',
    browserColorScheme: props.dark ? 'dark' : 'light',
    cellFontSize: densityMetrics.value.fontSize,
    cellHorizontalPadding: densityMetrics.value.cellHorizontalPadding,
    columnBorder: false,
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: densityMetrics.value.fontSize,
    headerColumnBorder: true,
    headerColumnResizeHandleColor: props.dark ? '#59677a' : '#a8b2c1',
    headerFontSize: 12,
    headerFontWeight: 650,
    headerHeight: densityMetrics.value.headerHeight,
    rowBorder: true,
    rowHeight: densityMetrics.value.rowHeight,
    spacing: densityMetrics.value.spacing,
    wrapperBorder: false,
    wrapperBorderRadius: 0,
  });
});

function gameClass(system: string): string {
  if (system.includes('Starfinder')) return 'pfxp-game--sf';
  if (system.includes('Pathfinder 1')) return 'pfxp-game--pf1';
  if (!system.includes('Pathfinder')) return 'pfxp-game--other';
  return '';
}

function gameRenderer(params: ICellRendererParams<CharacterSummaryView, string>): HTMLElement {
  const badge = document.createElement('span');
  badge.className = ['pfxp-game', gameClass(params.value ?? '')].filter(Boolean).join(' ');
  badge.textContent = params.valueFormatted || params.value || 'Unknown';
  return badge;
}

function xpRenderer(params: ICellRendererParams<CharacterSummaryView, number>): HTMLElement {
  const value = document.createElement('strong');
  value.className = 'character-grid__xp';
  value.textContent = Number.isFinite(params.value) ? String(params.value) : '—';
  return value;
}

function numericLevel(value: number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLastPlayed(value?: string): string {
  return formatShortDate(value) || '—';
}

const columnDefs: ColDef<CharacterSummaryView>[] = [
  {
    colId: 'name',
    field: 'name',
    headerName: 'Character',
    filter: 'agTextColumnFilter',
    minWidth: 28,
    width: 190,
    pinned: 'left',
    tooltipField: 'name',
  },
  {
    colId: 'gameSystem',
    field: 'gameSystem',
    headerName: 'Game system',
    filter: 'agTextColumnFilter',
    cellRenderer: gameRenderer,
    valueFormatter: ({ value }) => props.density === 'compact'
      ? compactGameSystem(String(value ?? ''))
      : String(value ?? ''),
    minWidth: 28,
    width: 190,
  },
  {
    colId: 'totalXp',
    field: 'totalXp',
    headerName: 'XP',
    filter: 'agNumberColumnFilter',
    cellRenderer: xpRenderer,
    sort: 'desc',
    type: 'numericColumn',
    minWidth: 28,
    width: 100,
  },
  {
    colId: 'effectiveLevel',
    headerName: 'Level',
    filter: 'agNumberColumnFilter',
    filterValueGetter: ({ data }) => numericLevel(data?.effectiveLevel),
    getQuickFilterText: ({ data }) => data
      ? formatEffectiveLevel(data.totalXp, data.gameSystem as Parameters<typeof formatEffectiveLevel>[1])
      : '',
    valueGetter: ({ data }) => numericLevel(data?.effectiveLevel),
    valueFormatter: ({ data }) => data
      ? formatEffectiveLevel(data.totalXp, data.gameSystem as Parameters<typeof formatEffectiveLevel>[1])
      : 'N/A',
    type: 'numericColumn',
    minWidth: 28,
    width: 104,
  },
  {
    colId: 'sessionCount',
    field: 'sessionCount',
    headerName: 'Sessions',
    filter: 'agNumberColumnFilter',
    type: 'numericColumn',
    minWidth: 28,
    width: 120,
  },
  {
    colId: 'lastPlayed',
    field: 'lastPlayed',
    headerName: 'Last played',
    filter: 'agDateColumnFilter',
    filterValueGetter: ({ data }) => parseDate(data?.lastPlayed),
    comparator: (left, right) => (parseDate(left)?.getTime() ?? 0) - (parseDate(right)?.getTime() ?? 0),
    getQuickFilterText: ({ data }) => {
      const value = data?.lastPlayed;
      return `${String(value ?? '')} ${formatLastPlayed(value)}`;
    },
    valueFormatter: ({ value }) => formatLastPlayed(value),
    minWidth: 28,
    width: 154,
  },
  {
    colId: 'orgplayid',
    field: 'orgplayid',
    headerName: 'Org ID',
    filter: 'agNumberColumnFilter',
    type: 'numericColumn',
    minWidth: 28,
    width: 124,
  },
  {
    colId: 'charid',
    field: 'charid',
    headerName: 'Character ID',
    filter: 'agNumberColumnFilter',
    type: 'numericColumn',
    minWidth: 28,
    width: 138,
  },
];

const defaultColDef = computed<ColDef<CharacterSummaryView>>(() => ({
  filter: true,
  floatingFilter: floatingFiltersVisible.value,
  lockPinned: false,
  resizable: true,
  sortable: true,
  suppressHeaderFilterButton: false,
  suppressHeaderMenuButton: false,
  suppressMovable: false,
  unSortIcon: true,
}));

const rowSelection: RowSelectionOptions<CharacterSummaryView> = {
  mode: 'singleRow',
  checkboxes: false,
  enableClickSelection: true,
};

const getRowId: GetRowIdFunc<CharacterSummaryView> = ({ data }) => data.key;

let persistenceEnabled = false;
let stateTimer: ReturnType<typeof setTimeout> | undefined;
let pendingState: GridState | undefined;
let suppressPresetCustomization = true;
let presetCustomized = props.preset === 'custom';
let lastFilteredCount = -1;

function persistableState(state: GridState): GridState {
  const {
    focusedCell: _focusedCell,
    rowSelection: _rowSelection,
    scroll: _scroll,
    ...preferences
  } = state;
  return preferences;
}

async function hydrateState(): Promise<void> {
  try {
    const stored = await characterPreferences.getItem<unknown>(STATE_KEY)
      ?? await characterPreferences.getItem<unknown>(LEGACY_STATE_KEY);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const candidate = stored as Partial<StoredCharacterGridState>;
      if (candidate.state && typeof candidate.state === 'object') {
        persistedState.value = candidate.state;
        restoredManualColumns.value = Array.isArray(candidate.manualColumns)
          ? candidate.manualColumns.filter((value): value is string => typeof value === 'string')
          : [];
      } else {
        persistedState.value = stored as GridState;
      }
    }
  } catch (error) {
    console.warn('Unable to restore character grid preferences.', error);
  } finally {
    stateReady.value = true;
  }
}

async function writeState(state: GridState): Promise<void> {
  try {
    await characterPreferences.setItem<StoredCharacterGridState>(STATE_KEY, {
      state: persistableState(state),
      manualColumns: columnSizer.getManualColumns(),
    });
  } catch (error) {
    console.warn('Unable to save character grid preferences.', error);
  }
}

function scheduleStateWrite(state: GridState): void {
  if (!persistenceEnabled) return;
  pendingState = state;
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    stateTimer = undefined;
    const nextState = pendingState;
    pendingState = undefined;
    if (nextState) void writeState(nextState);
  }, 320);
}

function releasePresetSuppression(): void {
  requestAnimationFrame(() => {
    suppressPresetCustomization = false;
  });
}

function markPresetCustomized(): void {
  if (suppressPresetCustomization || presetCustomized) return;
  presetCustomized = true;
  emit('presetCustomized');
}

function emitFilteredCount(api: GridApi<CharacterSummaryView>): void {
  const count = api.getDisplayedRowCount();
  if (count === lastFilteredCount) return;
  lastFilteredCount = count;
  emit('filteredCount', count);
}

function applyPreset(preset: CharacterPreset): boolean {
  const api = gridApi.value;
  if (!api || preset === 'custom') return false;
  suppressPresetCustomization = true;
  presetCustomized = false;
  const visible = new Set<CharacterColumnId>(CHARACTER_PRESET_COLUMNS[preset]);
  const applied = api.applyColumnState({
    applyOrder: true,
    state: CHARACTER_COLUMN_ORDER.map((colId) => ({ colId, hide: !visible.has(colId) })),
  });
  scheduleStateWrite(api.getState());
  columnSizer.schedule();
  releasePresetSuppression();
  return applied;
}

function getColumns(): Array<{ id: string; label: string; visible: boolean }> {
  const api = gridApi.value;
  if (!api) return CHARACTER_COLUMN_ORDER.map((id) => ({
    id,
    label: CHARACTER_COLUMN_LABELS[id],
    visible: CHARACTER_PRESET_COLUMNS.default.includes(id),
  }));
  return api.getAllGridColumns().map((column) => ({
    id: column.getColId(),
    label: columnLabel(api, column),
    visible: column.isVisible(),
  }));
}

function setColumnVisible(id: string, visible: boolean): boolean {
  const api = gridApi.value;
  const column = api?.getColumn(id);
  if (!api || !column) return false;
  if (!visible && api.getAllDisplayedColumns().length <= 1) return false;
  api.setColumnsVisible([column], visible);
  markPresetCustomized();
  scheduleStateWrite(api.getState());
  if (visible) columnSizer.schedule();
  return true;
}

function moveColumn(id: string, index: number): boolean {
  const api = gridApi.value;
  const column = api?.getColumn(id);
  if (!api || !column) return false;
  const target = Math.max(0, Math.min(CHARACTER_COLUMN_ORDER.length - 1, Math.trunc(index)));
  api.moveColumns([column], target);
  markPresetCustomized();
  scheduleStateWrite(api.getState());
  return true;
}

function autoSizeColumns(): void {
  columnSizer.fitAllColumns();
  const state = gridApi.value?.getState();
  if (state) scheduleStateWrite(state);
}

function fitColumns(): void {
  const api = gridApi.value;
  if (!api) return;
  columnSizer.markDisplayedColumnsManual();
  api.sizeColumnsToFit();
  markPresetCustomized();
  scheduleStateWrite(api.getState());
}

function setFloatingFilters(visible: boolean): boolean {
  if (floatingFiltersVisible.value === visible) return visible;
  floatingFiltersVisible.value = visible;
  const api = gridApi.value;
  void nextTick(() => {
    if (!api || api !== gridApi.value) return;
    api.setGridOption('defaultColDef', defaultColDef.value);
    api.refreshHeader();
  });
  return visible;
}

function clearFilters(): void {
  const api = gridApi.value;
  if (!api) return;
  api.setFilterModel(null);
  emit('filterModelChanged', {});
  scheduleStateWrite(api.getState());
}

function resetGrid(): void {
  const api = gridApi.value;
  if (!api) return;
  suppressPresetCustomization = true;
  presetCustomized = false;
  api.resetColumnState();
  api.setFilterModel(null);
  api.deselectAll();
  columnSizer.setManualColumns([]);
  applyPreset('default');
  emit('filterModelChanged', {});
  emitFilteredCount(api);
  columnSizer.schedule();
  scheduleStateWrite(api.getState());
}

function getCurrentRows(): CharacterSummaryView[] {
  const api = gridApi.value;
  if (!api) return [...props.rows];
  const rows: CharacterSummaryView[] = [];
  api.forEachNodeAfterFilterAndSort((node) => {
    if (node.data) rows.push(node.data);
  });
  return rows;
}

function getExportView(): TableExportView | null {
  const api = gridApi.value;
  return api ? getGridTableExportView(api, 'Characters') : null;
}

function exportCsv(fileName = 'pfxp-characters.csv'): void {
  const view = getExportView();
  if (view) downloadTableViewCsv(view, fileName);
}

async function exportXlsx(fileName = 'pfxp-characters.xlsx'): Promise<void> {
  const view = getExportView();
  if (!view) return;
  try {
    await downloadTableViewXlsx(view, fileName);
  } catch {
    $q.notify({ message: 'Unable to create the Excel workbook.', color: 'negative', icon: 'r_error' });
  }
}

function resize(): void {
  requestAnimationFrame(() => {
    gridApi.value?.refreshHeader();
    gridApi.value?.redrawRows();
  });
}

function onGridReady(event: GridReadyEvent<CharacterSummaryView>): void {
  gridApi.value = event.api;
  event.api.setGridAriaProperty('label', 'Character XP summary');
  columnSizer.setManualColumns(restoredManualColumns.value, false);
  if (!persistedState.value && props.preset !== 'custom') applyPreset(props.preset);
  else releasePresetSuppression();
  emitFilteredCount(event.api);
  columnSizer.schedule();
  requestAnimationFrame(() => {
    persistenceEnabled = true;
  });
}

function onStateUpdated(event: StateUpdatedEvent<CharacterSummaryView>): void {
  scheduleStateWrite(event.state);
}

function onFirstDataRendered(event: FirstDataRenderedEvent<CharacterSummaryView>): void {
  emitFilteredCount(event.api);
  columnSizer.schedule();
}

function onModelUpdated(event: ModelUpdatedEvent<CharacterSummaryView>): void {
  emitFilteredCount(event.api);
  columnSizer.schedule();
}

function onFilterChanged(event: FilterChangedEvent<CharacterSummaryView>): void {
  emit('filterModelChanged', event.api.getFilterModel());
  emitFilteredCount(event.api);
  columnSizer.schedule();
}

function onColumnResized(event: ColumnResizedEvent<CharacterSummaryView>): void {
  if (!event.finished) return;
  if (event.source === 'uiColumnResized') {
    const columns = event.columns ?? (event.column ? [event.column] : []);
    columnSizer.markManual(columns.map((column) => column.getColId()));
  }
  if (event.source === 'uiColumnResized') markPresetCustomized();
}

function onColumnMoved(event: ColumnMovedEvent<CharacterSummaryView>): void {
  if (event.finished && event.source.startsWith('ui')) markPresetCustomized();
}

function onColumnVisible(event: ColumnVisibleEvent<CharacterSummaryView>): void {
  if (event.source.startsWith('ui') || event.source === 'columnMenu') markPresetCustomized();
  if (event.visible !== false) columnSizer.schedule();
}

function onSelectionChanged(event: SelectionChangedEvent<CharacterSummaryView>): void {
  const row = event.selectedNodes?.[0]?.data;
  if (row) emit('select', row);
}

function onCellKeyDown(event: CellKeyDownEvent<CharacterSummaryView>): void {
  if (!(event.event instanceof KeyboardEvent) || !['Enter', ' '].includes(event.event.key)) return;
  event.event.preventDefault();
  event.node.setSelected(true, true);
}

function columnLabel(api: GridApi<CharacterSummaryView>, column: Column): string {
  return api.getDisplayNameForColumn(column, 'columnToolPanel') || column.getColId();
}

function clippedCaption(value: string): string {
  return value.length > 72 ? `${value.slice(0, 69)}…` : value;
}

const contextMenuTitle = computed(() => {
  const target = contextTarget.value;
  if (!target) return 'Character table';
  if (target.row) return target.row.name;

  const api = gridApi.value;
  const column = target.columnId ? api?.getColumn(target.columnId) : null;
  return api && column ? columnLabel(api, column) : 'Character table';
});

const contextMenuSubtitle = computed(() => {
  const target = contextTarget.value;
  if (!target) return 'Table actions';

  const api = gridApi.value;
  const column = target.columnId ? api?.getColumn(target.columnId) : null;
  if (target.kind === 'cell' && api && column) {
    const value = target.cellText ? ` · ${clippedCaption(target.cellText)}` : '';
    return `${columnLabel(api, column)}${value}`;
  }
  if (target.kind === 'header') return 'Column actions';
  if (target.row) return `${target.row.gameSystem} · ${target.row.sessionCount} sessions`;
  return 'Table actions';
});

const contextActions = computed<ContextMenuAction[]>(() => {
  // AG Grid's API is intentionally shallow. The revision makes menu checkmarks
  // and disabled states react immediately after a context action mutates it.
  void contextRevision.value;

  const api = gridApi.value;
  const target = contextTarget.value;
  if (!api || !target) return [];

  const columns = api.getAllGridColumns();
  const column = target.columnId ? api.getColumn(target.columnId) : null;
  const columnIndex = column
    ? columns.findIndex((candidate) => candidate.getColId() === column.getColId())
    : -1;
  const visibleCount = columns.filter((candidate) => candidate.isVisible()).length;
  const actions: ContextMenuAction[] = [];

  if (target.row) {
    actions.push({
      id: 'show-sessions',
      label: 'Show this character’s sessions',
      icon: 'r_open_in_new',
      caption: `${target.row.sessionCount} sessions`,
    });

    const copyActions: ContextMenuAction[] = [];
    if (target.kind === 'cell') {
      copyActions.push({
        id: 'copy-cell',
        label: 'Copy cell value',
        icon: 'r_content_copy',
        caption: target.cellText ? clippedCaption(target.cellText) : 'No value',
        disabled: !target.cellText,
      });
    }
    copyActions.push(
      {
        id: 'copy-name',
        label: 'Copy character name',
        icon: 'r_badge',
        caption: clippedCaption(target.row.name),
      },
      {
        id: 'copy-org-id',
        label: 'Copy Org ID',
        icon: 'r_content_copy',
        caption: target.row.orgplayid == null ? 'Unavailable' : String(target.row.orgplayid),
        disabled: target.row.orgplayid == null,
      },
      {
        id: 'copy-character-id',
        label: 'Copy Character ID',
        icon: 'r_content_copy',
        caption: target.row.charid == null ? 'Unavailable' : String(target.row.charid),
        disabled: target.row.charid == null,
      },
    );
    actions.push({
      id: 'copy',
      label: 'Copy',
      icon: 'r_content_copy',
      children: copyActions,
    });
  }

  if (column) {
    const sort = column.getSort();
    actions.push(
      {
        id: 'sort',
        label: 'Sort',
        icon: 'r_sort',
        separatorBefore: actions.length > 0,
        children: [
          {
            id: 'sort-ascending',
            label: 'Sort ascending',
            icon: sort === 'asc' ? 'r_check' : 'r_arrow_upward',
          },
          {
            id: 'sort-descending',
            label: 'Sort descending',
            icon: sort === 'desc' ? 'r_check' : 'r_arrow_downward',
          },
          {
            id: 'sort-clear',
            label: 'Clear sort',
            icon: 'r_remove',
            disabled: !sort,
            separatorBefore: true,
          },
        ],
      },
      {
        id: 'hide-column',
        label: `Hide ${columnLabel(api, column)}`,
        icon: 'r_visibility_off',
        disabled: !column.isVisible() || visibleCount <= 1,
      },
    );
  }

  actions.push({
    id: 'columns',
    label: 'Columns',
    icon: 'r_view_column',
    separatorBefore: !column && actions.length > 0,
    children: [
      {
        id: 'show-all-columns',
        label: 'Show all columns',
        icon: 'r_visibility',
        keepOpen: true,
        disabled: visibleCount === columns.length,
      },
      ...columns.map((candidate, index): ContextMenuAction => ({
        id: `column-visible:${encodeURIComponent(candidate.getColId())}`,
        label: columnLabel(api, candidate),
        checked: candidate.isVisible(),
        keepOpen: true,
        separatorBefore: index === 0,
        disabled: candidate.isVisible() && visibleCount <= 1,
      })),
    ],
  });

  if (column) {
    actions.push(
      {
        id: 'move',
        label: 'Move column',
        icon: 'r_swap_horiz',
        children: [
          {
            id: 'move-first',
            label: 'Move to first',
            icon: 'r_first_page',
            disabled: columnIndex <= 0,
          },
          {
            id: 'move-left',
            label: 'Move left',
            icon: 'r_chevron_left',
            disabled: columnIndex <= 0,
          },
          {
            id: 'move-right',
            label: 'Move right',
            icon: 'r_chevron_right',
            disabled: columnIndex < 0 || columnIndex >= columns.length - 1,
          },
          {
            id: 'move-last',
            label: 'Move to last',
            icon: 'r_last_page',
            disabled: columnIndex < 0 || columnIndex >= columns.length - 1,
          },
        ],
      },
      {
        id: 'pin',
        label: 'Pin column',
        icon: 'r_push_pin',
        children: [
          {
            id: 'pin-left',
            label: 'Pin left',
            icon: column.getPinned() === 'left' ? 'r_check' : 'r_vertical_align_top',
          },
          {
            id: 'pin-right',
            label: 'Pin right',
            icon: column.getPinned() === 'right' ? 'r_check' : 'r_vertical_align_bottom',
          },
          {
            id: 'pin-clear',
            label: 'Unpin',
            icon: 'r_remove',
            disabled: !column.getPinned(),
            separatorBefore: true,
          },
        ],
      },
    );
  }

  actions.push({
    id: 'sizing',
    label: 'Column sizing',
    icon: 'r_width_normal',
    separatorBefore: true,
    children: [
      ...(column ? [{
        id: 'auto-size-column',
        label: 'Auto-size this column',
        icon: 'r_fit_screen',
      } satisfies ContextMenuAction] : []),
      {
        id: 'auto-size-all',
        label: 'Auto-size all columns',
        icon: 'r_fit_screen',
      },
      {
        id: 'fit-viewport',
        label: 'Fit columns to viewport',
        icon: 'r_fullscreen',
      },
    ],
  });

  actions.push(
    {
      id: 'clear-filters',
      label: 'Clear all column filters',
      icon: 'r_filter_alt_off',
      separatorBefore: true,
      disabled: !api.isColumnFilterPresent(),
    },
    {
      id: 'reset-columns',
      label: 'Reset columns',
      icon: 'r_restart_alt',
      caption: 'Restore default order, widths, visibility, pins, and sort',
    },
    {
      id: 'export',
      label: 'Export current view',
      caption: 'Visible columns and filtered/sorted rows',
      icon: 'r_download',
      separatorBefore: true,
      children: [
        { id: 'export-csv', label: 'CSV', icon: 'r_table_view' },
        { id: 'export-xlsx', label: 'Excel XLSX', icon: 'r_grid_on' },
      ],
    },
  );

  return actions;
});

function editableContextTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
}

function resolveContextTarget(target: EventTarget | null): CharacterContextTarget | null {
  const api = gridApi.value;
  const element = target instanceof Element ? target : null;
  if (!api || !element) return null;

  const cell = element.closest<HTMLElement>('.ag-cell[col-id]');
  const header = cell ? null : element.closest<HTMLElement>('.ag-header-cell[col-id]');
  const rowElement = cell?.closest<HTMLElement>('.ag-row')
    ?? element.closest<HTMLElement>('.ag-row');
  const anchor = cell ?? header ?? rowElement ?? (element instanceof HTMLElement ? element : null);
  if (!anchor) return null;

  const columnId = (cell ?? header)?.getAttribute('col-id') ?? null;
  const rowId = rowElement?.getAttribute('row-id');
  let rowNode = rowId ? api.getRowNode(rowId) : undefined;
  if (!rowNode && rowElement) {
    const rowIndex = Number(rowElement.getAttribute('row-index'));
    if (Number.isInteger(rowIndex) && rowIndex >= 0) rowNode = api.getDisplayedRowAtIndex(rowIndex) ?? undefined;
  }

  const row = rowNode?.data ?? null;
  const value = rowNode && columnId
    ? api.getCellValue({ rowNode, colKey: columnId, useFormatter: true })
    : null;

  return {
    anchor,
    kind: cell ? 'cell' : header ? 'header' : rowElement ? 'row' : 'grid',
    columnId,
    row,
    cellText: value == null ? '' : String(value),
  };
}

function openContextMenu(event: Event, trigger: ContextMenuTrigger): void {
  const target = resolveContextTarget(event.target);
  if (!target) return;

  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
  contextTarget.value = target;
  contextRevision.value += 1;
  void nextTick(() => contextMenu.value?.open(event, trigger));
}

function onNativeContextMenu(event: MouseEvent): void {
  if (editableContextTarget(event.target)) return;
  openContextMenu(event, 'pointer');
}

function onGridKeyDown(event: KeyboardEvent): void {
  const isMenuKey = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
  if (!isMenuKey || event.repeat || editableContextTarget(event.target)) return;
  openContextMenu(event, 'keyboard');
}

function persistContextMutation(api: GridApi<CharacterSummaryView>): void {
  markPresetCustomized();
  scheduleStateWrite(api.getState());
  contextRevision.value += 1;
}

function selectedContextColumn(api: GridApi<CharacterSummaryView>): Column | null {
  const id = contextTarget.value?.columnId;
  return id ? api.getColumn(id) : null;
}

function copyContextText(value: unknown): void {
  if (value == null || String(value) === '') return;
  void copyTextToClipboard(String(value)).catch((error) => {
    console.warn('Unable to copy character value.', error);
  });
}

function decodeActionColumnId(id: string): string | null {
  try {
    return decodeURIComponent(id.slice('column-visible:'.length));
  } catch {
    return null;
  }
}

function moveContextColumn(api: GridApi<CharacterSummaryView>, direction: 'first' | 'left' | 'right' | 'last'): void {
  const column = selectedContextColumn(api);
  if (!column) return;

  const columns = api.getAllGridColumns();
  const fromIndex = columns.findIndex((candidate) => candidate.getColId() === column.getColId());
  if (fromIndex < 0) return;

  const toIndex = direction === 'first'
    ? 0
    : direction === 'last'
      ? columns.length - 1
      : direction === 'left'
        ? Math.max(0, fromIndex - 1)
        : Math.min(columns.length - 1, fromIndex + 1);
  if (toIndex === fromIndex) return;

  api.moveColumns([column], toIndex);
  persistContextMutation(api);
}

function onContextAction(id: string): void {
  const api = gridApi.value;
  const target = contextTarget.value;
  if (!api || !target) return;

  if (id === 'show-sessions' && target.row) {
    emit('select', target.row);
    return;
  }

  if (id === 'copy-cell') return copyContextText(target.cellText);
  if (id === 'copy-name') return copyContextText(target.row?.name);
  if (id === 'copy-org-id') return copyContextText(target.row?.orgplayid);
  if (id === 'copy-character-id') return copyContextText(target.row?.charid);

  if (id.startsWith('column-visible:')) {
    const columnId = decodeActionColumnId(id);
    const column = columnId ? api.getColumn(columnId) : null;
    if (!column) return;

    const visibleCount = api.getAllGridColumns().filter((candidate) => candidate.isVisible()).length;
    if (column.isVisible() && visibleCount <= 1) return;
    api.setColumnsVisible([column], !column.isVisible());
    persistContextMutation(api);
    return;
  }

  const column = selectedContextColumn(api);
  switch (id) {
    case 'sort-ascending':
    case 'sort-descending':
    case 'sort-clear':
      if (!column) return;
      api.applyColumnState({
        state: [{
          colId: column.getColId(),
          sort: id === 'sort-clear' ? null : id === 'sort-ascending' ? 'asc' : 'desc',
        }],
        ...(id === 'sort-clear' ? {} : { defaultState: { sort: null } }),
      });
      persistContextMutation(api);
      break;
    case 'hide-column': {
      if (!column) return;
      const visibleCount = api.getAllGridColumns().filter((candidate) => candidate.isVisible()).length;
      if (!column.isVisible() || visibleCount <= 1) return;
      api.setColumnsVisible([column], false);
      persistContextMutation(api);
      break;
    }
    case 'show-all-columns':
      api.setColumnsVisible(api.getAllGridColumns(), true);
      persistContextMutation(api);
      break;
    case 'move-first':
      moveContextColumn(api, 'first');
      break;
    case 'move-left':
      moveContextColumn(api, 'left');
      break;
    case 'move-right':
      moveContextColumn(api, 'right');
      break;
    case 'move-last':
      moveContextColumn(api, 'last');
      break;
    case 'pin-left':
    case 'pin-right':
    case 'pin-clear':
      if (!column) return;
      api.setColumnsPinned(
        [column],
        id === 'pin-clear' ? null : id === 'pin-left' ? 'left' : 'right',
      );
      persistContextMutation(api);
      break;
    case 'auto-size-column':
      if (!column) return;
      columnSizer.fitColumn(column.getColId());
      persistContextMutation(api);
      break;
    case 'auto-size-all':
      columnSizer.fitAllColumns();
      persistContextMutation(api);
      break;
    case 'fit-viewport':
      columnSizer.markDisplayedColumnsManual();
      api.sizeColumnsToFit();
      persistContextMutation(api);
      break;
    case 'clear-filters':
      api.setFilterModel(null);
      persistContextMutation(api);
      break;
    case 'reset-columns':
      resetGrid();
      break;
    case 'export-csv':
      exportCsv();
      break;
    case 'export-xlsx':
      void exportXlsx();
      break;
  }
}

watch(() => props.preset, (preset) => {
  presetCustomized = preset === 'custom';
  if (preset !== 'custom') applyPreset(preset);
});

watch(densityMetrics, (metrics) => {
  const api = gridApi.value;
  if (!api) return;
  api.setGridOption('rowHeight', metrics.rowHeight);
  api.setGridOption('headerHeight', metrics.headerHeight);
  api.setGridOption('floatingFiltersHeight', metrics.floatingFilterHeight);
  api.resetRowHeights();
  api.refreshCells({ force: true });
  columnSizer.schedule();
});

onMounted(() => {
  void hydrateState();
});

onBeforeUnmount(() => {
  persistenceEnabled = false;
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = undefined;

  const finalState = pendingState ?? gridApi.value?.getState();
  pendingState = undefined;
  if (finalState) void writeState(finalState);
  columnSizer.destroy();
  gridApi.value = null;
});

defineExpose({
  applyPreset,
  autoSizeColumns,
  clearFilters,
  exportCsv,
  exportXlsx,
  fitColumns,
  getColumns,
  getCurrentRows,
  getExportView,
  moveColumn,
  reset: resetGrid,
  resize,
  setColumnVisible,
  setFloatingFilters,
});
</script>

<template>
  <div
    ref="gridRoot"
    class="character-grid"
    @contextmenu.capture="onNativeContextMenu"
    @keydown.capture="onGridKeyDown"
  >
    <div v-if="!stateReady" class="character-grid__loading" aria-label="Loading character table preferences">
      <q-spinner color="primary" size="28px" />
    </div>
    <AgGridVue
      v-else
      class="character-grid__table"
      :animate-rows="false"
      :column-defs="columnDefs"
      :default-col-def="defaultColDef"
      dom-layout="normal"
      :enable-cell-text-selection="true"
      :floating-filters-height="densityMetrics.floatingFilterHeight"
      :get-row-id="getRowId"
      :header-height="densityMetrics.headerHeight"
      :initial-state="persistedState"
      :maintain-column-order="true"
      :overlay-no-rows-template="'No characters match the current filters.'"
      :row-buffer="12"
      :row-data="rows"
      :row-height="densityMetrics.rowHeight"
      :row-selection="rowSelection"
      :suppress-column-virtualisation="false"
      :suppress-context-menu="true"
      :suppress-drag-leave-hides-columns="true"
      :suppress-row-virtualisation="false"
      :theme="gridTheme"
      :tooltip-hide-delay="5000"
      :tooltip-show-delay="350"
      @cell-key-down="onCellKeyDown"
      @column-moved="onColumnMoved"
      @column-resized="onColumnResized"
      @column-visible="onColumnVisible"
      @filter-changed="onFilterChanged"
      @first-data-rendered="onFirstDataRendered"
      @grid-ready="onGridReady"
      @model-updated="onModelUpdated"
      @selection-changed="onSelectionChanged"
      @state-updated="onStateUpdated"
    />
    <ContextActionMenu
      ref="contextMenu"
      :title="contextMenuTitle"
      :subtitle="contextMenuSubtitle"
      :actions="contextActions"
      :target="contextTarget?.anchor ?? false"
      @select="onContextAction"
    />
  </div>
</template>

<style scoped>
.character-grid {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 20rem;
  overflow: hidden;
}

.character-grid__table,
.character-grid__loading {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 0;
}

.character-grid__loading {
  display: grid;
  place-items: center;
}

.character-grid :deep(.ag-root-wrapper) {
  border: 0;
  border-radius: 0;
}

.character-grid :deep(.ag-header-cell-text) {
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.025em;
}

.character-grid :deep(.ag-cell),
.character-grid :deep(.ag-cell-value) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.character-grid :deep(.character-grid__xp) {
  color: var(--pfxp-primary);
  font-variant-numeric: tabular-nums;
}
</style>
