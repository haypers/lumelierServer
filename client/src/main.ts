import * as gps from "./gps";
import * as popup from "./popup";
import * as timeline from "./timeline";
import * as ui from "./ui";

const DEVICE_ID_STORAGE_KEY = "lumelier_device_id";

const POLL_INTERVAL_MS = 2500;
const OFFSET_SAMPLES_MAX = 5;
const DISPLAY_FALLBACK_MS = 15000;

let broadcastCache: timeline.PollBroadcast | null = null;
let broadcastPlaybackStartedAtMs: number | null = null;
let broadcastPausedAtMs: number | null = null;
let lastAppliedBroadcastColor: string | null = null;
let lastDisplayedColor: string | null = null;
let lastEvents: timeline.PollEvent[] = [];
let lastDeviceId = "";

let clockOffset = 0;
let offsetSamples: number[] = [];
let nextColorChangeTimeoutId: ReturnType<typeof setTimeout> | null = null;
let lastRttMs: number | null = null;

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getServerTime(): number {
  return Date.now() + clockOffset;
}

function getTimelineContext(): timeline.TimelineContext {
  return {
    broadcastCache,
    broadcastPlaybackStartedAtMs,
    broadcastPausedAtMs,
    getServerTime,
  };
}

function syncDisplayAndScheduleNext(): void {
  const serverTimeEl = document.getElementById("server-time");
  if (serverTimeEl) serverTimeEl.textContent = String(getServerTime());

  const ctx = getTimelineContext();

  if (broadcastCache == null) {
    const colorHex =
      lastDisplayedColor ?? lastAppliedBroadcastColor ?? (lastEvents[0]?.color ?? "#000000");
    if (colorHex !== lastDisplayedColor) {
      lastDisplayedColor = colorHex;
      ui.applyDisplayedColor(colorHex);
    }
    if (nextColorChangeTimeoutId != null) clearTimeout(nextColorChangeTimeoutId);
    nextColorChangeTimeoutId = setTimeout(() => {
      nextColorChangeTimeoutId = null;
      syncDisplayAndScheduleNext();
    }, DISPLAY_FALLBACK_MS);
    return;
  }

  let positionSec: number | null = timeline.getBroadcastPlaybackSec(ctx);
  if (
    positionSec == null &&
    broadcastCache.playAtMs != null &&
    broadcastPausedAtMs != null &&
    getServerTime() >= broadcastPausedAtMs
  ) {
    positionSec =
      (broadcastCache.readheadSec ?? 0) +
      (broadcastPausedAtMs - broadcastCache.playAtMs) / 1000;
  }

  let currentColor: string | null = null;
  if (positionSec != null) {
    currentColor = timeline.getColorFromBroadcastTimeline(ctx, positionSec);
    if (currentColor != null) lastAppliedBroadcastColor = currentColor;
  } else if (
    broadcastCache.playAtMs != null &&
    broadcastCache.pauseAtMs != null &&
    getServerTime() >= broadcastCache.pauseAtMs
  ) {
    const pausedSec =
      (broadcastCache.readheadSec ?? 0) +
      (broadcastCache.pauseAtMs - broadcastCache.playAtMs) / 1000;
    currentColor = timeline.getColorFromBroadcastTimeline(ctx, pausedSec);
    if (currentColor != null) lastAppliedBroadcastColor = currentColor;
  }
  const colorHex =
    currentColor ??
    lastAppliedBroadcastColor ??
    lastDisplayedColor ??
    (lastEvents[0]?.color ?? "#000000");
  if (colorHex !== lastDisplayedColor) {
    lastDisplayedColor = colorHex;
    ui.applyDisplayedColor(colorHex);
  }

  const isPlaying = timeline.getBroadcastPlaybackSec(ctx) != null;
  if (!isPlaying || positionSec == null) {
    if (nextColorChangeTimeoutId != null) clearTimeout(nextColorChangeTimeoutId);
    nextColorChangeTimeoutId = setTimeout(() => {
      nextColorChangeTimeoutId = null;
      syncDisplayAndScheduleNext();
    }, DISPLAY_FALLBACK_MS);
    return;
  }

  const nextStartSec = timeline.getNextColorChangeStartSec(ctx, positionSec);
  if (nextStartSec == null) {
    if (nextColorChangeTimeoutId != null) clearTimeout(nextColorChangeTimeoutId);
    nextColorChangeTimeoutId = setTimeout(() => {
      nextColorChangeTimeoutId = null;
      syncDisplayAndScheduleNext();
    }, DISPLAY_FALLBACK_MS);
    return;
  }

  const delayMs = Math.max(1, (nextStartSec - positionSec) * 1000);
  if (nextColorChangeTimeoutId != null) clearTimeout(nextColorChangeTimeoutId);
  nextColorChangeTimeoutId = setTimeout(() => {
    nextColorChangeTimeoutId = null;
    syncDisplayAndScheduleNext();
  }, delayMs);
}

