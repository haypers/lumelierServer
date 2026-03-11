/** Minimal item shape for scroll range (need startSec and endSec). */
export interface ViewportItem {
  startSec: number;
  endSec?: number;
}

export const MIN_SCROLL_RANGE_SEC = 5 * 60; // 5 minutes
export const EXTEND_PAST_LAST_EVENT_SEC = 3 * 60; // 3 minutes

export interface TimelineViewportState {
  startSec: number;
  pixelsPerSec: number;
  viewportWidthPx: number;
}

export function createViewportState(initialPixelsPerSec = 20): TimelineViewportState {
  return {
    startSec: 0,
    pixelsPerSec: initialPixelsPerSec,
    viewportWidthPx: 0,
  };
}

export function getVisibleRange(v: TimelineViewportState): { startSec: number; endSec: number } {
  const startSec = v.startSec;
  const endSec = startSec + getViewportDurationSec(v);
  return { startSec, endSec };
}

export function getViewportDurationSec(v: TimelineViewportState): number {
  if (v.viewportWidthPx <= 0) return 60;
  return v.viewportWidthPx / v.pixelsPerSec;
}

export function getLastEventSec(items: ViewportItem[]): number {
  let maxSec = 0;
  for (const it of items) {
    maxSec = Math.max(maxSec, it.startSec);
    if (it.endSec != null) maxSec = Math.max(maxSec, it.endSec);
  }
  return maxSec;
}

export function getScrollRangeRightSec(
  v: TimelineViewportState,
  items: ViewportItem[]
): number {
  const viewportRight = v.startSec + getViewportDurationSec(v);
  const lastEventSec = getLastEventSec(items);
  const contentFloor = Math.max(MIN_SCROLL_RANGE_SEC, lastEventSec + EXTEND_PAST_LAST_EVENT_SEC);
  return Math.max(viewportRight, contentFloor);
}

export function setStartSec(v: TimelineViewportState, sec: number): void {
  v.startSec = Math.max(0, sec);
}

export function setPixelsPerSec(v: TimelineViewportState, px: number): void {
  v.pixelsPerSec = Math.max(1, px);
}

export function setViewportWidthPx(v: TimelineViewportState, px: number): void {
  v.viewportWidthPx = Math.max(0, px);
}

export function panByPx(
  v: TimelineViewportState,
  deltaPx: number,
  scrollRangeRightSec: number
): void {
  const durationSec = getViewportDurationSec(v);
  const maxStart = Math.max(0, scrollRangeRightSec - durationSec);
  const deltaSec = -deltaPx / v.pixelsPerSec;
  v.startSec = Math.max(0, Math.min(maxStart, v.startSec + deltaSec));
}

export function zoomAtCursor(
  v: TimelineViewportState,
  cursorX: number,
  deltaY: number,
  zoomMin: number,
  zoomMax: number
): void {
  const cursorTimeSec = v.startSec + cursorX / v.pixelsPerSec;
  const factor = deltaY > 0 ? 0.9 : 1.1;
  let newPx = v.pixelsPerSec * factor;
  newPx = Math.max(zoomMin, Math.min(zoomMax, newPx));
  v.pixelsPerSec = newPx;
  const newStartSec = cursorTimeSec - cursorX / newPx;
  v.startSec = Math.max(0, newStartSec);
}
