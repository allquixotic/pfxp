(function(){
  function findGridThemeContainer(){
    const container = document.querySelector('#table');
    if (!container) return null;
    // Find the first child with class starting with 'ag-theme'
    return container.querySelector('[class*="ag-theme"]') || container.firstElementChild;
  }

  function applyScrollMode(pageScroll){
    const themeEl = findGridThemeContainer();
    if (!themeEl) return;
    themeEl.classList.toggle('ag-layout-auto-height', !!pageScroll);
    if (pageScroll) {
      themeEl.style.height = '';
      themeEl.style.maxHeight = '';
    } else {
      // Fixed height for table-level scrolling
      themeEl.style.height = '65vh';
      themeEl.style.maxHeight = '65vh';
    }
  }

  function initScrollToggle(){
    const toggle = document.getElementById('pageScrollToggle');
    if (!toggle) return;
    // Default to page-level scroll
    applyScrollMode(true);
    toggle.addEventListener('change', () => applyScrollMode(toggle.checked));
    // Re-apply when grid mounts
    const obs = new MutationObserver(() => applyScrollMode(toggle.checked));
    const table = document.getElementById('table');
    if (table) obs.observe(table, { childList: true, subtree: true });
  }

  function renderSummary(data){
    if (!data || !data.details || !data.summary) return;
    const card = document.getElementById('summaryCard');
    const tbody = document.querySelector('#summaryTable tbody');
    if (!card || !tbody) return;

    // Compute sessions per character name
    const sessionsPerChar = {};
    for (const d of data.details) {
      const name = d?.character?.name || 'Unknown';
      sessionsPerChar[name] = (sessionsPerChar[name] || 0) + 1;
    }

    // Build rows from summary
    const rows = [];
    for (const [name, summ] of Object.entries(data.summary)) {
      const xp = Number(summ?.xp || 0);
      // Approximate level: 12 XP per level typical; ensure minimum level 1
      const level = Math.max(1, Math.floor(xp / 12) + 1);
      const count = sessionsPerChar[name] || 0;
      rows.push({ name, xp, level, count });
    }

    rows.sort((a,b)=> a.name.localeCompare(b.name));

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td class="text-end">${r.xp}</td>
        <td class="text-end">${r.level}</td>
        <td class="text-end">${r.count}</td>
      </tr>
    `).join('');

    card.classList.remove('d-none');
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  // Intercept fetch to capture /api/status responses and render summary when ready
  function hookFetch(){
    const origFetch = window.fetch;
    window.fetch = function(input, init){
      const p = origFetch.apply(this, arguments);
      try {
        const url = (typeof input === 'string') ? input : (input && input.url) || '';
        if (url.includes('/api/status')) {
          p.then(resp => {
            try {
              const clone = resp.clone();
              clone.json().then(json => {
                if (json && json.status === 'ready' && json.data) {
                  renderSummary(json.data);
                }
              }).catch(()=>{});
            } catch (_) {}
          }).catch(()=>{});
        }
      } catch (_) {}
      return p;
    };
  }

  // Also observe any global data injection by the app (e.g., setting window.lastData)
  function hookDataLayer(){
    const w = window;
    let lastData = null;
    Object.defineProperty(w, 'PFXP_LAST_DATA', {
      configurable: true,
      set(val){ lastData = val; if (val && val.details && val.summary) renderSummary(val); },
      get(){ return lastData; }
    });
    // Expose a manual trigger
    w.PFXP_RENDER_SUMMARY = function(data){ if (data && data.details && data.summary) renderSummary(data); };
  }

  function tryParseJson(val){
    if (!val) return null;
    if (typeof val === 'object') return val;
    if (typeof val === 'string'){
      try { return JSON.parse(val); } catch (_) { return null; }
    }
    return null;
  }

  function tryRenderFromValue(val){
    const obj = tryParseJson(val);
    if (obj && obj.details && obj.summary){
      renderSummary(obj);
      return true;
    }
    return false;
  }

  function hookLocalForage(){
    const lf = window.localforage;
    if (!lf) return;

    const origGetItem = lf.getItem?.bind(lf);
    if (origGetItem){
      lf.getItem = function(key){
        const p = origGetItem(key);
        if (p && typeof p.then === 'function'){
          return p.then(val => { tryRenderFromValue(val); return val; });
        }
        tryRenderFromValue(p);
        return p;
      };
    }

    const origSetItem = lf.setItem?.bind(lf);
    if (origSetItem){
      lf.setItem = function(key, value){
        const p = origSetItem(key, value);
        if (p && typeof p.then === 'function'){
          return p.then(val => { tryRenderFromValue(value ?? val); return val; });
        }
        tryRenderFromValue(value);
        return p;
      };
    }
  }

  function readFileAndRender(file){
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { tryRenderFromValue(reader.result); };
    reader.readAsText(file);
  }

  function hookFileLoaders(){
    const input = document.getElementById('loadJsonInput');
    const btn = document.getElementById('loadJsonBtn');
    if (input){
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (f) readFileAndRender(f);
      });
    }
    if (btn && input){
      btn.addEventListener('click', () => {
        const f = input.files && input.files[0];
        if (f) readFileAndRender(f);
      });
    }
    // Previous Runs load: rely on localforage.getItem hook to render
    const loadRunBtn = document.getElementById('loadRunBtn');
    if (loadRunBtn){
      loadRunBtn.addEventListener('click', () => {
        // no-op: summary will render when localforage.getItem resolves
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initScrollToggle();
    hookFetch();
    hookDataLayer();
    hookLocalForage();
    hookFileLoaders();
    // Try initial apply in case grid is already mounted
    applyScrollMode(true);
  });
})();
