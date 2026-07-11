import { describe, expect, test } from 'bun:test';

import { compactGameSystem, compactScenarioName, formatShortDate } from './display-format';

describe('compact table formatting', () => {
  test('uses canonical short game labels', () => {
    expect(compactGameSystem('Starfinder 2e')).toBe('SF2e');
    expect(compactGameSystem('Starfinder Playtest')).toBe('SF2e Test');
    expect(compactGameSystem('Pathfinder 2e')).toBe('PF2e');
    expect(compactGameSystem('Pathfinder 1e')).toBe('PF1e');
    expect(compactGameSystem('Starfinder 1e')).toBe('SF1e');
  });

  test('removes duplicated scenario catalog text without losing chapter detail', () => {
    expect(compactScenarioName(
      'Starfinder Second Edition Playtest Adventure: Empires Devoured - Starfinder Playtest Adventure: Empires Devoured, Chapter 3',
    )).toBe('Adventure: Empires Devoured, Chapter 3');
  });

  test('V15: removes catalog game systems while preserving session identity', () => {
    const cases = [
      ['SFS2 #1-23: Psychic Echoes', '#1-23: Psychic Echoes'],
      ["Starfinder Society Scenario #1-01: Invasion's Edge", "Scenario #1-01: Invasion's Edge"],
      [
        'Starfinder Society Special #3-99: Perils of the Past - SFS1 #3-99: Perils of the Past [PaizoCon 2025]',
        'Special #3-99: Perils of the Past [PaizoCon 2025]',
      ],
      ['PFS(2ed) #7-17: Perch of Liberty', '#7-17: Perch of Liberty'],
      [
        'Pathfinder One-Shot #1: Sundered Waves - Pathfinder One-Shot #1: Sundered Waves',
        'One-Shot #1: Sundered Waves',
      ],
      ['Pathfinder Dark Archive - Pathfinder Adventure: A Song of Making and Unmaking', 'Dark Archive - Adventure: A Song of Making and Unmaking'],
      ['Starfinder Bounty #1: The Cantina Job', 'Bounty #1: The Cantina Job'],
      ["Pathfinder Quest (Series 2) #26: Dragon's Plea", "Quest (Series 2) #26: Dragon's Plea"],
      ['Starfinder Free RPG Day: Battle for Nova Rush', 'Free RPG Day: Battle for Nova Rush'],
      [
        'Starfinder Society Scenario #9-99: The Last Starfinder of Pathfinder Station',
        'Scenario #9-99: The Last Starfinder of Pathfinder Station',
      ],
    ];

    for (const [input, expected] of cases) {
      expect(compactScenarioName(input!)).toBe(expected!);
    }
  });

  test('formats dates as MM-DD-YY without UTC rollover', () => {
    expect(formatShortDate('2026-01-09')).toBe('01-09-26');
    expect(formatShortDate('2026-12-31T23:59:00Z')).toBe('12-31-26');
  });
});
