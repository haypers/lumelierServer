import type { TimelineViewportState } from "./timeline-viewport";
import { getVisibleRange } from "./timeline-viewport";

export interface ReadheadState {
  readheadSec: number;
  readheadDraggable: boolean;
}

export function createReadheadElement(): { element: HTMLElement; innerLine: HTMLElement } {
  const readheadLine = document.createElement("div");
  readheadLine.className = "timeline-readhead";
  readheadLine.setAttribute("aria-hidden", "true");
  const readheadLineInner = document.createElement("div");
  readheadLineInner.className = "timeline-readhead-line";
  readheadLineInner.style.position = "absolute";
  readheadLineInner.style.left = "50%";
  readheadLineInner.style.top = "0";
  readheadLineInner.style.bottom = "0";
  readheadLineInner.style.width = "2px";
  readheadLineInner.style.transform = "translateX(-50%)";
  readheadLineInner.style.background = "var(--accent)";
  readheadLineInner.style.pointerEvents = "none";
  readheadLine.appendChild(readheadLineInner);
  return { element: readheadLine, innerLine: readheadLineInner };
}

export function renderReadhead(
  readheadEl: HTMLElement,
  innerLine: HTMLElement,
  getState: () => ReadheadState,
  viewport: TimelineViewportState,
  readheadHitWidthPx: number
): void {
  const state = getState();
  const { startSec, endSec } = getVisibleRange(viewport);
  const viewportWidthPx = viewport.viewportWidthPx || 0;
  if (viewportWidthPx <= 0) return;
  const x = (state.readheadSec - startSec) * viewport.pixelsPerSec;
  const inView = state.readheadSec >= startSec && state.readheadSec <= endSec;
  readheadEl.style.left = `${x}px`;
  readheadEl.style.position = "absolute";
  readheadEl.style.top = "0";
  readheadEl.style.width = "2px";
  readheadEl.style.background = "var(--accent)";
  readheadEl.style.zIndex = "10";
  readheadEl.style.visibility = inView ? "visible" : "hidden";
  if (state.readheadDraggable) {
    readheadEl.classList.add("timeline-readhead--draggable");
    readheadEl.style.pointerEvents = "auto";
    readheadEl.style.cursor = "ew-resize";
    readheadEl.style.width = `${readheadHitWidthPx}px`;
    readheadEl.style.marginLeft = `${-readheadHitWidthPx / 2}px`;
    readheadEl.style.background = "transparent";
    innerLine.style.display = "";
  } else {
    readheadEl.classList.remove("timeline-readhead--draggable");
    readheadEl.style.pointerEvents = "none";
    readheadEl.style.cursor = "";
    readheadEl.style.width = "2px";
    readheadEl.style.marginLeft = "0";
    readheadEl.style.background = "var(--accent)";
    innerLine.style.display = "none";
  }
}
