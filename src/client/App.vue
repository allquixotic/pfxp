<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Dark, useQuasar } from 'quasar';
import localforage from 'localforage';
import type { FilterModel, GridState } from 'ag-grid-community';
import { createPaizoAccountIdentity } from '../account';

import { BUILD_ID, BUILD_TIMESTAMP } from '../build-info';
import WelcomePanel from './components/WelcomePanel.vue';
import MobileSessions from './components/MobileSessions.vue';
import SessionDetailDialog from './components/SessionDetailDialog.vue';
import ContextActionMenu from './components/ContextActionMenu.vue';
import GmRecognitions from './components/GmRecognitions';
import type { ContextMenuAction, ContextMenuTrigger } from './components/context-menu-model';
import FilterDrawer, {
  type CombineMode,
  type DateRangeFilter,
  type RoleFilter,
} from './components/FilterDrawer.vue';
import type { CharacterSummaryView } from './components/CharacterSummary.vue';
import {
  aggregateCharacterSummaries,
  characterKey,
  compactGameSystem,
  compactScenarioName,
  formatShortDate,
  parsePfxpDocument,
  searchSessionRows,
  type PfxpDocument,
  type SessionDetail,
} from './domain';
import {
  HistoryRepository,
  PfxpApiClient,
  ScrapeController,
  createFilteredSessionsExport,
  downloadFilteredSessions,
  downloadFullDocument,
  downloadTableViewCsv,
  downloadTableViewXlsx,
  type HistoryEntry,
  type ScrapeState,
  type TableExportView,
} from './services';

const CharacterSummary = defineAsyncComponent(() => import('./components/CharacterSummary.vue'));
const SessionsGrid = defineAsyncComponent(() => import('./components/SessionsGrid.vue'));

type ThemeMode = 'system' | 'light' | 'dark';
type Density = 'compact' | 'comfortable';
type Preset = 'simple' | 'default' | 'full' | 'custom';
type MobileSort = 'date-desc' | 'date-asc' | 'xp-desc' | 'character';

interface GridColumnView {
  id: string;
  label: string;
  visible: boolean;
}

interface SessionsGridApi {
  applyPreset(preset: Exclude<Preset, 'custom'>): boolean;
  autoSizeColumns(): void;
  fitColumns(): void;
  reset(): void;
  exportCsv(filename?: string): void;
  exportXlsx(filename?: string): Promise<void>;
  getExportView(): TableExportView | null;
  getCurrentRows(): SessionDetail[];
  getColumns(): GridColumnView[];
  setColumnVisible(id: string, visible: boolean): boolean;
  moveColumn(id: string, index: number): boolean;
  pinColumn(id: string, pinned: 'left' | 'right' | null): boolean;
  resize(): void;
  setFloatingFilters(visible: boolean): boolean;
  clearFilters(): void;
}

interface RunView extends HistoryEntry {
  label: string;
  timestamp: number;
}

const $q = useQuasar();
const preferences = localforage.createInstance({ name: 'pfxp' });
const historyRepository = new HistoryRepository();
const scrapeController = new ScrapeController(new PfxpApiClient());

const documentData = ref<PfxpDocument | null>(null);
const activeSource = ref('');
const activeRunId = ref<string | null>(null);
const activeTab = ref<'sessions' | 'characters'>('sessions');
const email = ref('');
const settingsReady = ref(false);
const busy = ref(false);
const scrapeState = ref<ScrapeState | null>(null);
const inlineError = ref('');

const themeMode = ref<ThemeMode>('system');
const darkActive = ref(false);
const density = ref<Density>('comfortable');
const preset = ref<Preset>('default');
const floatingFilters = ref(false);
const initialGridState = ref<GridState>();
const initialManualColumns = ref<string[]>([]);

const quickSearch = ref<string | null>('');
const searchTerms = ref<string[]>([]);
const combineMode = ref<CombineMode>('AND');
const gameFilter = ref<string | null>(null);
const characterFilter = ref<string | null>(null);
const exactCharacterKey = ref<string | null>(null);
const roleFilter = ref<RoleFilter>('all');
const dateRange = ref<DateRangeFilter>('any');
const excludeNoXp = ref(false);
const mobileSort = ref<MobileSort>('date-desc');
const filterDrawerOpen = ref(false);
const filterModel = ref<FilterModel>({});
const gridFilteredCount = ref(0);

const selectedSession = ref<SessionDetail | null>(null);
const detailOpen = ref(false);
const historyOpen = ref(false);
const historyEntries = ref<HistoryEntry[]>([]);
const columnSearch = ref('');
const columns = ref<GridColumnView[]>([]);
const fullscreen = ref(false);

interface AccountView {
  key: string;
  email: string;
  runCount: number;
  latestTimestamp: number;
  latestRunId: string;
}

interface SessionViewPreferences {
  quickSearch: string;
  searchTerms: string[];
  combineMode: CombineMode;
  gameFilter: string | null;
  characterFilter: string | null;
  exactCharacterKey: string | null;
  roleFilter: RoleFilter;
  dateRange: DateRangeFilter;
  excludeNoXp: boolean;
  mobileSort: MobileSort;
  density: Density;
  preset: Preset;
  floatingFilters: boolean;
  manualColumns: string[];
}

const sessionsGrid = ref<SessionsGridApi | null>(null);
const searchInput = ref<{ focus?: () => void } | null>(null);
const importInput = ref<HTMLInputElement>();
const workspacePage = ref<HTMLElement>();
const workspaceContextMenu = ref<{ open: (event: Event, trigger?: ContextMenuTrigger) => void; close: () => void }>();

const summaries = computed((): CharacterSummaryView[] => {
  if (!documentData.value) return [];
  return aggregateCharacterSummaries(documentData.value).map((row) => ({
    key: row.key,
    name: row.character || (row.charid == null ? 'GM sessions' : `Character ${row.charid}`),
    gameSystem: row.game,
    totalXp: row.totalXp,
    effectiveLevel: row.effectiveLevel,
    sessionCount: row.sessionCount,
    lastPlayed: row.lastPlayed ?? undefined,
    orgplayid: row.orgplayid,
    charid: row.charid,
  }));
});

const gameOptions = computed(() => uniqueSorted(documentData.value?.details.map((row) => row.gameSystem) ?? []));
const characterOptions = computed(() => uniqueSorted(documentData.value?.details.map((row) => row.character.name).filter(Boolean) ?? []));

const advancedRows = computed((): SessionDetail[] => {
  const source = documentData.value?.details ?? [];
  let rows = applyFuzzyTerms(source, searchTerms.value, combineMode.value);
  if (gameFilter.value) rows = rows.filter((row) => row.gameSystem === gameFilter.value);
  if (exactCharacterKey.value) {
    rows = rows.filter((row) => characterKey(row.player.orgplayid, row.player.charid, row.gameSystem) === exactCharacterKey.value);
  } else if (characterFilter.value) {
    rows = rows.filter((row) => row.character.name === characterFilter.value);
  }
  if (roleFilter.value !== 'all') {
    const expected = roleFilter.value === 'gm' ? 'yes' : 'no';
    rows = rows.filter((row) => row.prestigeReputation.isGM === expected);
  }
  const cutoff = dateCutoff(dateRange.value);
  if (cutoff) rows = rows.filter((row) => row.date && Date.parse(row.date) >= cutoff);
  if (excludeNoXp.value) rows = rows.filter((row) => Number.isFinite(row.xp) && row.xp > 0);
  return rows;
});

const searchedRows = computed((): SessionDetail[] => {
  const query = (quickSearch.value ?? '').trim();
  if (!query) return advancedRows.value;
  return searchSessionRows(advancedRows.value, query);
});

