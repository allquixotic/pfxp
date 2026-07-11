<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { AgGridVue } from 'ag-grid-vue3';
import { copyToClipboard, useQuasar } from 'quasar';
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  colorSchemeLight,
  themeQuartz,
  type ColDef,
  type ColumnEventType,
  type ColumnMovedEvent,
  type ColumnPinnedEvent,
  type ColumnResizedEvent,
  type ColumnVisibleEvent,
  type FilterChangedEvent,
  type FilterModel,
  type FirstDataRenderedEvent,
  type GetRowIdFunc,
  type GridApi,
  type GridReadyEvent,
  type GridState,
  type RowClassParams,
  type ModelUpdatedEvent,
  type RowSelectionOptions,
  type SelectionChangedEvent,
  type StateUpdatedEvent,
} from 'ag-grid-community';

import { scenarioDisplayName, type SessionDetail } from '../domain';
import { isAlreadyPlayedSessionNote } from '../../session-rules';
import ContextActionMenu from './ContextActionMenu.vue';
import type { ContextMenuAction, ContextMenuTrigger } from './context-menu-model';
import {
  SESSION_COLUMN_META,
  SESSION_COLUMN_ORDER,
  SESSION_PRESET_COLUMNS,
  createSessionColumnDefs,
  getSessionRowId,
  type SessionColumnId,
  type SessionPreset,
} from '../domain/session-columns';
import {
  AutoColumnSizer,
  downloadTableViewCsv,
  downloadTableViewXlsx,
  getGridTableExportView,
  type TableExportView,
} from '../services';

ModuleRegistry.registerModules([AllCommunityModule]);

const props = withDefaults(defineProps<{
  rows: SessionDetail[];
  quickFilter: string;
  dark: boolean;
  density: 'compact' | 'comfortable';
  preset: SessionPreset;
  initialState?: GridState;
  initialManualColumns?: string[];
}>(), {
  quickFilter: '',
  dark: false,
  density: 'comfortable',
  preset: 'default',
});

const emit = defineEmits<{
  rowSelected: [row: SessionDetail | null];
  filterCharacter: [row: SessionDetail];
  filteredCount: [count: number];
  stateChanged: [state: GridState];
  presetCustomized: [];
  filterModelChanged: [model: FilterModel];
  floatingFiltersChanged: [visible: boolean];
  manualColumnsChanged: [columns: string[]];
}>();

interface ContextActionMenuApi {
  open(event: Event, trigger?: ContextMenuTrigger): void;
  close(): void;
}

interface GridContextTarget {
  kind: 'header' | 'cell' | 'workspace';
  colId: SessionColumnId | null;
  row: SessionDetail | null;
  rowIndex: number | null;
  value: string;
  trigger: HTMLElement;
}

interface TouchHoldDetails {
  evt: TouchEvent;
  position: { left: number; top: number };
}

const $q = useQuasar();
const initialPreset = props.preset;
const columnDefs = createSessionColumnDefs(initialPreset, {
  compact: () => props.density === 'compact',
});
const gridApi = shallowRef<GridApi<SessionDetail> | null>(null);
const floatingFiltersVisible = ref(false);
const gridRoot = ref<HTMLElement | null>(null);
const contextMenu = ref<ContextActionMenuApi | null>(null);
const contextTarget = shallowRef<GridContextTarget | null>(null);
const contextRevision = ref(0);
const columnSizer = new AutoColumnSizer<SessionDetail>({
  api: () => gridApi.value,
  root: () => gridRoot.value,
  fontSize: () => densityMetrics.value.fontSize,
  horizontalPadding: () => densityMetrics.value.cellHorizontalPadding,
  manualColumns: props.initialManualColumns,
  onManualColumnsChanged: (columns) => emit('manualColumnsChanged', columns),
});

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

const defaultColDef = computed<ColDef<SessionDetail>>(() => ({
  filter: true,
  floatingFilter: floatingFiltersVisible.value,
  lockPinned: false,
  resizable: true,
  sortable: true,
  suppressHeaderFilterButton: false,
  suppressHeaderContextMenu: true,
  suppressHeaderMenuButton: false,
  suppressMovable: false,
  unSortIcon: true,
}));

const rowSelection: RowSelectionOptions<SessionDetail> = {
  mode: 'singleRow',
  checkboxes: false,
  enableClickSelection: true,
};

const getRowId: GetRowIdFunc<SessionDetail> = ({ data }) => getSessionRowId(data);
const labelByColumnId = new Map(SESSION_COLUMN_META.map(({ id, label }) => [id, label]));
const sessionColumnIds = new Set<string>(SESSION_COLUMN_ORDER);

