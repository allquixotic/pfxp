// Client entry built by Bun
// Imports (ESM) for bundling
import { createGrid, ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import localforage from 'localforage';
import { DateTime } from 'luxon';
import { BUILD_ID, BUILD_TIMESTAMP } from '../build-info';

// Register all Community modules (simplest, resolves AG Grid #272)
ModuleRegistry.registerModules([AllCommunityModule]);

// Bundle Bootstrap locally (CSS + JS Tooltip only)
import 'bootstrap/dist/css/bootstrap.min.css';
import Tooltip from 'bootstrap/js/dist/tooltip';

// AG Grid legacy CSS themes (Quartz includes dark variant)
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

// App styles (extracted from index.html)
import './styles.css';

declare global {
  interface Window {
    PFXP_BUILD_ID?: string;
    PFXP_BUILD_TIMESTAMP?: string;
  }
}

window.PFXP_BUILD_ID = BUILD_ID;
window.PFXP_BUILD_TIMESTAMP = BUILD_TIMESTAMP;

// State and DOM refs (migrated from inline script)
const state: any = {
  email: null,
  raw: null,
  filters: [],
  combine: 'AND',
  gridApi: null,
  gridColumnApi: null,
  fuse: null,
  pollTimer: null,
  currentJobId: null,
  es: null,
  summaryGridApi: null,
  summaryFuse: null,
  summaryFilters: [],
  pageScrollListenerAttached: false,
};

const statusEl = document.getElementById('statusAlert') as HTMLElement;
const tableCard = document.getElementById('tableCard') as HTMLElement;
const filtersCard = document.getElementById('filtersCard') as HTMLElement;
const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
const previousRunsEl = document.getElementById('previousRuns') as HTMLSelectElement;
const loadRunBtn = document.getElementById('loadRunBtn') as HTMLButtonElement;
const deleteRunBtn = document.getElementById('deleteRunBtn') as HTMLButtonElement;
const addFilterBtn = document.getElementById('addFilter') as HTMLButtonElement;
const combineMode = document.getElementById('combineMode') as HTMLSelectElement;
const darkSwitch = document.getElementById('darkSwitch') as HTMLInputElement;
const mainExportCsvBtn = document.getElementById('mainExportCsv') as HTMLButtonElement;
const mainExportJsonBtn = document.getElementById('mainExportJson') as HTMLButtonElement;
const mainFullscreenBtn = document.getElementById('mainFullscreenBtn') as HTMLButtonElement;
const mainQuickFilter = document.getElementById('mainQuickFilter') as HTMLInputElement;
const pageScrollToggle = document.getElementById('pageScrollToggle') as HTMLInputElement;

// View preset buttons
const viewPresetSimpleBtn = document.getElementById('viewPresetSimple') as HTMLInputElement;
const viewPresetDefaultBtn = document.getElementById('viewPresetDefault') as HTMLInputElement;
const viewPresetFullBtn = document.getElementById('viewPresetFull') as HTMLInputElement;

const VIEW_PRESETS = {
  simple: ['date', 'character.name', 'effectiveLevel', 'gameSystem', 'scenario', 'xp', 'notes'],
  default: [
    'date', 'character.name', 'effectiveLevel', 'gameSystem', 'scenario', 'xp', 'gm', 'event.name', 'faction.name', 'notes'
  ],
  full: null, // null means all columns are visible
};

async function applyViewPreset(presetName: 'simple' | 'default' | 'full' | 'custom') {
  if (!state.gridApi) return;

  const colIds = VIEW_PRESETS[presetName as keyof typeof VIEW_PRESETS];
  const cols = state.gridColumnApi.getColumns?.() ?? [];
  const allCols = cols.map((c: any) => c.getColId());

  const applyState = (ids: string[], visible: boolean) => {
    if (!ids.length) return;
    if (state.gridColumnApi.applyColumnState) {
      state.gridColumnApi.applyColumnState({
        state: ids.map((id) => ({ colId: id, hide: !visible })),
        applyOrder: false,
      });
    } else if (state.gridColumnApi.setColumnsVisible) {
      state.gridColumnApi.setColumnsVisible(ids, visible);
    }
  };

  if (colIds) {
    applyState(allCols, false);
    applyState(colIds, true);
  } else if (presetName === 'full') {
    applyState(allCols, true);
  }

  // Update button state
  viewPresetSimpleBtn.checked = presetName === 'simple';
  viewPresetDefaultBtn.checked = presetName === 'default';
  viewPresetFullBtn.checked = presetName === 'full';

  // Persist for next load
  if (presetName !== 'custom') {
    await storage.setItem('pfxp:viewPreset', presetName);
  }
}

async function loadViewPreset() {
  const saved = await storage.getItem('pfxp:viewPreset') || 'default';
  await applyViewPreset(saved as any);
}

async function loadInitialSettings() {
  const [savedTheme, savedPreset, savedEmail] = await Promise.all([
    storage.getItem('theme:preference'),
    storage.getItem('pfxp:viewPreset'),
    storage.getItem('pfxp:user:email'),
  ]);

  // Theme
  const isDark = savedTheme === 'dark';
  darkSwitch.checked = isDark;
  document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
  updateGridThemes();

  // View preset (will be applied when grid is created)
  if (savedPreset && ['simple','default','full'].includes(String(savedPreset))) {
    const presetId = `#viewPreset${capitalize(String(savedPreset))}`;
    const presetEl = document.querySelector(presetId) as HTMLInputElement | null;
    if (presetEl) presetEl.checked = true;
  }

  // Email
  if (savedEmail) {
    (document.getElementById('email') as HTMLInputElement).value = savedEmail as string;
  }

  // Reveal body now that theme is set
  document.body.classList.remove('is-loading');
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const globalDatalistId = 'filterSuggestions';
const datalistEl = document.createElement('datalist');
datalistEl.id = globalDatalistId;
document.body.appendChild(datalistEl);

const loadJsonInput = document.getElementById('loadJsonInput') as HTMLInputElement;
const loadJsonBtn = document.getElementById('loadJsonBtn') as HTMLButtonElement;

// Legacy CSS theme class names
const THEME_CLASS_LIGHT = 'ag-theme-quartz';
const THEME_CLASS_DARK = 'ag-theme-quartz-dark';

function setStatus(msg: string, type: 'info' | 'warning' | 'danger' | 'success' = 'info') {
  statusEl.classList.remove('d-none', 'alert-info', 'alert-warning', 'alert-danger', 'alert-success');
  statusEl.classList.add('alert-' + type);
  statusEl.textContent = msg;
}
function clearStatus() { statusEl.classList.add('d-none'); }

function systemBadgeHtml(system: string) {
  const map: Record<string, string> = {
    'Pathfinder 2e': 'text-bg-danger',
    'Starfinder 2e': 'text-bg-info',
    'Starfinder 1e': 'text-bg-primary',
    'Pathfinder 1e': 'text-bg-warning',
    'Starfinder Playtest': 'text-bg-secondary',
  };
  const cls = map[system] || 'text-bg-secondary';
  return `<span class="badge ${cls}" data-bs-toggle="tooltip" data-bs-title="${system}">${system}</span>`;
}

function initTooltips() {
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
    try { new Tooltip(el as Element); } catch {}
  });
}

