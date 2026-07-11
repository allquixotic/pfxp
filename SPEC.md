# PFXP spec

## §G

Give Paizo Organized Play users fast, durable, account-aware session and character tables on desktop and mobile.

## §C

- Bun + TypeScript server. Playwright Firefox scraper stays authoritative.
- Quasar + Vue client. AG Grid Community powers desktop tables.
- Credentials stay encrypted in transit and memory-only on server.
- Paizo account key = whitespace-free, case-folded email. `+` aliases remain distinct.
- Runs persist locally across accounts. Startup selects chronologically newest run, never last-selected run.
- Desktop and mobile actions expose same table behavior where form factor permits.

## §I

- I.api: `GET /api/crypto/key`, `POST /api/fetch`, `POST /api/status`.
- I.data: scrape document with `characters`, `details`, `summary`, optional account identity.
- I.history: browser IndexedDB/local storage for accounts, runs, active tab, and per-table view state.
- I.tables: Sessions and Characters grids, mobile cards, toolbar, context menu, exports.
- I.deploy: `pfxp.dmvorgplay.com` via Cloudflare tunnel and d6n `pffoundry` LXC.

## §V

1. Already-played note rows remain visible, have zero XP, and render gray.
2. No-XP exclusion is explicit, reversible, and off by default.
3. CSV, JSON, and XLSX exports contain current visible rows and visible columns in displayed order.
4. Each table restores column width/order/visibility, filters, sort, density/preset, and manual-width intent. Active table restores too.
5. Auto-width columns equal minimum width needed for header plus longest currently visible value. They never stay wider. User-resized columns may be any width until reset to auto.
6. Both tables offer Filters, Columns, Custom, Compact, Export, fullscreen, and equivalent context actions.
7. Compact strings use stable game/scenario abbreviations and `MM-DD-YY` dates without losing distinguishing content.
8. Character level renders whole level plus reduced plain-text progress fraction.
9. Account identity is canonical across API state, documents, and history; case/whitespace variants merge, `+` aliases do not.
10. Startup loads newest stored run across all accounts. Runtime account/run switching never deletes other accounts' runs.

## §T

|id|status|task|cites|
|---|---|---|---|
|T1|x|retain/style already-played rows; add no-XP filter|V1,V2,I.data,I.tables|
|T2|x|add canonical account model and account/run switcher|V9,V10,I.api,I.data,I.history|
|T3|x|make both table toolbars and view persistence equivalent|V4,V6,I.tables|
|T4|x|implement auto/manual column sizing and reset UX|V5,I.tables|
|T5|x|add compact formatters and fractional levels|V7,V8,I.data,I.tables|
|T6|x|export current view to XLSX|V3,I.tables|
|T7|>|regression, browser, real-account, production tests|V1,V2,V3,V4,V5,V6,V7,V8,V9,V10,I.deploy|
|T8|>|commit, push, deploy exact verified commit|I.deploy|

## §B

|id|date|cause|fix|
|---|---|---|---|
|B1|2026-07-10|already-played rows were discarded during scrape and import normalization|V1,V2|
|B2|2026-07-10|Characters search depended on AG Grid quick-filter aggregation, whose date filter value reached a string formatter and rejected every row; prefilter shared row data and test formatted search values|V4,V6|