let stateTimer: ReturnType<typeof setTimeout> | undefined;
let pendingState: GridState | undefined;
let lastFilteredCount = -1;
let suppressCustomizationEvents = true;
let customizationEmitted = props.preset === 'custom';
let destroying = false;

function scheduleStateChanged(state?: GridState): void {
  if (destroying) return;
  pendingState = state ?? gridApi.value?.getState();
  if (!pendingState) return;

  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    stateTimer = undefined;
    const nextState = pendingState;
    pendingState = undefined;
    if (nextState) emit('stateChanged', nextState);
  }, 280);
}

function emitFilteredCount(api: GridApi<SessionDetail>): void {
  const count = api.getDisplayedRowCount();
  if (count === lastFilteredCount) return;
  lastFilteredCount = count;
  emit('filteredCount', count);
}

function releaseCustomizationSuppression(): void {
  requestAnimationFrame(() => {
    suppressCustomizationEvents = false;
  });
}

function markPresetCustomized(): void {
  if (suppressCustomizationEvents || customizationEmitted) return;
  customizationEmitted = true;
  emit('presetCustomized');
}

function isUserColumnEvent(source: ColumnEventType): boolean {
  return source.startsWith('ui')
    || source === 'columnMenu'
    || source === 'contextMenu'
    || source === 'toolPanelDragAndDrop'
    || source === 'toolPanelUi';
}

function onGridReady(event: GridReadyEvent<SessionDetail>): void {
  gridApi.value = event.api;
  event.api.setGridAriaProperty('label', 'Organized Play sessions');
  emitFilteredCount(event.api);

  if (!props.initialState && props.preset !== initialPreset && props.preset !== 'custom') {
    applyPreset(props.preset);
  } else {
    releaseCustomizationSuppression();
  }
  columnSizer.schedule();
}

function onFirstDataRendered(event: FirstDataRenderedEvent<SessionDetail>): void {
  emitFilteredCount(event.api);
  columnSizer.schedule();
}

function onModelUpdated(event: ModelUpdatedEvent<SessionDetail>): void {
  emitFilteredCount(event.api);
  columnSizer.schedule();
}

function onSelectionChanged(event: SelectionChangedEvent<SessionDetail>): void {
  emit('rowSelected', event.selectedNodes?.[0]?.data ?? null);
}

function onFilterChanged(event: FilterChangedEvent<SessionDetail>): void {
  emit('filterModelChanged', event.api.getFilterModel());
  emitFilteredCount(event.api);
  contextRevision.value += 1;
  columnSizer.schedule();
}

function onStateUpdated(event: StateUpdatedEvent<SessionDetail>): void {
  scheduleStateChanged(event.state);
  contextRevision.value += 1;
}

function onColumnMoved(event: ColumnMovedEvent<SessionDetail>): void {
  if (event.finished && isUserColumnEvent(event.source)) markPresetCustomized();
}

function onColumnResized(event: ColumnResizedEvent<SessionDetail>): void {
  if (!event.finished) return;
  if (event.source === 'uiColumnResized') {
    const columns = event.columns ?? (event.column ? [event.column] : []);
    columnSizer.markManual(columns.map((column) => column.getColId()));
  }
  if (isUserColumnEvent(event.source)) markPresetCustomized();
}

function onColumnVisible(event: ColumnVisibleEvent<SessionDetail>): void {
  if (isUserColumnEvent(event.source)) markPresetCustomized();
  if (event.visible !== false) columnSizer.schedule();
}

function onColumnPinned(event: ColumnPinnedEvent<SessionDetail>): void {
  if (isUserColumnEvent(event.source)) markPresetCustomized();
}

function applyPreset(preset: SessionPreset): boolean {
  const api = gridApi.value;
  if (!api || preset === 'custom') return false;

  suppressCustomizationEvents = true;
  customizationEmitted = false;
  const visible = new Set<SessionColumnId>(SESSION_PRESET_COLUMNS[preset]);
  const applied = api.applyColumnState({
    applyOrder: true,
    state: SESSION_COLUMN_ORDER.map((colId) => ({
      colId,
      hide: !visible.has(colId),
    })),
  });

  scheduleStateChanged(api.getState());
  releaseCustomizationSuppression();
  return applied;
}

function autoSizeColumns(): void {
  const api = gridApi.value;
  if (!api) return;
  columnSizer.fitAllColumns();
  markPresetCustomized();
  scheduleStateChanged(api.getState());
  contextRevision.value += 1;
}

function fitColumns(): void {
  const api = gridApi.value;
  if (!api) return;
  columnSizer.markDisplayedColumnsManual();
  api.sizeColumnsToFit();
  markPresetCustomized();
  scheduleStateChanged(api.getState());
  contextRevision.value += 1;
}

