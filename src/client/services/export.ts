import type { PfxpDocument, SessionDetail } from '../domain';

/** Marker used to distinguish filtered exports from re-importable full documents. */
export const FILTERED_EXPORT_KIND = 'pfxp.filtered-sessions' as const;

/** Metadata optionally attached to a filtered export. */
export interface FilteredExportContext {
  query?: string;
  filters?: readonly string[];
}

/** Explicit wrapper for filtered rows, which are not a complete import document. */
export interface FilteredSessionsExport {
  kind: typeof FILTERED_EXPORT_KIND;
  schemaVersion: 1;
  exportedAt: string;
  totalSessionCount: number;
  filteredSessionCount: number;
  context?: FilteredExportContext;
  rows: SessionDetail[];
}

/** Column definition used by the generic CSV serializer. */
export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => unknown;
}

/** CSV serialization options. */
export interface CsvOptions {
  includeBom?: boolean;
  lineEnding?: '\r\n' | '\n';
}

/** Dependencies used to initiate a browser download. */
export interface DownloadEnvironment {
  document: Document;
  url: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  defer: (callback: () => void) => unknown;
}

/** Replace path separators and control characters in a download filename. */
export function safeFilename(filename: string, fallback = 'pfxp-export'): string {
  const cleaned = filename
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return cleaned || fallback;
}

/** Serialize the complete scraper document in the format accepted by import. */
export function serializeFullDocument(document: PfxpDocument, pretty = true): string {
  return JSON.stringify(document, null, pretty ? 2 : 0);
}

/** Build a JSON blob containing a complete, re-importable scraper document. */
export function fullDocumentBlob(document: PfxpDocument, pretty = true): Blob {
  return new Blob([serializeFullDocument(document, pretty)], {
    type: 'application/json;charset=utf-8',
  });
}

/** Build the explicit wrapper used when exporting only visible/filtered sessions. */
export function createFilteredSessionsExport(
  document: PfxpDocument,
  rows: readonly SessionDetail[],
  options: { exportedAt?: Date; context?: FilteredExportContext } = {},
): FilteredSessionsExport {
  const result: FilteredSessionsExport = {
    kind: FILTERED_EXPORT_KIND,
    schemaVersion: 1,
    exportedAt: (options.exportedAt ?? new Date()).toISOString(),
    totalSessionCount: document.details.length,
    filteredSessionCount: rows.length,
    rows: [...rows],
  };
  if (options.context) {
    result.context = {
      ...(options.context.query === undefined ? {} : { query: options.context.query }),
      ...(options.context.filters === undefined ? {} : { filters: [...options.context.filters] }),
    };
  }
  return result;
}

/** Build a JSON blob for a filtered-session wrapper. */
export function filteredSessionsBlob(value: FilteredSessionsExport, pretty = true): Blob {
  return new Blob([JSON.stringify(value, null, pretty ? 2 : 0)], {
    type: 'application/json;charset=utf-8',
  });
}

/** Prefix spreadsheet formulas in string cells to prevent CSV injection. */
export function sanitizeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const stringValue = value instanceof Date
    ? value.toISOString()
    : typeof value === 'string'
      ? value
      : JSON.stringify(value) ?? String(value);
  return /^(?:[\t\r\n]|[\s\u0000-\u001f\ufeff]*[=+\-@])/u.test(stringValue)
    ? `'${stringValue}`
    : stringValue;
}

function csvCell(value: unknown): string {
  return `"${sanitizeCsvValue(value).replace(/"/g, '""')}"`;
}

/** Serialize rows as RFC 4180-style quoted CSV with formula sanitization. */
export function serializeCsv<Row>(
  rows: readonly Row[],
  columns: readonly CsvColumn<Row>[],
  options: CsvOptions = {},
): string {
  const lineEnding = options.lineEnding ?? '\r\n';
  const lines = [
    columns.map((column) => csvCell(column.header)).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(',')),
  ];
  const body = lines.join(lineEnding);
  return options.includeBom === false ? body : `\ufeff${body}`;
}

/** Build a UTF-8 CSV blob with spreadsheet-injection protection. */
export function csvBlob<Row>(
  rows: readonly Row[],
  columns: readonly CsvColumn<Row>[],
  options: CsvOptions = {},
): Blob {
  return new Blob([serializeCsv(rows, columns, options)], {
    type: 'text/csv;charset=utf-8',
  });
}

/** Trigger a browser download and revoke its temporary object URL safely. */
export function downloadBlob(
  blob: Blob,
  filename: string,
  environment: DownloadEnvironment = {
    document: globalThis.document,
    url: globalThis.URL,
    defer: (callback) => setTimeout(callback, 0),
  },
): void {
  if (!environment.document) throw new Error('Downloads require a browser document');
  const objectUrl = environment.url.createObjectURL(blob);
  const anchor = environment.document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = safeFilename(filename);
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  const parent = environment.document.body ?? environment.document.documentElement;
  parent.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    environment.defer(() => environment.url.revokeObjectURL(objectUrl));
  }
}

/** Download a complete document that can be loaded back into PFXP. */
export function downloadFullDocument(
  document: PfxpDocument,
  filename = 'pfxp-full.json',
): void {
  downloadBlob(fullDocumentBlob(document), filename);
}

/** Download an explicitly wrapped filtered-session result. */
export function downloadFilteredSessions(
  value: FilteredSessionsExport,
  filename = 'pfxp-filtered.json',
): void {
  downloadBlob(filteredSessionsBlob(value), filename);
}

/** Download rows as safely escaped CSV. */
export function downloadCsv<Row>(
  rows: readonly Row[],
  columns: readonly CsvColumn<Row>[],
  filename = 'pfxp-export.csv',
): void {
  downloadBlob(csvBlob(rows, columns), filename);
}
