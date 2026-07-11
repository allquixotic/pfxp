import { describe, expect, test } from 'bun:test';

import { calculateSessionXp, classifySessionProduct } from './session-rules';

describe('authoritative session rules', () => {
  test('V14: recognizes explicit Paizo product shapes without title-word false positives', () => {
    const cases = [
      ['Pathfinder Adventure Path #1: A Full Book', 'adventure-path'],
      ['\n        Starfinder Bounty #1: The Cantina Job\n      ', 'bounty'],
      ["Pathfinder Quest (Series 2) #26: Dragon's Plea", 'quest'],
      ["Starfinder Society Scenario #1-01: Invasion's Edge", 'scenario'],
      ['Pathfinder Dark Archive - Pathfinder Adventure: A Song of Making and Unmaking', 'adventure'],
      ['Starfinder Free RPG Day: Battle for Nova Rush', 'adventure'],
      ["Starfinder Society Special #1-00: Collision's Wake", 'special'],
      ["Starfinder Society Intro: Year of Redemption's Rise", 'intro'],
      ['Pathfinder One-Shot #1: Sundered Waves', 'one-shot'],
      ['#1-05: Trailblazers’ Bounty', 'standard'],
      ['SFS2 #1-23: Psychic Echoes', 'standard'],
    ] as const;

    for (const [scenario, expected] of cases) {
      expect(classifySessionProduct(scenario)).toBe(expected);
    }
  });

  test('V14: uses game system for XP scale and note/reputation only for credit', () => {
    expect(calculateSessionXp({
      scenario: '\n        Starfinder Bounty #1: The Cantina Job\n      ',
      gameSystem: 'Starfinder 1e',
      prestigePoints: 0,
    })).toBe(0.25);
    expect(calculateSessionXp({
      scenario: "Pathfinder Quest (Series 2) #26: Dragon's Plea",
      gameSystem: 'Pathfinder 2e',
      prestigePoints: 4,
    })).toBe(2);
    expect(calculateSessionXp({
      scenario: 'SFS2 #1-23: Psychic Echoes',
      gameSystem: 'Starfinder 2e',
      prestigePoints: 0,
    })).toBe(4);
    expect(calculateSessionXp({
      scenario: 'Pathfinder Adventure Path #1: A Full Book',
      gameSystem: 'Pathfinder 2e',
      prestigePoints: 4,
    })).toBe(12);
    expect(calculateSessionXp({
      scenario: 'SFS2 #1-23: Psychic Echoes',
      gameSystem: 'Starfinder 2e',
      prestigePoints: 4,
      notes: '  PLAYER HAS ALREADY PLAYED this scenario.',
    })).toBe(0);
    expect(() => calculateSessionXp({
      scenario: 'SFS2 #1-23: Psychic Echoes',
      gameSystem: 'Unknown',
      prestigePoints: 4,
    })).toThrow('Unsupported game system: Unknown');
  });
});
