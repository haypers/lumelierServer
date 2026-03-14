const BROADCAST_READHEAD_TICK_MS = 100;
const BROADCAST_READHEAD_POST_DEBOUNCE_MS = 150;

let serverTimeOffsetMs = 0;
let broadcastPlayAtMs: number | null = null;
let broadcastReadheadSec = 0;
let broadcastPauseAtMs: number | null = null;
let broadcastReadheadTickId: ReturnType<typeof setInterval> | null = null;
let broadcastReadheadPostTimer: ReturnType<typeof setTimeout> | null = null;

export interface BroadcastDeps {
  setReadheadSec: (sec: number) => void;
  getIsBroadcastMode: () => boolean;
  getCurrentShowId: () => string | null;
}

let deps: BroadcastDeps | null = null;

export function initBroadcast(d: BroadcastDeps): void {
  deps = d;
}

export function getServerTimeMs(): number {
  return Date.now() + serverTimeOffsetMs;
}

function tickBroadcastReadhead(): void {
  if (!deps) return;
  if (broadcastPlayAtMs == null) return;
  const nowMs = getServerTimeMs();
  if (nowMs < broadcastPlayAtMs) return;
  if (broadcastPauseAtMs != null && nowMs >= broadcastPauseAtMs) {
    return;
  }
  const sec = broadcastReadheadSec + (nowMs - broadcastPlayAtMs) / 1000;
  deps.setReadheadSec(sec);
}

export function postBroadcastReadheadDebounced(sec: number): void {
  if (!deps) return;
  if (!deps.getIsBroadcastMode()) return;
  if (broadcastPlayAtMs != null && broadcastPauseAtMs == null) return;
  if (broadcastReadheadPostTimer != null) {
    clearTimeout(broadcastReadheadPostTimer);
    broadcastReadheadPostTimer = null;
  }
  const clamped = Math.max(0, sec);
  const showId = deps.getCurrentShowId();
  broadcastReadheadPostTimer = setTimeout(() => {
    broadcastReadheadPostTimer = null;
    if (!showId) return;
    fetch(`/api/admin/shows/${showId}/broadcast/readhead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readheadSec: clamped }),
      credentials: "include",
    }).catch(() => {});
  }, BROADCAST_READHEAD_POST_DEBOUNCE_MS);
}

export function startBroadcastReadheadTick(): void {
  if (broadcastReadheadTickId != null) {
    clearInterval(broadcastReadheadTickId);
    broadcastReadheadTickId = null;
  }
  broadcastReadheadTickId = setInterval(tickBroadcastReadhead, BROADCAST_READHEAD_TICK_MS);
}

export function stopBroadcastReadheadTick(): void {
  if (broadcastReadheadTickId != null) {
    clearInterval(broadcastReadheadTickId);
    broadcastReadheadTickId = null;
  }
  broadcastPlayAtMs = null;
  broadcastPauseAtMs = null;
}

export interface BroadcastPlayResponse {
  playAtMs?: number;
  serverTimeMs?: number;
}

export interface BroadcastPauseResponse {
  pauseAtMs?: number;
  serverTimeMs?: number;
}

/** Call broadcast/play API, update internal state, and start the readhead tick. */
export async function requestBroadcastPlay(showId: string, readheadSec: number): Promise<BroadcastPlayResponse> {
  const res = await fetch(`/api/admin/shows/${showId}/broadcast/play`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ readheadSec }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as BroadcastPlayResponse;
  const playAtMs = data.playAtMs ?? 0;
  if (data.serverTimeMs != null) {
    serverTimeOffsetMs = data.serverTimeMs - Date.now();
  }
  broadcastPlayAtMs = playAtMs;
  broadcastReadheadSec = readheadSec;
  broadcastPauseAtMs = null;
  startBroadcastReadheadTick();
  return data;
}

/** Call broadcast/pause API and set pause time so the tick stops advancing. */
export async function requestBroadcastPause(showId: string): Promise<BroadcastPauseResponse> {
  const res = await fetch(`/api/admin/shows/${showId}/broadcast/pause`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as BroadcastPauseResponse;
  const pauseAtMs = data.pauseAtMs ?? 0;
  if (data.serverTimeMs != null) {
    serverTimeOffsetMs = data.serverTimeMs - Date.now();
  }
  broadcastPauseAtMs = pauseAtMs;
  return data;
}

/** Restart from beginning (play at readhead 0). */
export async function requestBroadcastRestart(showId: string): Promise<BroadcastPlayResponse> {
  return requestBroadcastPlay(showId, 0);
}