// Storage
const storage = localforage.createInstance({ name: 'pfxp' });
async function saveColumnState(prefix: string, columnApi: any) {
  try {
    const getState = columnApi.getColumnState?.bind(columnApi);
    if (!getState) return;
    const st = getState();
    await storage.setItem('ag:layout:' + prefix, st);
  } catch {}
}
async function loadColumnState(prefix: string) {
  try {
    const st = await storage.getItem('ag:layout:' + prefix);
    return Array.isArray(st) ? st : null;
  } catch { return null; }
}

function fieldGetter(path: string) {
  const parts = path.split('.');
  return (data: any) => parts.reduce((acc: any, p: string) => (acc && acc[p] != null ? acc[p] : null), data);
}

function makeCol(headerName: string, path: string, opts: any = {}) {
  const get = fieldGetter(path);
  const col = {
    headerName,
    colId: path,
    sortable: true,
    resizable: true,
    filter: typeof get({}) === 'number' ? 'agNumberColumnFilter' : 'agTextColumnFilter',
    valueGetter: (p: any) => get(p.data),
    tooltipValueGetter: (p: any) => {
      const v = get(p.data);
      return v == null ? '' : String(v);
    },
    ...opts,
  };
  return col;
}

function badgeRenderer(params: any) {
  const span = document.createElement('span');
  span.innerHTML = systemBadgeHtml(params.value || '');
  return span;
}

function mainColumnDefs() {
  return [
    makeCol('Date', 'date'),
    {
      headerName: 'Character', colId: 'character.name', sortable: true, resizable: true, filter: 'agTextColumnFilter',
      valueGetter: (p: any) => p.data?.character?.name || '',
      tooltipValueGetter: (p: any) => {
        const d = p.data;
        const cid = d?.player?.charid != null ? d.player.charid : '—';
        const oid = d?.player?.orgplayid != null ? d.player.orgplayid : '—';
        return `Org ID: ${oid}\nChar ID: ${cid}`;
      },
    },
    {
      headerName: 'Level', colId: 'effectiveLevel', sortable: true, resizable: true, filter: 'agNumberColumnFilter',
      valueGetter: (p: any) => {
        if (p.node.isRowPinned()) return p.data.effectiveLevel;
        return '';
      },
      valueFormatter: (p: any) => p.value ? String(p.value) : '',
      cellStyle: (p: any) => p.node.isRowPinned() ? { fontWeight: 'bold' } : {},
    },
    { headerName: 'Game System', colId: 'gameSystem', sortable: true, resizable: true, filter: 'agTextColumnFilter', valueGetter: (p: any) => p.data?.gameSystem || '', cellRenderer: badgeRenderer },
    makeCol('Scenario', 'scenario'),
    makeCol('XP', 'xp', { filter: 'agNumberColumnFilter',
      cellStyle: (p: any) => p.node.isRowPinned() ? { fontWeight: 'bold' } : {},
    }),
    makeCol('GM', 'gm'),
    { headerName: 'Event', colId: 'event.name', sortable: true, resizable: true, filter: 'agTextColumnFilter', valueGetter: (p: any) => p.data?.event?.name || '', tooltipValueGetter: (p: any) => {
        const id = p.data?.event?.id ?? '—';
        return `${p.value || ''}\nID: ${id}`;
      } },
    makeCol('Event ID', 'event.id', { filter: 'agNumberColumnFilter' }),
    makeCol('Session', 'session', { filter: 'agNumberColumnFilter' }),
    makeCol('Player', 'player.orgplayid', { filter: 'agNumberColumnFilter' }),
    makeCol('Character ID', 'player.charid'),
    makeCol('Faction', 'faction.name'),
    makeCol('Prestige', 'prestigeReputation.prestigePoints', { filter: 'agNumberColumnFilter' }),
    {
      headerName: 'GM?',
      colId: 'prestigeReputation.isGM',
      sortable: true,
      resizable: true,
      filter: 'agTextColumnFilter',
      valueGetter: (p: any) => {
        if (p.node.isRowPinned?.() || p.data?.isPinnedSummary) return '';
        const flag = p.data?.prestigeReputation?.isGM;
        if (flag === true) return 'Yes';
        if (flag === false) return 'No';
        return '';
      },
    },
    makeCol('Notes', 'notes')
  ];
}

function updateSuggestions(details: any[]) {
  const values = new Set<string>();
  for (const d of details) {
    ['date','gm','scenario','xp'].forEach((k) => (d as any)[k] && values.add(String((d as any)[k])));
    if (d.event?.name) values.add(d.event.name);
    if (d.event?.id != null) values.add(String(d.event.id));
    if (d.session != null) values.add(String(d.session));
    if (d.player?.orgplayid != null) values.add(String(d.player.orgplayid));
    if (d.player?.charid != null) values.add(String(d.player.charid));
    if (d.character?.name) values.add(d.character.name);
    if (d.faction?.name) values.add(d.faction.name);
    if (d.prestigeReputation?.prestigePoints != null) values.add(String(d.prestigeReputation.prestigePoints));
    if (d.notes) values.add(d.notes);
  }
  datalistEl.innerHTML = Array.from(values).slice(0, 500).map((v) => `<option value="${v.replace(/"/g, '&quot;')}"></option>`).join('');
}

