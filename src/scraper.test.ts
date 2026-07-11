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
  player = '100001-2001',
  prestige = '4',
}: {
  date: string;
  scenario: string;
  notes: string;
  player?: string;
  prestige?: string;
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
      <td>${player}</td>
      <td><a>Test Character</a></td>
      <td>Envoy's Alliance</td>
      <td>${prestige}</td>
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
          ${row({
            date: '2024-05-24',
            scenario: '\n        Starfinder Bounty #1: The Cantina Job\n      ',
            notes: '',
            player: '100001-701',
            prestige: '0',
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

    expect(sessions).toHaveLength(4);
    expect(sessions.map((session) => session.scenario)).toEqual([
      'SFS2 #1-23: Psychic Echoes',
      'PFS(2ed) #7-09: The Chitterwood Walks',
      'PFS(2ed) #7-15: Within Antiquated Halls',
      'Starfinder Bounty #1: The Cantina Job',
    ]);
    expect(sessions.map((session) => session.xp)).toEqual([4, 0, 4, 0.25]);
  } finally {
    await page.close();
  }
});

test('V13: XP classification follows product class and never awards eight XP', () => {
  const scraper = new PaizoScraper({ maxBrowsers: 1 });
  const calculateXP = (
    scraper as unknown as {
      calculateXP(
        scenario: string,
        prestigePoints: number,
        gameSystem: string,
      ): number;
    }
  ).calculateXP.bind(scraper);

  const cases: Array<[string, number, string, number]> = [
    ['SFS2 #1-23: Psychic Echoes', 0, 'Starfinder 2e', 4],
    ["Starfinder Society Special #1-00: Collision's Wake", 2, 'Starfinder 2e', 4],
    ['Starfinder Free RPG Day: Battle for Nova Rush', 2, 'Starfinder 2e', 4],
    ['Starfinder Adventure: A Standard Chapter, Chapter 2', 4, 'Starfinder 2e', 4],
    ['Starfinder Adventure Path #1: A Full Book', 4, 'Starfinder 2e', 12],
    ['Pathfinder Bounty #15: Treasure off the Coast', 1, 'Pathfinder 2e', 1],
    ['#1-05: Trailblazers’ Bounty', 4, 'Pathfinder 2e', 4],
    ["Pathfinder Quest (Series 2) #26: Dragon's Plea", 2, 'Pathfinder 2e', 2],
    ['Pathfinder Quest (Series 2) #17: Escorting a Mirage', 4, 'Pathfinder 2e', 2],
    ['Quest #7: A Curious Claim', 1, 'Pathfinder 2e', 1],
    ['Starfinder Bounty #1: The Cantina Job', 0, 'Starfinder 1e', 0.25],
    ['Starfinder Quest #1: A Short Mission', 1, 'Starfinder 1e', 0.5],
    ['SFS #3-14: A Standard Scenario', 2, 'Starfinder 1e', 1],
    ['Starfinder Playtest Adventure: Chapter 1', 4, 'Starfinder Playtest', 0],
  ];

  const actual = cases.map(([scenario, prestige, gameSystem]) =>
    calculateXP(scenario, prestige, gameSystem));
  expect(actual).toEqual(cases.map(([, , , expected]) => expected));
  expect(actual).not.toContain(8);
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