function resetGrid(): void {
  const api = gridApi.value;
  if (!api) return;

  suppressCustomizationEvents = true;
  customizationEmitted = false;
  api.resetColumnState();
  api.setFilterModel(null);
  api.deselectAll();
  columnSizer.setManualColumns([]);

  const visible = new Set<SessionColumnId>(SESSION_PRESET_COLUMNS.default);
  api.applyColumnState({
    applyOrder: true,
    state: SESSION_COLUMN_ORDER.map((colId) => ({
      colId,
      hide: !visible.has(colId),
    })),
  });

  setFloatingFilters(false);
  emit('filterModelChanged', {});
  emitFilteredCount(api);
  scheduleStateChanged(api.getState());
  columnSizer.schedule();
  releaseCustomizationSuppression();
}

function exportCsv(fileName = 'pfxp-sessions.csv'): void {
  const view = getExportView();
  if (view) downloadTableViewCsv(view, fileName);
}

async function exportXlsx(fileName = 'pfxp-sessions.xlsx'): Promise<void> {
  const view = getExportView();
  if (!view) return;
  try {
    await downloadTableViewXlsx(view, fileName);
  } catch {
    $q.notify({ message: 'Unable to create the Excel workbook.', color: 'negative', icon: 'r_error' });
  }
}

function getExportView(): TableExportView | null {
  const api = gridApi.value;
  return api ? getGridTableExportView(api, 'Sessions') : null;
}

function getCurrentRows(): SessionDetail[] {
  const api = gridApi.value;
  if (!api) return [...props.rows];

  const currentRows: SessionDetail[] = [];
  api.forEachNodeAfterFilterAndSort((node) => {
    if (node.data) currentRows.push(node.data);
  });
  return currentRows;
}

function getAllRows(): SessionDetail[] {
  const api = gridApi.value;
  if (!api) return [...props.rows];

  const allRows: SessionDetail[] = [];
  api.forEachNode((node) => {
    if (node.data) allRows.push(node.data);
  });
  return allRows;
}

function resize(): void {
  const api = gridApi.value;
  if (!api) return;

  // AG Grid observes its host size. Redrawing on the next frame handles the
  // end of fullscreen/card transitions without rewriting user column widths.
  requestAnimationFrame(() => {
    if (gridApi.value !== api) return;
    api.refreshHeader();
    api.redrawRows();
  });
}

function setFloatingFilters(visible: boolean): boolean {
  if (floatingFiltersVisible.value === visible) return visible;

  const api = gridApi.value;
  const state = api?.getState();
  suppressCustomizationEvents = true;
  floatingFiltersVisible.value = visible;

  void nextTick(() => {
    if (api && state && gridApi.value === api) api.setState(state);
    resize();
    releaseCustomizationSuppression();
  });

  return visible;
}

function toggleFloatingFilters(force?: boolean): boolean {
  return setFloatingFilters(force ?? !floatingFiltersVisible.value);
}

function getColumns(): Array<{ id: string; label: string; visible: boolean }> {
  const api = gridApi.value;
  if (!api) {
    const preset = props.preset === 'custom' ? 'default' : props.preset;
    const visible = new Set<SessionColumnId>(SESSION_PRESET_COLUMNS[preset]);
    return SESSION_COLUMN_META.map(({ id, label }) => ({
      id,
      label,
      visible: visible.has(id),
    }));
  }

  return api.getAllGridColumns()
    .filter((column) => sessionColumnIds.has(column.getColId()))
    .map((column) => {
      const id = column.getColId();
      return {
        id,
        label: labelByColumnId.get(id as SessionColumnId)
          ?? api.getDisplayNameForColumn(column, 'columnToolPanel'),
        visible: column.isVisible(),
      };
    });
}

function setColumnVisible(id: string, visible: boolean): boolean {
  const api = gridApi.value;
  if (!api || !sessionColumnIds.has(id) || !api.getColumn(id)) return false;
  if (!visible) {
    const visibleColumns = api.getAllGridColumns()
      .filter((column) => sessionColumnIds.has(column.getColId()) && column.isVisible());
    if (visibleColumns.length <= 1 && visibleColumns[0]?.getColId() === id) return false;
  }

  api.setColumnsVisible([id], visible);
  markPresetCustomized();
  scheduleStateChanged(api.getState());
  contextRevision.value += 1;
  return true;
}

function moveColumn(id: string, toIndex: number): boolean {
  const api = gridApi.value;
  const columns = api?.getAllGridColumns()
    .filter((column) => sessionColumnIds.has(column.getColId())) ?? [];
  if (!api || !sessionColumnIds.has(id) || !api.getColumn(id) || columns.length === 0) return false;

  const clampedIndex = Math.max(0, Math.min(Math.trunc(toIndex), columns.length - 1));
  api.moveColumns([id], clampedIndex);
  markPresetCustomized();
  scheduleStateChanged(api.getState());
  contextRevision.value += 1;
  return true;
}

