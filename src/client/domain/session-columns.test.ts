import { describe, expect, test } from 'bun:test';
import type { ValueFormatterParams } from 'ag-grid-community';

import { createSessionColumnDefs } from './session-columns';
import type { SessionDetail } from './models';

function formatScenario(compact: boolean): string {
  const scenario = createSessionColumnDefs('default', { compact: () => compact })
    .find((column) => column.colId === 'scenario');
  const formatter = scenario?.valueFormatter;
  if (typeof formatter !== 'function') throw new Error('Scenario formatter is unavailable');
  return String(formatter({
    value: "Starfinder Society Scenario #1-01: Invasion's Edge",
    data: { gameSystem: 'Starfinder 2e' } as SessionDetail,
  } as ValueFormatterParams<SessionDetail>));
}

describe('session columns', () => {
  test('V15: Comfortable and Compact both omit the catalog game system', () => {
    expect(formatScenario(false)).toBe("Scenario #1-01: Invasion's Edge");
    expect(formatScenario(true)).toBe("Scenario #1-01: Invasion's Edge");
  });
});
