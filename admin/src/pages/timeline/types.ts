/** Time in seconds; we use Date(sec * 1000) for vis-timeline so 0 = epoch start. */
export const SEC = 1000;

export const readheadId = "readhead";
export const defaultTimeZero = new Date(0);

/** Normalize vis-timeline time (Date, number, or moment-like) to milliseconds. */
export function toMs(t: unknown): number {
  if (typeof t === "number" && !Number.isNaN(t)) return t;
  if (t instanceof Date) return t.getTime();
  if (t != null && typeof (t as { valueOf?: () => number }).valueOf === "function") {
    const ms = (t as { valueOf(): number }).valueOf();
    if (!Number.isNaN(ms)) return ms;
  }
  const n = Number(t);
  return Number.isNaN(n) ? 0 : n;
}

export function timeToDate(sec: number): Date {
  return new Date(sec * SEC);
}

export function dateToSec(date: Date): number {
  return Math.round(date.getTime() / SEC);
}

/** Extended item payload for clips and flags (stored in item and in JSON). */
export interface TimelineItemPayload {
  kind: "clip" | "flag";
  label?: string;
  /** Optional effect or event type for server. */
  effectType?: string;
}

/** Serializable timeline state for server. */
export interface TimelineStateJSON {
  version: number;
  layers: { id: string; label: string }[];
  items: {
    id: string;
    layerId: string;
    kind: "clip" | "flag";
    startSec: number;
    endSec?: number;
    label?: string;
    effectType?: string;
  }[];
  /** Readhead position in seconds. */
  readheadSec: number;
}
