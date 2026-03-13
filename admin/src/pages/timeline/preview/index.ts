/**
 * Preview panel: array-dimensions slider (5–40) + X×X grid of client squares.
 * Layout: portrait (taller than wide) → horizontal slider 20px tall at top, grid below;
 *         landscape (wider than tall) → vertical slider 20px wide on left, grid to the right.
 */

import "./styles.css";

const MIN_DIM = 5;
const MAX_DIM = 40;
const DEFAULT_DIM = 10;

const STORAGE_KEY_PREFIX = "lumelier-timeline:";
const STORAGE_KEY_SUFFIX = ":preview-array-dim";

function loadStoredDim(showId: string): number | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY_PREFIX + showId + STORAGE_KEY_SUFFIX);
    if (v == null) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= MIN_DIM && n <= MAX_DIM ? n : null;
  } catch {
    return null;
  }
}

function saveDim(showId: string, dim: number): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + showId + STORAGE_KEY_SUFFIX, String(dim));
  } catch {
    /* ignore */
  }
}

export function renderPreviewPanel(container: HTMLElement, showId: string | null = null): void {
  container.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "timeline-preview-widget";

  const sliderBar = document.createElement("div");
  sliderBar.className = "timeline-preview-slider-bar";

  const sliderWrap = document.createElement("div");
  sliderWrap.className = "timeline-preview-slider-wrap";

  const storedDim = showId ? loadStoredDim(showId) : null;
  const initialDim = storedDim ?? DEFAULT_DIM;

  const sliderInput = document.createElement("input");
  sliderInput.type = "range";
  sliderInput.min = String(MIN_DIM);
  sliderInput.max = String(MAX_DIM);
  sliderInput.step = "1";
  sliderInput.value = String(initialDim);
  sliderInput.className = "timeline-preview-array-slider";
  sliderInput.setAttribute("aria-label", "Array dimensions (grid size)");

  const gridArea = document.createElement("div");
  gridArea.className = "timeline-preview-grid-area";

  const gridContainer = document.createElement("div");
  gridContainer.className = "timeline-preview-grid-container";

  sliderWrap.appendChild(sliderInput);
  sliderBar.appendChild(sliderWrap);
  gridArea.appendChild(gridContainer);
  wrapper.appendChild(sliderBar);
  wrapper.appendChild(gridArea);
  container.appendChild(wrapper);

  let dimension = initialDim;

  function renderGrid(): void {
    const side = dimension;
    gridContainer.style.gridTemplateColumns = `repeat(${side}, 1fr)`;
    gridContainer.style.gridTemplateRows = `repeat(${side}, 1fr)`;
    gridContainer.innerHTML = "";
    const total = side * side;
    for (let i = 0; i < total; i++) {
      const cell = document.createElement("div");
      cell.className = "timeline-preview-grid-cell";
      cell.setAttribute("aria-hidden", "true");
      gridContainer.appendChild(cell);
    }
  }

  function onSliderInput(): void {
    const val = sliderInput.value;
    const n = Math.round(parseFloat(val));
    if (Number.isFinite(n) && n >= MIN_DIM && n <= MAX_DIM) {
      dimension = n;
      renderGrid();
      if (showId) saveDim(showId, n);
    }
  }

  sliderInput.addEventListener("input", onSliderInput);
  renderGrid();

  function updateLayout(): void {
    const w = container.offsetWidth;
    const h = container.offsetHeight;
    const isPortrait = h > w;
    wrapper.classList.toggle("timeline-preview-widget--portrait", isPortrait);
    wrapper.classList.toggle("timeline-preview-widget--landscape", !isPortrait);
  }

  const ro = new ResizeObserver(updateLayout);
  ro.observe(container);
  updateLayout();
}
