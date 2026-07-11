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
- I.data: scrape document with `characters`, `details`, `summary`, optional account identity, and optional sanitized GM-recognition blocks.
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
11. GM-recognition blocks preserve Paizo text and glyph images across saved runs, but only bounded `p`/`span`/`img` markup with validated Paizo image URLs and safe attributes may render. Unsafe, malformed, oversized, or deeply nested blocks are omitted. Legacy runs without blocks remain valid.
12. CSP permits GM-recognition images from HTTPS `paizo.com` hosts and no other remote image origin.
13. XP classification uses explicit product shapes, never incidental title words: Adventure Path books award 12 XP; second-edition Bounties award 1 XP, Quests award at most 2 reported XP, and all other rows award 4 XP; first-edition Bounties award 1/4 XP, Quests award 1/2 XP, and all other rows award 1 XP. Playtest and no-credit rows award zero. No single row may award 8 XP.
14. Scrapes and loaded runs derive every session XP value from canonical game system, explicit product class, reputation/no-credit signals, and V13. Stored session XP and summaries are never authoritative.
15. Comfortable and Compact Scenario displays omit catalog game-system boilerplate while preserving product class, number, semantic title, and raw I.data. Grid, mobile, details, tooltip, copy, and current-view exports use the same display string.
16. Effective-level formatting preserves fractional XP and emits the reduced plain-text fraction of level progress; it never rounds XP before computing the level.

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
|T9|x|extract, persist, render, and test safe GM-recognition blocks|V11,V12,I.data,I.history|
|T10|x|correct XP product classification and normalize saved runs|V13,I.data,I.history,I.deploy|
|T11|x|make loaded XP authoritative and Scenario display system-free|V13,V14,V15,V16,I.data,I.history,I.tables,I.deploy|

## §B

|id|date|cause|fix|
|---|---|---|---|
|B1|2026-07-10|already-played rows were discarded during scrape and import normalization|V1,V2|
|B2|2026-07-10|Characters search depended on AG Grid quick-filter aggregation, whose date filter value reached a string formatter and rejected every row; prefilter shared row data and test formatted search values|V4,V6|
|B3|2026-07-10|GM-recognition URLs passed sanitizer, but app CSP blocked every remote image|V12|
|B4|2026-07-10|The Starfinder 2e fallback assigned 8 XP to every title lacking the literal word `Scenario`, while broad substring checks also mistook incidental `Bounty`/`Quest` title words for product classes|V13|
|B5|2026-07-10|Saved-run migration repaired only XP equal to 8, leaving stale first-edition Bounties and character totals unchanged|V14|
|B6|2026-07-10|Comfortable displayed raw Paizo Scenario text while Compact globally abbreviated system words, so both repeated the separate Game System column|V15|
|B7|2026-07-10|Effective-level formatting rounded fractional XP before computing progress, inflating quarter-XP character levels|V16|
|B8|2026-07-10|The history test encoded its distinguishing data only in a derived summary, so authoritative summary rebuilding correctly erased the invalid fixture; use roster data for fixture identity|V14|
|B9|2026-07-10|Paizo scenario cells retain indentation around their text, so the start-anchored product recognizer saw raw Quests and Bounties as standard rows until the client reparsed their trimmed stored titles; normalize inside the authoritative classifier|V14|