function pinColumn(id: string, pinned: 'left' | 'right' | null): boolean {
  const api = gridApi.value;
  if (!api || !sessionColumnIds.has(id) || !api.getColumn(id)) return false;

  api.setColumnsPinned([id], pinned);
  markPresetCustomized();
  scheduleStateChanged(api.getState());
  contextRevision.value += 1;
  return true;
}

function getState(): GridState | undefined {
  return gridApi.value?.getState();
}

function clearFilters(): void {
  const api = gridApi.value;
  if (!api) return;
  api.setFilterModel(null);
  scheduleStateChanged(api.getState());
  contextRevision.value += 1;
}

function orderedSessionColumns(api: GridApi<SessionDetail>) {
  return api.getAllGridColumns()
    .filter((column) => sessionColumnIds.has(column.getColId()));
}

function contextColumnLabel(colId: string | null): string {
  if (!colId) return 'Sessions';
  const api = gridApi.value;
  const column = api?.getColumn(colId);
  return labelByColumnId.get(colId as SessionColumnId)
    ?? (api && column ? api.getDisplayNameForColumn(column, 'columnToolPanel') : colId);
}

function eventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (target instanceof Node && target.parentElement) return target.parentElement;
  return null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return !!eventTargetElement(target)?.closest(
    'input, textarea, select, [contenteditable="true"], [role="textbox"]',
  );
}

function contextFromEventTarget(target: EventTarget | null): GridContextTarget | null {
  const api = gridApi.value;
  const root = gridRoot.value;
  const element = eventTargetElement(target);
  if (!api || !root || !element || !root.contains(element)) return null;

  const cell = element.closest<HTMLElement>('.ag-cell[col-id]');
  const header = element.closest<HTMLElement>('.ag-header-cell[col-id], .ag-floating-filter[col-id]');
  const trigger = cell ?? header ?? element.closest<HTMLElement>('.sessions-grid__table') ?? root;
  const rawColId = (cell ?? header)?.getAttribute('col-id') ?? null;
  const colId = rawColId && sessionColumnIds.has(rawColId)
    ? rawColId as SessionColumnId
    : null;

  if (header && colId) {
    return {
      kind: 'header',
      colId,
      row: null,
      rowIndex: null,
      value: '',
      trigger,
    };
  }

  if (cell && colId) {
    const rowElement = cell.closest<HTMLElement>('.ag-row[row-index]');
    const rowIndexValue = rowElement?.getAttribute('row-index');
    const parsedRowIndex = rowIndexValue == null ? Number.NaN : Number(rowIndexValue);
    const rowIndex = Number.isInteger(parsedRowIndex) ? parsedRowIndex : null;
    const rowNode = rowIndex == null ? null : api.getDisplayedRowAtIndex(rowIndex);
    const formatted = rowNode
      ? api.getCellValue({ rowNode, colKey: colId, useFormatter: true })
      : '';

    return {
      kind: 'cell',
      colId,
      row: rowNode?.data ?? null,
      rowIndex,
      value: formatted == null ? '' : String(formatted),
      trigger,
    };
  }

  return {
    kind: 'workspace',
    colId: null,
    row: null,
    rowIndex: null,
    value: '',
    trigger,
  };
}

function openGridContextMenu(event: Event, trigger: ContextMenuTrigger): void {
  if (isEditableTarget(event.target)) return;
  const target = contextFromEventTarget(event.target);
  if (!target) return;

  event.preventDefault();
  event.stopPropagation();
  contextTarget.value = target;
  contextRevision.value += 1;
  contextMenu.value?.open(event, trigger);
}

function onGridContextMenu(event: MouseEvent): void {
  openGridContextMenu(event, 'pointer');
}

function onGridTouchHold(details: TouchHoldDetails): void {
  openGridContextMenu(details.evt, 'touch');
}

function onGridContextKeydown(event: KeyboardEvent): void {
  const isContextKey = event.key === 'ContextMenu'
    || (event.shiftKey && event.key === 'F10');
  if (!isContextKey || event.repeat) return;
  openGridContextMenu(event, 'keyboard');
}

function commitContextCustomization(api: GridApi<SessionDetail>): void {
  markPresetCustomized();
  scheduleStateChanged(api.getState());
  contextRevision.value += 1;
}

function setContextSort(colId: SessionColumnId, sort: 'asc' | 'desc' | null): void {
  const api = gridApi.value;
  if (!api?.getColumn(colId)) return;

  api.applyColumnState({
    state: [{ colId, sort, sortIndex: sort ? 0 : null }],
    ...(sort ? { defaultState: { sort: null, sortIndex: null } } : {}),
  });
  commitContextCustomization(api);
}

