<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { copyToClipboard, useQuasar } from 'quasar';
import localforage from 'localforage';
import type { FilterModel } from 'ag-grid-community';

import ContextActionMenu from './ContextActionMenu.vue';
import type { ContextMenuAction, ContextMenuTrigger } from './context-menu-model';
import {
  compactGameSystem,
  filterCharacterRows,
  formatEffectiveLevel,
  formatShortDate,
  type CharacterPreset,
  type GameSystem,
} from '../domain';
import {
  downloadTableViewCsv,
  downloadTableViewXlsx,
  type TableExportView,
} from '../services';

export interface CharacterSummaryView {
  key: string;
  name: string;
  gameSystem: GameSystem;
  totalXp: number;
  effectiveLevel: number | null;
  sessionCount: number;
  lastPlayed?: string;
  orgplayid?: number;
  charid?: number | null;
}

interface GridColumnView {
  id: string;
  label: string;
  visible: boolean;
}

interface CharacterGridApi {
  applyPreset(preset: Exclude<CharacterPreset, 'custom'>): boolean;
  autoSizeColumns(): void;
  clearFilters(): void;
  exportCsv(filename?: string): void;
  exportXlsx(filename?: string): Promise<void>;
  fitColumns(): void;
  getColumns(): GridColumnView[];
  getExportView(): TableExportView | null;
  moveColumn(id: string, index: number): boolean;
  reset(): void;
  resize(): void;
  setColumnVisible(id: string, visible: boolean): boolean;
  setFloatingFilters(visible: boolean): boolean;
}

interface CharacterViewPreferences {
  query: string;
  density: 'compact' | 'comfortable';
  preset: CharacterPreset;
  floatingFilters: boolean;
  mobileSort: MobileCharacterSort;
}

type MobileCharacterSort = 'xp-desc' | 'name' | 'recent' | 'level' | 'sessions';

const props = withDefaults(defineProps<{
  rows: CharacterSummaryView[];
  dark?: boolean;
  density?: 'compact' | 'comfortable';
}>(), {
  dark: false,
  density: 'comfortable',
});

const emit = defineEmits<{ select: [row: CharacterSummaryView] }>();
const CharacterGrid = defineAsyncComponent(() => import('./CharacterGrid.vue'));
const $q = useQuasar();
const preferences = localforage.createInstance({ name: 'pfxp' });
const VIEW_KEY = 'pfxp:v3:characterView';

const root = ref<HTMLElement>();
const grid = ref<CharacterGridApi | null>(null);
const workspaceContextMenu = ref<InstanceType<typeof ContextActionMenu> | null>(null);
const rowContextMenu = ref<InstanceType<typeof ContextActionMenu> | null>(null);
const query = ref('');
const density = ref<'compact' | 'comfortable'>(props.density);
const preset = ref<CharacterPreset>('default');
const floatingFilters = ref(false);
const mobileSort = ref<MobileCharacterSort>('xp-desc');
const filterModel = ref<FilterModel>({});
const filteredCount = ref(props.rows.length);
const columns = ref<GridColumnView[]>([]);
const columnSearch = ref('');
const settingsReady = ref(false);
const fullscreen = ref(false);
const contextRow = ref<CharacterSummaryView | null>(null);

const normalizedQuery = computed(() => query.value.trim());
const columnFilterCount = computed(() => Object.keys(filterModel.value).length);
const totalFilterCount = computed(() => columnFilterCount.value + (normalizedQuery.value ? 1 : 0));
const filteredColumns = computed(() => {
  const needle = columnSearch.value.trim().toLocaleLowerCase();
  return needle
    ? columns.value.filter((column) => column.label.toLocaleLowerCase().includes(needle))
    : columns.value;
});

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLastPlayed(value?: string): string {
  return formatShortDate(value) || '—';
}

function displayGame(value: GameSystem): string {
  return density.value === 'compact' ? compactGameSystem(value) : value;
}

function levelLabel(row: CharacterSummaryView): string {
  return formatEffectiveLevel(row.totalXp, row.gameSystem);
}

const filtered = computed(() => {
  return filterCharacterRows(props.rows, normalizedQuery.value);
});

