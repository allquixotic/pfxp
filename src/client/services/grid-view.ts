import type { Column, GridApi } from 'ag-grid-community';

import type { TableExportView } from './export';

export interface AutoColumnSizerOptions<Row> {
  api: () => GridApi<Row> | null;
  root?: () => HTMLElement | null;
  fontSize: () => number;
  horizontalPadding: () => number;
  manualColumns?: readonly string[];
  onManualColumnsChanged?: (columns: string[]) => void;
}

function displayText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value) ?? String(value);
}

/** Snapshot current visible columns plus filtered/sorted rows from AG Grid. */
export function getGridTableExportView<Row>(
  api: GridApi<Row>,
  sheetName: string,
): TableExportView {
  const columns = api.getAllDisplayedColumns();
  const rows: unknown[][] = [];
  api.forEachNodeAfterFilterAndSort((rowNode) => {
    if (!rowNode.data) return;
    rows.push(columns.map((column) => api.getCellValue({
      rowNode,
      colKey: column,
      useFormatter: true,
    })));
  });

  return {
    sheetName,
    columns: columns.map((column) => ({
      id: column.getColId(),
      header: api.getDisplayNameForColumn(column, 'columnToolPanel') || column.getColId(),
      widthPx: column.getActualWidth(),
    })),
    rows,
  };
}

/**
 * Keeps untouched columns at exact content width while preserving every width
 * the user deliberately set. Uses all currently filtered rows, not only DOM-
 * rendered rows, so virtualization cannot hide the longest visible value.
 */
export class AutoColumnSizer<Row> {
  private readonly options: AutoColumnSizerOptions<Row>;
  private readonly manual = new Set<string>();
  private frame: number | null = null;
  private canvas: HTMLCanvasElement | null = null;

  constructor(options: AutoColumnSizerOptions<Row>) {
    this.options = options;
    this.setManualColumns(options.manualColumns ?? [], false);
  }

  getManualColumns(): string[] {
    return [...this.manual].sort();
  }

  setManualColumns(columns: readonly string[], notify = true): void {
    this.manual.clear();
    columns.forEach((column) => this.manual.add(column));
    if (notify) this.notify();
  }

  markManual(columnIds: readonly string[]): void {
    let changed = false;
    for (const id of columnIds) {
      if (!this.manual.has(id)) {
        this.manual.add(id);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  markDisplayedColumnsManual(): void {
    const api = this.options.api();
    if (!api) return;
    this.markManual(api.getAllDisplayedColumns().map((column) => column.getColId()));
  }

  schedule(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.fitAutomaticColumns();
    });
  }

  fitAutomaticColumns(): void {
    const api = this.options.api();
    if (!api) return;
    this.applyWidths(api.getAllDisplayedColumns().filter((column) => !this.manual.has(column.getColId())));
  }

  fitColumn(columnId: string): void {
    const api = this.options.api();
    const column = api?.getColumn(columnId);
    if (!api || !column) return;
    const changed = this.manual.delete(columnId);
    this.applyWidths([column]);
    if (changed) this.notify();
  }

  fitAllColumns(): void {
    const api = this.options.api();
    if (!api) return;
    const changed = this.manual.size > 0;
    this.manual.clear();
    this.applyWidths(api.getAllDisplayedColumns());
    if (changed) this.notify();
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.canvas = null;
  }

  private applyWidths(columns: Column[]): void {
    const api = this.options.api();
    if (!api || columns.length === 0) return;
    const widths = columns.map((column) => ({
      key: column,
      newWidth: this.measureColumn(api, column),
    })).filter(({ key, newWidth }) => Math.abs(key.getActualWidth() - newWidth) >= 1);
    if (widths.length) api.setColumnWidths(widths, true, 'autosizeColumns');
  }

  private measureColumn(api: GridApi<Row>, column: Column): number {
    const context = this.context();
    const fontSize = this.options.fontSize();
    const padding = this.options.horizontalPadding();
    const header = api.getDisplayNameForColumn(column, 'columnToolPanel') || column.getColId();
    const root = this.options.root?.() ?? null;
    const headerCell = this.findColumnElement(root, '.ag-header-cell[col-id]', column.getColId());
    const headerText = headerCell?.querySelector<HTMLElement>('.ag-header-cell-text') ?? null;
    const cell = this.findColumnElement(root, '.ag-cell[col-id]', column.getColId());
    const renderer = cell?.querySelector<HTMLElement>('.session-cell-badge, .pfxp-game') ?? null;

    context.font = headerText ? getComputedStyle(headerText).font : '650 12px Inter, system-ui, sans-serif';
    let required = context.measureText(header).width + this.headerChromeWidth(headerCell);
    context.font = renderer
      ? getComputedStyle(renderer).font
      : cell
        ? getComputedStyle(cell).font
        : `${fontSize}px Inter, system-ui, sans-serif`;
    const cellChrome = cell ? this.horizontalBoxWidth(cell) : padding * 2;
    const rendererChrome = renderer
      ? Math.max(0, renderer.getBoundingClientRect().width - context.measureText(renderer.textContent ?? '').width)
      : 0;
    api.forEachNodeAfterFilterAndSort((rowNode) => {
      if (!rowNode.data) return;
      const value = api.getCellValue({ rowNode, colKey: column, useFormatter: true });
      for (const line of displayText(value).split(/\r?\n/u)) {
        required = Math.max(required, context.measureText(line).width + cellChrome + rendererChrome);
      }
    });

    return Math.max(28, Math.ceil(required));
  }

  private findColumnElement(
    root: HTMLElement | null,
    selector: string,
    columnId: string,
  ): HTMLElement | null {
    if (!root) return null;
    return [...root.querySelectorAll<HTMLElement>(selector)]
      .find((element) => element.getAttribute('col-id') === columnId) ?? null;
  }

  private horizontalBoxWidth(element: HTMLElement): number {
    const style = getComputedStyle(element);
    return ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
      .reduce((total, property) => total + (Number.parseFloat(style[property as keyof CSSStyleDeclaration] as string) || 0), 0);
  }

  private headerChromeWidth(headerCell: HTMLElement | null): number {
    if (!headerCell) return 42;
    let width = this.horizontalBoxWidth(headerCell);
    const controls = headerCell.querySelectorAll<HTMLElement>(
      '.ag-header-cell-menu-button, .ag-header-cell-filter-button, .ag-sort-indicator-container',
    );
    controls.forEach((control) => {
      const style = getComputedStyle(control);
      if (style.display === 'none') return;
      width += control.getBoundingClientRect().width
        + (Number.parseFloat(style.marginLeft) || 0)
        + (Number.parseFloat(style.marginRight) || 0);
    });
    const label = headerCell.querySelector<HTMLElement>('.ag-header-cell-label');
    if (label) width += Number.parseFloat(getComputedStyle(label).columnGap) || 0;
    return Math.max(16, width + 1);
  }

  private context(): CanvasRenderingContext2D {
    this.canvas ??= document.createElement('canvas');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas text measurement is unavailable');
    return context;
  }

  private notify(): void {
    this.options.onManualColumnsChanged?.(this.getManualColumns());
  }
}
