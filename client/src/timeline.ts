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
  /** Server time at request receipt (t1). */
  serverTimeAtRecv?: number;
  /** Server time right before send; use with RTT/2 for better sync. */
  serverTimeAtSend?: number;
  /** Echo of the client's request send time header (t0). */
  clientSendMsEcho?: number;
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
  // Pause can be latched either from local state (broadcastPausedAtMs) or directly from broadcast.pauseAtMs.
  if (broadcastCache.pauseAtMs != null && getServerTime() >= broadcastCache.pauseAtMs) return null;
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
    .filter(
      (it) =>
        it.effectType === EVENT_TYPE_SET_COLOR_BROADCAST &&
        typeof it.color === "string" &&
        it.color.length > 0 &&
        typeof it.startSec === "number" &&
        Number.isFinite(it.startSec)
    )
    .sort((a, b) => (a.startSec as number) - (b.startSec as number));
  let color: string | null = null;
  for (const ev of events) {
    if ((ev.startSec as number) <= positionSec) color = (ev.color as string) ?? null;
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
    .filter(
      (it) =>
        it.effectType === EVENT_TYPE_SET_COLOR_BROADCAST &&
        typeof it.color === "string" &&
        it.color.length > 0 &&
        typeof it.startSec === "number" &&
        Number.isFinite(it.startSec)
    )
    .sort((a, b) => (a.startSec as number) - (b.startSec as number));
  const next = events.find((ev) => (ev.startSec as number) > positionSec);
  const start = next?.startSec;
  return typeof start === "number" && Number.isFinite(start) ? start : null;
}