const mobileRows = computed(() => {
  const rows = [...filtered.value];
  switch (mobileSort.value) {
    case 'name':
      return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    case 'recent':
      return rows.sort((a, b) => (parseDate(b.lastPlayed)?.getTime() ?? 0) - (parseDate(a.lastPlayed)?.getTime() ?? 0));
    case 'level':
      return rows.sort((a, b) => (b.effectiveLevel ?? 0) - (a.effectiveLevel ?? 0) || b.totalXp - a.totalXp);
    case 'sessions':
      return rows.sort((a, b) => b.sessionCount - a.sessionCount || b.totalXp - a.totalXp);
    default:
      return rows.sort((a, b) => b.totalXp - a.totalXp || a.name.localeCompare(b.name));
  }
});

const visibleCount = computed(() => $q.screen.lt.md ? mobileRows.value.length : filteredCount.value);

function refreshColumns(): void {
  columns.value = grid.value?.getColumns() ?? [];
}

function applyPreset(value: Exclude<CharacterPreset, 'custom'>): void {
  preset.value = value;
  grid.value?.applyPreset(value);
  refreshColumns();
}

function setColumnVisible(column: GridColumnView, visible: boolean): void {
  grid.value?.setColumnVisible(column.id, visible);
  refreshColumns();
}

function moveColumn(column: GridColumnView, direction: -1 | 1): void {
  const index = columns.value.findIndex((item) => item.id === column.id);
  if (index < 0) return;
  grid.value?.moveColumn(column.id, index + direction);
  refreshColumns();
}

function setFloatingFilters(value: boolean): void {
  floatingFilters.value = value;
  grid.value?.setFloatingFilters(value);
}

function clearFilters(): void {
  query.value = '';
  filterModel.value = {};
  grid.value?.clearFilters();
}

function resetView(): void {
  query.value = '';
  density.value = 'comfortable';
  preset.value = 'default';
  floatingFilters.value = false;
  mobileSort.value = 'xp-desc';
  filterModel.value = {};
  grid.value?.reset();
  grid.value?.setFloatingFilters(false);
  refreshColumns();
  $q.notify({ message: 'Character view reset.', icon: 'r_restart_alt' });
}

function mobileExportView(): TableExportView {
  const exportColumns = [
    { id: 'name', header: 'Character', widthPx: 190 },
    { id: 'gameSystem', header: 'Game system', widthPx: 130 },
    { id: 'totalXp', header: 'XP', widthPx: 70 },
    { id: 'effectiveLevel', header: 'Level', widthPx: 90 },
    { id: 'sessionCount', header: 'Sessions', widthPx: 85 },
    { id: 'lastPlayed', header: 'Last played', widthPx: 100 },
    { id: 'orgplayid', header: 'Org ID', widthPx: 105 },
    { id: 'charid', header: 'Character ID', widthPx: 110 },
  ];
  return {
    sheetName: 'Characters',
    columns: exportColumns,
    rows: mobileRows.value.map((row) => [
      row.name,
      displayGame(row.gameSystem),
      row.totalXp,
      levelLabel(row),
      row.sessionCount,
      formatLastPlayed(row.lastPlayed),
      row.orgplayid,
      row.charid,
    ]),
  };
}

function currentExportView(): TableExportView | null {
  return $q.screen.lt.md ? mobileExportView() : grid.value?.getExportView() ?? null;
}

function exportCsv(): void {
  const view = currentExportView();
  if (view) downloadTableViewCsv(view, 'pfxp-characters.csv');
}

async function exportXlsx(): Promise<void> {
  const view = currentExportView();
  if (!view) return;
  try {
    await downloadTableViewXlsx(view, 'pfxp-characters.xlsx');
  } catch {
    $q.notify({ message: 'Unable to create the Excel workbook.', color: 'negative', icon: 'r_error' });
  }
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.value?.requestFullscreen();
  } catch {
    $q.notify({ message: 'Fullscreen is unavailable in this browser.', color: 'warning' });
  }
}

function onFullscreenChange(): void {
  fullscreen.value = document.fullscreenElement === root.value;
  nextTick(() => grid.value?.resize());
}

