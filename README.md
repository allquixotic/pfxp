# Paizo XP Finder (pfxp)

A Bun + TypeScript web app that calculates Paizo Organized Play XP and presents rich tables in the browser. The backend is a headless Playwright scraper using Firefox browsers, driven by a Bun server. The architecture supports multiple Firefox browser instances and multiple long-running requests concurrently, using async for all I/O.

## Highlights

- Bun server written in TypeScript (see `index.ts` and `src/server.ts`).
- Playwright-powered scraper (see `src/scraper.ts`) with a Firefox browser pool and an async scheduler for concurrent flows.
- Client UI (see `public/index.html`) built with Bootstrap and Tabulator, featuring:
  - Two interactive tables: detailed sessions and character summary with XP totals
  - Column reordering, visibility toggling, and width resizing for both tables
  - Horizontal scrolling when total column width exceeds viewport (tables use 'fitData' layout)
  - Persistent layout (order, visibility, widths) saved to IndexedDB via localForage and restored on reload
  - Fuzzy search filtering for both tables with AND/OR logic and search suggestions
  - "Previous Runs" dropdown storing up to 25 unique results (by SHA-256 hash) from Fetch or file loads
  - File loader to visualize previously saved JSON from disk
  - Dark/light theme toggle with automatic UI scaling based on viewport size
  - Resizable table sections with persistent height preferences
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

We also vendor a small client-side storage helper (localForage) via CDN in the HTML and track it in the project dependencies:

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

- Two interactive Tabulator tables (sessions detail and character summary) with:
  - Horizontal scrolling when columns exceed the viewport
  - Column reordering, hiding/showing, and resizing with right-click menu on headers
  - Persistent layouts (order, visibility, widths) saved to IndexedDB via localForage and restored on reload
  - Independent fuzzy search filtering with AND/OR logic and autocomplete suggestions
  - CSV and JSON export capabilities
  - Layout reset functionality
- "Previous Runs" history storing up to 25 unique results (by SHA-256 hash) from both API fetches and file loads
- Resizable table sections with mouse drag handles and persistent height preferences
- Dark/light theme toggle with improved contrast and automatic UI scaling
- Character summary table showing total XP and effective level calculations per character per game system

## Security

- Credentials are encrypted client-side using RSA-OAEP-256 with ephemeral public keys rotated every 15 minutes
- Private keys are kept server-side only; expired keys are automatically pruned after a 5-minute grace period
- Only encrypted ciphertext is transmitted to the server; passwords never persist client-side beyond the current session

## Development notes

- The scraping flow and selectors live in `src/scraper.ts` and are the source of truth for page navigation and parsing.
- The server endpoints and queueing logic are in `src/server.ts`.
- The browser UI and persistence logic are in `public/index.html`.

If Playwright reports a missing executable, install Firefox with:

```bash
bunx playwright install firefox
```

If you change scraping logic, verify the UI still renders and that history + layouts persist correctly across reloads.
