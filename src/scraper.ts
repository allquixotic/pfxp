import { firefox } from 'playwright';
import type { Browser, Page } from 'playwright';
import { cpus } from 'os';
import type { Character, SessionDetail, PaizoOrganizedPlayData } from './types';
import { isAlreadyPlayedSessionNote } from './session-rules';
import { createPaizoAccountIdentity } from './account';

// Engine names we launch (Firefox-only)
type EngineName = 'firefox';

// Internal state tracking for each scraping flow
interface FlowState {
  id: string;
  email: string;
  step: string;
  startedAt: number;
  updatedAt: number;
  browserEngine?: EngineName;
  pageNum?: number;
}

interface FlowTask {
  id: string;
  email: string;
  password: string;
  resolve: (data: PaizoOrganizedPlayData) => void;
  reject: (err: any) => void;
  onProgress?: (p: { step?: string; message?: string; currentPage?: number; totalPages?: number }) => void;
}

interface BrowserRecord {
  id: string;
  engine: EngineName;
  browser: Browser;
  busy: boolean;
  tasksRun: number;
  lastUsedAt: number;
}

export class PaizoScraper {
  private headed: boolean;
  private preferredEngines: EngineName[];
  private maxBrowsers: number;

  // Pool and scheduler
  private pool: BrowserRecord[] = [];
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private queue: FlowTask[] = [];
  private state = new Map<string, FlowState>();

  constructor(opts?: { headed?: boolean; maxBrowsers?: number; preferredEngines?: EngineName[] }) {
    this.headed = !!opts?.headed;
    // Force Firefox-only pool regardless of provided preferences
    this.preferredEngines = ['firefox'];
    const halfThreads = Math.max(1, Math.floor((cpus?.().length ?? 1) / 2));
    this.maxBrowsers = Math.max(1, opts?.maxBrowsers ?? halfThreads);
  }

