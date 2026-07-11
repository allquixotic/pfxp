# AGENTS.md (TypeScript/Bun + Playwright)

This project is implemented in TypeScript running on the Bun runtime with a headless Playwright backend using Firefox browsers exclusively. The server orchestrates a pool of Firefox browser instances and processes multiple concurrent requests using async for all I/O. The browser UI is a feature-rich single page application (`public/index.html`) with two AG Grid data grids and persistent state management.

Source of truth: The TypeScript in `src/scraper.ts` and `src/server.ts` defines the exact flow and selectors. Any divergence in documentation should be corrected to match that code.

## File Overview

### Core Application Files
- **`index.ts`** - Main entry point that imports and starts the server from `src/server.ts`
- **`src/server.ts`** - Bun HTTP server implementation with API endpoints, request queueing, RSA key management, and static file serving
- **`src/scraper.ts`** - Core Playwright scraper class managing Firefox browser pools, page navigation, session parsing, and XP calculations
- **`src/types.ts`** - TypeScript type definitions for characters, sessions, API requests/responses, and internal state management
- **`src/cli.ts`** - Command-line interface for direct scraping to JSON files with environment variable credential handling
- **`src/client/`** - Vue 3 + Quasar single-page application with dual AG Grid grids, persistent state, account/run history, filtering, and export logic
- **`public/index.html`** / **`public/assets/`** - Vite build output served by the Bun server

### Configuration Files
- **`package.json`** - Project dependencies, scripts, and Bun module configuration
- **`tsconfig.json`** - TypeScript compiler configuration
- **`bunfig.toml`** - Bun runtime configuration
- **`test.ts`** - Test file (if present)
- **`output.json`** - Sample/test output data file

### Development Support
- **`.claude/settings.local.json`** - Claude AI assistant configuration
- **`.gitignore`** - Git ignore patterns
- **`.env` / `.env.keys`** - Environment variable files for credentials (not tracked in git)
- **`bun.lock`** - Bun dependency lock file

## Goals

- Accept Paizo.com credentials from a local user, then scrape Organized Play data using Playwright.
- Produce a single JSON document with characters, sessions, and computed summary.
- Present results in a browser-based UI with export, filtering, and history.

## Architecture

- Runtime: Bun + TypeScript
- Browser automation: Playwright (Firefox-only)
- Server: `index.ts` imports `src/server.ts` and starts a Bun HTTP server.
- Scraper: `src/scraper.ts` manages a pool of Firefox browsers and schedules flows concurrently.
- UI: Vue 3 + Quasar + AG Grid Community source under `src/client`, built by Vite into `public` and served by the Bun server.

### Concurrency model

- A Firefox browser pool is created, sized to roughly half of CPU threads by default (minimum 1 browser).
- A FIFO task queue feeds idle browser instances; each scraping flow runs as an independent async task with internal state tracking.
- The HTTP layer maintains per-user status, a 5-minute refresh cooldown, a 2-minute block on credential failures, and a 5-minute global delay on scraping errors. It respects the scraper's concurrency limit to avoid oversubmission.

### Credential handling

- The server rotates ephemeral RSA-OAEP-256 key pairs every 15 minutes with a 5-minute grace period for expired keys.
- The client fetches the current public key (`/api/crypto/key`) and encrypts the password client-side using the Web Crypto API.
- The client submits `{ email, credential: { keyId, ciphertext } }` to `/api/fetch`. Passwords are never stored client-side beyond the current session.

## Page flow and scraping logic (as implemented)

1) Go to `https://paizo.com/cgi-bin/WebObjects/Store.woa/wa/browse?path=organizedPlay/myAccount/player#tabs`.
   - If `input[name="e"]` exists, submit login via `input[name="e"]` (email), `input[name="zzz"]` (password), click `button[value="Sign In"]`, then navigate back to the player page.
   - If an invalid-credentials message appears, abort with `Login failed - invalid credentials`.

2) Parse the "My Characters" table:
   - Extract `orgplayid`, `charid`, character `name`, `faction` (from image alt), and infer `game` based on character ID ranges:
     - Starfinder 2e: 2700-2799
     - Pathfinder 2e: 2001-2699  
     - Starfinder 1e: 701-799
     - Pathfinder 1e: all others

