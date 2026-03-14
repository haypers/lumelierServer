/**
 * Live state polling and BroadcastChannel listener for the current show.
 * State (showLiveState) and UI refresh remain in show-management; this module uses callbacks.
 */

export type ShowLiveState = "not_live" | "requesting" | "live";

const LIVE_STATE_CHANNEL_NAME = "lumelier-live-state";
export const LIVE_STATE_INITIAL_POLL_MS = 15000;
const LIVE_STATE_VOICE_INTERVAL_MS = 30000;
const LIVE_STATE_LISTENER_BACKOFF_MS = 40000;
const LIVE_STATE_LISTENER_BACKOFF_RANDOM_MS = 10000;

const liveStateChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(LIVE_STATE_CHANNEL_NAME) : null;
let liveStatePollTimerId: ReturnType<typeof setTimeout> | null = null;
let syncShowStatusUIRef: (() => void) | null = null;

let getCurrentShowRef: () => { id: string } | null = () => null;
let setShowLiveStateRef: (s: ShowLiveState) => void = () => {};

export function initLiveState(deps: {
  getCurrentShow: () => { id: string } | null;
  setShowLiveState: (s: ShowLiveState) => void;
}): void {
  getCurrentShowRef = deps.getCurrentShow;
  setShowLiveStateRef = deps.setShowLiveState;
}

export function setSyncShowStatusUIRef(fn: (() => void) | null): void {
  syncShowStatusUIRef = fn;
}

/** Call the registered sync UI callback (e.g. from show-management after changing show live state). */
export function refreshLiveStateUI(): void {
  syncShowStatusUIRef?.();
}

export async function fetchLiveStateFromServer(showId: string): Promise<boolean> {
  const res = await fetch(`/api/admin/show-workspaces/${showId}/live-join-url`, { credentials: "include" });
  if (!res.ok) return false;
  const data = (await res.json()) as { live?: boolean };
  return data.live === true;
}

export function clearLiveStatePollTimer(): void {
  if (liveStatePollTimerId != null) {
    clearTimeout(liveStatePollTimerId);
    liveStatePollTimerId = null;
  }
}

export function dispatchLiveStateEvent(showId: string, live: boolean, pending?: boolean): void {
  if (typeof window !== "undefined") {
    const detail = pending === true ? { showId, live: false, pending: true } : { showId, live, pending: false };
    window.dispatchEvent(new CustomEvent("lumelier-live-state", { detail }));
  }
}

export function scheduleNextLiveStatePoll(ms: number): void {
  clearLiveStatePollTimer();
  const currentShow = getCurrentShowRef();
  if (!currentShow) return;
  const showId = currentShow.id;
  liveStatePollTimerId = setTimeout(() => {
    liveStatePollTimerId = null;
    if (getCurrentShowRef()?.id !== showId) return;
    fetchLiveStateFromServer(showId)
      .then((live) => {
        if (getCurrentShowRef()?.id !== showId) return;
        setShowLiveStateRef(live ? "live" : "not_live");
        syncShowStatusUIRef?.();
        if (liveStateChannel) {
          liveStateChannel.postMessage({ showId, live });
        }
        dispatchLiveStateEvent(showId, live);
        scheduleNextLiveStatePoll(LIVE_STATE_VOICE_INTERVAL_MS);
      })
      .catch(() => {
        if (getCurrentShowRef()?.id === showId) scheduleNextLiveStatePoll(LIVE_STATE_VOICE_INTERVAL_MS);
      });
  }, ms);
}

export function broadcastLiveState(showId: string, live: boolean): void {
  if (liveStateChannel) liveStateChannel.postMessage({ showId, live });
  dispatchLiveStateEvent(showId, live);
}

export function setupLiveStateBroadcastListener(): void {
  if (!liveStateChannel) return;
  liveStateChannel.onmessage = (e: MessageEvent) => {
    const msg = e.data as { showId?: string; live?: boolean } | null;
    if (msg == null || typeof msg.showId !== "string" || typeof msg.live !== "boolean") return;
    if (getCurrentShowRef()?.id !== msg.showId) return;
    setShowLiveStateRef(msg.live ? "live" : "not_live");
    syncShowStatusUIRef?.();
    dispatchLiveStateEvent(msg.showId, msg.live);
    const backoffMs =
      LIVE_STATE_LISTENER_BACKOFF_MS +
      Math.random() * LIVE_STATE_LISTENER_BACKOFF_RANDOM_MS;
    scheduleNextLiveStatePoll(backoffMs);
  };
}