  async initialize() {
    if (this.initialized) return;
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      // Attempt to launch browsers up to maxBrowsers, round-robin across engines
      const engines: EngineName[] = this.preferredEngines.length > 0 ? [...this.preferredEngines] : ['firefox'];
      let launched = 0;
      let attempts = 0;
      const maxAttempts = Math.max(this.maxBrowsers, engines.length) * 2; // some slack in case of failures

      while (launched < this.maxBrowsers && attempts < maxAttempts) {
        const engine = engines[launched % engines.length] as EngineName;
        attempts++;
        try {
          const browser = await this.launchEngine(engine);
          const rec: BrowserRecord = {
            id: crypto.randomUUID(),
            engine,
            browser,
            busy: false,
            tasksRun: 0,
            lastUsedAt: Date.now(),
          };
          this.pool.push(rec);
          launched++;
        } catch (err: any) {
          // If an engine is unavailable (e.g., not installed), log and try next
          const msg = err?.message ? String(err.message) : String(err);
          console.warn(`[scraper] Failed to launch ${engine}: ${msg}`);
          // Rotate engine order to avoid repeatedly failing the same one
          const remaining = engines.filter((e) => e !== engine) as EngineName[];
          this.preferredEngines = [...remaining, engine];
          if (this.preferredEngines.length === 0) break;
        }
      }

      if (this.pool.length === 0) {
        // As a last resort, try firefox once (project already installs it)
        try {
          const browser = await this.launchEngine('firefox');
          this.pool.push({
            id: crypto.randomUUID(),
            engine: 'firefox',
            browser,
            busy: false,
            tasksRun: 0,
            lastUsedAt: Date.now(),
          });
        } catch (err) {
          console.error(err);
          throw new Error('Unable to launch any Playwright browser. Have you installed the browsers?');
        }
      }

      this.initialized = true;
    })();

    return this.initPromise;
  }

  private async launchEngine(engine: EngineName): Promise<Browser> {
    // For headless environments without X11, ensure proper configuration
    const launchOptions: any = {
      headless: !this.headed,
      firefoxUserPrefs: {
        'toolkit.startup.max_resumed_crashes': -1,
        // Disable crash reporting and telemetry which can cause issues in containers
        'toolkit.telemetry.reportingpolicy.firstRun': false,
        'datareporting.healthreport.uploadEnabled': false,
        'datareporting.healthreport.service.enabled': false,
        'datareporting.policy.dataSubmissionEnabled': false,
      },
      // Set environment variables to ensure Firefox runs without needing X11
      env: {
        ...process.env,
        MOZ_HEADLESS: '1',
        // Disable GPU acceleration which can cause issues in containers
        MOZ_WEBRENDER: '0',
        // Force software rendering
        MOZ_ACCELERATED: '0',
      }
    };

    // Always launch Firefox
    return firefox.launch(launchOptions);
  }

  async close() {
    const pool = [...this.pool];
    this.pool = [];
    this.initialized = false;
    this.initPromise = null;

    await Promise.allSettled(pool.map(async (rec) => {
      try {
        await rec.browser.close();
      } catch (e) {
        console.error(e);
      }
    }));
  }

  // Public API remains the same: schedule a flow, which will run on the next available browser
  async scrapeData(email: string, password: string, opts?: { onProgress?: (p: { step?: string; message?: string; currentPage?: number; totalPages?: number }) => void }): Promise<PaizoOrganizedPlayData> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Create task and enqueue
    const id = crypto.randomUUID();
    const promise = new Promise<PaizoOrganizedPlayData>((resolve, reject) => {
      const task: FlowTask = { id, email, password, resolve, reject, onProgress: opts?.onProgress };
      this.queue.push(task);
      this.state.set(id, {
        id,
        email,
        step: 'queued',
        startedAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Kick the scheduler
      this.schedule();
    });

    return promise;
  }

  // Expose read-only state for external observability (optional usage)
  getFlowState(flowId: string): FlowState | undefined {
    const st = this.state.get(flowId);
    return st ? { ...st } : undefined;
  }

  // Expose concurrency limit to allow upstream scheduler to match pool capacity
  getConcurrencyLimit(): number {
    return this.maxBrowsers;
  }

  private schedule() {
    // While we have idle browsers and tasks, start flows
    for (;;) {
      const idle = this.pool.find((rec) => !rec.busy);
      if (!idle) break;
      const task = this.queue.shift();
      if (!task) break;
      idle.busy = true;
      idle.lastUsedAt = Date.now();

      const st = this.state.get(task.id);
      if (st) {
        st.step = 'starting';
        st.updatedAt = Date.now();
        st.browserEngine = idle.engine;
        this.state.set(task.id, st);
      }

      // Run flow asynchronously; don't await here to allow multiple concurrent flows
      this.runFlowOnBrowser(idle, task)
        .then((data) => task.resolve(data))
        .catch((err) => task.reject(err))
        .finally(() => {
          idle.busy = false;
          idle.tasksRun++;
          idle.lastUsedAt = Date.now();
          // Clean up flow state when done
          const st2 = this.state.get(task.id);
          if (st2) {
            st2.step = 'finished';
            st2.updatedAt = Date.now();
            this.state.set(task.id, st2);
          }
          // Try to start the next queued task
          // Use microtask to avoid deep recursion
          queueMicrotask(() => this.schedule());
        });
    }
  }

  private async runFlowOnBrowser(rec: BrowserRecord, task: FlowTask): Promise<PaizoOrganizedPlayData> {
    const context = await rec.browser.newContext();
    const page = await context.newPage();

    const update = (step: string, extra?: Partial<FlowState>) => {
      const st = this.state.get(task.id);
      if (st) {
        Object.assign(st, { step, updatedAt: Date.now() }, extra || {});
        this.state.set(task.id, st);
      }
      try { task.onProgress?.({ step }); } catch {}
    };

    try {
      // Navigate to the player page
      update('navigating:player');
      await page.goto('https://paizo.com/cgi-bin/WebObjects/Store.woa/wa/browse?path=organizedPlay/myAccount/player#tabs');
      await page.waitForTimeout(5000);

      // Check if we need to login
      const loginField = await page.$('input[name="e"]');
      if (loginField) {
        update('login:submitting');
        await loginField.fill(task.email);
        await page.fill('input[name="zzz"]', task.password);
        await page.click('button[value="Sign In"]');
        // Explicitly look for invalid-credentials message for up to 5 seconds.
        try {
          await page
            .locator('text=That email address and password combination is not valid')
            .first()
            .waitFor({ state: 'visible', timeout: 5000 });
          throw new Error('Login failed - invalid credentials');
        } catch (e: any) {
          // If the wait timed out, proceed.
          if (!(e && e.name === 'TimeoutError')) {
            throw e;
          }
        }

        // Navigate back to player page after login
        update('navigating:player:post-login');
        await page.goto('https://paizo.com/cgi-bin/WebObjects/Store.woa/wa/browse?path=organizedPlay/myAccount/player#tabs');
        await page.waitForLoadState('networkidle');
      }

      // Parse characters
      update('parsing:characters');
      const characters = await this.parseCharacters(page);

      // Navigate to sessions page (with access error handling)
      update('navigating:sessions');
      await this.navigateWithAccessRetry(page, 'https://paizo.com/cgi-bin/WebObjects/Store.woa/wa/browse?path=organizedPlay/myAccount/allsessions#tabs');

      // Parse all sessions (handle pagination)
      update('parsing:sessions');
      const details = await this.parseAllSessions(page, characters, task.id, (p) => { try { task.onProgress?.(p); } catch {} });

      // Calculate summary
      update('summarizing');
      const summary = this.calculateSummary(details);

      update('done');
      return { account: createPaizoAccountIdentity(task.email), characters, details, summary };
    } catch (err: any) {
      // Log full Playwright error details to stderr and keep the page alive for inspection
      console.error(err?.stack || err);
      const message = (err && typeof err === 'object' && 'message' in err)
        ? (err as any).message as string
        : String(err);
      // Do not sleep for credential failures; otherwise, wait 30s before closing the page
      if (!message.includes('Login failed - invalid credentials')) {
        try {
          await page.waitForTimeout(30_000);
        } catch {}
      }
      throw err;
    } finally {
      try {
        await page.close();
      } catch (closeErr: any) {
        // Do not fail the whole run if closing the page errors out; log full details instead
        console.error(closeErr?.stack || closeErr);
      }
      try {
        await context.close();
      } catch (e) {
        console.error(e);
      }
    }
  }

  private async parseCharacters(page: Page): Promise<Character[]> {
    const characters: Character[] = [];

    const rows = await page.$$('table > tbody > tr');

    for (let i = 0; i < rows.length; i++) {
      const cells = await rows[i]?.$$('td') || [];

      if (cells.length >= 3) {
        const idCell = await cells[0]?.textContent();
        const gameCell = await cells[1]?.textContent();
        const characterCell = cells[2];

        if (idCell && idCell.includes('#')) {
          // Extract character ID and org play ID
          const idMatch = idCell.match(/# (\d+)-(\d+)/);
          if (idMatch && characterCell) {
            const orgplayid = parseInt(idMatch[1]!);
            const charid = parseInt(idMatch[2]!);

            // Get character name
            const nameElement = await characterCell.$('a');
            const name = await nameElement?.textContent() || '';

            // Get faction from image alt text
            const factionImg = await characterCell.$('img');
            const faction = await factionImg?.getAttribute('alt') || '';

            // Determine game system from character number per rules
            let game = '';
            if (charid >= 2700 && charid <= 2799) {
              game = 'Starfinder 2e';
            } else if (charid >= 2001 && charid <= 2699) {
              game = 'Pathfinder 2e';
            } else if (charid >= 701 && charid <= 799) {
              game = 'Starfinder 1e';
            } else {
              game = 'Pathfinder 1e';
            }

            characters.push({
              orgplayid,
              charid,
              name: name.trim(),
              faction,
              game
            });
          }
        }
      }
    }

    return characters;
  }

  private async hasAccessError(page: Page): Promise<boolean> {
    const selector = 'text=The requested URL was not found on this server, or you do not have permission to access this area.';
    try {
      const el = await page.$(selector);
      return !!el;
    } catch {
      return false;
    }
  }

  private async navigateWithAccessRetry(page: Page, url: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const resp = await page.goto(url);
      try {
        await page.waitForLoadState('networkidle');
      } catch {}
      const status = resp?.status();
      const hasAccessErr = await this.hasAccessError(page);
      if (status === 404 || hasAccessErr) {
        try {
          await page.goBack();
          await page.waitForLoadState('networkidle');
        } catch {}
        await page.waitForTimeout(60_000);
        continue;
      }
      return;
    }
    throw new Error('Access error encountered navigating to ' + url);
  }

  private async getPagerInfo(page: Page): Promise<{ start: number; end: number; total: number } | null> {
    try {
      const text = (await page
        .locator('div#results table:nth-of-type(1) td.tiny')
        .first()
        .textContent())?.trim() || '';
      const m = text.match(/(\d+)\s*to\s*(\d+)\s*of\s*(\d+)/i);
      if (m) {
        return { start: parseInt(m[1]!), end: parseInt(m[2]!), total: parseInt(m[3]!) };
      }
    } catch {}
    return null;
  }

  private async parseAllSessions(page: Page, characters: Character[], flowId?: string, onProgress?: (p: { step?: string; message?: string; currentPage?: number; totalPages?: number }) => void): Promise<SessionDetail[]> {
    const allDetails: SessionDetail[] = [];
    let pageNum = 1;
    let totalPages: number | undefined;

    while (true) {
      console.log(`DEBUG: Parsing page ${pageNum}`);

      // Determine total pages if available
      try {
        const pager = await this.getPagerInfo(page);
        if (pager && pager.total) {
          const pageSize = Math.max(1, pager.end - pager.start + 1);
          const computed = Math.max(1, Math.ceil(pager.total / pageSize));
          totalPages = totalPages || computed;
        }
      } catch {}

      if (onProgress) {
        const msg = totalPages ? `Processing page ${pageNum} of ${totalPages}` : `Processing page ${pageNum}`;
        try { onProgress({ step: 'parsing:sessions', currentPage: pageNum, totalPages, message: msg }); } catch {}
      }

      if (flowId) {
        const st = this.state.get(flowId);
        if (st) {
          st.step = `parsing:sessions:page:${pageNum}`;
          st.pageNum = pageNum;
          st.updatedAt = Date.now();
          this.state.set(flowId, st);
        }
      }

      // Parse current page
      const pageDetails = await this.parseSessions(page, characters);
      console.log(`DEBUG: Found ${pageDetails.length} sessions on page ${pageNum}`);
      if (pageDetails.length > 0) {
        const dates = pageDetails.map(d => d.date).sort();
        console.log(`DEBUG: Date range on page ${pageNum}: ${dates[0]} to ${dates[dates.length - 1]}`);
      }
      allDetails.push(...pageDetails);

      // Check for next page link
      const nextLocator = page.locator('a:has-text("next >")').first();
      let canClickNext = false;
      try {
        const visible = await nextLocator.isVisible();
        const href = visible ? await nextLocator.getAttribute('href') : null;
        canClickNext = !!visible && !!href;
        console.log(`DEBUG: Next link visible: ${visible}, has href: ${!!href}, canClickNext: ${canClickNext}`);
      } catch {
        canClickNext = false;
        console.log(`DEBUG: Exception checking next link, canClickNext: false`);
      }

      // If no clickable "next >" link, we're on the last page - exit after parsing
      if (!canClickNext) {
        console.log(`DEBUG: No more pages, stopping at page ${pageNum}`);
        break;
      }

      // Navigate to next page
      let advanced = false;
      let retries = 0;

      // Get current page number from pagination
      const getCurrentPageNumber = async () => {
        try {
          const paginationCell = await page.$('td.tiny[align="RIGHT"]');
          if (paginationCell) {
            const paginationHtml = await paginationCell.innerHTML();
            console.log(`DEBUG: Pagination HTML: ${paginationHtml.substring(0, 500)}`);

            // Find numbers that are NOT inside <a> tags (plain text = current page)
            // Look for patterns like "| 2 |" where 2 is not wrapped in <a> tags
            const segments = paginationHtml.split('|');
            for (const segment of segments) {
              const trimmed = segment.trim();
              // Check if this segment contains only a number (no <a> tag)
              if (/^\s*\d+\s*$/.test(trimmed)) {
                const pageNum = parseInt(trimmed);
                console.log(`DEBUG: Found current page number: ${pageNum}`);
                return pageNum;
              }
            }
          }
        } catch {}
        return 0;
      };

      const currentPageNumber = await getCurrentPageNumber();
      console.log(`DEBUG: Current page number from pagination: ${currentPageNumber}`);

      while (retries < 3) {
        try {
          console.log(`DEBUG: Attempting to navigate to page ${pageNum + 1}`);
          // Force a 10s wait between page transitions to reduce load and avoid throttling
          await page.waitForTimeout(10_000);
          // Double-check just before clicking to avoid timeout noise at the end
          const stillVisible = await nextLocator.isVisible().catch(() => false);
          const stillHref = stillVisible ? await nextLocator.getAttribute('href') : null;
          if (!stillVisible || !stillHref) {
            console.log(`DEBUG: Next link disappeared before clicking`);
            break;
          }
          await nextLocator.click({ timeout: 3000 });
          try { await page.waitForLoadState('networkidle'); } catch {}

          // Verify the page actually changed by checking pagination
          let newPageNumber = 0;
          let verificationAttempts = 0;
          while (verificationAttempts < 5) {
            try {
              await page.waitForTimeout(2000); // Give page time to update
              newPageNumber = await getCurrentPageNumber();
              if (newPageNumber > 0 && newPageNumber !== currentPageNumber) {
                break;
              }
            } catch {}
            verificationAttempts++;
          }

          if (newPageNumber === currentPageNumber || newPageNumber === 0) {
            console.log(`DEBUG: Page did not change after navigation (still page ${currentPageNumber})`);
            // Page didn't change, try clicking again
            retries++;
            continue;
          } else {
            console.log(`DEBUG: Successfully navigated from page ${currentPageNumber} to page ${newPageNumber}`);
          }
        } catch (navErr: any) {
          // If clicking "next" times out, break out of retry loop
          const msg = navErr?.message ? String(navErr.message) : '';
          console.log(`DEBUG: Navigation error: ${msg}`);
          if (!msg.includes("locator('a:has-text(\"next >\")')")) {
            console.error(navErr?.stack || navErr);
          }
          break;
        }

        let hasAccessErr = false;
        try {
          hasAccessErr = await this.hasAccessError(page);
        } catch {
          // Treat as access error and back off
          hasAccessErr = true;
        }
        if (hasAccessErr) {
          console.log(`DEBUG: Access error detected, retrying...`);
          // Go back, wait 60 seconds, and retry
          try {
            await page.goBack();
            try { await page.waitForLoadState('networkidle'); } catch {}
          } catch {}
          await page.waitForTimeout(60_000);
          retries++;
          continue;
        }
        advanced = true;
        break;
      }

      // If we couldn't advance to the next page, we're done
      if (!advanced) {
        console.log(`DEBUG: Could not advance from page ${pageNum}, stopping`);
        break;
      }

      pageNum++;
    }

    console.log(`DEBUG: Total sessions found across all pages: ${allDetails.length}`);
    return allDetails;
  }

  private async parseSessions(page: Page, characters: Character[]): Promise<SessionDetail[]> {
    const details: SessionDetail[] = [];
    try {
      // Ensure the results table is present before parsing
      try {
        await page.locator('div#results table:nth-of-type(2)').first().waitFor({ state: 'visible', timeout: 10000 });
      } catch {}

      const sessionRows = await page.$$('div#results table:nth-of-type(2) tbody tr');
      console.log(`DEBUG: parseSessions found ${sessionRows.length} table rows`);

      for (let i = 1; i < sessionRows.length; i++) { // Skip header row
        const cells = await sessionRows[i]?.$$('td') || [];

        if (cells.length >= 12) {
          // Parse date
          const dateElement = await cells[0]?.$('time');
          const dateStr = await dateElement?.getAttribute('datetime') || '';
          const date = dateStr.split('T')[0];

          // Parse GM
          const gmElement = await cells[1]?.$('a');
          const gm = await gmElement?.textContent() || '';

          // Paizo renders some newer scenarios as plain text instead of links.
          const scenario = await cells[2]?.textContent() || '';

          // Include Starfinder Playtest scenarios; XP will be 0 per rules

          // Parse points
          const pointsText = await cells[3]?.textContent() || '';
          const achievementMatch = pointsText.match(/(\d+\.?\d*) Achievement Points/);
          const gmCreditsMatch = pointsText.match(/(\d+\.?\d*) GM Credits/);

          const achievementPoints = achievementMatch ? parseFloat(achievementMatch[1]!) : null;
          const gmCredits = gmCreditsMatch ? parseFloat(gmCreditsMatch[1]!) : null;

          // Include rows even when points are blank or em dash; XP is still computed from rules

          // Parse event
          const eventId = parseInt(await cells[4]?.textContent() || '0');
          const eventElement = await cells[5]?.$('a');
          const eventName = await eventElement?.textContent() || '';

          // Parse session
          const sessionText = await cells[6]?.textContent() || '';
          const session = parseInt(sessionText) || 0;

          // Parse player
          const playerText = await cells[7]?.textContent() || '';
          const playerMatch = playerText.match(/(\d+)(-(\d+))?/);
          const orgplayid = playerMatch ? parseInt(playerMatch[1]!) : 0;
          let charid: number | null = playerMatch && playerMatch[3] ? parseInt(playerMatch[3]) : null;

          // Parse character
          const characterElement = await cells[8]?.$('a');
          const characterName = await characterElement?.textContent() || '';

          // If GM, try to find character ID by name
          if (!charid && characterName) {
            const matchingChar = characters.find(c => c.name === characterName);
            charid = matchingChar?.charid || null;
          }

          // Determine if this is Starfinder 2e (character IDs are 27xx)
          const isSF2e = charid !== null && charid >= 2700 && charid < 2800;

          // Parse faction
          const factionText = await cells[9]?.textContent() || '';

          // Parse prestige/rep  
          const prestigeText = await cells[10]?.textContent() || '';

          // Skip if no prestige/rep or it's an em-dash
          if (!prestigeText || prestigeText === '—') {
            console.log(`DEBUG: Skipping session with no prestige: ${scenario} (prestige: "${prestigeText}")`);
            continue;
          }

          const isGM = prestigeText.includes('GM');
          const prestigeMatch = prestigeText.match(/(\d+)/);
          const prestigePoints = prestigeMatch ? parseInt(prestigeMatch[1]!) : 0;
          const isGMYesNo = isGM ? 'yes' : 'no';

          // Determine game system per rules
          const gameSystem = this.determineGameSystem(charid, scenario, playerText);

          // Paizo reports duplicate credit in Notes. Keep the audit row but do
          // not award XP; the UI renders it muted and can filter zero-XP rows.
          const notes = await cells[11]?.textContent() || null;

          // Calculate XP (respecting system-specific rules)
          const xp = isAlreadyPlayedSessionNote(notes)
            ? 0
            : this.calculateXP(scenario, prestigePoints, pointsText, gameSystem);

          console.log(`DEBUG: Adding session: ${date} ${scenario}`);

          details.push({
            date,
            gm: gm.trim(),
            scenario: scenario.trim(),
            gameSystem,
            points: {
              achievementPoints,
              gmCredits
            },
            event: {
              id: eventId,
              name: eventName.trim()
            },
            session,
            player: {
              orgplayid,
              charid
            },
            character: {
              name: characterName.trim()
            },
            faction: {
              name: factionText.trim()
            },
            prestigeReputation: {
              prestigePoints,
              isGM: isGMYesNo
            },
            notes: notes?.trim() || null,
            xp
          });
        }
      }

      return details;
    } catch (err: any) {
      // Log full error and treat known context/navigation errors as soft end-of-pagination
      console.error(err?.stack || err);
      const msg = (err && typeof err === 'object' && 'message' in err)
        ? (err as any).message as string
        : String(err);
      if (
        msg.includes('Cannot find context with specified id') ||
        msg.includes('Execution context was destroyed') ||
        msg.includes('Target closed') ||
        msg.includes('Protocol error')
      ) {
        return details;
      }
      throw err;
    }
  }

  private calculateXP(scenario: string, prestigePoints: number, pointsText: string, gameSystem: string): number {
    // Universal rules
    if (scenario.includes('Bounty')) {
      return 1;
    }

    if (scenario.includes('Quest')) {
      return prestigePoints;
    }

    if (scenario.includes('AP #') || scenario.includes('Adventure Path')) {
      return 12;
    }

    // Starfinder 2e specific rules
    if (gameSystem === 'Starfinder 2e') {
      if (scenario.includes('Scenario')) return 4;
      if (scenario.match(/Adventure\s*Path|AP\s*#/i)) return 12; // already caught above, but explicit
      return 8; // Adventure
    }

    if (gameSystem === 'Starfinder 1e') {
      return 1;
    }

    if (gameSystem === 'Pathfinder 2e') {
      return 4;
    }

    if (gameSystem === 'Pathfinder 1e') {
      return 1;
    }

    if (gameSystem === 'Starfinder Playtest') {
      return 0; // retained for audit/history, but never rewarded
    }

    // Fallbacks based on points text markers
    if (/PFS\(2ed\)/i.test(pointsText)) return 4;
    if (/SFS/i.test(pointsText)) return 1;
    return 4; // Default fallback
  }

  private determineGameSystem(charid: number | null, scenario: string, playerText: string): string {
    if (charid != null) {
      if (charid >= 2700 && charid <= 2799) return 'Starfinder 2e';
      if (charid >= 2001 && charid <= 2699) return 'Pathfinder 2e';
      if (charid >= 701 && charid <= 799) return 'Starfinder 1e';
      return 'Pathfinder 1e';
    }
    if (/Playtest/i.test(scenario)) return 'Starfinder Playtest';
    // Fallbacks if we cannot determine from charid
    if (/PFS\(2ed\)/i.test(scenario)) return 'Pathfinder 2e';
    if (/SFS/i.test(scenario)) return 'Starfinder 1e';
    return 'Pathfinder 2e';
  }

  private calculateSummary(details: SessionDetail[]): Record<string, { xp: number }> {
    const summary: Record<string, { xp: number }> = {};

    for (const detail of details) {
      const charName = detail.character.name;
      if (!summary[charName]) {
        summary[charName] = { xp: 0 };
      }
      summary[charName].xp += detail.xp;
    }

    return summary;
  }
}