async function getFuseCtor() {
  if ((state as any)._FuseCtor) return (state as any)._FuseCtor;
  const mod = await import('fuse.js');
  (state as any)._FuseCtor = (mod as any).default ?? mod;
  return (state as any)._FuseCtor;
}

async function buildFuse(details: any[]) {
  const Fuse = await getFuseCtor();
  state.fuse = new Fuse(details, {
    includeScore: false,
    shouldSort: false,
    threshold: 0.3,
    ignoreLocation: true,
    keys: [
      'date','gm','scenario','gameSystem','event.name','event.id','session',
      'player.orgplayid','player.charid','character.name','faction.name',
      'prestigeReputation.prestigePoints','notes','xp'
    ]
  });
}

function rebuildExternalFilter() {
  if (!state.raw || !state.gridApi) return;
  if (!state.fuse || state.filters.length === 0) {
    state.gridApi.onFilterChanged();
    return;
  }
  const sets = state.filters.map((f: any) => new Set(state.fuse.search(f.query).map((r: any) => r.item)));
  state._externalPassSet = new Set<any>();
  if (state.combine === 'AND') {
    for (const item of state.raw.details) {
      if (sets.every((s: Set<any>) => s.has(item))) state._externalPassSet.add(item);
    }
  } else {
    sets.forEach((s: Set<any>) => s.forEach((x: any) => state._externalPassSet.add(x)));
  }
  state.gridApi.onFilterChanged();
}

function buildMainGrid(details: any[]) {
  const gridDiv = document.getElementById('table')!;
  applyLegacyThemeClasses();

  const gridOptions: any = {
    theme: 'legacy',
    domLayout: pageScrollToggle?.checked ? 'autoHeight' : 'normal',
    defaultColDef: { sortable: true, filter: true, resizable: true },
    columnDefs: mainColumnDefs(),
    rowData: details,
    animateRows: true,
    suppressDragLeaveHidesColumns: false,
    rowSelection: { mode: 'singleRow', enableClickSelection: true },
    isExternalFilterPresent: () => !!state._externalPassSet && state.filters.length > 0,
    doesExternalFilterPass: (node: any) => {
      if (!state._externalPassSet || state.filters.length === 0) return true;
      return state._externalPassSet.has(node.data);
    },
    onFirstDataRendered: (p: any) => { sizeGrids(); initTooltips(); updatePinnedCharacterSummary(p.api); },
    onModelUpdated: (p: any) => { initTooltips(); updatePinnedCharacterSummary(p.api); },
    onFilterChanged: (p: any) => updatePinnedCharacterSummary(p.api),
    onSortChanged: (p: any) => updatePinnedCharacterSummary(p.api),
    onBodyScrollEnd: initTooltips,
  };

  state.gridApi = createGrid(gridDiv, gridOptions);
  state.gridColumnApi = state.gridApi?.getColumnApi?.() || state.gridApi;
  syncDomLayoutWithToggle();
  if (!state.pageScrollListenerAttached && pageScrollToggle) {
    pageScrollToggle.addEventListener('change', () => {
      syncDomLayoutWithToggle();
      sizeGrids();
    });
    state.pageScrollListenerAttached = true;
  }

  loadColumnState('pfxp:main').then((st) => {
    if (st && state.gridColumnApi.applyColumnState) {
      try { state.gridColumnApi.applyColumnState({ state: st, applyOrder: true }); } catch {}
    }
  });

  const persist = () => {
    saveColumnState('pfxp:main', state.gridColumnApi);
    // Deselect presets if user customizes columns
    viewPresetSimpleBtn.checked = false;
    viewPresetDefaultBtn.checked = false;
    viewPresetFullBtn.checked = false;
    storage.setItem('pfxp:viewPreset', 'custom');
  };
  state.gridApi.addEventListener('columnMoved', persist);
  state.gridApi.addEventListener('columnVisible', persist);
  state.gridApi.addEventListener('columnResized', persist);
  state.gridApi.addEventListener('sortChanged', persist);

  attachHeaderVisibilityMenu('#table', state.gridApi);
}