async function fetchPoll(): Promise<timeline.PollResponse> {
  const deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  const headers: HeadersInit = {};
  if (deviceId) (headers as Record<string, string>)["X-Device-ID"] = deviceId;
  if (lastRttMs != null) (headers as Record<string, string>)["X-Ping-Ms"] = String(lastRttMs);
  gps.addGeoHeaders(headers as Record<string, string>);
  const t0 = Date.now();
  const res = await fetch("/api/poll", { headers });
  lastRttMs = Date.now() - t0;
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  const data = (await res.json()) as timeline.PollResponse;
  if (data.deviceId) localStorage.setItem(DEVICE_ID_STORAGE_KEY, data.deviceId);
  return data;
}

function computeFirstColor(): string {
  const ctx = getTimelineContext();
  if (broadcastCache == null) {
    return lastEvents[0]?.color ?? "#000000";
  }
  const positionSec = timeline.getBroadcastPlaybackSec(ctx);
  let broadcastColor: string | null = null;
  if (positionSec != null) {
    broadcastColor = timeline.getColorFromBroadcastTimeline(ctx, positionSec);
    if (broadcastColor != null) lastAppliedBroadcastColor = broadcastColor;
  } else if (
    broadcastCache.playAtMs != null &&
    broadcastCache.pauseAtMs != null &&
    getServerTime() >= broadcastCache.pauseAtMs
  ) {
    const pausedPositionSec =
      (broadcastCache.readheadSec ?? 0) +
      (broadcastPausedAtMs! - broadcastCache.playAtMs) / 1000;
    broadcastColor = timeline.getColorFromBroadcastTimeline(ctx, pausedPositionSec);
    if (broadcastColor != null) lastAppliedBroadcastColor = broadcastColor;
  }
  return (
    broadcastColor ??
    lastAppliedBroadcastColor ??
    lastDisplayedColor ??
    (lastEvents[0]?.color ?? "#000000")
  );
}

function doRender(): void {
  const firstColor = computeFirstColor();
  lastDisplayedColor = firstColor;
  ui.render({
    deviceId: lastDeviceId,
    serverTime: getServerTime(),
    firstColor,
  });
}

async function pollLoop(): Promise<void> {
  try {
    const data = await fetchPoll();
    const serverTs =
      data.serverTimeAtSend != null ? data.serverTimeAtSend : data.serverTime;
    const rttMs = lastRttMs ?? 0;
    const rawOffset = serverTs + rttMs / 2 - Date.now();
    offsetSamples.push(rawOffset);
    if (offsetSamples.length > OFFSET_SAMPLES_MAX) offsetSamples.shift();
    clockOffset = median(offsetSamples);

    lastDeviceId = data.deviceId || localStorage.getItem(DEVICE_ID_STORAGE_KEY) || "—";

    if (data.broadcast && timeline.isBroadcastTimeline(data.broadcast.timeline)) {
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
    doRender();
    syncDisplayAndScheduleNext();

    const requestsGPS = broadcastCache?.timeline && typeof broadcastCache.timeline === "object" && (broadcastCache.timeline as { requestsGPS?: boolean }).requestsGPS === true;
    gps.setGpsRequired(!!requestsGPS);

    if (popup.hasPopupWithType("no-connection")) {
      popup.dismissPopupsByType("no-connection");
    }
  } catch {
    if (!popup.hasPopupWithType("no-connection")) {
      popup.showPopupIfNotExists("no-connection", {
        message: "Unable to contact the Show Server.",
        leftLabel: "Refresh Browser",
        rightLabel: "Show is over",
      });
    }
  }
  setTimeout(pollLoop, POLL_INTERVAL_MS);
}

lastDisplayedColor = "#000000";
lastDeviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY) || "—";
ui.render({
  deviceId: lastDeviceId,
  serverTime: getServerTime(),
  firstColor: "#000000",
});
pollLoop();