function moveContextColumn(colId: SessionColumnId, destination: 'left' | 'right' | 'first' | 'last'): void {
  const api = gridApi.value;
  if (!api?.getColumn(colId)) return;
  const columns = orderedSessionColumns(api);
  const index = columns.findIndex((column) => column.getColId() === colId);
  if (index < 0) return;

  const targetIndex = destination === 'first'
    ? 0
    : destination === 'last'
      ? columns.length - 1
      : destination === 'left'
        ? index - 1
        : index + 1;
  if (targetIndex < 0 || targetIndex >= columns.length || targetIndex === index) return;

  api.moveColumns([colId], targetIndex);
  commitContextCustomization(api);
}

function setAllColumnsVisible(visible: boolean): void {
  const api = gridApi.value;
  if (!api || !visible) return;
  api.setColumnsVisible(orderedSessionColumns(api), true);
  commitContextCustomization(api);
}

function showOnlyContextColumn(colId: SessionColumnId): void {
  const api = gridApi.value;
  if (!api?.getColumn(colId)) return;
  api.applyColumnState({
    state: orderedSessionColumns(api).map((column) => ({
      colId: column.getColId(),
      hide: column.getColId() !== colId,
    })),
  });
  commitContextCustomization(api);
}

function autoSizeContextColumn(colId: SessionColumnId): void {
  const api = gridApi.value;
  if (!api?.getColumn(colId)) return;
  columnSizer.fitColumn(colId);
  commitContextCustomization(api);
}

async function clearContextColumnFilter(colId: SessionColumnId): Promise<void> {
  const api = gridApi.value;
  if (!api?.getColumn(colId)) return;
  await api.setColumnFilterModel(colId, null);
  api.onFilterChanged();
  scheduleStateChanged(api.getState());
  contextRevision.value += 1;
}

async function copyContextText(value: unknown, label: string): Promise<void> {
  if (value == null || String(value).length === 0) return;
  try {
    await copyToClipboard(String(value));
    $q.notify({ message: `${label} copied`, color: 'primary', icon: 'r_content_copy' });
  } catch {
    $q.notify({ message: `Unable to copy ${label.toLocaleLowerCase()}.`, color: 'warning' });
  }
}

function onContextAction(id: string): void {
  const api = gridApi.value;
  const target = contextTarget.value;
  if (!api || !target) return;
  const colId = target.colId;

  if (id === 'session:open' && target.row) {
    emit('rowSelected', target.row);
    return;
  }
  if (id === 'session:filter-character' && target.row) {
    emit('filterCharacter', target.row);
    return;
  }
  if (id === 'copy:cell') {
    void copyContextText(target.value, contextColumnLabel(colId));
    return;
  }
  if (id === 'copy:scenario' && target.row) {
    void copyContextText(scenarioDisplayName(target.row.scenario), 'Scenario');
    return;
  }
  if (id === 'copy:character' && target.row) {
    void copyContextText(target.row.character.name, 'Character');
    return;
  }
  if (id === 'sort:asc' && colId) {
    setContextSort(colId, 'asc');
    return;
  }
  if (id === 'sort:desc' && colId) {
    setContextSort(colId, 'desc');
    return;
  }
  if (id === 'sort:clear' && colId) {
    setContextSort(colId, null);
    return;
  }
  if (id === 'filter:open' && colId) {
    globalThis.setTimeout(() => api.showColumnFilter(colId), 140);
    return;
  }
  if (id === 'filter:clear-column' && colId) {
    void clearContextColumnFilter(colId);
    return;
  }
  if (id === 'column:hide' && colId) {
    setColumnVisible(colId, false);
    return;
  }
  if (id === 'column:move-left' && colId) {
    moveContextColumn(colId, 'left');
    return;
  }
  if (id === 'column:move-right' && colId) {
    moveContextColumn(colId, 'right');
    return;
  }
  if (id === 'column:move-first' && colId) {
    moveContextColumn(colId, 'first');
    return;
  }
  if (id === 'column:move-last' && colId) {
    moveContextColumn(colId, 'last');
    return;
  }
  if (id === 'column:pin-left' && colId) {
    pinColumn(colId, 'left');
    return;
  }
  if (id === 'column:pin-right' && colId) {
    pinColumn(colId, 'right');
    return;
  }
  if (id === 'column:unpin' && colId) {
    pinColumn(colId, null);
    return;
  }
  if (id === 'columns:show-all') {
    setAllColumnsVisible(true);
    return;
  }
  if (id === 'columns:show-only' && colId) {
    showOnlyContextColumn(colId);
    return;
  }
  if (id.startsWith('columns:toggle:')) {
    const toggleId = id.slice('columns:toggle:'.length);
    const column = api.getColumn(toggleId);
    if (column && sessionColumnIds.has(toggleId)) setColumnVisible(toggleId, !column.isVisible());
    return;
  }
  if (id === 'size:column' && colId) {
    autoSizeContextColumn(colId);
    return;
  }
  if (id === 'size:all') {
    autoSizeColumns();
    return;
  }
  if (id === 'size:fit') {
    fitColumns();
    return;
  }
  if (id === 'view:floating-filters') {
    const visible = toggleFloatingFilters();
    emit('floatingFiltersChanged', visible);
    contextRevision.value += 1;
    return;
  }
  if (id === 'view:clear-filters') {
    clearFilters();
    contextRevision.value += 1;
    return;
  }
  if (id === 'export:csv') exportCsv('pfxp-sessions.csv');
  if (id === 'export:xlsx') void exportXlsx('pfxp-sessions.xlsx');
}