function attachHeaderVisibilityMenu(containerSelector: string, apiLike: any) {
  const container = document.querySelector(containerSelector) as HTMLElement | null;
  const header = container?.querySelector('.ag-header') as HTMLElement | null;
  let menuDiv: HTMLDivElement | null = null;
  const columnApi = apiLike?.getColumnApi?.() || apiLike;
  header?.addEventListener('click', (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    const isHeader = !!e.target.closest('.ag-header-cell');
    if (!isHeader) return;
    if (menuDiv) menuDiv.remove();
    menuDiv = document.createElement('div');
    menuDiv.className = 'dropdown-menu show p-2';
    menuDiv.style.position = 'absolute';
    menuDiv.style.left = e.pageX + 'px';
    menuDiv.style.top = e.pageY + 'px';

    const allToggleId = 'col_all_' + Math.random().toString(36).slice(2);
    const allWrap = document.createElement('div');
    allWrap.className = 'form-check mb-2';
    allWrap.innerHTML = `<input class="form-check-input" type="checkbox" id="${allToggleId}"><label class="form-check-label" for="${allToggleId}">Select All</label>`;
    menuDiv.appendChild(allWrap);

    const list = document.createElement('div');
    menuDiv.appendChild(list);

    const cols = columnApi.getColumns ? columnApi.getColumns() : columnApi.getAllGridColumns?.();
    const columns = cols || [];
    const checkboxes: { cb: HTMLInputElement, colId: string }[] = [];

    columns.forEach((c: any, idx: number) => {
      const colId = c.getColId ? c.getColId() : c.colId;
      const def = c.getColDef ? c.getColDef() : {};
      const wrap = document.createElement('div');
      wrap.className = 'form-check';
      const visible = c.isVisible ? c.isVisible() : !c.isHidden?.();
      const id = 'col_' + idx + '_' + Math.random().toString(36).slice(2);
      wrap.innerHTML = `<input class="form-check-input" type="checkbox" id="${id}" ${visible ? 'checked' : ''}><label class="form-check-label" for="${id}">${def.headerName || colId}</label>`;
      list.appendChild(wrap);
      const cb = wrap.querySelector('input') as HTMLInputElement;
      checkboxes.push({ cb, colId });
      cb.addEventListener('change', () => {
        const target = columnApi.applyColumnState ? columnApi : state.gridColumnApi;
        if (target?.applyColumnState) {
          target.applyColumnState({ state: [{ colId, hide: !cb.checked }], applyOrder: false });
        } else if (target?.setColumnVisible) {
          target.setColumnVisible(colId, cb.checked);
        }
        saveColumnState(containerSelector.includes('summary') ? 'pfxp:summary' : 'pfxp:main', target || columnApi);
      });
    });

    const allCb = menuDiv.querySelector('#' + allToggleId) as HTMLInputElement;
    allCb.addEventListener('change', () => {
      const on = allCb.checked;
      const target = columnApi.applyColumnState ? columnApi : state.gridColumnApi;
      checkboxes.forEach(({ cb, colId }) => {
        if (target?.applyColumnState) {
          target.applyColumnState({ state: [{ colId, hide: !on }], applyOrder: false });
        } else if (target?.setColumnVisible) {
          target.setColumnVisible(colId, on);
        }
        cb.checked = on;
      });
      saveColumnState(containerSelector.includes('summary') ? 'pfxp:summary' : 'pfxp:main', target || columnApi);
    });

    document.body.appendChild(menuDiv);
    const closer = (ev: MouseEvent) => { if (!menuDiv!.contains(ev.target as Node)) { menuDiv!.remove(); document.removeEventListener('click', closer); } };
    setTimeout(() => document.addEventListener('click', closer), 0);
  });
}

function layoutTables() { sizeGrids(); }
window.addEventListener('resize', () => { updateScale(); sizeGrids(); clampSavedHeightsToViewport(); });

function sizeGrids() {
  try { state.gridApi?.sizeColumnsToFit(); } catch {}
}

function syncDomLayoutWithToggle() {
  if (!state.gridApi) return;
  const isPageScroll = !!pageScrollToggle?.checked;
  const layout = isPageScroll ? 'autoHeight' : 'normal';
  try {
    state.gridApi.setGridOption('domLayout', layout);
  } catch {
    try { (state.gridApi as any).setDomLayout?.(layout); } catch {}
  }
  const wasPageScroll = document.body.classList.contains('page-scroll-mode');
  document.body.classList.toggle('page-scroll-mode', isPageScroll);
  document.body.classList.toggle('table-scroll-mode', !isPageScroll);

  const tableCard = document.getElementById('tableCard') as HTMLElement | null;
  if (tableCard) {
    if (isPageScroll) {
      if (!wasPageScroll) {
        if (!(tableCard as any).dataset.tableScrollHeight && tableCard.style.height) {
          (tableCard as any).dataset.tableScrollHeight = tableCard.style.height;
        }
        if (!(tableCard as any).dataset.tableScrollFlex && tableCard.style.flex) {
          (tableCard as any).dataset.tableScrollFlex = tableCard.style.flex;
        }
      }
      tableCard.style.height = '';
      tableCard.style.flex = '';
    } else if (wasPageScroll) {
      const h = (tableCard as any).dataset.tableScrollHeight || '';
      const flex = (tableCard as any).dataset.tableScrollFlex || '';
      if (h) tableCard.style.height = h; else tableCard.style.height = '';
      if (flex) tableCard.style.flex = flex; else tableCard.style.flex = '';
      if (!tableCard.style.height) {
        void applySavedHeights();
      }
    }
  }

  if (!isPageScroll) sizeGrids();
}

// Previous Runs persistence
async function sha256Hex(str: string) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadRunsIndex() {
  const idx = await storage.getItem('runs:index');
  return Array.isArray(idx) ? idx : [];
}

async function saveRunsIndex(idx: any[]) {
  await storage.setItem('runs:index', idx);
}

function fmtTs(ts: number) {
  try { return DateTime.fromMillis(ts).toFormat('yyyy-LL-dd HH:mm:ss'); } catch { return String(ts); }
}

async function addRun(doc: any, source: string) {
  const minified = JSON.stringify(doc);
  const hash = await sha256Hex(minified);
  const now = Date.now();
  let idx = await loadRunsIndex();
  if (idx.some((it: any) => it.hash === hash)) {
    idx = idx.filter((it: any) => it.hash !== hash);
  }
  const id = crypto.randomUUID();
  idx.unshift({ id, ts: now, source, hash });
  if (idx.length > 25) {
    const toDelete = idx.splice(25);
    await Promise.allSettled(toDelete.map((d: any) => storage.removeItem('run:' + d.id)));
  }
  await storage.setItem('run:' + id, minified);
  await saveRunsIndex(idx);
  await populateRunsDropdown();
}

async function populateRunsDropdown() {
  const idx = await loadRunsIndex();
  previousRunsEl.innerHTML = '';
  if (idx.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No saved runs';
    opt.disabled = true;
    opt.selected = true;
    previousRunsEl.appendChild(opt);
    loadRunBtn.disabled = true;
    deleteRunBtn.disabled = true;
    return;
  }
  idx.forEach((item: any) => {
    const opt = document.createElement('option');
    opt.value = item.id;
    const label = `${fmtTs(item.ts)} ${item.source === 'file' ? '(file)' : '(fetch)'}`;
    opt.textContent = label;
    previousRunsEl.appendChild(opt);
  });
  loadRunBtn.disabled = false;
  deleteRunBtn.disabled = !previousRunsEl.value;
}

