import * as gps from "./gps";
import * as popup from "./popup";
import * as timeline from "./timeline";
import * as ui from "./ui";

const DEVICE_ID_STORAGE_KEY = "lumelier_device_id";

const POLL_INTERVAL_MS = 2500;
const SHOW_ID_LEN = 8;

/** Parse show_id from URL: path /{show_id} or /{show_id}/ or query ?show= */
function getShowIdFromUrl(): string | null {
  const path = window.location.pathname.replace(/\/$/, "").replace(/^\//, "");
  const firstSegment = path.split("/")[0];
  if (firstSegment && firstSegment.length === SHOW_ID_LEN && /^[a-z0-9]+$/.test(firstSegment)) {
    return firstSegment;
  }
  const params = new URLSearchParams(window.location.search);
  const show = params.get("show");
  if (show && show.length === SHOW_ID_LEN && /^[a-z0-9]+$/.test(show)) {
    return show;
  }
  return null;
}
const SYNC_SAMPLES_MAX = 30;
const DELAY_SLACK_MS = 40;
const SLEW_MAX_STEP_MS = 25;
const DISPLAY_FALLBACK_MS = 15000;

let broadcastCache: timeline.PollBroadcast | null = null;
let broadcastPlaybackStartedAtMs: number | null = null;
let broadcastPausedAtMs: number | null = null;
let lastAppliedBroadcastColor: string | null = null;
let lastDisplayedColor: string | null = null;
let lastEvents: timeline.PollEvent[] = [];
let lastDeviceId = "";
let broadcastColorEvents: { startSec: number; color: string }[] | null = null;

let clockOffset = 0;
let nextColorChangeTimeoutId: ReturnType<typeof setTimeout> | null = null;
let lastRttMs: number | null = null;
let playbackRafId: number | null = null;

type SyncSample = {
  offsetMs: number;
  delayMs: number;
};

let syncSamples: SyncSample[] = [];

function nowEpochMs(): number {
  // Monotonic-ish epoch ms to avoid wall-clock jumps affecting sync math.
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    const origin =
      typeof performance.timeOrigin === "number" && Number.isFinite(performance.timeOrigin)
        ? performance.timeOrigin
        : Date.now() - performance.now();
    return origin + performance.now();
  }
  return Date.now();
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function getServerTime(): number {
  return Math.round(nowEpochMs() + clockOffset);
}

function rebuildBroadcastColorEvents(): void {
  if (broadcastCache == null) {
    broadcastColorEvents = null;
    return;
  }
  const items = broadcastCache.timeline?.items ?? [];
  broadcastColorEvents = items
    .filter(
      (it) =>
        it.effectType === timeline.EVENT_TYPE_SET_COLOR_BROADCAST &&
        typeof it.color === "string" &&
        it.color.length > 0 &&
        typeof it.startSec === "number" &&
        Number.isFinite(it.startSec)
    )
    .map((it) => ({ startSec: it.startSec as number, color: it.color as string }))
    .sort((a, b) => a.startSec - b.startSec);
}

function getColorAtPositionSec(positionSec: number): string | null {
  const events = broadcastColorEvents;
  if (!events || events.length === 0) return null;
  // Binary search for last event with startSec <= positionSec
  let lo = 0;
  let hi = events.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].startSec <= positionSec) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? events[ans].color : null;
}

function getColorReferencePositionSec(ctx: timeline.TimelineContext): number {
  if (broadcastCache == null) return 0;
  const playingPosSec = timeline.getBroadcastPlaybackSec(ctx);
  if (playingPosSec != null) return playingPosSec;

  const nowServer = getServerTime();
  if (
    broadcastCache.playAtMs != null &&
    broadcastCache.pauseAtMs != null &&
    nowServer >= broadcastCache.pauseAtMs
  ) {
    return (
      (broadcastCache.readheadSec ?? 0) +
      (broadcastCache.pauseAtMs - broadcastCache.playAtMs) / 1000
    );
  }

  // Stopped / not-yet-started / playAtMs in the future: use server-provided readhead.
  return broadcastCache.readheadSec ?? 0;
}

function stopPlaybackRaf(): void {
  if (playbackRafId != null) {
    cancelAnimationFrame(playbackRafId);
    playbackRafId = null;
  }
}

function syncDisplayOnce(): boolean {
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
    return false;
  }

  // Latch play/pause moments as soon as we cross them (avoids waiting for the next poll tick).
  const nowServer = getServerTime();
  if (broadcastCache.playAtMs != null && nowServer >= broadcastCache.playAtMs) {
    broadcastPlaybackStartedAtMs = broadcastPlaybackStartedAtMs ?? broadcastCache.playAtMs;
  }
  if (broadcastCache.pauseAtMs != null && nowServer >= broadcastCache.pauseAtMs) {
    broadcastPausedAtMs = broadcastPausedAtMs ?? broadcastCache.pauseAtMs;
  }

  const positionSec: number | null = timeline.getBroadcastPlaybackSec(ctx);
  const refSec = getColorReferencePositionSec(ctx);
  const currentColor = getColorAtPositionSec(refSec);
  const colorHex = currentColor ?? "#000000";
  if (colorHex !== lastDisplayedColor) {
    lastDisplayedColor = colorHex;
    ui.applyDisplayedColor(colorHex);
  }

  return positionSec != null;
}