const contextMenuTitle = computed(() => {
  const target = contextTarget.value;
  if (!target) return 'Session actions';
  if (target.kind === 'header' && target.colId) return `${contextColumnLabel(target.colId)} column`;
  return target.row ? scenarioDisplayName(target.row.scenario) : 'Sessions view';
});

const contextMenuSubtitle = computed(() => {
  const target = contextTarget.value;
  if (!target) return '';
  if (target.kind === 'header') return 'Sort, filter, arrange, and size';
  if (!target.row) return 'Columns, filters, sizing, and export';
  return [target.row.character.name, target.row.date].filter(Boolean).join(' · ');
});

const contextMenuActions = computed<ContextMenuAction[]>(() => {
  contextRevision.value;
  const api = gridApi.value;
  const target = contextTarget.value;
  if (!api || !target) return [];

  const actions: ContextMenuAction[] = [];
  const column = target.colId ? api.getColumn(target.colId) : null;
  const columns = orderedSessionColumns(api);
  const visibleColumns = columns.filter((candidate) => candidate.isVisible());
  const columnIndex = column
    ? columns.findIndex((candidate) => candidate.getColId() === column.getColId())
    : -1;

  if (target.row) {
    actions.push(
      { id: 'session:open', label: 'Open session details', icon: 'r_open_in_new' },
      {
        id: 'session:filter-character',
        label: 'Show this character’s sessions',
        icon: 'r_filter_alt',
        disabled: !target.row.character.name,
      },
      {
        id: 'copy',
        label: 'Copy',
        icon: 'r_content_copy',
        children: [
          {
            id: 'copy:cell',
            label: `Copy ${contextColumnLabel(target.colId).toLocaleLowerCase()}`,
            icon: 'r_content_copy',
            disabled: target.kind !== 'cell' || !target.value,
          },
          {
            id: 'copy:scenario',
            label: 'Copy scenario',
            icon: 'r_local_library',
            disabled: !target.row.scenario,
          },
          {
            id: 'copy:character',
            label: 'Copy character',
            icon: 'r_person',
            disabled: !target.row.character.name,
          },
        ],
      },
    );
  }

  if (column && target.colId) {
    const currentSort = column.getSort();
    const hasColumnFilter = api.getColumnFilterModel(target.colId) != null;
    actions.push(
      {
        id: 'sort',
        label: `Sort ${contextColumnLabel(target.colId)}`,
        icon: 'r_sort',
        separatorBefore: actions.length > 0,
        children: [
          { id: 'sort:asc', label: 'Ascending', icon: 'r_arrow_upward', checked: currentSort === 'asc' },
          { id: 'sort:desc', label: 'Descending', icon: 'r_arrow_downward', checked: currentSort === 'desc' },
          { id: 'sort:clear', label: 'Clear sort', icon: 'r_sort_by_alpha', disabled: !currentSort },
        ],
      },
      {
        id: 'filter:open',
        label: `Filter ${contextColumnLabel(target.colId)}`,
        icon: 'r_filter_alt',
      },
      {
        id: 'filter:clear-column',
        label: 'Clear this column filter',
        icon: 'r_filter_alt_off',
        disabled: !hasColumnFilter,
      },
      {
        id: 'arrange',
        label: 'Arrange this column',
        icon: 'r_view_column',
        children: [
          {
            id: 'column:hide',
            label: 'Hide column',
            icon: 'r_visibility_off',
            disabled: visibleColumns.length <= 1,
          },
          { id: 'column:move-left', label: 'Move left', icon: 'r_arrow_back', disabled: columnIndex <= 0 },
          { id: 'column:move-right', label: 'Move right', icon: 'r_arrow_forward', disabled: columnIndex < 0 || columnIndex >= columns.length - 1 },
          { id: 'column:move-first', label: 'Move to start', icon: 'r_first_page', disabled: columnIndex <= 0 },
          { id: 'column:move-last', label: 'Move to end', icon: 'r_last_page', disabled: columnIndex < 0 || columnIndex >= columns.length - 1 },
          { id: 'column:pin-left', label: 'Pin left', icon: 'r_vertical_align_top', checked: column.getPinned() === 'left', separatorBefore: true },
          { id: 'column:pin-right', label: 'Pin right', icon: 'r_vertical_align_bottom', checked: column.getPinned() === 'right' },
          { id: 'column:unpin', label: 'Unpin', icon: 'r_push_pin', checked: column.getPinned() == null },
        ],
      },
    );
  }

  actions.push({
    id: 'columns',
    label: 'Show or hide columns',
    icon: 'r_view_week',
    separatorBefore: !column && actions.length > 0,
    children: [
      {
        id: 'columns:show-all',
        label: 'Show all columns',
        icon: 'r_visibility',
        disabled: visibleColumns.length === columns.length,
        keepOpen: true,
      },
      ...(target.colId ? [{
        id: 'columns:show-only',
        label: `Show only ${contextColumnLabel(target.colId)}`,
        icon: 'r_filter_center_focus',
        disabled: visibleColumns.length === 1 && visibleColumns[0]?.getColId() === target.colId,
        keepOpen: true,
      } satisfies ContextMenuAction] : []),
      ...columns.map((candidate, index): ContextMenuAction => ({
        id: `columns:toggle:${candidate.getColId()}`,
        label: contextColumnLabel(candidate.getColId()),
        checked: candidate.isVisible(),
        disabled: candidate.isVisible() && visibleColumns.length <= 1,
        keepOpen: true,
        separatorBefore: index === 0,
      })),
    ],
  });

  actions.push(
    {
      id: 'size',
      label: 'Column sizing',
      icon: 'r_width_normal',
      children: [
        ...(target.colId ? [{ id: 'size:column', label: 'Auto-size this column', icon: 'r_swap_horiz' }] : []),
        { id: 'size:all', label: 'Auto-size all columns', icon: 'r_width_full' },
        { id: 'size:fit', label: 'Fit columns to viewport', icon: 'r_fit_screen' },
      ],
    },
    {
      id: 'view',
      label: 'Table view',
      icon: 'r_tune',
      children: [
        {
          id: 'view:floating-filters',
          label: 'Filter row below headers',
          checked: floatingFiltersVisible.value,
          keepOpen: true,
        },
        {
          id: 'view:clear-filters',
          label: 'Clear all column filters',
          icon: 'r_filter_alt_off',
          disabled: Object.keys(api.getFilterModel()).length === 0,
        },
      ],
    },
    {
      id: 'export',
      label: 'Export current view',
      caption: 'Visible columns and filtered/sorted rows',
      icon: 'r_download',
      separatorBefore: true,
      children: [
        { id: 'export:csv', label: 'CSV', icon: 'r_table_view' },
        { id: 'export:xlsx', label: 'Excel XLSX', icon: 'r_grid_on' },
      ],
    },
  );

  return actions;
});