3) Parse GM recognition from the player page:
   - Find paragraph text shaped like `You are a … GM.` (or `You are an … GM.`).
   - Preserve text, nested spans, and glyph/nova-style images as structured nodes; never persist or render raw HTML.
   - Allow at most 8 bounded blocks. Images must be HTTPS URLs under a `paizo.com` host and `/image/content/OrganizedPlay/`; unsupported, malformed, oversized, or deeply nested blocks are omitted.

4) Navigate to sessions: `https://paizo.com/cgi-bin/WebObjects/Store.woa/wa/browse?path=organizedPlay/myAccount/allsessions#tabs`.
   - Robustly handle intermittent access errors by backing off and retrying (`navigateWithAccessRetry`).

5) Parse all sessions across pagination:
   - Use the visible `next >` link when present, with 10-second delays between page transitions.
   - Verify successful page navigation by checking pagination indicators.
   - For each page, collect rows with date, GM, scenario, points, event ID/name, session number, player/org/char IDs, character/faction, prestige/reputation, notes.
   - Keep rows with blank/em-dash points and Starfinder Playtest entries; Playtest rows receive zero XP.
   - Skip rows only when the prestige/reputation cell itself is blank or an em dash.
   - Retain rows whose notes begin with "player has already played", force their XP reward to zero, and expose them to the UI's gray-row treatment and no-XP filter.

6) Compute XP per row using game system-specific rules and aggregate per-character summaries:
   - Adventure Path books: 12 XP
   - Second-edition Bounties: 1 XP; Quests: at most 2 reported XP; all other scenarios, adventures, and specials: 4 XP
   - First-edition Bounties: 1/4 XP; Quests: 1/2 XP; all other scenarios, adventures, and specials: 1 XP
   - Product classes require explicit title shapes (for example, `Pathfinder Bounty #...`); incidental words in scenario titles do not change the class
   - Starfinder Playtest and no-credit rows: 0 XP

The exact selectors, checks, and waits used here match the implementation in `src/scraper.ts` and should be treated as authoritative.

## HTTP API

- GET `/api/crypto/key` — returns `{ keyId, alg: 'RSA-OAEP-256', key: jwk, expiresAt }`.
- POST `/api/fetch` — queues a run for `{ email, credential }`, returns `queued | processing | ready | blocked | error`.
- POST `/api/status` — `{ email }` → current status or `{ status: 'ready', data }`.

## UI behavior

- Two AG Grid data grids: sessions (detailed) and character summary (aggregated XP and effective level).
- Both grids expose the same controls for column resizing/reorder/visibility, sorting, filtering, search, density, saved views, CSV/XLSX export, and fullscreen mode.
- Fuzzy search chips (Fuse.js) integrated via AG Grid external filter API with AND/OR combination and a global suggestions datalist.
- Independent grid state (order, visibility, widths, sort, filters, density, saved view, and active table) is saved in IndexedDB via localForage.
- Columns auto-fit the header and longest currently filtered value until the user deliberately resizes them; auto-fit can be restored from the toolbar or context menu.
- Right-click on desktop and long-press on mobile expose contextual table and column actions.
- Current-view CSV/XLSX exports preserve displayed column order and filtered/sorted row order.
- Previous Runs retains every fetched or imported run, groups them by canonicalized Paizo account, and loads the newest run at startup.
- Sanitized GM recognition is stored in the run document and rendered below its loaded-run label. Legacy runs without recognition remain valid.
- Account switching is available at runtime. Account keys remove Unicode whitespace and fold case while preserving distinct `+` aliases.
- Dark/light theme toggle switches Quasar colors and AG Grid Quartz color schemes.

## Notes for implementers

- Browser engine: Firefox exclusively (hardcoded in scraper initialization).
- Concurrency: governed by `PaizoScraper.getConcurrencyLimit()` (defaults to half CPU threads) and internal FIFO scheduler.
- Error handling: 
  - Invalid credentials trigger immediate failure and 2-minute user block
  - Scraping errors introduce 5-minute global delay
  - Access errors on sessions page trigger 60-second backoff and retry (up to 3 attempts)
- Security: ephemeral RSA key rotation every 15 minutes, 5-minute grace period, passwords only in memory during session.
- XP calculation: system-specific rules implemented in `calculateXP()` with character ID range detection.
- UI state: comprehensive persistence including grid layouts, heights, filters, and run history via IndexedDB.
- Source of truth: `src/scraper.ts` defines exact flow, selectors, and business logic. Changes should be made there first.