async function loadSelectedRun() {
  const id = (previousRunsEl as HTMLSelectElement).value;
  if (!id) return;
  const text = await storage.getItem('run:' + id);
  if (!text) return;
  try {
    const doc = JSON.parse(text as string);
    await presentData(doc, { fromFile: true });
  } catch (e) {
    setStatus('Failed to load saved run', 'danger');
  }
}

function updateScale() {
  const baseArea = 1366 * 768;
  const w = Math.max(320, window.innerWidth);
  const h = Math.max(480, window.innerHeight);
  const area = w * h;
  const scale = Math.max(0.85, Math.min(1.15, Math.pow(baseArea / area, 0.125)));
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

async function presentData(doc: any, opts = { fromFile: false }) {
  clearStatus();
  state.raw = doc;
  if (!state.gridApi) {
    buildMainGrid(doc.details);
    await loadViewPreset(); // Apply after grid is built
  } else {
    state.gridApi.setGridOption('rowData', doc.details);
    syncDomLayoutWithToggle();
  }
  updateSuggestions(doc.details);
  state.fuse = null;
  await buildFuse(doc.details);
  tableCard.classList.remove('d-none');
  filtersCard.classList.remove('d-none');
  refreshBtn.disabled = !!(opts as any).fromFile;
  ensureDefaultFilterInputs();
  initCardResize('#tableCard', 'pfxp:main', '#table', 'bottom');
  await applySavedHeights();
  setTimeout(() => { updateScale(); sizeGrids(); }, 0);
  document.getElementById('authCard')?.classList.add('d-none');
  try { await addRun(doc, (opts as any).fromFile ? 'file' : 'fetch'); } catch {}
}

async function pollStatus() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    const res = await post('/api/status', { email: state.email });
    if (res.status === 'processing' || res.status === 'queued') {
      setStatus('Processing…');
    } else if (res.status === 'blocked') {
      const seconds = Math.max(0, Math.floor((res.retryAfter - Date.now()) / 1000));
      setStatus(`Blocked due to failed login. Try again in ${seconds}s`, 'warning');
    } else if (res.status === 'ready') {
      clearInterval(state.pollTimer);
      await presentData(res.data, { fromFile: false });
    } else if (res.status === 'error') {
      setStatus(res.message || 'Error while scraping', 'danger');
    }
  }, 2000);
}

function startLiveStatus(jobId: string) {
  state.currentJobId = jobId;
  try { state.es?.close?.(); } catch {}
  try { clearInterval(state.pollTimer); } catch {}
  try {
    const es = new EventSource(`/api/events?jobId=${encodeURIComponent(jobId)}`);
    state.es = es;
    es.addEventListener('progress', async (ev: MessageEvent) => {
      try {
        const p = JSON.parse((ev as any).data);
        // Update message
        if (p.status === 'blocked') {
          setStatus(p.message || 'Blocked', 'warning');
        } else if (p.status === 'error') {
          setStatus(p.message || 'Error while scraping', 'danger');
        } else if (p.status === 'ready') {
          setStatus('Finalizing…');
          es.close();
          // Fetch the final data once
          const res = await post('/api/status', { email: state.email });
          if (res.status === 'ready') {
            await presentData(res.data, { fromFile: false });
          }
        } else {
          // processing/queued
          const base = p.message || 'Processing…';
          const pct = typeof p.percent === 'number' ? ` (${p.percent}%)` : '';
          setStatus(base + pct);
        }
      } catch {}
    });
    es.onerror = () => {
      try { es.close(); } catch {}
      // Fallback to polling
      pollStatus();
    };
  } catch {
    pollStatus();
  }
}

document.getElementById('authForm')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = (document.getElementById('email') as HTMLInputElement).value.trim();
  const password = (document.getElementById('password') as HTMLInputElement).value;
  state.email = email;
  state.password = password;
  await storage.setItem('pfxp:user:email', email); // Save email
  setStatus('Queued…');
  const credential = await encryptPassword(password);
  const res = await post('/api/fetch', { email, credential });
  if (res.status === 'blocked') {
    setStatus('Blocked due to failed login. Try later.', 'warning');
    return;
  }
  if (res.status === 'ready') {
    await presentData(res.data, { fromFile: false });
  } else if (res.status === 'queued' && res.jobId) {
    setStatus('Queued…');
    startLiveStatus(res.jobId);
  } else {
    // Fallback: poll by email
    pollStatus();
  }
});

// Crypto helpers
let keyCache: any = { keyId: null, expiresAt: 0, publicKey: null };
async function getPublicKey() {
  const now = Date.now();
  if (keyCache.publicKey && keyCache.expiresAt - now > 10_000) return keyCache;
  const res = await fetch('/api/crypto/key');
  if (!res.ok) throw new Error('Failed to fetch crypto key');
  const data = await res.json();
  const key = await crypto.subtle.importKey('jwk', data.key, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  keyCache = { keyId: data.keyId, expiresAt: data.expiresAt, publicKey: key };
  return keyCache;
}
function abToB64(buf: ArrayBuffer) { const bytes = new Uint8Array(buf); let binary = ''; for (let i=0;i<bytes.length;i++) binary += String.fromCharCode(bytes[i]); return btoa(binary); }
async function encryptPassword(plain: string) { const { keyId, publicKey } = await getPublicKey(); const enc = new TextEncoder().encode(plain); const ct = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, enc); return { keyId, ciphertext: abToB64(ct) }; }

// HTTP helper
async function post(url: string, payload: any) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return res.json();
}

// Filters (chips + external filter)
function addFilterChip(prefill = '') {
  if (state.raw) updateSuggestions(state.raw.details);
  const id = Math.random().toString(36).slice(2);
  const wrap = document.createElement('div');
  wrap.className = 'input-group input-group-sm search-chip';
  wrap.style.maxWidth = '22rem';
  wrap.innerHTML = `
    <span class="input-group-text">Filter</span>
    <input type=\"text\" class=\"form-control\" id=\"q_${id}\" placeholder=\"Search...\" value=\"${prefill}\" list=\"${globalDatalistId}\">\n          <button class=\"btn btn-outline-secondary\" type=\"button\" id=\"rm_${id}\">Remove</button>
  `;
  document.getElementById('filters')!.appendChild(wrap);
  const input = wrap.querySelector('#q_' + id) as HTMLInputElement;
  const btn = wrap.querySelector('#rm_' + id) as HTMLButtonElement;
  const filter = { id, query: prefill } as any;
  state.filters.push(filter);
  input.addEventListener('input', () => { filter.query = input.value; rebuildExternalFilter(); });
  btn.addEventListener('click', () => {
    state.filters = state.filters.filter((f: any) => f.id !== id);
    wrap.remove();
    rebuildExternalFilter();
  });
  input.focus();
}

