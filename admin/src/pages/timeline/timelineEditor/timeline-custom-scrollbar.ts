const TRACK_HEIGHT_PX = 10;
const THUMB_MIN_WIDTH_PX = 20;

export interface CustomScrollbarOptions {
  trackWidthPx: number;
  scrollRangeRightSec: number;
  startSec: number;
  viewportDurationSec: number;
  onScroll: (startSec: number) => void;
}

export function createCustomScrollbar(
  container: HTMLElement,
  options: CustomScrollbarOptions
): { update: (opts: Partial<CustomScrollbarOptions>) => void } {
  const track = document.createElement("div");
  track.className = "custom-timeline-scrollbar-track";
  track.style.position = "relative";
  track.style.width = "100%";
  track.style.height = `${TRACK_HEIGHT_PX}px`;
  track.style.background = "var(--bg-elevated)";
  track.style.borderRadius = "4px";
  track.style.cursor = "pointer";

  const thumb = document.createElement("div");
  thumb.className = "custom-timeline-scrollbar-thumb";
  thumb.style.position = "absolute";
  thumb.style.top = "0";
  thumb.style.height = "100%";
  thumb.style.background = "var(--accent)";
  thumb.style.borderRadius = "4px";
  thumb.style.cursor = "grab";
  track.appendChild(thumb);

  container.appendChild(track);

  let state = { ...options };
  let thumbDragging = false;
  let dragStartX = 0;
  let dragStartSec = 0;

  function applyState(): void {
    const { trackWidthPx, scrollRangeRightSec: range, startSec, viewportDurationSec } = state;
    if (range <= 0) return;
    const thumbWidthRatio = viewportDurationSec / range;
    const thumbWidthPx = Math.max(THUMB_MIN_WIDTH_PX, trackWidthPx * thumbWidthRatio);
    const thumbLeftRatio = startSec / range;
    const thumbLeftPx = Math.max(0, Math.min(trackWidthPx - thumbWidthPx, trackWidthPx * thumbLeftRatio));
    thumb.style.width = `${thumbWidthPx}px`;
    thumb.style.left = `${thumbLeftPx}px`;
  }

  function secFromClientX(clientX: number): number {
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left;
    const { trackWidthPx, scrollRangeRightSec: range } = state;
    const ratio = Math.max(0, Math.min(1, x / trackWidthPx));
    return ratio * range;
  }

  track.addEventListener("mousedown", (e) => {
    if (e.target === thumb) {
      thumbDragging = true;
      dragStartX = e.clientX;
      dragStartSec = state.startSec;
      thumb.style.cursor = "grabbing";
      e.preventDefault();
      return;
    }
    const sec = secFromClientX(e.clientX);
    const newStart = Math.max(0, sec - state.viewportDurationSec / 2);
    state.onScroll(newStart);
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!thumbDragging) return;
    const range = state.scrollRangeRightSec;
    const duration = state.viewportDurationSec;
    const maxStart = Math.max(0, range - duration);
    const deltaPx = e.clientX - dragStartX;
    const trackRect = track.getBoundingClientRect();
    const deltaSec = (deltaPx / trackRect.width) * range;
    const newStart = Math.max(0, Math.min(maxStart, dragStartSec + deltaSec));
    state.onScroll(newStart);
  });

  document.addEventListener("mouseup", () => {
    if (thumbDragging) {
      thumbDragging = false;
      thumb.style.cursor = "grab";
    }
  });

  function update(opts: Partial<CustomScrollbarOptions>): void {
    state = { ...state, ...opts };
    applyState();
  }

  applyState();

  return {
    update,
  };
}
