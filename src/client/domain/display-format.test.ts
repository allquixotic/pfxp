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
    )).toBe('SF2e Test Adventure: Empires Devoured, Chapter 3');
  });

  test('formats dates as MM-DD-YY without UTC rollover', () => {
    expect(formatShortDate('2026-01-09')).toBe('01-09-26');
    expect(formatShortDate('2026-12-31T23:59:00Z')).toBe('12-31-26');
  });
});