addFilterBtn.addEventListener('click', (e) => { e.preventDefault(); addFilterChip(''); });
combineMode.addEventListener('change', () => { state.combine = combineMode.value; rebuildExternalFilter(); });

// Dark Mode toggle applies theme via Theming API
function applyLegacyThemeClasses() {
  const dark = !!darkSwitch.checked;
  const table = document.getElementById('table');
  const summary = document.getElementById('summaryTable');
  if (table) {
  table.classList.toggle(THEME_CLASS_DARK, dark);
    table.classList.toggle(THEME_CLASS_LIGHT, !dark);
  }
}

function updateGridThemes() {
  applyLegacyThemeClasses();
}

function updatePinnedCharacterSummary(api: any) {
  if (!api) return;
  const totals = new Map<string, { name: string; system: string; xp: number }>();

  api.forEachNodeAfterFilterAndSort((node: any) => {
    const d = node.data;
    if (!d || !d.character?.name || !d.gameSystem) return;
    const key = `${d.character.name}|${d.gameSystem}`;
    const current = totals.get(key) || { name: d.character.name, system: d.gameSystem, xp: 0 };
    current.xp += Number(d.xp || 0);
    totals.set(key, current);
  });

  const pinnedRows = Array.from(totals.values())
    .sort((a, b) => b.xp - a.xp)
    .map((t) => ({
      character: { name: t.name },
      gameSystem: t.system,
      xp: t.xp,
      effectiveLevel: computeEffectiveLevel(t.xp, t.system),
      // Style hook
      isPinnedSummary: true,
    }));

  try {
    api.setGridOption('pinnedBottomRowData', pinnedRows);
  } catch {
    // Fallback for older APIs (if present)
    try { (api as any).setPinnedBottomRowData?.(pinnedRows); } catch {}
  }
}

// Load and apply saved theme preference
async function loadThemePreference() {
  // Now handled in loadInitialSettings
}

darkSwitch.addEventListener('change', async () => {
  const isDark = darkSwitch.checked;
  document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
  updateGridThemes();
  sizeGrids();
  await storage.setItem('theme:preference', isDark ? 'dark' : 'light');
});