const mobileRows = computed((): SessionDetail[] => {
  const rows = [...searchedRows.value];
  switch (mobileSort.value) {
    case 'date-asc':
      return rows.sort((a, b) => dateValue(a.date) - dateValue(b.date));
    case 'xp-desc':
      return rows.sort((a, b) => b.xp - a.xp || dateValue(b.date) - dateValue(a.date));
    case 'character':
      return rows.sort((a, b) => a.character.name.localeCompare(b.character.name) || dateValue(b.date) - dateValue(a.date));
    default:
      return rows.sort((a, b) => dateValue(b.date) - dateValue(a.date));
  }
});

const activeFilterChips = computed(() => {
  const chips: Array<{ id: string; label: string }> = [];
  searchTerms.value.forEach((term, index) => {
    if (term.trim()) chips.push({ id: `term:${index}`, label: `Term: ${term.trim()}` });
  });
  if (gameFilter.value) chips.push({ id: 'game', label: `Game: ${gameFilter.value}` });
  if (characterFilter.value) {
    const exact = exactCharacterKey.value ? summaries.value.find((row) => row.key === exactCharacterKey.value) : undefined;
    const identity = exact ? ` · ${exact.orgplayid}-${exact.charid ?? 'GM'} · ${exact.gameSystem}` : '';
    chips.push({ id: 'character', label: `Character: ${characterFilter.value}${identity}` });
  }
  if (roleFilter.value !== 'all') chips.push({ id: 'role', label: roleFilter.value === 'gm' ? 'Role: GM' : 'Role: Player' });
  if (dateRange.value !== 'any') {
    const labels: Record<DateRangeFilter, string> = { any: '', '30d': 'Last 30 days', '12m': 'Last 12 months', year: 'This year' };
    chips.push({ id: 'date', label: `Date: ${labels[dateRange.value]}` });
  }
  if (excludeNoXp.value) chips.push({ id: 'no-xp', label: 'Exclude events with no XP reward' });
  return chips;
});

const columnFilterCount = computed(() => Object.keys(filterModel.value).length);
const totalFilterCount = computed(() => activeFilterChips.value.length + ($q.screen.lt.md ? 0 : columnFilterCount.value));
const visibleCount = computed(() => $q.screen.lt.md ? mobileRows.value.length : gridFilteredCount.value);
const runViews = computed<RunView[]>(() => historyEntries.value.map((entry) => ({
  ...entry,
  timestamp: entry.ts,
  label: entry.label,
})));
const activeRunEntry = computed(() => historyEntries.value.find((entry) => entry.id === activeRunId.value) ?? null);
const accountViews = computed<AccountView[]>(() => {
  const accounts = new Map<string, AccountView>();
  for (const entry of historyEntries.value) {
    if (!entry.accountKey || !entry.accountEmail) continue;
    const existing = accounts.get(entry.accountKey);
    if (!existing) {
      accounts.set(entry.accountKey, {
        key: entry.accountKey,
        email: entry.accountEmail,
        runCount: 1,
        latestTimestamp: entry.ts,
        latestRunId: entry.id,
      });
    } else {
      existing.runCount += 1;
      if (entry.ts > existing.latestTimestamp) {
        existing.latestTimestamp = entry.ts;
        existing.latestRunId = entry.id;
      }
    }
  }
  return [...accounts.values()].sort((left, right) => right.latestTimestamp - left.latestTimestamp);
});
const activeAccountEmail = computed(() => documentData.value?.account?.email
  ?? activeRunEntry.value?.accountEmail
  ?? (email.value ? createPaizoAccountIdentity(email.value).email : ''));
