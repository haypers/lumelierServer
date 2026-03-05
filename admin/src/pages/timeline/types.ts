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

/** Seconds as float (for editable start time). */
export function dateToSecFloat(date: Date): number {
  return date.getTime() / SEC;
}

/** Extended item payload for clips and events (stored in item and in JSON). */
export interface TimelineItemPayload {
  kind: "clip" | "event";
  label?: string;
  /** Event type (e.g. "Set Color Broadcast"). No effect on timeline visual. */
  effectType?: string;
  /** For "Set Color Broadcast": target audience (All, GPS Enabled, GPS Disabled). */
  target?: string;
  /** For "Set Color Broadcast": hex color (e.g. "#ff0000"). */
  color?: string;
}

import type { TrackAssignmentsRoot } from "./track-assignments/types";

/** Serializable timeline state for server. */
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
    kind: "clip" | "event";
    startSec: number;
    endSec?: number;
    label?: string;
    effectType?: string;
    target?: string;
    color?: string;
  }[];
  /** Readhead position in seconds. */
  readheadSec: number;
  /** How users are split into tracks when they join. Stored in timeline.json. */
  trackAssignments?: TrackAssignmentsRoot;
}
