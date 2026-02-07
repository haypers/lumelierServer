const EVENT_TYPE_SET_COLOR_BROADCAST = "Set Color Broadcast";

interface PollEvent {
  t: number;
  color: string;
}

interface BroadcastTimelineItem {
  id?: string;
  layerId?: string;
  kind?: string;
  startSec: number;
  effectType?: string;
  target?: string;
  color?: string;
}

interface BroadcastTimeline {
  version?: number;
  title?: string;
  layers?: { id: string; label: string }[];
  items: BroadcastTimelineItem[];
  readheadSec?: number;
}

interface PollBroadcast {
  timeline: BroadcastTimeline;
  readheadSec: number;
  playAtMs?: number;
  pauseAtMs?: number;
}

const DEVICE_ID_STORAGE_KEY = "lumelier_device_id";

interface PollResponse {
  serverTime: number;
  deviceId: string;
  events: PollEvent[];
  broadcast?: PollBroadcast;
}

function isBroadcastTimeline(v: unknown): v is BroadcastTimeline {
  return (
    v != null &&
    typeof v === "object" &&
    Array.isArray((v as BroadcastTimeline).items)
  );
}

let broadcastCache: PollBroadcast | null = null;
let broadcastPlaybackStartedAtMs: number | null = null;
let broadcastPausedAtMs: number | null = null;
/** Only updated when playing and an event triggers, or when paused at a position. */
let lastAppliedBroadcastColor: string | null = null;
/** Whatever color we last rendered; preserved so we never change color until playing + event. */
let lastDisplayedColor: string | null = null;
let lastEvents: PollEvent[] = [];
let lastDeviceId = "";

const POLL_INTERVAL_MS = 2500;
const CLOCK_UPDATE_MS = 100;

/** Offset from local time to server time (ms). serverTime ≈ Date.now() + offset */
let clockOffset = 0;
let clockIntervalStarted = false;
/** RTT from previous poll (ms), sent on next request for server to store. */
let lastRttMs: number | null = null;

function getServerTime(): number {
  return Date.now() + clockOffset;
}

function getBroadcastPlaybackSec(): number | null {
  if (!broadcastCache?.playAtMs) return null;
  if (broadcastPausedAtMs != null && getServerTime() >= broadcastPausedAtMs) return null;
  const startMs = broadcastPlaybackStartedAtMs ?? broadcastCache.playAtMs;
  if (getServerTime() < startMs) return null;
  if (broadcastPlaybackStartedAtMs == null) broadcastPlaybackStartedAtMs = startMs;
  const elapsedSec = (getServerTime() - startMs) / 1000;
  return (broadcastCache.readheadSec ?? 0) + elapsedSec;
}

function getColorFromBroadcastTimeline(positionSec: number): string | null {
  if (!broadcastCache?.timeline?.items) return null;
  // TODO: build out target filtering (All, GPS Enabled, GPS Disabled) for Set Color Broadcast.
  const events = broadcastCache.timeline.items
    .filter((it) => it.effectType === EVENT_TYPE_SET_COLOR_BROADCAST && it.color != null)
    .sort((a, b) => a.startSec - b.startSec);
  let color: string | null = null;
  for (const ev of events) {
    if (ev.startSec <= positionSec) color = ev.color ?? null;
  }
  return color;
}

async function fetchPoll(): Promise<PollResponse> {
  const deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  const headers: HeadersInit = {};
  if (deviceId) (headers as Record<string, string>)["X-Device-ID"] = deviceId;
  if (lastRttMs != null) (headers as Record<string, string>)["X-Ping-Ms"] = String(lastRttMs);
  const t0 = Date.now();
  const res = await fetch("/api/poll", { headers });
  lastRttMs = Date.now() - t0;
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  const data = (await res.json()) as PollResponse;
  if (data.deviceId) localStorage.setItem(DEVICE_ID_STORAGE_KEY, data.deviceId);
  return data;
}

function render(events: PollEvent[], deviceId: string) {
  const app = document.getElementById("app");
  if (!app) return;

  let firstColor: string;
  if (broadcastCache == null) {
    firstColor = events.length > 0 ? events[0].color : "#000000";
  } else {
    const positionSec = getBroadcastPlaybackSec();
    let broadcastColor: string | null = null;
    if (positionSec != null) {
      broadcastColor = getColorFromBroadcastTimeline(positionSec);
      if (broadcastColor != null) lastAppliedBroadcastColor = broadcastColor;
    } else if (
      broadcastCache.playAtMs != null &&
      broadcastPausedAtMs != null &&
      getServerTime() >= broadcastPausedAtMs
    ) {
      const pausedPositionSec =
        broadcastCache.readheadSec + (broadcastPausedAtMs - broadcastCache.playAtMs) / 1000;
      broadcastColor = getColorFromBroadcastTimeline(pausedPositionSec);
      if (broadcastColor != null) lastAppliedBroadcastColor = broadcastColor;
    }
    firstColor =
      broadcastColor ??
      lastAppliedBroadcastColor ??
      lastDisplayedColor ??
      (events.length > 0 ? events[0].color : "#000000");
  }
  lastDisplayedColor = firstColor;

  const serverTime = getServerTime();
  app.innerHTML = `
    <p style="font-size:11px;color:#666;word-break:break-all;"><strong>Device ID:</strong> ${deviceId || "—"}</p>
    <p>Server time: <span id="server-time">${serverTime}</span></p>
    <p>Events: ${events.length}</p>
    <div style="width:80px;height:80px;background:${firstColor};border:1px solid #333;"></div>
  `;
}

function updateClockDisplay() {
  const el = document.getElementById("server-time");
  if (el) el.textContent = String(getServerTime());
}

async function pollLoop() {
  try {
    const data = await fetchPoll();
    clockOffset = data.serverTime - Date.now();
    const displayId = data.deviceId || localStorage.getItem(DEVICE_ID_STORAGE_KEY) || "—";

    if (data.broadcast && isBroadcastTimeline(data.broadcast.timeline)) {
      broadcastCache = data.broadcast;
      const now = getServerTime();
      if (data.broadcast.pauseAtMs != null && now >= data.broadcast.pauseAtMs)
        broadcastPausedAtMs = data.broadcast.pauseAtMs;
      else broadcastPausedAtMs = null;
      if (data.broadcast.playAtMs != null && now >= data.broadcast.playAtMs)
        broadcastPlaybackStartedAtMs = data.broadcast.playAtMs;
    } else {
      broadcastCache = null;
      lastAppliedBroadcastColor = null;
    }

    lastEvents = data.events;
    lastDeviceId = displayId;
    render(data.events, displayId);

    if (!clockIntervalStarted) {
      clockIntervalStarted = true;
      setInterval(updateClockDisplay, CLOCK_UPDATE_MS);
      setInterval(() => {
        const positionSec = getBroadcastPlaybackSec();
        if (positionSec != null) render(lastEvents, lastDeviceId);
      }, 100);
    }
  } catch (e) {
    const app = document.getElementById("app");
    if (app) app.innerHTML = `<p>Error: ${String(e)}</p>`;
  }
  setTimeout(pollLoop, POLL_INTERVAL_MS);
}

pollLoop();