const workspaceActions = computed<ContextMenuAction[]>(() => [
  { id: 'filters', label: 'Filters', caption: totalFilterCount.value ? `${totalFilterCount.value} active` : 'Search and column filters', icon: 'r_filter_alt' },
  { id: 'filters-clear', label: 'Clear filters', icon: 'r_filter_alt_off', disabled: totalFilterCount.value === 0 },
  {
    id: 'columns',
    label: 'Show or hide columns',
    icon: 'r_view_column',
    separatorBefore: true,
    children: columns.value.map((column) => ({
      id: `column:${column.id}`,
      label: column.label,
      checked: column.visible,
      keepOpen: true,
      disabled: column.visible && columns.value.filter((item) => item.visible).length <= 1,
    })),
  },
  {
    id: 'preset',
    label: 'Column preset',
    icon: 'r_view_week',
    children: (['simple', 'default', 'full'] as const).map((value) => ({
      id: `preset:${value}`,
      label: value[0]!.toUpperCase() + value.slice(1),
      checked: preset.value === value,
    })),
  },
  {
    id: 'density',
    label: 'Row density',
    icon: 'r_density_medium',
    children: [
      { id: 'density:compact', label: 'Compact', checked: density.value === 'compact' },
      { id: 'density:comfortable', label: 'Comfortable', checked: density.value === 'comfortable' },
    ],
  },
  {
    id: 'sizing',
    label: 'Column sizing',
    icon: 'r_width_normal',
    children: [
      { id: 'size:auto', label: 'Reset all to auto width', icon: 'r_width_normal' },
      { id: 'size:fit', label: 'Fit viewport (manual)', icon: 'r_fit_screen' },
    ],
  },
  {
    id: 'export',
    label: 'Export current view',
    icon: 'r_download',
    separatorBefore: true,
    children: [
      { id: 'export:csv', label: 'CSV', icon: 'r_table_view' },
      { id: 'export:xlsx', label: 'Excel XLSX', icon: 'r_grid_on' },
    ],
  },
  { id: 'fullscreen', label: fullscreen.value ? 'Exit fullscreen' : 'Enter fullscreen', icon: fullscreen.value ? 'r_fullscreen_exit' : 'r_fullscreen' },
  { id: 'reset', label: 'Reset table view', icon: 'r_restart_alt', separatorBefore: true },
]);

function preserveNativeContextMenu(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable="true"], a[href]'));
}

function openWorkspaceContext(event: Event, trigger: ContextMenuTrigger): void {
  if (preserveNativeContextMenu(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  refreshColumns();
  workspaceContextMenu.value?.open(event, trigger);
}

function onWorkspaceContextKey(event: KeyboardEvent): void {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    openWorkspaceContext(event, 'keyboard');
  }
}

function handleWorkspaceAction(id: string): void {
  if (id === 'filters') setFloatingFilters(true);
  else if (id === 'filters-clear') clearFilters();
  else if (id.startsWith('column:')) {
    const column = columns.value.find((candidate) => candidate.id === id.slice(7));
    if (column) setColumnVisible(column, !column.visible);
  } else if (id.startsWith('preset:')) applyPreset(id.slice(7) as Exclude<CharacterPreset, 'custom'>);
  else if (id.startsWith('density:')) density.value = id.slice(8) as 'compact' | 'comfortable';
  else if (id === 'size:auto') grid.value?.autoSizeColumns();
  else if (id === 'size:fit') grid.value?.fitColumns();
  else if (id === 'export:csv') exportCsv();
  else if (id === 'export:xlsx') void exportXlsx();
  else if (id === 'fullscreen') void toggleFullscreen();
  else if (id === 'reset') resetView();
}

const rowContextActions = computed<ContextMenuAction[]>(() => {
  const row = contextRow.value;
  const ids = row ? `${row.orgplayid ?? '—'}-${row.charid ?? 'GM'}` : '';
  return [
    { id: 'character:open', label: 'View this character’s sessions', icon: 'r_open_in_new' },
    {
      id: 'copy',
      label: 'Copy',
      icon: 'r_content_copy',
      separatorBefore: true,
      children: [
        { id: 'copy:name', label: 'Character name', icon: 'r_person', disabled: !row?.name },
        { id: 'copy:ids', label: 'Organized Play IDs', caption: ids || undefined, icon: 'r_tag', disabled: !row },
        { id: 'copy:game', label: 'Game system', icon: 'r_sports_esports', disabled: !row?.gameSystem },
      ],
    },
    {
      id: 'sort',
      label: 'Sort characters',
      icon: 'r_sort',
      children: [
        { id: 'sort:xp-desc', label: 'Highest XP', checked: mobileSort.value === 'xp-desc' },
        { id: 'sort:name', label: 'Character name', checked: mobileSort.value === 'name' },
        { id: 'sort:recent', label: 'Recently played', checked: mobileSort.value === 'recent' },
        { id: 'sort:level', label: 'Highest level', checked: mobileSort.value === 'level' },
        { id: 'sort:sessions', label: 'Most sessions', checked: mobileSort.value === 'sessions' },
      ],
    },
    {
      id: 'export',
      label: 'Export current view',
      icon: 'r_download',
      separatorBefore: true,
      children: [
        { id: 'export:csv', label: 'CSV' },
        { id: 'export:xlsx', label: 'Excel XLSX' },
      ],
    },
  ];
});

function openRowContext(event: Event, row: CharacterSummaryView, trigger: ContextMenuTrigger): void {
  event.preventDefault();
  event.stopPropagation();
  contextRow.value = row;
  rowContextMenu.value?.open(event, trigger);
}

function touchHandler(row: CharacterSummaryView) {
  return ({ evt }: { evt: Event }) => openRowContext(evt, row, 'touch');
}

function onRowContextKey(event: KeyboardEvent, row: CharacterSummaryView): void {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    openRowContext(event, row, 'keyboard');
  }
}

