import { afterAll, beforeAll, expect, test } from 'bun:test';
import { firefox, type Browser, type Page } from 'playwright';
import { PaizoScraper } from './scraper';
import type { Character, SessionDetail } from './types';

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

test('session parser reads plain-text scenarios and excludes already-played note prefixes', async () => {
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

    expect(sessions).toHaveLength(2);
    expect(sessions.map((session) => session.scenario)).toEqual([
      'SFS2 #1-23: Psychic Echoes',
      'PFS(2ed) #7-15: Within Antiquated Halls',
    ]);
  } finally {
    await page.close();
  }
});