watch(() => props.preset, (preset) => {
  customizationEmitted = preset === 'custom';
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
  resize();
  columnSizer.schedule();
});

onBeforeUnmount(() => {
  destroying = true;
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = undefined;

  const finalState = pendingState ?? gridApi.value?.getState();
  pendingState = undefined;
  if (finalState) emit('stateChanged', finalState);
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
  getAllRows,
  getColumns,
  getCurrentRows,
  getExportView,
  getState,
  moveColumn,
  pinColumn,
  reset: resetGrid,
  resetGrid,
  resize,
  setColumnVisible,
  setFloatingFilters,
  toggleFloatingFilters,
});

function getRowClass(params: RowClassParams<SessionDetail>): string | undefined {
  return isAlreadyPlayedSessionNote(params.data?.notes)
    ? 'session-row--already-played'
    : undefined;
}
</script>

<template>
  <section
    ref="gridRoot"
    class="sessions-grid"
    :class="[
      `sessions-grid--${density}`,
      { 'sessions-grid--dark': dark },
    ]"
    aria-label="Organized Play sessions"
    v-touch-hold:500:12.capture="onGridTouchHold"
    @contextmenu.capture="onGridContextMenu"
    @keydown.capture="onGridContextKeydown"
  >
    <AgGridVue
      class="sessions-grid__table"
      :animate-rows="false"
      :cache-quick-filter="true"
      :column-defs="columnDefs"
      :default-col-def="defaultColDef"
      dom-layout="normal"
      :enable-cell-text-selection="true"
      :floating-filters-height="densityMetrics.floatingFilterHeight"
      :get-row-id="getRowId"
      :get-row-class="getRowClass"
      :header-height="densityMetrics.headerHeight"
      :include-hidden-columns-in-quick-filter="true"
      :initial-state="initialState"
      :maintain-column-order="true"
      :overlay-no-rows-template="'<div class=\'sessions-grid__empty\'>No sessions match the current filters.</div>'"
      :quick-filter-text="quickFilter"
      :row-buffer="14"
      :row-data="rows"
      :row-height="densityMetrics.rowHeight"
      :row-selection="rowSelection"
      :suppress-column-virtualisation="false"
      :suppress-drag-leave-hides-columns="true"
      :suppress-row-virtualisation="false"
      :theme="gridTheme"
      :tooltip-hide-delay="5000"
      :tooltip-show-delay="350"
      @column-moved="onColumnMoved"
      @column-pinned="onColumnPinned"
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
      :actions="contextMenuActions"
      @select="onContextAction"
    />
  </section>