async function copyValue(value: string, label: string): Promise<void> {
  if (!value) return;
  try {
    await copyToClipboard(value);
    $q.notify({ message: `${label} copied`, icon: 'r_content_copy', color: 'positive', timeout: 1800 });
  } catch {
    $q.notify({ message: `Could not copy ${label.toLocaleLowerCase()}.`, icon: 'r_error', color: 'negative' });
  }
}

function handleRowContextAction(id: string): void {
  const row = contextRow.value;
  if (!row) return;
  if (id === 'character:open') emit('select', row);
  else if (id === 'copy:name') void copyValue(row.name, 'Character name');
  else if (id === 'copy:ids') void copyValue(`${row.orgplayid ?? '—'}-${row.charid ?? 'GM'}`, 'Organized Play IDs');
  else if (id === 'copy:game') void copyValue(row.gameSystem, 'Game system');
  else if (id.startsWith('sort:')) mobileSort.value = id.slice(5) as MobileCharacterSort;
  else if (id === 'export:csv') exportCsv();
  else if (id === 'export:xlsx') void exportXlsx();
}

function persistView(): void {
  if (!settingsReady.value) return;
  const value: CharacterViewPreferences = {
    query: query.value,
    density: density.value,
    preset: preset.value,
    floatingFilters: floatingFilters.value,
    mobileSort: mobileSort.value,
  };
  void preferences.setItem(VIEW_KEY, value).catch(() => undefined);
}

onMounted(async () => {
  try {
    const saved = await preferences.getItem<Partial<CharacterViewPreferences>>(VIEW_KEY);
    if (saved) {
      if (typeof saved.query === 'string') query.value = saved.query;
      if (saved.density === 'compact' || saved.density === 'comfortable') density.value = saved.density;
      if (['simple', 'default', 'full', 'custom'].includes(saved.preset ?? '')) preset.value = saved.preset as CharacterPreset;
      if (typeof saved.floatingFilters === 'boolean') floatingFilters.value = saved.floatingFilters;
      if (['xp-desc', 'name', 'recent', 'level', 'sessions'].includes(saved.mobileSort ?? '')) {
        mobileSort.value = saved.mobileSort as MobileCharacterSort;
      }
    }
  } finally {
    settingsReady.value = true;
    document.addEventListener('fullscreenchange', onFullscreenChange);
    await nextTick();
    grid.value?.setFloatingFilters(floatingFilters.value);
    refreshColumns();
  }
});

