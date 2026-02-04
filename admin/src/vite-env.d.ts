/// <reference types="vite/client" />

declare module "tabulator-tables" {
  export class Tabulator {
    constructor(selector: string, options: Record<string, unknown>);
    setData(data: unknown[]): void;
    destroy(): void;
    getColumns(): unknown[];
  }
}