// Export & Reset buttons
function exportDisplayedRowsAsJson(api: any, filename: string) {
  const rows: any[] = [];
  const count = api.getDisplayedRowCount();
  for (let i = 0; i < count; i++) {
    const row = api.getDisplayedRowAtIndex(i);
    if (row?.data) rows.push(row.data);
  }
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

mainExportCsvBtn.addEventListener('click', () => state.gridApi?.exportDataAsCsv({ fileName: 'sessions.csv' }));
mainExportJsonBtn.addEventListener('click', () => state.gridApi && exportDisplayedRowsAsJson(state.gridApi, 'sessions.json'));
mainQuickFilter.addEventListener('input', () => { try { state.gridApi?.setGridOption('quickFilterText', mainQuickFilter.value || ''); } catch {} });

function computeEffectiveLevel(totalXp: number, gameSystem: string) {
  if (gameSystem === 'Starfinder 2e' || gameSystem === 'Pathfinder 2e') return (1 + totalXp / 12).toFixed(2);
  if (gameSystem === 'Starfinder 1e' || gameSystem === 'Pathfinder 1e') return (1 + totalXp / 3).toFixed(2);
  return 'N/A';
}

async function buildSummary(doc: any) {
  const agg = new Map<string, { name: string, system: string, xp: number }>();
  for (const d of doc.details) {
    const key = d.character.name + '|' + d.gameSystem;
    const prev = agg.get(key) || { name: d.character.name, system: d.gameSystem, xp: 0 };
    prev.xp += d.xp;
    agg.set(key, prev);
  }
  const rows = Array.from(agg.values()).map((r) => ({
    character: r.name,
    gameSystem: r.system,
    totalXp: r.xp,
    effectiveLevel: computeEffectiveLevel(r.xp, r.system)
  }));

  if (!state.summaryGridApi) {
    buildSummaryGrid(rows);
  } else {
    state.summaryGridApi.setGridOption('rowData', rows);
  }

  const Fuse = await getFuseCtor();
  state.summaryFuse = new Fuse(rows, {
    includeScore: false,
    shouldSort: false,
    threshold: 0.3,
    ignoreLocation: true,
    keys: ['character','gameSystem','totalXp','effectiveLevel']
  });

  document.getElementById('summaryCard')?.classList.remove('d-none');
  document.getElementById('summaryFiltersCard')?.classList.remove('d-none');
}

function addSummaryFilterChip(prefill = '') {
  const id = Math.random().toString(36).slice(2);
  const wrap = document.createElement('div');
  wrap.className = 'input-group input-group-sm search-chip';
  wrap.style.maxWidth = '22rem';
  wrap.innerHTML = `
    <span class="input-group-text">Filter</span>
    <input type=\"text\" class=\"form-control\" id=\"sq_${id}\" placeholder=\"Search summary...\" value=\"${prefill}\">\n          <button class=\"btn btn-outline-secondary\" type=\"button\" id=\"srm_${id}\">Remove</button>
  `;
  document.getElementById('summaryFilters')!.appendChild(wrap);
  const input = wrap.querySelector('#sq_' + id) as HTMLInputElement;
  const btn = wrap.querySelector('#srm_' + id) as HTMLButtonElement;
  const filter = { id, query: prefill } as any;
  state.summaryFilters.push(filter);
  input.addEventListener('input', () => { filter.query = input.value; rebuildSummaryExternalFilter(); });
  btn.addEventListener('click', () => {
    state.summaryFilters = state.summaryFilters.filter((f: any) => f.id !== id);
    wrap.remove();
    rebuildSummaryExternalFilter();
  });
}

const addSummaryFilterBtnEl = document.getElementById('addSummaryFilter') as HTMLButtonElement | null;
if (addSummaryFilterBtnEl) {
  addSummaryFilterBtnEl.addEventListener('click', (e) => { e.preventDefault(); addSummaryFilterChip(''); });
}
const summaryCombineModeEl = document.getElementById('summaryCombineMode') as HTMLSelectElement | null;
if (summaryCombineModeEl) {
  summaryCombineModeEl.addEventListener('change', rebuildSummaryExternalFilter);
}
const summaryExportCsvBtnEl = document.getElementById('summaryExportCsv') as HTMLButtonElement | null;
if (summaryExportCsvBtnEl) {
  summaryExportCsvBtnEl.addEventListener('click', () => state.summaryGridApi?.exportDataAsCsv({ fileName: 'summary.csv' }));
}
const summaryExportJsonBtnEl = document.getElementById('summaryExportJson') as HTMLButtonElement | null;
if (summaryExportJsonBtnEl) {
  summaryExportJsonBtnEl.addEventListener('click', () => state.summaryGridApi && exportDisplayedRowsAsJson(state.summaryGridApi, 'summary.json'));
}
const summaryQuickFilterEl = document.getElementById('summaryQuickFilter') as HTMLInputElement | null;
if (summaryQuickFilterEl) {
  summaryQuickFilterEl.addEventListener('input', () => { try { state.summaryGridApi?.setGridOption('quickFilterText', summaryQuickFilterEl.value || ''); } catch {} });
}

// Stub summary functions that are referenced but not fully implemented
function buildSummaryGrid(rows: any[]) {
  // This would build the summary grid if the HTML elements existed
  console.log('buildSummaryGrid called but summary UI not present');
}

function rebuildSummaryExternalFilter() {
  if (!state.summaryFuse || state.summaryFilters.length === 0) {
    state.summaryGridApi?.onFilterChanged();
    return;
  }
  // This would filter the summary grid if it existed
  console.log('rebuildSummaryExternalFilter called but summary UI not present');
}

// Reset entire layout (but keep previous runs history)
document.getElementById('resetLayoutBtn')!.addEventListener('click', async () => {
  const keys = await storage.keys();
  await Promise.all(keys.filter((k) => k.startsWith('ag:layout:') || k.startsWith('height:') || k.startsWith('pfxp:viewPreset')).map((k) => storage.removeItem(k)));
  const main = document.querySelector('#tableCard') as HTMLElement | null;
  if (main) { main.classList.remove('fullscreen-overlay'); main.style.height = ''; main.style.flex = ''; main.style.minHeight = '45vh'; }
  document.body.classList.remove('fullscreen-active');
  if (state.raw) {
    if (state.gridApi) { state.gridApi.setGridOption('columnDefs', mainColumnDefs()); state.gridApi.setGridOption('rowData', state.raw.details); }
    await applyViewPreset('default'); // Reset to default view
    ensureDefaultFilterInputs();
    initCardResize('#tableCard', 'pfxp:main', '#table', 'bottom');
    setTimeout(sizeGrids, 0);
  }
});

refreshBtn.addEventListener('click', async () => {
  if (!state.email) return;
  setStatus('Refreshing…');
  const credential = await encryptPassword(state.password || '');
  await post('/api/fetch', { email: state.email, credential });
  pollStatus();
});

// Initialize after page load
document.addEventListener('DOMContentLoaded', async () => {
  const badge = document.getElementById('appBuildId') as HTMLElement | null;
  if (badge) {
    badge.textContent = BUILD_ID;
    badge.setAttribute('title', `Build ${BUILD_ID} (${BUILD_TIMESTAMP})`);
    badge.classList.remove('d-none');
  }

  initTooltips();
  updateScale();
  sizeGrids();
  await loadInitialSettings();
  await populateRunsDropdown();
  initCardResize('#tableCard', 'pfxp:main', '#table');
  await applySavedHeights();

  // Wire up view presets
  viewPresetSimpleBtn.addEventListener('change', () => applyViewPreset('simple'));
  viewPresetDefaultBtn.addEventListener('change', () => applyViewPreset('default'));
  viewPresetFullBtn.addEventListener('change', () => applyViewPreset('full'));
  mainFullscreenBtn.addEventListener('click', () => toggleFullscreen('#tableCard', 'pfxp:main', '#table'));
});

// Redraw on mouse up (end of resize interactions)
window.addEventListener('mouseup', () => setTimeout(sizeGrids, 50));

// Load JSON from disk
loadJsonBtn.addEventListener('click', () => loadJsonInput.click());
loadJsonInput.addEventListener('change', async (e: any) => {
  const file: File | undefined = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const doc = JSON.parse(text);
    if (!doc || !Array.isArray(doc.details)) {
      setStatus('Invalid JSON file: missing details array.', 'danger');
      return;
    }
    await presentData(doc, { fromFile: true });
  } catch (err: any) {
    setStatus('Failed to load JSON: ' + (err?.message || err), 'danger');
  } finally {
    e.target.value = '';
  }
});

// Previous Runs
loadRunBtn.addEventListener('click', async () => { await loadSelectedRun(); });
previousRunsEl.addEventListener('change', () => {
  const has = !!previousRunsEl.value;
  loadRunBtn.disabled = !has;
  deleteRunBtn.disabled = !has;
});

async function deleteSelectedRun() {
  const id = previousRunsEl.value;
  if (!id) return;
  try {
    await storage.removeItem('run:' + id);
    let idx = await loadRunsIndex();
    idx = idx.filter((it: any) => it.id !== id);
    await saveRunsIndex(idx);
    await populateRunsDropdown();
    setStatus('Deleted selected run', 'success');
    setTimeout(clearStatus, 1500);
  } catch {
    setStatus('Failed to delete run', 'danger');
  }
}