watch([query, density, preset, floatingFilters, mobileSort], persistView);
watch(grid, (value) => {
  if (!value) return;
  value.setFloatingFilters(floatingFilters.value);
  refreshColumns();
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
});
</script>

<template>
  <section ref="root" class="characters" :class="{ 'characters--dark': dark, 'characters--fullscreen': fullscreen }">
    <div
      class="pfxp-toolbar characters__commandbar"
      @contextmenu="openWorkspaceContext($event, 'pointer')"
      @keydown="onWorkspaceContextKey"
    >
      <div class="pfxp-toolbar__primary">
        <q-input v-model="query" outlined dense clearable class="pfxp-search" placeholder="Search every character field…" aria-label="Search every character field">
          <template #prepend><q-icon name="r_search" /></template>
        </q-input>
      </div>

      <div class="pfxp-toolbar__actions pfxp-desktop-only" v-touch-hold:500:12="({ evt }: { evt: Event }) => openWorkspaceContext(evt, 'touch')">
        <q-btn outline no-caps icon="r_filter_alt" label="Filters" class="pfxp-command" :class="{ 'pfxp-command--active': totalFilterCount > 0 }">
          <q-badge v-if="totalFilterCount" color="primary" floating>{{ totalFilterCount }}</q-badge>
          <q-menu>
            <q-list style="min-width: 300px">
              <q-item-label header>Character filters</q-item-label>
              <q-item><q-item-section><q-toggle v-model="floatingFilters" color="primary" label="Show filter row below headers" @update:model-value="setFloatingFilters" /></q-item-section></q-item>
              <q-separator />
              <q-item clickable v-close-popup :disable="totalFilterCount === 0" @click="clearFilters"><q-item-section avatar><q-icon name="r_filter_alt_off" /></q-item-section><q-item-section>Clear all filters</q-item-section></q-item>
            </q-list>
          </q-menu>
        </q-btn>

        <q-btn outline no-caps icon="r_view_column" label="Columns" class="pfxp-command">
          <q-menu class="column-menu" @before-show="refreshColumns">
            <div class="column-menu__header"><strong>Columns & view</strong><q-btn flat round dense icon="r_close" v-close-popup aria-label="Close column manager" /></div>
            <div class="column-menu__presets">
              <q-btn v-for="value in ['simple', 'default', 'full'] as const" :key="value" unelevated no-caps :color="preset === value ? 'primary' : 'grey-2'" :text-color="preset === value ? 'white' : 'dark'" :label="value[0]!.toUpperCase() + value.slice(1)" @click="applyPreset(value)" />
            </div>
            <q-input v-model="columnSearch" borderless dense clearable placeholder="Find a column…" class="column-menu__search"><template #prepend><q-icon name="r_search" /></template></q-input>
            <q-scroll-area class="column-menu__list">
              <q-list dense>
                <q-item v-for="(column, index) in filteredColumns" :key="column.id">
                  <q-item-section avatar><q-checkbox :model-value="column.visible" :aria-label="`Show ${column.label}`" @update:model-value="setColumnVisible(column, $event === true)" /></q-item-section>
                  <q-item-section>{{ column.label }}</q-item-section>
                  <q-item-section side class="row no-wrap">
                    <q-btn flat round dense icon="r_keyboard_arrow_up" :disable="index === 0" :aria-label="`Move ${column.label} left`" @click="moveColumn(column, -1)" />
                    <q-btn flat round dense icon="r_keyboard_arrow_down" :disable="index === filteredColumns.length - 1" :aria-label="`Move ${column.label} right`" @click="moveColumn(column, 1)" />
                  </q-item-section>
                </q-item>
              </q-list>
            </q-scroll-area>
            <div class="column-menu__footer"><q-btn flat no-caps label="Reset to auto width" @click="grid?.autoSizeColumns()" /><q-btn flat no-caps label="Fit viewport" @click="grid?.fitColumns()" /></div>
          </q-menu>
        </q-btn>

        <q-btn-dropdown outline no-caps icon="r_view_week" :label="preset === 'custom' ? 'Custom' : preset[0]!.toUpperCase() + preset.slice(1)" class="pfxp-command">
          <q-list><q-item v-for="value in ['simple', 'default', 'full'] as const" :key="value" clickable v-close-popup @click="applyPreset(value)"><q-item-section>{{ value[0]!.toUpperCase() + value.slice(1) }}</q-item-section><q-item-section side v-if="preset === value"><q-icon name="r_check" color="primary" /></q-item-section></q-item></q-list>
        </q-btn-dropdown>

        <q-btn-dropdown outline no-caps icon="r_density_medium" :label="density === 'compact' ? 'Compact' : 'Comfortable'" class="pfxp-command">
          <q-list><q-item v-for="value in ['compact', 'comfortable'] as const" :key="value" clickable v-close-popup @click="density = value"><q-item-section>{{ value === 'compact' ? 'Compact' : 'Comfortable' }}</q-item-section><q-item-section side v-if="density === value"><q-icon name="r_check" color="primary" /></q-item-section></q-item></q-list>
        </q-btn-dropdown>

        <q-btn-dropdown outline no-caps icon="r_download" label="Export" class="pfxp-command">
          <q-list style="min-width: 250px">
            <q-item clickable v-close-popup @click="exportCsv"><q-item-section avatar><q-icon name="r_table_view" /></q-item-section><q-item-section><q-item-label>Current CSV</q-item-label><q-item-label caption>Visible columns and rows</q-item-label></q-item-section></q-item>
            <q-item clickable v-close-popup @click="exportXlsx"><q-item-section avatar><q-icon name="r_grid_on" /></q-item-section><q-item-section><q-item-label>Excel XLSX</q-item-label><q-item-label caption>Current browser view</q-item-label></q-item-section></q-item>
          </q-list>
        </q-btn-dropdown>
        <q-btn outline round :icon="fullscreen ? 'r_fullscreen_exit' : 'r_fullscreen'" class="pfxp-command" :aria-label="fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'" @click="toggleFullscreen" />
      </div>

      <div class="pfxp-mobile-actions pfxp-mobile-only">
        <q-btn outline no-caps icon="r_filter_alt" :label="`Filters${totalFilterCount ? ` ${totalFilterCount}` : ''}`" class="pfxp-command">
          <q-menu><q-list><q-item><q-item-section><q-toggle v-model="floatingFilters" label="Column filters" /></q-item-section></q-item><q-item clickable v-close-popup @click="clearFilters"><q-item-section>Clear filters</q-item-section></q-item></q-list></q-menu>
        </q-btn>
        <q-select v-model="mobileSort" outlined dense emit-value map-options options-dense class="pfxp-control" :options="[
          { label: 'Sort: Highest XP', value: 'xp-desc' },
          { label: 'Sort: Name', value: 'name' },
          { label: 'Sort: Recent', value: 'recent' },
          { label: 'Sort: Level', value: 'level' },
          { label: 'Sort: Sessions', value: 'sessions' },
        ]" />
        <q-btn outline round icon="r_more_vert" class="pfxp-command">
          <q-menu auto-close><q-list><q-item clickable @click="density = density === 'compact' ? 'comfortable' : 'compact'"><q-item-section avatar><q-icon name="r_density_medium" /></q-item-section><q-item-section>{{ density === 'compact' ? 'Comfortable' : 'Compact' }}</q-item-section></q-item><q-item clickable @click="exportCsv"><q-item-section avatar><q-icon name="r_table_view" /></q-item-section><q-item-section>Export CSV</q-item-section></q-item><q-item clickable @click="exportXlsx"><q-item-section avatar><q-icon name="r_grid_on" /></q-item-section><q-item-section>Export XLSX</q-item-section></q-item></q-list></q-menu>
        </q-btn>
      </div>

      <ContextActionMenu ref="workspaceContextMenu" title="Characters workspace" subtitle="Table, filters, layout, and export" :actions="workspaceActions" @select="handleWorkspaceAction" />
    </div>

    <div v-if="totalFilterCount" class="pfxp-filter-rail">
      <q-chip v-if="normalizedQuery" removable class="pfxp-filter-chip" @remove="query = ''">Search: {{ normalizedQuery }}</q-chip>
      <q-chip v-if="columnFilterCount" removable class="pfxp-filter-chip" @remove="clearFilters">{{ columnFilterCount }} column {{ columnFilterCount === 1 ? 'filter' : 'filters' }}</q-chip>
      <q-btn flat no-caps color="primary" label="Clear all" @click="clearFilters" />
    </div>

    <Suspense v-if="!$q.screen.lt.md && settingsReady">
      <CharacterGrid
        ref="grid"
        class="characters__grid"
        :rows="filtered"
        :dark="dark"
        :density="density"
        :preset="preset"
        @select="emit('select', $event)"
        @preset-customized="preset = 'custom'"
        @filter-model-changed="filterModel = $event"
        @filtered-count="filteredCount = $event"
      />
      <template #fallback><div class="characters__loading"><q-spinner color="primary" size="28px" /></div></template>
    </Suspense>

    <q-virtual-scroll v-else-if="$q.screen.lt.md" class="characters__mobile" :items="mobileRows" :virtual-scroll-item-size="density === 'compact' ? 74 : 88" v-slot="{ item }" @scroll.passive="rowContextMenu?.close()">
      <q-item clickable v-ripple v-touch-hold:500:12="touchHandler(item)" class="characters__mobile-row" :class="{ 'characters__mobile-row--compact': density === 'compact' }" @click="emit('select', item)" @contextmenu.prevent.stop="openRowContext($event, item, 'pointer')" @keydown="onRowContextKey($event, item)">
        <q-item-section><q-item-label class="text-weight-bold">{{ item.name }}</q-item-label><q-item-label caption>{{ displayGame(item.gameSystem) }} · {{ item.sessionCount }} sessions</q-item-label><q-item-label caption>Last played {{ formatLastPlayed(item.lastPlayed) }}</q-item-label></q-item-section>
        <q-item-section side class="characters__mobile-xp"><strong>{{ item.totalXp }} XP</strong><span>Level {{ levelLabel(item) }}</span><q-icon name="r_chevron_right" /></q-item-section>
      </q-item>
    </q-virtual-scroll>

    <footer class="pfxp-statusbar characters__statusbar">
      <span class="pfxp-statusbar__item"><q-icon name="r_format_list_numbered" size="18px" /> {{ visibleCount }} of {{ rows.length }} characters</span>
      <span v-if="totalFilterCount" class="pfxp-statusbar__item pfxp-statusbar__item--accent"><q-icon name="r_filter_alt" size="18px" /> {{ totalFilterCount }} {{ totalFilterCount === 1 ? 'filter' : 'filters' }} active</span>
      <span class="pfxp-statusbar__item pfxp-desktop-only"><q-icon name="r_mouse" size="18px" /> Right-click a row or header for actions</span>
      <span class="pfxp-statusbar__item pfxp-mobile-only"><q-icon name="r_touch_app" size="18px" /> Long-press a character for actions</span>
    </footer>

    <ContextActionMenu ref="rowContextMenu" title="Character actions" :subtitle="contextRow?.name" :actions="rowContextActions" @select="handleRowContextAction" />
  </section>
</template>

<style scoped>
.characters {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--pfxp-surface);
}

.characters--fullscreen {
  height: 100vh;
}

.characters__commandbar {
  flex: 0 0 auto;
}

.characters__grid,
.characters__loading {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 20rem;
}

.characters__loading {
  display: grid;
  place-items: center;
}

.characters__mobile {
  flex: 1 1 auto;
  min-height: 0;
}

.characters__mobile-row {
  width: 100%;
  min-height: 88px;
  border-bottom: 1px solid var(--pfxp-border);
  -webkit-touch-callout: none;
}

.characters__mobile-row--compact {
  min-height: 74px;
  padding-block: 7px;
}

.characters__mobile-row:focus-visible {
  z-index: 1;
  outline: 3px solid color-mix(in srgb, var(--pfxp-primary) 46%, transparent);
  outline-offset: -3px;
}

.characters__mobile-xp {
  align-items: flex-end;
  color: var(--pfxp-muted);
  font-size: 11px;
}

.characters__mobile-xp strong {
  color: var(--pfxp-primary);
  font-size: 14px;
}

.characters__statusbar {
  flex: 0 0 auto;
}
</style>
