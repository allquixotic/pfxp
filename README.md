# Paizo XP Finder (pfxp)

A Bun + TypeScript web app that calculates Paizo Organized Play XP and presents rich tables in the browser. The backend is a headless Playwright scraper using Firefox browsers, driven by a Bun server. The architecture supports multiple Firefox browser instances and multiple long-running requests concurrently, using async for all I/O.

## Highlights

- Bun server written in TypeScript (see `index.ts` and `src/server.ts`).
- Playwright-powered scraper (see `src/scraper.ts`) with a Firefox browser pool and an async scheduler for concurrent flows.
- Client UI (see `src/client`) built with Vue 3, Quasar, and AG Grid Community, featuring:
  - Two interactive tables: detailed sessions and character summary with XP totals
  - Matching search, filter, column, density, saved-view, export, and fullscreen controls for both tables
  - Auto-fit column widths with manual overrides, drag reordering, visibility controls, sorting, and contextual right-click/long-press actions
  - Persistent table state (order, visibility, widths, sort, filters, density, and active table) saved to IndexedDB via localForage
  - Fuzzy search filtering with AND/OR logic and search suggestions
  - Account-scoped Previous Runs history that retains every imported or fetched result and opens the newest run at startup
  - Runtime switching between canonicalized Paizo account identities without discarding another account's history
  - CSV, JSON, and Excel XLSX export; table exports contain the currently visible columns and filtered/sorted rows
  - File loader to visualize previously saved JSON from disk
  - Responsive desktop grids and ergonomic mobile card views with compact display formatting
  - Dark/light theme toggle
- Client-side credential encryption using ephemeral RSA-OAEP-256 public keys served by the backend.

## Requirements

- Bun (https://bun.sh) v1.1+
- Playwright browsers (Firefox)

Install the Playwright browser once:

```bash
bunx playwright install firefox
```

## Install dependencies

```bash
bun install
```

Client-side persistence is provided by the tracked localForage dependency:

```bash
bun add localforage@latest
```

## Run the server

```bash
bun run index.ts
```

Then open http://localhost:3000 in your browser.

## CLI (optional)

A CLI is available if you prefer to scrape and write JSON directly to disk:

```bash
# Provide credentials via env (dotenvx recommended)
dotenvx run -- bun run src/cli.ts [output.json] [--headed]
```

- Set PAIZO_EMAIL and PAIZO_PASSWORD securely via dotenvx or your shell.
- The `--headed` flag launches a visible browser (handy for debugging); otherwise Firefox runs headless.

## API overview

- GET /api/crypto/key
  - Returns the current ephemeral RSA-OAEP-256 public JWK and keyId for client-side credential encryption.
- POST /api/fetch
  - Body: `{ email: string, credential: { keyId: string, ciphertext: string } }`
  - Queues a new request if needed and returns `{ status: 'queued' | 'processing' | 'ready' | 'blocked' | 'error', ... }`.
- POST /api/status
  - Body: `{ email: string }`
  - Returns the current status or `{ status: 'ready', data }` when the scrape finishes (cached briefly to respect cooldowns).

## Concurrency design (TypeScript/Bun)

- The scraper (`PaizoScraper`) maintains a pool of Firefox browsers sized to roughly half your CPU threads by default. Each browser instance runs independent scraping flows in parallel.
- The scheduler uses a FIFO queue to dispatch tasks to idle browsers without blocking, with all operations using async I/O to keep the event loop responsive.
- The HTTP layer (`src/server.ts`) implements per-user status tracking, a 5-minute refresh cooldown, and error handling including a 2-minute block on credential failures and a 5-minute global delay on scraping errors.

## UI features

- Two AG Grid tables (session detail and character summary) with an identical power-user command surface.
- Column reordering, hiding/showing, free resizing, auto-fit reset, sorting, advanced filters, fuzzy search, compact mode, saved custom views, and fullscreen mode.
- Right-click menus on desktop and long-press menus on mobile for table and column actions.
- CSV and Excel XLSX exports contain the current filtered/sorted rows and visible columns; JSON exports preserve the complete run document.
- Every table view is persisted independently in IndexedDB and restored across reloads, including the active table.
- Account-scoped run history retains all fetched and imported runs and automatically opens the chronologically newest run at startup.
- Paizo account identities are canonicalized case-insensitively while preserving distinct `+` aliases, and accounts can be switched without losing run history.
- Rows whose notes start with “player has already played” remain visible, receive zero XP, and are styled gray; a filter can exclude every zero-XP event.
- Character effective levels use reduced ASCII fractions, such as `4 5/12` or `2 1/2`.
- Responsive desktop and mobile layouts, compact scenario/date labels, and dark/light themes.

## License

Copyright 2025 Sean McNamara <smcnam@gmail.com>

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUTHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

## Security

- Credentials are encrypted client-side using RSA-OAEP-256 with ephemeral public keys rotated every 15 minutes
- Private keys are kept server-side only; expired keys are automatically pruned after a 5-minute grace period
- Only encrypted ciphertext is transmitted to the server; passwords never persist client-side beyond the current session

## Development notes

- The scraping flow and selectors live in `src/scraper.ts` and are the source of truth for page navigation and parsing.
- The server endpoints and queueing logic are in `src/server.ts`.
- The browser UI and persistence logic are in `src/client`; Vite emits the deployable assets under `public`.

If Playwright reports a missing executable, install Firefox with:

```bash
bunx playwright install firefox
```

If you change scraping logic, verify the UI still renders and that history + layouts persist correctly across reloads.