</template>

<style scoped>
.sessions-grid {
  position: relative;
  inline-size: 100%;
  block-size: 100%;
  min-block-size: 20rem;
  min-inline-size: 0;
  overflow: hidden;
}

.sessions-grid__table {
  inline-size: 100%;
  block-size: 100%;
  min-inline-size: 0;
}

.sessions-grid :deep(.ag-root-wrapper) {
  border: 0;
  border-radius: 0;
}

.sessions-grid :deep(.ag-header-cell-text) {
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.025em;
}

.sessions-grid :deep(.ag-cell) {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sessions-grid :deep(.ag-cell-value) {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sessions-grid :deep(.ag-row.session-row--already-played .ag-cell) {
  color: #6b7280;
  background: #eef1f4;
}

.sessions-grid :deep(.ag-row.session-row--already-played:hover .ag-cell),
.sessions-grid :deep(.ag-row.session-row--already-played.ag-row-selected .ag-cell) {
  color: #596273;
  background: #e2e6eb;
}

.sessions-grid--dark :deep(.ag-row.session-row--already-played .ag-cell) {
  color: #8d98a8;
  background: #1b2430;
}

.sessions-grid--dark :deep(.ag-row.session-row--already-played:hover .ag-cell),
.sessions-grid--dark :deep(.ag-row.session-row--already-played.ag-row-selected .ag-cell) {
  color: #aab3c0;
  background: #242f3d;
}

@media (pointer: coarse) {
  .sessions-grid :deep(.ag-cell),
  .sessions-grid :deep(.ag-header-cell) {
    -webkit-touch-callout: none;
  }
}

.sessions-grid :deep(.session-cell-badge) {
  display: inline-flex;
  align-items: center;
  max-inline-size: 100%;
  block-size: 1.55rem;
  padding-inline: 0.55rem;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 650;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sessions-grid :deep(.session-cell-badge--pathfinder) {
  border-color: #b8e6cd;
  color: #087345;
  background: #f0fbf5;
}

.sessions-grid :deep(.session-cell-badge--starfinder) {
  border-color: #bfdbfe;
  color: #1d4ed8;
  background: #eff6ff;
}

.sessions-grid :deep(.session-cell-badge--positive) {
  border-color: #a7f3d0;
  color: #047857;
  background: #ecfdf5;
}

.sessions-grid :deep(.session-cell-badge--neutral) {
  border-color: #dbe3ee;
  color: #526174;
  background: #f5f7fa;
}

.sessions-grid--dark :deep(.session-cell-badge--pathfinder) {
  border-color: #276443;
  color: #83e6b4;
  background: #133425;
}

.sessions-grid--dark :deep(.session-cell-badge--starfinder) {
  border-color: #315b8f;
  color: #bfdbfe;
  background: #1c3555;
}

.sessions-grid--dark :deep(.session-cell-badge--positive) {
  border-color: #25634d;
  color: #a7f3d0;
  background: #173f32;
}

.sessions-grid--dark :deep(.session-cell-badge--neutral) {
  border-color: #3d4a5d;
  color: #cbd5e1;
  background: #222e3e;
}

.sessions-grid--compact :deep(.session-cell-badge) {
  block-size: 1.3rem;
  padding-inline: 0.42rem;
  font-size: 0.67rem;
}

.sessions-grid :deep(.sessions-grid__empty) {
  color: #64748b;
  font-size: 0.82rem;
}

.sessions-grid--dark :deep(.sessions-grid__empty) {
  color: #94a3b8;
}

@media (max-width: 599px) {
  .sessions-grid {
    min-block-size: 22rem;
  }

  .sessions-grid :deep(.ag-header-cell-menu-button),
  .sessions-grid :deep(.ag-header-cell-filter-button) {
    opacity: 1;
  }
}
</style>
