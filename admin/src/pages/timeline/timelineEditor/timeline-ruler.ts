/** Format seconds as m:ss */
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Tick step in seconds for a given visible range; used by ruler and wheel pan. */
export function getTickStepForRange(rangeSec: number): number {
  const targetLabels = 10;
  const secPerLabel = rangeSec / targetLabels;
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300];
  let best = 1;
  for (const step of candidates) {
    if (step <= secPerLabel * 1.5) best = step;
  }
  return best;
}

/**
 * Render ruler ticks for the visible range [startSec, endSec] into the container.
 * Container width is set to viewportWidthPx. Tick positions are (t - startSec) * pixelsPerSec.
 */
export function renderRuler(
  container: HTMLElement,
  startSec: number,
  endSec: number,
  pixelsPerSec: number,
  viewportWidthPx: number
): void {
  container.style.width = `${viewportWidthPx}px`;
  container.innerHTML = "";
  const rangeSec = endSec - startSec;
  const step = getTickStepForRange(rangeSec);
  const firstTick = Math.ceil(startSec / step) * step;
  for (let t = firstTick; t < endSec; t += step) {
    const left = (t - startSec) * pixelsPerSec;
    const tick = document.createElement("div");
    tick.className = "custom-timeline-ruler-tick";
    tick.style.position = "absolute";
    tick.style.left = `${left}px`;
    tick.style.top = "0";
    tick.style.width = "1px";
    tick.style.height = "100%";
    tick.style.background = "var(--border)";
    const label = document.createElement("span");
    label.className = "custom-timeline-ruler-label";
    label.style.position = "absolute";
    label.style.left = `${left + 2}px`;
    label.style.top = "50%";
    label.style.transform = "translateY(-50%)";
    label.style.fontSize = "11px";
    label.style.color = "var(--text-muted)";
    label.style.whiteSpace = "nowrap";
    label.textContent = formatTime(t);
    container.appendChild(tick);
    container.appendChild(label);
  }
}
