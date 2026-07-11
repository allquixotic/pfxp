import { afterAll, beforeAll, expect, test } from 'bun:test';
import { firefox, type Browser, type Page } from 'playwright';
import { PaizoScraper } from './scraper';
import type { Character, SessionDetail } from './types';
import { gmRecognitionPlainText, type GmRecognitionBlock } from './gm-recognition';

let browser: Browser;

beforeAll(async () => {
  browser = await firefox.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

function row({
  date,
  scenario,
  notes,
}: {
  date: string;
  scenario: string;
  notes: string;
}): string {
  return `
    <tr>
      <td><time datetime="${date}T00:00:00Z">${date}</time></td>
      <td><a>Test GM</a></td>
      <td>${scenario}</td>
      <td>4 Achievement Points</td>
      <td>12345</td>
      <td><a>Test Event</a></td>
      <td>1</td>
      <td>100001-2001</td>
      <td><a>Test Character</a></td>
      <td>Envoy's Alliance</td>
      <td>4</td>
      <td>${notes}</td>
    </tr>`;
}

test('session parser reads plain-text scenarios and keeps already-played rows at zero XP', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div id="results">
        <table><tbody><tr><td>pager</td></tr></tbody></table>
        <table><tbody>
          <tr><th>Date</th></tr>
          ${row({
            date: '2026-07-06',
            scenario: '  SFS2 #1-23: Psychic Echoes  ',
            notes: 'Ordinary reporting note',
          })}
          ${row({
            date: '2026-05-30',
            scenario: 'PFS(2ed) #7-09: The Chitterwood Walks',
            notes: '\n   pLaYeR HaS AlReAdY pLaYeD scenario at another event.',
          })}
          ${row({
            date: '2026-04-01',
            scenario: '<a>PFS(2ed) #7-15: Within Antiquated Halls</a>',
            notes: 'Review note: player has already played was entered in error.',
          })}
        </tbody></table>
      </div>`);

    const scraper = new PaizoScraper({ maxBrowsers: 1 });
    const parseSessions = (
      scraper as unknown as {
        parseSessions(page: Page, characters: Character[]): Promise<SessionDetail[]>;
      }
    ).parseSessions.bind(scraper);

    const sessions = await parseSessions(page, []);

    expect(sessions).toHaveLength(3);
    expect(sessions.map((session) => session.scenario)).toEqual([
      'SFS2 #1-23: Psychic Echoes',
      'PFS(2ed) #7-09: The Chitterwood Walks',
      'PFS(2ed) #7-15: Within Antiquated Halls',
    ]);
    expect(sessions.map((session) => session.xp)).toEqual([4, 0, 4]);
  } finally {
    await page.close();
  }
});

test('GM recognition parser keeps glyph markup and rejects ad-like content', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <main>
        <p>
          You are a
          <span class="referenceable"><span class="stars">
            <img border="0" alt="*" height="25"
              src="https://paizo.com/image/content/OrganizedPlay/PFS2GlyphIcon_500.png"
              width="24">
            <img border="0" alt="*" height="25"
              src="https://paizo.com/image/content/OrganizedPlay/PFS2GlyphIcon_500.png"
              width="24">
          </span></span>
          Pathfinder Society (second edition) GM.
        </p>
        <p>
          You are a <a href="https://paizo.com/advertisement"><img
            src="https://paizo.com/image/content/OrganizedPlay/banner.png"></a>
          Pathfinder Society GM.
        </p>
      </main>`);

    const scraper = new PaizoScraper({ maxBrowsers: 1 });
    const parseGmRecognitions = (
      scraper as unknown as {
        parseGmRecognitions(page: Page): Promise<GmRecognitionBlock[]>;
      }
    ).parseGmRecognitions.bind(scraper);

    const blocks = await parseGmRecognitions(page);
    expect(blocks).toHaveLength(1);
    expect(gmRecognitionPlainText(blocks[0]!)).toBe(
      'You are a Pathfinder Society (second edition) GM.',
    );
  } finally {
    await page.close();
  }
});