const filteredColumns = computed(() => {
  const query = columnSearch.value.trim().toLocaleLowerCase();
  if (!query) return columns.value;
  return columns.value.filter((column) => column.label.toLocaleLowerCase().includes(query));
});
const workspaceContextActions = computed<ContextMenuAction[]>(() => {
  const mobile = $q.screen.lt.md;
  const visibleColumns = columns.value.filter((column) => column.visible).length;
  const actions: ContextMenuAction[] = [
    {
      id: 'filters:open',
      label: 'Open filters',
      caption: totalFilterCount.value ? `${totalFilterCount.value} active` : 'Game, character, role, date, XP reward, and search terms',
      icon: 'r_filter_alt',
    },
    { id: 'filters:clear', label: 'Clear active filters', icon: 'r_filter_alt_off', disabled: totalFilterCount.value === 0 },
  ];

  if (mobile) {
    actions.push({
      id: 'mobile-sort',
      label: 'Sort sessions',
      icon: 'r_sort',
      separatorBefore: true,
      children: [
        { id: 'mobile-sort:date-desc', label: 'Newest first', icon: 'r_arrow_downward', checked: mobileSort.value === 'date-desc' },
        { id: 'mobile-sort:date-asc', label: 'Oldest first', icon: 'r_arrow_upward', checked: mobileSort.value === 'date-asc' },
        { id: 'mobile-sort:xp-desc', label: 'Most XP', icon: 'r_trending_up', checked: mobileSort.value === 'xp-desc' },
        { id: 'mobile-sort:character', label: 'Character name', icon: 'r_sort_by_alpha', checked: mobileSort.value === 'character' },
      ],
    });
  } else {
    actions.push(
      {
        id: 'columns',
        label: 'Show or hide columns',
        caption: `${visibleColumns} of ${columns.value.length} shown`,
        icon: 'r_view_column',
        separatorBefore: true,
        children: columns.value.map((column) => ({
          id: `column:${column.id}`,
          label: column.label,
          checked: column.visible,
          keepOpen: true,
          disabled: column.visible && visibleColumns <= 1,
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
        id: 'floating-filters',
        label: 'Floating column filters',
        icon: 'r_filter_list',
        checked: floatingFilters.value,
        keepOpen: true,
      },
      { id: 'columns:auto-size', label: 'Auto-size all columns', icon: 'r_width_normal', separatorBefore: true },
      { id: 'columns:fit', label: 'Fit columns to viewport', icon: 'r_fit_screen' },
    );
  }

  actions.push(
    {
      id: 'export',
      label: 'Export',
      icon: 'r_download',
      separatorBefore: true,
      children: [
        { id: 'export:csv', label: 'Visible sessions as CSV', icon: 'r_table_view' },
        { id: 'export:xlsx', label: 'Visible sessions as Excel XLSX', icon: 'r_grid_on' },
        { id: 'export:filtered-json', label: 'Filtered sessions as JSON', icon: 'r_filter_alt' },
        { id: 'export:full-json', label: 'Full PFXP JSON', icon: 'r_archive' },
      ],
    },
  );
  if (!mobile) {
    actions.push({
      id: 'fullscreen',
      label: fullscreen.value ? 'Exit fullscreen' : 'Enter fullscreen',
      icon: fullscreen.value ? 'r_fullscreen_exit' : 'r_fullscreen',
    });
  }
  actions.push({ id: 'view:reset', label: 'Reset table view', icon: 'r_restart_alt', separatorBefore: true });
  return actions;
});
const progressPercent = computed(() => {
  const percent = scrapeState.value?.progress?.percent;
  return typeof percent === 'number' ? Math.max(0, Math.min(1, percent / 100)) : 0;
});
const progressMessage = computed(() => {
  const state = scrapeState.value;
  if (!state) return 'Preparing request…';
  if (state.message) return state.message;
  if (state.status === 'queued') return state.progress?.queuePosition ? `Queued · position ${state.progress.queuePosition}` : 'Queued…';
  if (state.status === 'processing') return state.progress?.currentPage ? `Processing page ${state.progress.currentPage}${state.progress.totalPages ? ` of ${state.progress.totalPages}` : ''}` : 'Processing sessions…';
  return 'Finalizing…';
});
const themeIcon = computed(() => themeMode.value === 'system' ? 'r_brightness_auto' : darkActive.value ? 'r_dark_mode' : 'r_light_mode');

function mobileSessionExportView(): TableExportView {
  const compact = density.value === 'compact';
  return {
    sheetName: 'Sessions',
    columns: [
      { id: 'date', header: 'Date', widthPx: 100 },
      { id: 'scenario', header: 'Scenario', widthPx: 320 },
      { id: 'character.name', header: 'Character', widthPx: 180 },
      { id: 'gameSystem', header: 'Game system', widthPx: 130 },
      { id: 'xp', header: 'XP', widthPx: 70 },
      { id: 'role', header: 'Role', widthPx: 80 },
    ],
    rows: mobileRows.value.map((row) => [
      compact ? formatShortDate(row.date) : row.date,
      compact ? compactScenarioName(row.scenario) : row.scenario,
      row.character.name,
      compact ? compactGameSystem(row.gameSystem) : row.gameSystem,
      row.xp,
      row.prestigeReputation.isGM === 'yes' ? 'GM' : 'Player',
    ]),
  };
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function persistPreference<T>(key: string, value: T) {
  void preferences.setItem(key, value).catch(() => undefined);
}

async function readPreference<T>(key: string): Promise<T | null> {
  try {
    return await preferences.getItem<T>(key);
  } catch {
    return null;
  }
}

function dateValue(value?: string) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateCutoff(value: DateRangeFilter) {
  const now = new Date();
  if (value === '30d') return now.getTime() - 30 * 86_400_000;
  if (value === '12m') {
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    return cutoff.getTime();
  }
  if (value === 'year') return new Date(now.getFullYear(), 0, 1).getTime();
  return null;
}

function applyFuzzyTerms(rows: SessionDetail[], terms: string[], combine: CombineMode) {
  const nonempty = terms.map((term) => term.trim()).filter(Boolean);
  if (!nonempty.length) return rows;
  const sets = nonempty.map((term) => new Set(searchSessionRows(rows, term, { threshold: 0.3, shouldSort: false })));
  return rows.filter((row) => combine === 'AND' ? sets.every((set) => set.has(row)) : sets.some((set) => set.has(row)));
}

function removeFilterChip(id: string) {
  if (id.startsWith('term:')) {
    const index = Number(id.split(':')[1]);
    searchTerms.value = searchTerms.value.filter((_, termIndex) => termIndex !== index);
  } else if (id === 'game') gameFilter.value = null;
  else if (id === 'character') setCharacterFacet(null);
  else if (id === 'role') roleFilter.value = 'all';
  else if (id === 'date') dateRange.value = 'any';
  else if (id === 'no-xp') excludeNoXp.value = false;
}

function clearAllFilters() {
  searchTerms.value = [];
  gameFilter.value = null;
  characterFilter.value = null;
  exactCharacterKey.value = null;
  roleFilter.value = 'all';
  dateRange.value = 'any';
  excludeNoXp.value = false;
  filterModel.value = {};
  sessionsGrid.value?.clearFilters();
}

async function activateDocument(value: PfxpDocument, source: string, options: { save?: boolean; runId?: string | null } = {}) {
  const account = value.account ?? (source === 'fetch' && email.value
    ? createPaizoAccountIdentity(email.value)
    : undefined);
  const normalized = account && !value.account ? { ...value, account } : value;
  documentData.value = normalized;
  activeSource.value = source;
  activeRunId.value = options.runId ?? null;
  gridFilteredCount.value = normalized.details.length;
  inlineError.value = '';
  if (account) {
    email.value = account.email;
    persistPreference('pfxp:user:email', account.email);
  }
  if (options.save !== false) {
    try {
      const entry = await historyRepository.add(normalized, source);
      activeRunId.value = entry.id;
      await refreshHistory();
    } catch {
      activeRunId.value = null;
      $q.notify({
        message: 'Your data loaded, but this browser could not save it to Previous runs.',
        color: 'warning',
        icon: 'r_storage',
      });
    }
  }
  await nextTick();
  sessionsGrid.value?.setFloatingFilters(floatingFilters.value);
}

async function startScrape(credentials: { email: string; password: string }) {
  if (busy.value) return;
  const submittedEmail = createPaizoAccountIdentity(credentials.email).email;
  let submittedPassword = credentials.password;
  credentials.password = '';
  busy.value = true;
  inlineError.value = '';
  email.value = submittedEmail;
  persistPreference('pfxp:user:email', email.value);
  try {
    const scrapePromise = scrapeController.start(submittedEmail, submittedPassword);
    submittedPassword = '';
    const result = await scrapePromise;
    if (result.status === 'ready') {
      await activateDocument(result.data, 'fetch');
      $q.notify({ message: `Loaded ${result.data.details.length} sessions`, color: 'positive', icon: 'r_check_circle' });
    } else {
      const message = result.message || (result.status === 'blocked' ? 'Paizo sign-in is temporarily blocked.' : 'Unable to fetch sessions.');
      inlineError.value = message;
      $q.notify({ message, color: result.status === 'blocked' ? 'warning' : 'negative', icon: 'r_error' });
    }
  } catch (error) {
    if ((error as { name?: string })?.name !== 'AbortError') {
      const message = error instanceof Error ? error.message : 'Unable to fetch sessions.';
      inlineError.value = message;
      $q.notify({ message, color: 'negative', icon: 'r_error' });
    }
  } finally {
    submittedPassword = '';
    busy.value = false;
  }
}

function refreshFromPaizo() {
  if (!email.value || busy.value) return;
  $q.dialog({
    title: 'Refresh from Paizo',
    message: `Enter the password for ${email.value}. It is encrypted in your browser and is not saved.`,
    prompt: { model: '', type: 'password', isValid: (value) => String(value).length > 0 },
    cancel: true,
    persistent: true,
  }).onOk((password: string) => void startScrape({ email: email.value, password }));
}

async function importFile(file: File) {
  try {
    const parsed = parsePfxpDocument(await file.text());
    await activateDocument(parsed, 'file');
    $q.notify({ message: `Opened ${file.name}`, color: 'positive', icon: 'r_file_open' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'This is not a valid PFXP export.';
    inlineError.value = message;
    $q.notify({ message, color: 'negative', icon: 'r_error' });
  } finally {
    if (importInput.value) importInput.value.value = '';
  }
}

function triggerImport() {
  importInput.value?.click();
}

async function refreshHistory() {
  historyEntries.value = await historyRepository.list();
}

async function loadHistoryRun(id: string) {
  try {
    const saved = await historyRepository.load(id);
    if (!saved) {
      $q.notify({ message: 'That saved run is no longer available.', color: 'warning' });
      return;
    }
    historyOpen.value = false;
    await activateDocument(saved.document, saved.entry.source, { save: false, runId: id });
  } catch {
    $q.notify({ message: 'That saved run could not be opened.', color: 'negative', icon: 'r_error' });
  }
}

async function switchAccount(accountKey: string): Promise<void> {
  const account = accountViews.value.find((candidate) => candidate.key === accountKey);
  if (!account) return;
  await loadHistoryRun(account.latestRunId);
}

function addPaizoAccount(): void {
  closeDocument();
  email.value = '';
  persistPreference('pfxp:user:email', '');
  inlineError.value = '';
}

function deleteHistoryRun(entry: HistoryEntry) {
  $q.dialog({ title: 'Delete saved run?', message: 'This removes the browser copy only.', cancel: true, persistent: true })
    .onOk(async () => {
      await historyRepository.remove(entry.id);
      if (activeRunId.value === entry.id) activeRunId.value = null;
      await refreshHistory();
    });
}

function clearHistory() {
  $q.dialog({ title: 'Delete all saved runs?', message: 'This cannot be undone.', cancel: true, persistent: true })
    .onOk(async () => {
      await historyRepository.clear();
      activeRunId.value = null;
      await refreshHistory();
    });
}

function closeDocument() {
  documentData.value = null;
  activeRunId.value = null;
  activeSource.value = '';
  selectedSession.value = null;
  detailOpen.value = false;
  scrapeController.stop();
  busy.value = false;
}

function showSession(session: SessionDetail | null) {
  selectedSession.value = session;
  detailOpen.value = !!session;
}

function filterByCharacter(name: string) {
  characterFilter.value = name;
  const session = selectedSession.value;
  exactCharacterKey.value = session && session.character.name === name
    ? characterKey(session.player.orgplayid, session.player.charid, session.gameSystem)
    : null;
  activeTab.value = 'sessions';
  detailOpen.value = false;
  filterDrawerOpen.value = false;
}

function filterBySessionCharacter(session: SessionDetail) {
  selectedSession.value = session;
  filterByCharacter(session.character.name);
}

function filterByGame(gameSystem: string) {
  gameFilter.value = gameSystem;
  activeTab.value = 'sessions';
  detailOpen.value = false;
  filterDrawerOpen.value = false;
}

function filterByRole(role: 'gm' | 'player') {
  roleFilter.value = role;
  activeTab.value = 'sessions';
  detailOpen.value = false;
  filterDrawerOpen.value = false;
}

function onCharacterSelected(row: CharacterSummaryView) {
  characterFilter.value = row.name;
  exactCharacterKey.value = row.key;
  activeTab.value = 'sessions';
  detailOpen.value = false;
  filterDrawerOpen.value = false;
}

function setCharacterFacet(value: string | null) {
  characterFilter.value = value;
  exactCharacterKey.value = null;
}

function applyPreset(value: Exclude<Preset, 'custom'>) {
  preset.value = value;
  sessionsGrid.value?.applyPreset(value);
  refreshColumns();
}

function refreshColumns() {
  columns.value = sessionsGrid.value?.getColumns() ?? [];
}

function setColumnVisible(column: GridColumnView, visible: boolean) {
  sessionsGrid.value?.setColumnVisible(column.id, visible);
  refreshColumns();
}

function moveColumn(column: GridColumnView, direction: -1 | 1) {
  const index = columns.value.findIndex((item) => item.id === column.id);
  if (index < 0) return;
  sessionsGrid.value?.moveColumn(column.id, index + direction);
  refreshColumns();
}

function setFloatingFilters(value: boolean) {
  floatingFilters.value = value;
  sessionsGrid.value?.setFloatingFilters(value);
}

function clearColumnFilters() {
  filterModel.value = {};
  sessionsGrid.value?.clearFilters();
}

function resetView() {
  sessionsGrid.value?.reset();
  preset.value = 'default';
  density.value = 'comfortable';
  setFloatingFilters(false);
  clearAllFilters();
  quickSearch.value = '';
  initialGridState.value = undefined;
  initialManualColumns.value = [];
  void preferences.removeItem('pfxp:v3:sessionGridState').catch(() => undefined);
  void preferences.removeItem('pfxp:v2:gridState').catch(() => undefined);
  $q.notify({ message: 'View reset. Saved runs and theme were kept.', icon: 'r_restart_alt' });
}

function preserveNativeContextMenu(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(
    'input, textarea, select, option, [contenteditable="true"], a[href], [role="textbox"]',
  );
}

function openWorkspaceContext(event: Event, trigger: ContextMenuTrigger = 'pointer') {
  if (preserveNativeContextMenu(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  if (!$q.screen.lt.md) refreshColumns();
  workspaceContextMenu.value?.open(event, trigger);
}

function openWorkspaceHold({ evt }: { evt: Event }) {
  openWorkspaceContext(evt, 'touch');
}

function onWorkspaceContextKey(event: KeyboardEvent) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  openWorkspaceContext(event, 'keyboard');
}

function handleWorkspaceContextAction(id: string) {
  if (id === 'filters:open') filterDrawerOpen.value = true;
  else if (id === 'filters:clear') clearAllFilters();
  else if (id.startsWith('column:')) {
    const column = columns.value.find((candidate) => candidate.id === id.slice(7));
    if (column) setColumnVisible(column, !column.visible);
  } else if (id.startsWith('preset:')) applyPreset(id.slice(7) as Exclude<Preset, 'custom'>);
  else if (id.startsWith('density:')) density.value = id.slice(8) as Density;
  else if (id === 'floating-filters') setFloatingFilters(!floatingFilters.value);
  else if (id === 'columns:auto-size') sessionsGrid.value?.autoSizeColumns();
  else if (id === 'columns:fit') sessionsGrid.value?.fitColumns();
  else if (id.startsWith('mobile-sort:')) mobileSort.value = id.slice(12) as MobileSort;
  else if (id === 'export:csv') exportCsv();
  else if (id === 'export:xlsx') void exportXlsx();
  else if (id === 'export:filtered-json') exportFilteredJson();
  else if (id === 'export:full-json') exportFullJson();
  else if (id === 'fullscreen') void toggleFullscreen();
  else if (id === 'view:reset') resetView();
}

function currentRowsForExport(): SessionDetail[] {
  if ($q.screen.lt.md) return mobileRows.value;
  return (sessionsGrid.value?.getCurrentRows() ?? searchedRows.value) as SessionDetail[];
}

function exportFullJson() {
  if (documentData.value) downloadFullDocument(documentData.value, 'pfxp-full.json');
}

function exportFilteredJson() {
  if (!documentData.value) return;
  const rows = currentRowsForExport();
  const value = createFilteredSessionsExport(documentData.value, rows, {
    context: { query: quickSearch.value ?? '', filters: activeFilterChips.value.map((chip) => chip.label) },
  });
  downloadFilteredSessions(value, 'pfxp-filtered-sessions.json');
}

function exportCsv() {
  const view = $q.screen.lt.md
    ? mobileSessionExportView()
    : sessionsGrid.value?.getExportView();
  if (view) downloadTableViewCsv(view, 'pfxp-sessions.csv');
}

async function exportXlsx() {
  const view = $q.screen.lt.md
    ? mobileSessionExportView()
    : sessionsGrid.value?.getExportView();
  if (!view) return;
  try {
    await downloadTableViewXlsx(view, 'pfxp-sessions.xlsx');
  } catch {
    $q.notify({ message: 'Unable to create the Excel workbook.', color: 'negative', icon: 'r_error' });
  }
}

async function toggleFullscreen() {
  try {
    if (globalThis.document.fullscreenElement) await globalThis.document.exitFullscreen();
    else await workspacePage.value?.requestFullscreen();
  } catch {
    $q.notify({ message: 'Fullscreen is unavailable in this browser.', color: 'warning' });
  }
}

function onFullscreenChange() {
  fullscreen.value = globalThis.document.fullscreenElement === workspacePage.value;
  nextTick(() => sessionsGrid.value?.resize());
}

function setTheme(mode: ThemeMode) {
  themeMode.value = mode;
  applyTheme();
  persistPreference('pfxp:v2:theme', mode);
}

function applyTheme() {
  const systemDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const nextDark = themeMode.value === 'dark' || (themeMode.value === 'system' && systemDark);
  Dark.set(nextDark);
  darkActive.value = nextDark;
}

function formatHistoryDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

function onGlobalKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const editing = target?.matches('input, textarea, select, [contenteditable="true"]');
  if (!editing && (event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'))) {
    event.preventDefault();
    searchInput.value?.focus?.();
  }
}

async function persistGridState(state: GridState) {
  initialGridState.value = state;
  try {
    await preferences.setItem('pfxp:v3:sessionGridState', state);
  } catch {
    // The active grid remains usable when browser storage is unavailable.
  }
}

function persistManualColumns(columns: string[]): void {
  initialManualColumns.value = columns;
  persistSessionView();
}

function persistSessionView(): void {
  if (!settingsReady.value) return;
  const value: SessionViewPreferences = {
    quickSearch: quickSearch.value ?? '',
    searchTerms: [...searchTerms.value],
    combineMode: combineMode.value,
    gameFilter: gameFilter.value,
    characterFilter: characterFilter.value,
    exactCharacterKey: exactCharacterKey.value,
    roleFilter: roleFilter.value,
    dateRange: dateRange.value,
    excludeNoXp: excludeNoXp.value,
    mobileSort: mobileSort.value,
    density: density.value,
    preset: preset.value,
    floatingFilters: floatingFilters.value,
    manualColumns: [...initialManualColumns.value],
  };
  void preferences.setItem('pfxp:v3:sessionView', value).catch(() => undefined);
}

function onFilteredCount(count: number) {
  gridFilteredCount.value = count;
  if (floatingFilters.value) sessionsGrid.value?.setFloatingFilters(true);
}

const unsubscribeScrape = scrapeController.subscribe((state) => { scrapeState.value = state; });
let mediaQuery: MediaQueryList | null = null;
const onSystemThemeChange = () => { if (themeMode.value === 'system') applyTheme(); };

onMounted(async () => {
  try {
    const [
      savedTheme,
      legacyTheme,
      savedEmail,
      savedSessionView,
      savedGridState,
      legacyGridState,
      legacyDensity,
      legacyPreset,
      legacyFloating,
      savedActiveTab,
    ] = await Promise.all([
      readPreference<ThemeMode>('pfxp:v2:theme'),
      readPreference<'light' | 'dark'>('theme:preference'),
      readPreference<string>('pfxp:user:email'),
      readPreference<Partial<SessionViewPreferences>>('pfxp:v3:sessionView'),
      readPreference<GridState>('pfxp:v3:sessionGridState'),
      readPreference<GridState>('pfxp:v2:gridState'),
      readPreference<Density>('pfxp:v2:density'),
      readPreference<Preset>('pfxp:viewPreset'),
      readPreference<boolean>('pfxp:v2:floatingFilters'),
      readPreference<'sessions' | 'characters'>('pfxp:v3:activeTab'),
    ]);
    themeMode.value = savedTheme ?? legacyTheme ?? 'system';
    email.value = savedEmail ?? '';
    density.value = savedSessionView?.density ?? legacyDensity ?? 'comfortable';
    preset.value = savedSessionView?.preset ?? legacyPreset ?? 'default';
    floatingFilters.value = savedSessionView?.floatingFilters ?? legacyFloating ?? false;
    quickSearch.value = savedSessionView?.quickSearch ?? '';
    searchTerms.value = Array.isArray(savedSessionView?.searchTerms)
      ? savedSessionView.searchTerms.filter((value): value is string => typeof value === 'string')
      : [];
    combineMode.value = savedSessionView?.combineMode === 'OR' ? 'OR' : 'AND';
    gameFilter.value = savedSessionView?.gameFilter ?? null;
    characterFilter.value = savedSessionView?.characterFilter ?? null;
    exactCharacterKey.value = savedSessionView?.exactCharacterKey ?? null;
    roleFilter.value = ['gm', 'player'].includes(savedSessionView?.roleFilter ?? '')
      ? savedSessionView!.roleFilter as RoleFilter
      : 'all';
    dateRange.value = ['30d', '12m', 'year'].includes(savedSessionView?.dateRange ?? '')
      ? savedSessionView!.dateRange as DateRangeFilter
      : 'any';
    excludeNoXp.value = savedSessionView?.excludeNoXp === true;
    mobileSort.value = ['date-asc', 'xp-desc', 'character'].includes(savedSessionView?.mobileSort ?? '')
      ? savedSessionView!.mobileSort as MobileSort
      : 'date-desc';
    initialManualColumns.value = Array.isArray(savedSessionView?.manualColumns)
      ? savedSessionView.manualColumns.filter((value): value is string => typeof value === 'string')
      : [];
    activeTab.value = savedActiveTab === 'characters' ? 'characters' : 'sessions';
    initialGridState.value = savedGridState ?? legacyGridState ?? undefined;
    try {
      await historyRepository.migrateLegacyAccounts(email.value);
      await refreshHistory();
      let unreadableRuns = 0;
      for (const entry of historyEntries.value) {
        try {
          const saved = await historyRepository.load(entry.id);
          if (!saved) continue;
          await activateDocument(saved.document, saved.entry.source, { save: false, runId: saved.entry.id });
          break;
        } catch {
          unreadableRuns += 1;
        }
      }
      if (unreadableRuns) {
        $q.notify({
          message: `${unreadableRuns} saved ${unreadableRuns === 1 ? 'run was' : 'runs were'} unreadable; the newest valid run was opened.`,
          color: 'warning',
          icon: 'r_warning',
        });
      }
    } catch {
      historyEntries.value = [];
      $q.notify({ message: 'Previous runs are unavailable in this browser.', color: 'warning', icon: 'r_storage' });
    }
  } finally {
    applyTheme();
    settingsReady.value = true;
  }

  mediaQuery = globalThis.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  mediaQuery?.addEventListener('change', onSystemThemeChange);
  globalThis.addEventListener('keydown', onGlobalKeydown);
  globalThis.document.addEventListener('fullscreenchange', onFullscreenChange);
});

watch([
  quickSearch,
  searchTerms,
  combineMode,
  gameFilter,
  characterFilter,
  exactCharacterKey,
  roleFilter,
  dateRange,
  excludeNoXp,
  mobileSort,
  density,
  preset,
  floatingFilters,
], persistSessionView, { deep: true });
watch(activeTab, (value) => {
  if (settingsReady.value) persistPreference('pfxp:v3:activeTab', value);
});

onBeforeUnmount(() => {
  scrapeController.stop();
  unsubscribeScrape();
  mediaQuery?.removeEventListener('change', onSystemThemeChange);
  globalThis.removeEventListener('keydown', onGlobalKeydown);
  globalThis.document.removeEventListener('fullscreenchange', onFullscreenChange);
});
</script>

<template>
  <q-layout view="hHh lpR fFf" class="pfxp-app">
    <q-header class="pfxp-header">
      <div class="pfxp-header__inner">
        <div class="pfxp-brand" aria-label="PFXP Organized Play">
          <span class="pfxp-brand__name">PFXP</span>
          <span class="pfxp-brand__descriptor">Organized Play</span>
          <span class="pfxp-build" :title="`Built ${BUILD_TIMESTAMP}`">{{ BUILD_ID }}</span>
        </div>

        <div class="pfxp-header__actions pfxp-desktop-only">
          <q-btn flat no-caps class="pfxp-header-action" icon="r_switch_account" label="Accounts">
            <q-menu auto-close>
              <q-list style="min-width: 300px">
                <q-item-label header>Paizo accounts</q-item-label>
                <q-item v-for="account in accountViews" :key="account.key" clickable :active="account.key === documentData?.account?.key" active-class="text-primary bg-blue-1" @click="switchAccount(account.key)">
                  <q-item-section avatar><q-icon name="r_account_circle" /></q-item-section>
                  <q-item-section><q-item-label>{{ account.email }}</q-item-label><q-item-label caption>{{ account.runCount }} saved {{ account.runCount === 1 ? 'run' : 'runs' }} · latest {{ formatHistoryDate(account.latestTimestamp) }}</q-item-label></q-item-section>
                  <q-item-section side v-if="account.key === documentData?.account?.key"><q-icon name="r_check" color="primary" /></q-item-section>
                </q-item>
                <q-separator />
                <q-item clickable @click="addPaizoAccount"><q-item-section avatar><q-icon name="r_person_add" /></q-item-section><q-item-section>Add another Paizo account</q-item-section></q-item>
              </q-list>
            </q-menu>
          </q-btn>
          <q-btn flat no-caps class="pfxp-header-action" icon="r_history" label="Previous runs" :disable="!historyEntries.length" @click="historyOpen = true" />
          <q-btn flat no-caps class="pfxp-header-action" icon="r_upload_file" label="Import JSON" @click="triggerImport" />
          <q-btn flat no-caps class="pfxp-header-action" icon="r_refresh" label="Refresh" :loading="busy" :disable="!email || busy" @click="refreshFromPaizo" />
          <q-btn flat round class="pfxp-header-action" :icon="themeIcon" aria-label="Change appearance">
            <q-menu auto-close>
              <q-list style="min-width: 170px">
                <q-item clickable @click="setTheme('system')"><q-item-section avatar><q-icon name="r_brightness_auto" /></q-item-section><q-item-section>System</q-item-section><q-item-section side v-if="themeMode === 'system'"><q-icon name="r_check" color="primary" /></q-item-section></q-item>
                <q-item clickable @click="setTheme('light')"><q-item-section avatar><q-icon name="r_light_mode" /></q-item-section><q-item-section>Light</q-item-section><q-item-section side v-if="themeMode === 'light'"><q-icon name="r_check" color="primary" /></q-item-section></q-item>
                <q-item clickable @click="setTheme('dark')"><q-item-section avatar><q-icon name="r_dark_mode" /></q-item-section><q-item-section>Dark</q-item-section><q-item-section side v-if="themeMode === 'dark'"><q-icon name="r_check" color="primary" /></q-item-section></q-item>
              </q-list>
            </q-menu>
          </q-btn>
          <q-btn flat round icon="r_more_vert" aria-label="More actions">
            <q-menu auto-close>
              <q-list style="min-width: 220px">
                <q-item v-if="documentData" clickable @click="addPaizoAccount"><q-item-section avatar><q-icon name="r_person_add" /></q-item-section><q-item-section>Add Paizo account</q-item-section></q-item>
                <q-item v-if="documentData" clickable @click="resetView"><q-item-section avatar><q-icon name="r_restart_alt" /></q-item-section><q-item-section>Reset view</q-item-section></q-item>
                <q-separator />
                <q-item><q-item-section><q-item-label caption>Build {{ BUILD_ID }}</q-item-label></q-item-section></q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>

        <div class="pfxp-header__actions pfxp-mobile-only">
          <q-btn flat round icon="r_history" aria-label="Previous runs" :disable="!historyEntries.length" @click="historyOpen = true" />
          <q-btn flat round icon="r_refresh" aria-label="Refresh from Paizo" :loading="busy" :disable="!email || busy" @click="refreshFromPaizo" />
          <q-btn flat round icon="r_more_vert" aria-label="More actions">
            <q-menu auto-close>
              <q-list style="min-width: 220px">
                <q-item v-for="account in accountViews" :key="account.key" clickable @click="switchAccount(account.key)"><q-item-section avatar><q-icon name="r_account_circle" /></q-item-section><q-item-section><q-item-label>{{ account.email }}</q-item-label><q-item-label caption>{{ account.runCount }} saved {{ account.runCount === 1 ? 'run' : 'runs' }}</q-item-label></q-item-section><q-item-section side v-if="account.key === documentData?.account?.key"><q-icon name="r_check" color="primary" /></q-item-section></q-item>
                <q-item clickable @click="addPaizoAccount"><q-item-section avatar><q-icon name="r_person_add" /></q-item-section><q-item-section>Add Paizo account</q-item-section></q-item>
                <q-separator />
                <q-item clickable @click="triggerImport"><q-item-section avatar><q-icon name="r_upload_file" /></q-item-section><q-item-section>Import JSON</q-item-section></q-item>
                <q-item clickable @click="setTheme(darkActive ? 'light' : 'dark')"><q-item-section avatar><q-icon :name="darkActive ? 'r_light_mode' : 'r_dark_mode'" /></q-item-section><q-item-section>{{ darkActive ? 'Light appearance' : 'Dark appearance' }}</q-item-section></q-item>
                <q-item v-if="documentData" clickable @click="resetView"><q-item-section avatar><q-icon name="r_restart_alt" /></q-item-section><q-item-section>Reset view</q-item-section></q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>
      </div>
    </q-header>

    <q-page-container>
      <div v-if="!settingsReady" class="pfxp-empty-page"><q-spinner color="primary" size="36px" /></div>

      <div v-else-if="!documentData" class="pfxp-empty-page">
        <div class="full-width">
          <q-banner v-if="inlineError" rounded class="bg-red-1 text-negative q-mx-auto q-mb-md" style="max-width: 960px">
            <template #avatar><q-icon name="r_error" /></template>{{ inlineError }}
          </q-banner>
          <WelcomePanel
            :email="email"
            :busy="busy"
            :runs="runViews"
            @update:email="email = $event"
            @submit="startScrape"
            @import="importFile"
            @load-run="loadHistoryRun"
            @manage-runs="historyOpen = true"
          />
        </div>
      </div>

      <template v-else>
        <div class="pfxp-workspace-shell">
          <div class="pfxp-tabs-wrap">
            <div class="pfxp-active-run" aria-label="Loaded run">
              <div><q-icon name="r_history" /><strong>{{ activeRunEntry?.label ?? (activeSource === 'fetch' ? 'Paizo account fetch' : 'Loaded data') }}</strong><span v-if="activeAccountEmail">{{ activeAccountEmail }}</span></div>
              <time v-if="activeRunEntry" :datetime="new Date(activeRunEntry.ts).toISOString()">{{ formatHistoryDate(activeRunEntry.ts) }}</time>
            </div>
            <GmRecognitions
              v-if="documentData.gmRecognitions?.length"
              :blocks="documentData.gmRecognitions"
            />
            <q-tabs v-model="activeTab" dense align="left" indicator-color="primary" active-color="primary" class="pfxp-tabs">
              <q-tab name="sessions"><span>Sessions <span class="pfxp-tab-count">{{ documentData.details.length }}</span></span></q-tab>
              <q-tab name="characters"><span>Characters <span class="pfxp-tab-count">{{ summaries.length }}</span></span></q-tab>
            </q-tabs>
          </div>

          <main
            ref="workspacePage"
            class="pfxp-page"
            :class="{ 'pfxp-page--fullscreen': fullscreen }"
          >
          <div v-if="busy" class="pfxp-progress" role="status" aria-live="polite">
            <div class="pfxp-progress__copy"><strong>{{ progressMessage }}</strong><span v-if="scrapeState?.progress?.percent != null">{{ scrapeState.progress.percent }}%</span></div>
            <q-linear-progress rounded color="primary" :indeterminate="!progressPercent" :value="progressPercent" />
          </div>

          <template v-if="activeTab === 'sessions'">
            <div
              class="pfxp-toolbar"
              @contextmenu="openWorkspaceContext"
              @keydown="onWorkspaceContextKey"
            >
              <div class="pfxp-toolbar__primary">
                <q-input ref="searchInput" v-model="quickSearch" outlined dense clearable class="pfxp-search" placeholder="Search every field…" aria-label="Search every session field">
                  <template #prepend><q-icon name="r_search" /></template>
                  <template #append><kbd class="pfxp-desktop-only">/</kbd></template>
                </q-input>
              </div>

              <div class="pfxp-toolbar__actions pfxp-desktop-only" v-touch-hold:500:12="openWorkspaceHold">
                <q-btn outline no-caps icon="r_filter_alt" label="Filters" class="pfxp-command" :class="{ 'pfxp-command--active': totalFilterCount > 0 }" @click="filterDrawerOpen = true">
                  <q-badge v-if="totalFilterCount" color="primary" floating>{{ totalFilterCount }}</q-badge>
                </q-btn>
                <q-btn outline no-caps icon="r_view_column" label="Columns" class="pfxp-command">
                  <q-menu class="column-menu" @before-show="refreshColumns">
                    <div class="column-menu__header">
                      <strong>Columns & view</strong>
                      <q-btn flat round dense icon="r_close" v-close-popup aria-label="Close column manager" />
                    </div>
                    <div class="column-menu__presets">
                      <q-btn v-for="value in ['simple', 'default', 'full'] as const" :key="value" unelevated no-caps :color="preset === value ? 'primary' : 'grey-2'" :text-color="preset === value ? 'white' : 'dark'" :label="value[0]!.toUpperCase() + value.slice(1)" @click="applyPreset(value)" />
                    </div>
                    <q-input v-model="columnSearch" borderless dense clearable placeholder="Find a column…" class="column-menu__search"><template #prepend><q-icon name="r_search" /></template></q-input>
                    <q-scroll-area class="column-menu__list">
                      <q-list dense>
                        <q-item v-for="(column, index) in filteredColumns" :key="column.id">
                          <q-item-section avatar><q-checkbox :model-value="column.visible" :aria-label="`Show ${column.label}`" @update:model-value="setColumnVisible(column, $event)" /></q-item-section>
                          <q-item-section>{{ column.label }}</q-item-section>
                          <q-item-section side class="row no-wrap">
                            <q-btn flat round dense icon="r_keyboard_arrow_up" :disable="index === 0" :aria-label="`Move ${column.label} left`" @click="moveColumn(column, -1)" />
                            <q-btn flat round dense icon="r_keyboard_arrow_down" :disable="index === filteredColumns.length - 1" :aria-label="`Move ${column.label} right`" @click="moveColumn(column, 1)" />
                          </q-item-section>
                        </q-item>
                      </q-list>
                    </q-scroll-area>
                    <div class="column-menu__footer">
                      <q-btn flat no-caps label="Reset to auto width" @click="sessionsGrid?.autoSizeColumns()" />
                      <q-btn flat no-caps label="Fit viewport (manual)" @click="sessionsGrid?.fitColumns()" />
                    </div>
                  </q-menu>
                </q-btn>
                <q-btn-dropdown outline no-caps icon="r_view_week" :label="preset === 'custom' ? 'Custom' : preset[0]!.toUpperCase() + preset.slice(1)" class="pfxp-command">
                  <q-list>
                    <q-item v-for="value in ['simple', 'default', 'full'] as const" :key="value" clickable v-close-popup @click="applyPreset(value)"><q-item-section>{{ value[0]!.toUpperCase() + value.slice(1) }}</q-item-section><q-item-section side v-if="preset === value"><q-icon name="r_check" color="primary" /></q-item-section></q-item>
                  </q-list>
                </q-btn-dropdown>
                <q-btn-dropdown outline no-caps icon="r_density_medium" :label="density === 'compact' ? 'Compact' : 'Comfortable'" class="pfxp-command">
                  <q-list>
                    <q-item clickable v-close-popup @click="density = 'compact'"><q-item-section>Compact</q-item-section><q-item-section side v-if="density === 'compact'"><q-icon name="r_check" color="primary" /></q-item-section></q-item>
                    <q-item clickable v-close-popup @click="density = 'comfortable'"><q-item-section>Comfortable</q-item-section><q-item-section side v-if="density === 'comfortable'"><q-icon name="r_check" color="primary" /></q-item-section></q-item>
                  </q-list>
                </q-btn-dropdown>
                <q-btn-dropdown outline no-caps icon="r_download" label="Export" class="pfxp-command">
                  <q-list style="min-width: 250px">
                    <q-item clickable v-close-popup @click="exportCsv"><q-item-section avatar><q-icon name="r_table_view" /></q-item-section><q-item-section><q-item-label>Filtered CSV</q-item-label><q-item-label caption>Current sorted and filtered rows</q-item-label></q-item-section></q-item>
                    <q-item clickable v-close-popup @click="exportXlsx"><q-item-section avatar><q-icon name="r_grid_on" /></q-item-section><q-item-section><q-item-label>Excel XLSX</q-item-label><q-item-label caption>Visible columns and current rows</q-item-label></q-item-section></q-item>
                    <q-item clickable v-close-popup @click="exportFilteredJson"><q-item-section avatar><q-icon name="r_filter_alt" /></q-item-section><q-item-section><q-item-label>Filtered JSON</q-item-label><q-item-label caption>Explicit filtered-results wrapper</q-item-label></q-item-section></q-item>
                    <q-item clickable v-close-popup @click="exportFullJson"><q-item-section avatar><q-icon name="r_archive" /></q-item-section><q-item-section><q-item-label>Full PFXP JSON</q-item-label><q-item-label caption>Can be imported again later</q-item-label></q-item-section></q-item>
                  </q-list>
                </q-btn-dropdown>
                <q-btn outline round :icon="fullscreen ? 'r_fullscreen_exit' : 'r_fullscreen'" class="pfxp-command" :aria-label="fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'" @click="toggleFullscreen" />
              </div>

              <div class="pfxp-mobile-actions pfxp-mobile-only" v-touch-hold:500:12="openWorkspaceHold">
                <q-btn outline no-caps icon="r_filter_alt" :label="`Filters${totalFilterCount ? ` ${totalFilterCount}` : ''}`" class="pfxp-command" :class="{ 'pfxp-command--active': totalFilterCount > 0 }" @click="filterDrawerOpen = true" />
                <q-select v-model="mobileSort" outlined dense emit-value map-options options-dense class="pfxp-control" :options="[
                  { label: 'Sort: Newest', value: 'date-desc' },
                  { label: 'Sort: Oldest', value: 'date-asc' },
                  { label: 'Sort: Most XP', value: 'xp-desc' },
                  { label: 'Sort: Character', value: 'character' },
                ]" />
                <q-btn outline round icon="r_more_vert" class="pfxp-command" aria-label="Session actions">
                  <q-menu auto-close><q-list><q-item clickable @click="exportCsv"><q-item-section avatar><q-icon name="r_table_view" /></q-item-section><q-item-section>Export CSV</q-item-section></q-item><q-item clickable @click="exportXlsx"><q-item-section avatar><q-icon name="r_grid_on" /></q-item-section><q-item-section>Export XLSX</q-item-section></q-item><q-item clickable @click="exportFullJson"><q-item-section avatar><q-icon name="r_archive" /></q-item-section><q-item-section>Full JSON</q-item-section></q-item></q-list></q-menu>
                </q-btn>
              </div>

              <ContextActionMenu
                ref="workspaceContextMenu"
                title="Sessions workspace"
                subtitle="Table, filters, layout, and export"
                :actions="workspaceContextActions"
                @select="handleWorkspaceContextAction"
              />
            </div>

            <div v-if="totalFilterCount" class="pfxp-filter-rail" aria-label="Active filters">
              <q-chip v-for="chip in activeFilterChips" :key="chip.id" removable class="pfxp-filter-chip" @remove="removeFilterChip(chip.id)">{{ chip.label }}</q-chip>
              <q-chip v-if="!$q.screen.lt.md && columnFilterCount" removable class="pfxp-filter-chip" @remove="clearColumnFilters">{{ columnFilterCount }} column {{ columnFilterCount === 1 ? 'filter' : 'filters' }}</q-chip>
              <q-btn flat no-caps color="primary" label="Clear all" @click="clearAllFilters" />
            </div>

            <div class="pfxp-grid-region">
              <SessionsGrid
                v-if="!$q.screen.lt.md"
                ref="sessionsGrid"
                :rows="searchedRows"
                quick-filter=""
                :dark="darkActive"
                :density="density"
                :preset="preset"
                :initial-state="initialGridState"
                :initial-manual-columns="initialManualColumns"
                @row-selected="showSession"
                @filtered-count="onFilteredCount"
                @state-changed="persistGridState"
                @preset-customized="preset = 'custom'"
                @filter-model-changed="filterModel = $event"
                @filter-character="filterBySessionCharacter"
                @floating-filters-changed="setFloatingFilters"
                @manual-columns-changed="persistManualColumns"
              />
              <MobileSessions
                v-else
                :rows="mobileRows"
                :sort="mobileSort"
                :has-filters="totalFilterCount > 0"
                :density="density"
                @select="showSession"
                @filter-character="filterBySessionCharacter"
                @filter-game="filterByGame"
                @filter-role="filterByRole"
                @update-sort="mobileSort = $event"
                @open-filters="filterDrawerOpen = true"
                @clear-filters="clearAllFilters"
                @export="exportCsv"
              />
            </div>

            <footer class="pfxp-statusbar">
              <span class="pfxp-statusbar__item"><q-icon name="r_format_list_numbered" size="18px" /> {{ visibleCount }} of {{ documentData.details.length }} sessions</span>
              <span v-if="totalFilterCount" class="pfxp-statusbar__item pfxp-statusbar__item--accent"><q-icon name="r_filter_alt" size="18px" /> {{ totalFilterCount }} {{ totalFilterCount === 1 ? 'filter' : 'filters' }} active</span>
              <span class="pfxp-statusbar__item pfxp-desktop-only"><q-icon name="r_keyboard" size="18px" /> Press / to focus search</span>
              <span class="pfxp-statusbar__item pfxp-desktop-only"><q-icon name="r_mouse" size="18px" /> Right-click a row or header for actions</span>
              <span class="pfxp-statusbar__item pfxp-mobile-only"><q-icon name="r_touch_app" size="18px" /> Long-press a session for actions</span>
              <q-btn flat no-caps color="primary" icon="r_download" label="Export" class="pfxp-mobile-only" @click="exportCsv" />
            </footer>
          </template>

          <CharacterSummary v-else :rows="summaries" :dark="darkActive" @select="onCharacterSelected" />
          </main>
        </div>
      </template>
    </q-page-container>

    <input ref="importInput" class="welcome__file-input" type="file" accept="application/json,.json" @change="($event.target as HTMLInputElement).files?.[0] && importFile(($event.target as HTMLInputElement).files![0]!)">

    <FilterDrawer
      v-model="filterDrawerOpen"
      v-model:terms="searchTerms"
      v-model:combine="combineMode"
      v-model:game="gameFilter"
      :character="characterFilter"
      v-model:role="roleFilter"
      v-model:date-range="dateRange"
      :game-options="gameOptions"
      :character-options="characterOptions"
      :match-count="searchedRows.length"
      :floating-filters="floatingFilters"
      :exclude-no-xp="excludeNoXp"
      @update:character="setCharacterFacet"
      @update:floating-filters="setFloatingFilters"
      @update:exclude-no-xp="excludeNoXp = $event"
      @reset="clearAllFilters"
    />

    <SessionDetailDialog v-model="detailOpen" :session="selectedSession" @filter-character="filterByCharacter" />

    <q-dialog v-model="historyOpen">
      <q-card class="pfxp-dialog-card history-dialog">
        <header class="pfxp-sheet-header">
          <div class="col"><h2 class="pfxp-sheet-title">Previous runs</h2><div class="pfxp-sheet-subtitle">Saved in this browser across every Paizo account</div></div>
          <q-btn flat round icon="r_close" aria-label="Close previous runs" v-close-popup />
        </header>
        <q-scroll-area class="history-dialog__body">
          <q-list separator>
            <q-item v-for="entry in runViews" :key="entry.id" :active="entry.id === activeRunId" active-class="history-dialog__active">
              <q-item-section avatar><q-icon :name="entry.source === 'fetch' ? 'r_cloud_download' : 'r_description'" color="primary" /></q-item-section>
              <q-item-section clickable @click="loadHistoryRun(entry.id)"><q-item-label class="text-weight-bold">{{ entry.label }}</q-item-label><q-item-label caption>{{ entry.accountEmail ?? 'Unassigned account' }} · {{ formatHistoryDate(entry.ts) }}</q-item-label></q-item-section>
              <q-item-section side><div class="row no-wrap"><q-btn flat round icon="r_open_in_new" aria-label="Open saved run" @click="loadHistoryRun(entry.id)" /><q-btn flat round icon="r_delete" color="negative" aria-label="Delete saved run" @click="deleteHistoryRun(entry)" /></div></q-item-section>
            </q-item>
            <q-item v-if="!runViews.length"><q-item-section class="text-center text-grey-7 q-pa-xl">No saved runs yet.</q-item-section></q-item>
          </q-list>
        </q-scroll-area>
        <footer class="pfxp-sheet-footer"><q-btn v-if="runViews.length" flat no-caps color="negative" label="Delete all" @click="clearHistory" /><q-space /><q-btn unelevated no-caps color="primary" label="Done" v-close-popup /></footer>
      </q-card>
    </q-dialog>
  </q-layout>
</template>

<style scoped>
kbd {
  min-width: 24px;
  padding: 2px 6px;
  color: var(--pfxp-muted);
  background: var(--pfxp-surface-soft);
  border: 1px solid var(--pfxp-border);
  border-radius: 5px;
  font-family: inherit;
  font-size: 11px;
  text-align: center;
}

.pfxp-page--fullscreen {
  height: 100vh;
}

.column-menu {
  width: 360px;
  max-width: calc(100vw - 24px);
  color: var(--pfxp-text);
  background: var(--pfxp-surface);
  border: 1px solid var(--pfxp-border);
  border-radius: 9px;
  box-shadow: var(--pfxp-shadow);
}

.column-menu__header,
.column-menu__footer,
.column-menu__presets {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  gap: 6px;
  border-bottom: 1px solid var(--pfxp-border);
}

.column-menu__header {
  justify-content: space-between;
}

.column-menu__presets .q-btn {
  flex: 1 1 0;
  min-height: 34px;
  border-radius: 6px;
  font-size: 12px;
}

.column-menu__search {
  padding: 4px 12px;
  border-bottom: 1px solid var(--pfxp-border);
}

.column-menu__list {
  height: min(420px, 48vh);
}

.column-menu__footer {
  justify-content: flex-end;
  border-top: 1px solid var(--pfxp-border);
  border-bottom: 0;
}

.history-dialog {
  display: flex;
  flex-direction: column;
  width: min(680px, calc(100vw - 28px));
  max-width: 680px;
  height: min(720px, calc(100vh - 40px));
  border-radius: 12px;
}

.history-dialog__body {
  flex: 1 1 auto;
  height: 100%;
}

.history-dialog__active {
  color: var(--pfxp-primary);
  background: var(--pfxp-primary-soft);
}

.welcome__file-input {
  position: fixed;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

@media (max-width: 1023px) {
  .history-dialog {
    width: calc(100vw - 20px);
    height: min(82vh, 680px);
  }
}
</style>
