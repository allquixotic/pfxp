import { describe, expect, test } from 'bun:test';
import type { PfxpDocument } from '../domain';
import {
  FILTERED_EXPORT_KIND,
  createFilteredSessionsExport,
  safeFilename,
  sanitizeCsvValue,
  serializeCsv,
  serializeFullDocument,
  tableViewCsv,
  tableViewXlsxBlob,
} from './export';

describe('export helpers', () => {
  test('keeps full JSON re-importable and labels filtered output', () => {
    const document: PfxpDocument = { details: [], characters: [], summary: {} };
    expect(JSON.parse(serializeFullDocument(document))).toEqual(document);
    const filtered = createFilteredSessionsExport(document, [], {
      exportedAt: new Date('2026-07-10T12:00:00Z'),
      context: { query: 'quest' },
    });
    expect(filtered).toMatchObject({
      kind: FILTERED_EXPORT_KIND,
      schemaVersion: 1,
      totalSessionCount: 0,
      filteredSessionCount: 0,
      context: { query: 'quest' },
    });
  });

  test('neutralizes spreadsheet formulas before CSV quoting', () => {
    expect(sanitizeCsvValue('=HYPERLINK("https://bad")')).toStartWith("'=");
    expect(sanitizeCsvValue('  @SUM(A1:A2)')).toStartWith("'  @");
    expect(sanitizeCsvValue('\tDDE payload')).toStartWith("'\t");
    expect(sanitizeCsvValue(-4)).toBe('-4');
    const csv = serializeCsv(
      [{ name: '+cmd', note: 'quote " here' }],
      [
        { header: 'Name', value: (row) => row.name },
        { header: 'Note', value: (row) => row.note },
      ],
      { includeBom: false, lineEnding: '\n' },
    );
    expect(csv).toBe('"Name","Note"\n"\'+cmd","quote "" here"');
  });

  test('removes unsafe filename characters', () => {
    expect(safeFilename('../pfxp:run?.json')).toBe('-pfxp-run-.json');
  });

  test('writes visible columns and rows to CSV and a real XLSX zip', async () => {
    const view = {
      sheetName: 'Sessions',
      columns: [
        { id: 'scenario', header: 'Scenario', widthPx: 240 },
        { id: 'xp', header: 'XP', widthPx: 70 },
      ],
      rows: [['Visible row', 4]],
    };
    expect(tableViewCsv(view)).toContain('"Visible row","4"');
    const blob = await tableViewXlsxBlob(view);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 2))).toBe('PK');
  });
});
