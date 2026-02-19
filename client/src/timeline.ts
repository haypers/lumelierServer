export const EVENT_TYPE_SET_COLOR_BROADCAST = "Set Color Broadcast";

export interface PollEvent {
  t: number;
  color: string;
}

export interface BroadcastTimelineItem {
  id?: string;
  layerId?: string;
  kind?: string;
  startSec: number;
  effectType?: string;
  target?: string;
  color?: string;
}

export interface BroadcastTimeline {
  version?: number;
  title?: string;
  /** If true, this show requests GPS/location data from clients. */
  requestsGPS?: boolean;
  layers?: { id: string; label: string }[];
  items: BroadcastTimelineItem[];
  readheadSec?: number;
}

export interface PollBroadcast {
  timeline: BroadcastTimeline;
  readheadSec: number;
  playAtMs?: number;
  pauseAtMs?: number;
}

export interface PollResponse {
  serverTime: number;
  /** Server time right before send; use with RTT/2 for better sync. */
  serverTimeAtSend?: number;
  deviceId: string;
  events: PollEvent[];
  broadcast?: PollBroadcast;
}

export function isBroadcastTimeline(v: unknown): v is BroadcastTimeline {
  return (
    v != null &&
    typeof v === "object" &&
    Array.isArray((v as BroadcastTimeline).items)
  );
}

/** Context passed by main for timeline position/color resolution. */
export interface TimelineContext {
  broadcastCache: PollBroadcast | null;
  broadcastPlaybackStartedAtMs: number | null;
  broadcastPausedAtMs: number | null;
  getServerTime: () => number;
}

export function getBroadcastPlaybackSec(ctx: TimelineContext): number | null {
  const { broadcastCache, broadcastPlaybackStartedAtMs, broadcastPausedAtMs, getServerTime } = ctx;
  if (!broadcastCache?.playAtMs) return null;
  if (broadcastPausedAtMs != null && getServerTime() >= broadcastPausedAtMs) return null;
  const startMs = broadcastPlaybackStartedAtMs ?? broadcastCache.playAtMs;
  if (getServerTime() < startMs) return null;
  const elapsedSec = (getServerTime() - startMs) / 1000;
  return (broadcastCache.readheadSec ?? 0) + elapsedSec;
}

export function getColorFromBroadcastTimeline(
  ctx: TimelineContext,
  positionSec: number
): string | null {
  const { broadcastCache } = ctx;
  if (!broadcastCache?.timeline?.items) return null;
  const events = broadcastCache.timeline.items
    .filter((it) => it.effectType === EVENT_TYPE_SET_COLOR_BROADCAST && it.color != null)
    .sort((a, b) => a.startSec - b.startSec);
  let color: string | null = null;
  for (const ev of events) {
    if (ev.startSec <= positionSec) color = ev.color ?? null;
  }
  return color;
}

/** Next Set Color Broadcast startSec strictly after positionSec, or null if none. */
export function getNextColorChangeStartSec(
  ctx: TimelineContext,
  positionSec: number
): number | null {
  const { broadcastCache } = ctx;
  if (!broadcastCache?.timeline?.items) return null;
  const events = broadcastCache.timeline.items
    .filter((it) => it.effectType === EVENT_TYPE_SET_COLOR_BROADCAST && it.color != null)
    .sort((a, b) => a.startSec - b.startSec);
  const next = events.find((ev) => ev.startSec > positionSec);
  return next?.startSec ?? null;
}