function startPlaybackRafIfNeeded(): void {
  if (playbackRafId != null) return;
  const tick = () => {
    playbackRafId = requestAnimationFrame(tick);
    const playing = syncDisplayOnce();
    if (!playing) stopPlaybackRaf();
  };
  playbackRafId = requestAnimationFrame(tick);
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
  const isPlaying = syncDisplayOnce();

  if (isPlaying) {
    if (nextColorChangeTimeoutId != null) {
      clearTimeout(nextColorChangeTimeoutId);
      nextColorChangeTimeoutId = null;
    }
    startPlaybackRafIfNeeded();
    return;
  }

  stopPlaybackRaf();

  // Not playing (paused/stopped/not-yet-started). Re-check on fallback interval, but if playAtMs is
  // in the future, wake up right when we cross it.
  let delayMs = DISPLAY_FALLBACK_MS;
  const serverNow = getServerTime();
  if (broadcastCache?.playAtMs != null && serverNow < broadcastCache.playAtMs) {
    delayMs = Math.min(delayMs, broadcastCache.playAtMs - serverNow);
  }
  delayMs = Math.max(1, delayMs);

  if (nextColorChangeTimeoutId != null) clearTimeout(nextColorChangeTimeoutId);
  nextColorChangeTimeoutId = setTimeout(() => {
    nextColorChangeTimeoutId = null;
    syncDisplayAndScheduleNext();
  }, delayMs);
}

async function fetchPoll(showId: string): Promise<{ data: timeline.PollResponse; t0: number; t3: number }> {
  const deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  const headers: HeadersInit = {};
  if (deviceId) (headers as Record<string, string>)["X-Device-ID"] = deviceId;
  if (lastRttMs != null) (headers as Record<string, string>)["X-Ping-Ms"] = String(lastRttMs);
  const t0 = nowEpochMs();
  (headers as Record<string, string>)["X-Client-Send-Ms"] = String(Math.round(t0));
  gps.addGeoHeaders(headers as Record<string, string>);
  const url = `/api/poll?show=${encodeURIComponent(showId)}`;
  const res = await fetch(url, { headers });
  const t3 = nowEpochMs();
  lastRttMs = Math.round(t3 - t0);
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  const data = (await res.json()) as timeline.PollResponse;
  if (data.deviceId) localStorage.setItem(DEVICE_ID_STORAGE_KEY, data.deviceId);
  return { data, t0, t3 };
}

function computeFirstColor(): string {
  const ctx = getTimelineContext();
  if (broadcastCache == null) {
    return lastEvents[0]?.color ?? "#000000";
  }
  const refSec = getColorReferencePositionSec(ctx);
  return getColorAtPositionSec(refSec) ?? "#000000";
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

async function pollLoop(showId: string): Promise<void> {
  try {
    const { data, t0, t3 } = await fetchPoll(showId);
    const t1 = data.serverTimeAtRecv;
    const t2 = data.serverTimeAtSend ?? data.serverTime;

    let offsetMs: number;
    let delayMs: number;
    if (t1 != null && t2 != null) {
      offsetMs = ((t1 - t0) + (t2 - t3)) / 2;
      delayMs = (t3 - t0) - (t2 - t1);
      if (!Number.isFinite(offsetMs)) offsetMs = 0;
      if (!Number.isFinite(delayMs)) delayMs = 0;
      delayMs = Math.max(0, delayMs);
    } else {
      // Fallback (should not happen once server is updated).
      const rttMs = lastRttMs ?? 0;
      const serverTs = data.serverTimeAtSend != null ? data.serverTimeAtSend : data.serverTime;
      offsetMs = serverTs + rttMs / 2 - nowEpochMs();
      delayMs = Math.max(0, rttMs);
    }

    syncSamples.push({ offsetMs, delayMs });
    if (syncSamples.length > SYNC_SAMPLES_MAX) syncSamples.shift();

    const minDelay = Math.min(...syncSamples.map((s) => s.delayMs));
    const good = syncSamples.filter((s) => s.delayMs <= minDelay + DELAY_SLACK_MS);
    const offsets = (good.length ? good : syncSamples).map((s) => s.offsetMs);
    const filteredOffset = median(offsets);

    if (syncSamples.length < 3) {
      clockOffset = filteredOffset;
    } else {
      const delta = filteredOffset - clockOffset;
      clockOffset += clamp(delta, -SLEW_MAX_STEP_MS, SLEW_MAX_STEP_MS);
    }

    lastDeviceId = data.deviceId || localStorage.getItem(DEVICE_ID_STORAGE_KEY) || "—";

    if (data.broadcast && timeline.isBroadcastTimeline(data.broadcast.timeline)) {
      broadcastCache = data.broadcast;
      rebuildBroadcastColorEvents();
      lastAppliedBroadcastColor = null;
      const now = getServerTime();
      if (data.broadcast.pauseAtMs != null && now >= data.broadcast.pauseAtMs)
        broadcastPausedAtMs = data.broadcast.pauseAtMs;
      else broadcastPausedAtMs = null;
      if (data.broadcast.playAtMs != null && now >= data.broadcast.playAtMs)
        broadcastPlaybackStartedAtMs = data.broadcast.playAtMs;
    } else {
      broadcastCache = null;
      rebuildBroadcastColorEvents();
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
  setTimeout(() => pollLoop(showId), POLL_INTERVAL_MS);
}

const showId = getShowIdFromUrl();
if (showId == null) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px;text-align:center;font-family:system-ui,sans-serif;color:#ccc;background:#111;">
      <p>Invalid or missing show link.</p>
    </div>`;
} else {
  lastDisplayedColor = "#000000";
  lastDeviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY) || "—";
  ui.render({
    deviceId: lastDeviceId,
    serverTime: getServerTime(),
    firstColor: "#000000",
  });
  pollLoop(showId);
}
