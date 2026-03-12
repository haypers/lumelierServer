/**
 * Reusable resizable splitter: two panels with a draggable divider.
 * Use for horizontal (e.g. details | preview) or vertical (e.g. timeline | bottom row) splits.
 */

import "./resizable-split.css";

export type ResizableSplitDirection = "horizontal" | "vertical";

export interface ResizableSplitOptions {
  /** Initial size of the first panel in percent (0–100). Default 50. */
  size?: number;
  /** Minimum size of the first panel in percent. Default 10. */
  min?: number;
  /** Maximum size of the first panel in percent. Default 90. */
  max?: number;
  /** If set, persist size in localStorage under this key. */
  storageKey?: string;
}

const DEFAULT_SIZE = 50;
const DEFAULT_MIN = 10;
const DEFAULT_MAX = 90;

function loadStoredSize(key: string): number | null {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  } catch {
    return null;
  }
}

function saveSize(key: string, size: number): void {
  try {
    localStorage.setItem(key, String(Math.round(size)));
  } catch {
    /* ignore */
  }
}

export interface ResizableSplitResult {
  /** Root container (resizable-split). Append this to your layout. */
  container: HTMLElement;
  /** First panel; put your left (or top) content here. */
  panelA: HTMLElement;
  /** Second panel; put your right (or bottom) content here. */
  panelB: HTMLElement;
}

/**
 * Create a resizable split container. Caller must append content to panelA and panelB,
 * then append container to the desired parent.
 */
export function createResizableSplit(
  direction: ResizableSplitDirection,
  options: ResizableSplitOptions = {}
): ResizableSplitResult {
  const {
    size: initialSize = DEFAULT_SIZE,
    min = DEFAULT_MIN,
    max = DEFAULT_MAX,
    storageKey,
  } = options;

  const size = storageKey ? loadStoredSize(storageKey) ?? initialSize : initialSize;
  const clamped = Math.max(min, Math.min(max, size));

  const container = document.createElement("div");
  container.className = `resizable-split resizable-split--${direction}`;
  container.style.setProperty("--resizable-split-size", String(clamped));

  const panelA = document.createElement("div");
  panelA.className = "resizable-split__panel-a";

  const handle = document.createElement("div");
  handle.className = "resizable-split__handle";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-valuenow", String(clamped));
  handle.setAttribute("aria-valuemin", String(min));
  handle.setAttribute("aria-valuemax", String(max));
  handle.setAttribute("aria-label", direction === "horizontal" ? "Resize columns" : "Resize rows");

  const panelB = document.createElement("div");
  panelB.className = "resizable-split__panel-b";

  container.appendChild(panelA);
  container.appendChild(handle);
  container.appendChild(panelB);

  let isDragging = false;
  let startClient = 0;
  let startSize = 0;
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;
  const HOVER_DELAY_MS = 100;

  function clearHoverDelay(): void {
    if (hoverTimeout != null) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
    handle.classList.remove("resizable-split__handle--hover");
  }

  function getContainerRect(): DOMRect {
    return container.getBoundingClientRect();
  }

  function setSize(percent: number): void {
    const value = Math.max(min, Math.min(max, percent));
    container.style.setProperty("--resizable-split-size", String(value));
    handle.setAttribute("aria-valuenow", String(Math.round(value)));
    if (storageKey) saveSize(storageKey, value);
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    clearHoverDelay();
    isDragging = true;
    startClient = direction === "horizontal" ? e.clientX : e.clientY;
    const current = container.style.getPropertyValue("--resizable-split-size");
    startSize = current ? parseFloat(current) : clamped;
    if (!Number.isFinite(startSize)) startSize = clamped;
    container.classList.add("resizable-split--dragging");
    handle.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!isDragging) return;
    const current = direction === "horizontal" ? e.clientX : e.clientY;
    const rect = getContainerRect();
    const total = direction === "horizontal" ? rect.width : rect.height;
    if (total <= 0) return;
    const delta = ((current - startClient) / total) * 100;
    setSize(startSize + delta);
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.button !== 0 || !isDragging) return;
    isDragging = false;
    container.classList.remove("resizable-split--dragging");
    handle.releasePointerCapture(e.pointerId);
  }

  handle.addEventListener("pointerenter", () => {
    clearHoverDelay();
    hoverTimeout = setTimeout(() => handle.classList.add("resizable-split__handle--hover"), HOVER_DELAY_MS);
  });
  handle.addEventListener("pointerleave", clearHoverDelay);
  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);

  return { container, panelA, panelB };
}