// Hook up delete button
deleteRunBtn.addEventListener('click', async () => {
  if (!previousRunsEl.value) return;
  const ok = window.confirm('Delete the selected run? This cannot be undone.');
  if (!ok) return;
  await deleteSelectedRun();
});

function ensureDefaultFilterInputs() {
  const filtersWrap = document.getElementById('filters');
  if (filtersWrap && filtersWrap.querySelectorAll('.search-chip').length === 0) addFilterChip('');
}

// Card resize support with persisted heights
let activeResize: { card: HTMLElement, storageKey: string } | null = null;
function initCardResize(cardSelector: string, storageKey: string, tableSelector: string, edge: 'bottom' | 'top' = 'bottom') {
  const card = document.querySelector(cardSelector) as HTMLElement | null;
  if (!card) return;
  const sel = edge === 'top' ? '.card-resize-handle-top' : '.card-resize-handle';
  if (!card.querySelector(sel)) {
    const handle = document.createElement('div');
    handle.className = edge === 'top' ? 'card-resize-handle-top' : 'card-resize-handle';
    card.appendChild(handle);
    let startY = 0; let startH = 0;
    const onMouseMove = (e: MouseEvent) => {
      if (!activeResize) return;
      const dy = e.clientY - startY;
      let newH = edge === 'top' ? (startH - dy) : (startH + dy);
      newH = Math.max(minCardHeight(card, tableSelector), newH);
      newH = Math.min(newH, maxCardHeight(card));
      card.style.height = newH + 'px';
      card.style.flex = '0 0 ' + newH + 'px';
      sizeGrids();
    };
    const endResize = async () => {
      if (!activeResize) return;
      activeResize = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', endResize);
      const h = card.getBoundingClientRect().height;
      card.style.flex = '0 0 ' + Math.round(h) + 'px';
      await storage.setItem('height:' + storageKey, Math.round(h));
    };
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      activeResize = { card, storageKey };
      startY = (e as MouseEvent).clientY;
      startH = card.getBoundingClientRect().height;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', endResize);
    });
  }
}

function maxCardHeight(card: HTMLElement) {
  const rect = card.getBoundingClientRect();
  const viewportH = window.innerHeight || document.documentElement.clientHeight;
  const margin = 8;
  return Math.max(150, Math.floor(viewportH - rect.top - margin));
}

function minCardHeight(card: HTMLElement, tableSelector: string) {
  const headerEl = card.querySelector('.card-header') as HTMLElement | null;
  const bodyEl = card.querySelector('.card-body') as HTMLElement | null;
  const tableEl = document.querySelector(tableSelector) as HTMLElement | null;
  const gridHeader = tableEl ? tableEl.querySelector('.ag-header') as HTMLElement | null : null;
  const row = tableEl ? tableEl.querySelector('.ag-row') as HTMLElement | null : null;
  const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
  const bodyPadding = bodyEl ? (parseFloat(getComputedStyle(bodyEl).paddingTop) + parseFloat(getComputedStyle(bodyEl).paddingBottom)) : 0;
  const gridHeaderH = gridHeader ? gridHeader.getBoundingClientRect().height : 36;
  let rowH = row ? row.getBoundingClientRect().height : 36;
  if (rowH < 24) rowH = 24;
  const minTableArea = gridHeaderH + rowH * 3;
  const minTotal = headerH + bodyPadding + minTableArea + 4;
  return Math.max(200, Math.floor(minTotal));
}

async function applySavedHeights() {
  const main = document.querySelector('#tableCard') as HTMLElement | null;
  const mh = await storage.getItem('height:pfxp:main') as number | null;
  if (mh && main) {
    const h = Math.min(Math.max(mh, minCardHeight(main, '#table')), maxCardHeight(main));
    (main as any).dataset.tableScrollHeight = h + 'px';
    (main as any).dataset.tableScrollFlex = '0 0 ' + h + 'px';
    if (!pageScrollToggle?.checked) {
      main.style.height = h + 'px';
      main.style.flex = '0 0 ' + h + 'px';
    }
  }
  sizeGrids();
}

function clampSavedHeightsToViewport() {
  const main = document.querySelector('#tableCard') as HTMLElement | null;
  const sum = document.querySelector('#summaryCard') as HTMLElement | null;
  if (main && main.style.height) {
    const h = parseInt(main.style.height, 10) || 0;
    const clamped = Math.min(Math.max(h, minCardHeight(main, '#table')), maxCardHeight(main));
    if (clamped !== h) {
      main.style.height = clamped + 'px';
      main.style.flex = '0 0 ' + clamped + 'px';
    }
  }
  if (sum && sum.style.height) {
    const h2 = parseInt(sum.style.height, 10) || 0;
    const clamped2 = Math.min(Math.max(h2, minCardHeight(sum, '#summaryTable')), maxCardHeight(sum));
    if (clamped2 !== h2) {
      sum.style.height = clamped2 + 'px';
      sum.style.flex = '0 0 ' + clamped2 + 'px';
    }
  }
  sizeGrids();
}

function toggleFullscreen(cardSelector: string, storageKey: string, tableSelector: string) {
  const card = document.querySelector(cardSelector) as HTMLElement | null;
  if (!card) return;
  const isFs = card.classList.contains('fullscreen-overlay');
  if (!isFs) {
    (card as any).dataset.prevHeight = card.style.height || '';
    (card as any).dataset.prevFlex = card.style.flex || '';
    const navbar = document.querySelector('nav.navbar') as HTMLElement | null;
    const offsetTop = navbar ? navbar.getBoundingClientRect().height : 0;
    card.classList.add('fullscreen-overlay');
    card.style.top = offsetTop + 'px';
    card.style.height = '';
    card.style.flex = '';
    document.body.classList.add('fullscreen-active');
  } else {
    card.classList.remove('fullscreen-overlay');
    card.style.top = '';
    const prevH = (card as any).dataset.prevHeight || '';
    const prevF = (card as any).dataset.prevFlex || '';
    card.style.height = prevH;
    card.style.flex = prevF;
    document.body.classList.remove('fullscreen-active');
  }
  sizeGrids();
}

export {};
