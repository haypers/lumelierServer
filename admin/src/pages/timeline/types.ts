/** Time in seconds; we use sec * 1000 for Date so 0 = epoch start. */
export const SEC = 1000;

export const readheadId = "readhead";
export const defaultTimeZero = new Date(0);

/** Normalize time (Date, number, or moment-like) to milliseconds. */
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

/** Seconds as float (for editable start time). */
export function dateToSecFloat(date: Date): number {
  return date.getTime() / SEC;
}

/** Range type for media; used for bar color and optional file path. */
export type RangeType = "Image" | "Video" | "Audio";

/** Extended item payload for ranges and events (stored in item and in JSON). */
export interface TimelineItemPayload {
  kind: "range" | "event";
  label?: string;
  /** Event type (e.g. "Set Color Broadcast"). No effect on timeline visual. */
  effectType?: string;
  /** For "Set Color Broadcast": hex color (e.g. "#ff0000"). */
  color?: string;
  /** Range only: type of media (drives bar color). */
  rangeType?: RangeType;
  /** Range only: media file path the range represents (optional; range is general object). */
  filePath?: string;
}

/** Serializable timeline state for server (timeline.json). Track splitter tree is stored in trackSplitterTree.json. */
export interface TimelineStateJSON {
  version: number;
  /** Show title; default "Untitled Show" when missing. */
  title?: string;
  /** If true, this show requests GPS/location data from clients. Defaults to false when missing. */
  requestsGPS?: boolean;
  layers: { id: string; label: string }[];
  items: {
    id: string;
    layerId: string;
    kind: "range" | "event";
    startSec: number;
    endSec?: number;
    label?: string;
    effectType?: string;
    color?: string;
    rangeType?: RangeType;
    filePath?: string;
  }[];
  /** Readhead position in seconds. */
  readheadSec: number;
}
