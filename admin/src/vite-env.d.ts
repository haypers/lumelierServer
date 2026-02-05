/// <reference types="vite/client" />

declare module "tabulator-tables" {
  export class Tabulator {
    constructor(selector: string, options: Record<string, unknown>);
    setData(data: unknown[]): void;
    destroy(): void;
    getColumns(): TabulatorColumn[];
    setFilter(field: string, type: string, value?: unknown): void;
    clearFilter(): void;
    setSort(sorters: Array<{ column: string; dir: "asc" | "desc" }>): void;
  }
  export interface TabulatorColumn {
    getDefinition(): { title?: string; field?: string };
    show(): void;
    hide(): void;
    getVisible(): boolean;
  }
  export class TabulatorFull extends Tabulator {}
}
