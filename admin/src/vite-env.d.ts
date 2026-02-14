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
    on(event: string, callback: () => void): void;
    getSorters(): Array<{ field?: string; dir?: string; column?: { getField?: () => string } }>;
  }
  export interface TabulatorColumn {
    getDefinition(): { title?: string; field?: string };
    getElement(): HTMLElement;
    show(): void;
    hide(): void;
    getVisible(): boolean;
  }
  export class TabulatorFull extends Tabulator {}
}
