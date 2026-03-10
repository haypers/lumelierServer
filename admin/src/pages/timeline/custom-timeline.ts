import trashIcon from "../../icons/trash.svg?raw";
import type { TimelineStateJSON } from "./types";

const LAYER_LABELS_WIDTH_PX = 180;
const RULER_HEIGHT_PX = 40;
const LAYER_ROW_HEIGHT_PX = 32;
const DEFAULT_START_SEC = 0;
const DEFAULT_END_SEC = 60;
const DEFAULT_PIXELS_PER_SEC = 20;

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export interface CustomTimelineState {
  layers: TimelineStateJSON["layers"];
  items: TimelineStateJSON["items"];
  readheadSec: number;
}

export interface CustomTimelineCallbacks {
  onAddLayer: () => void;
  onRemoveLayer: (id: string) => void;
  onRenameLayer: (id: string, label: string) => void;
}

/** Format seconds as m:ss */
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Choose tick step so we have roughly 5–15 major labels over the visible range */
function chooseTickStep(rangeSec: number, _pixelsPerSec: number): number {
  const targetLabels = 10;
  const secPerLabel = rangeSec / targetLabels;
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300];
  let best = 1;
  for (const step of candidates) {
    if (step <= secPerLabel * 1.5) best = step;
  }
  return best;
}

export interface CustomTimelineView {
  update: () => void;
  getVisibleRange: () => { startSec: number; endSec: number };
}

export function createCustomTimelineView(
  mountEl: HTMLElement,
  getState: () => CustomTimelineState,
  callbacks: CustomTimelineCallbacks
): CustomTimelineView {
  let startSec = DEFAULT_START_SEC;
  let endSec = DEFAULT_END_SEC;
  let pixelsPerSec = DEFAULT_PIXELS_PER_SEC;

  const totalWidth = () => (endSec - startSec) * pixelsPerSec;

  const root = document.createElement("div");
  root.className = "custom-timeline";
  root.style.display = "flex";
  root.style.flexDirection = "row";
  root.style.height = "100%";
  root.style.minHeight = "0";
  root.style.overflow = "hidden";

  // —— Left column: layer labels (180px)
  const leftCol = document.createElement("div");
  leftCol.className = "custom-timeline-layer-labels";
  leftCol.style.width = `${LAYER_LABELS_WIDTH_PX}px`;
  leftCol.style.minWidth = `${LAYER_LABELS_WIDTH_PX}px`;
  leftCol.style.height = "100%";
  leftCol.style.display = "flex";
  leftCol.style.flexDirection = "column";
  leftCol.style.overflow = "hidden";
  leftCol.style.background = "var(--bg)";
  leftCol.style.borderRight = "1px solid var(--border)";

  const rulerSpacer = document.createElement("div");
  rulerSpacer.className = "custom-timeline-ruler-spacer";
  rulerSpacer.style.height = `${RULER_HEIGHT_PX}px`;
  rulerSpacer.style.minHeight = `${RULER_HEIGHT_PX}px`;
  rulerSpacer.style.display = "flex";
  rulerSpacer.style.alignItems = "center";
  rulerSpacer.style.justifyContent = "center";
  rulerSpacer.style.flexShrink = "0";
  const addLayerBtn = document.createElement("button");
  addLayerBtn.type = "button";
  addLayerBtn.className = "timeline-add-layer-btn";
  addLayerBtn.textContent = "+ Layer";
  addLayerBtn.addEventListener("click", () => callbacks.onAddLayer());
  rulerSpacer.appendChild(addLayerBtn);

  const layerLabelsScroll = document.createElement("div");
  layerLabelsScroll.className = "custom-timeline-layer-labels-scroll";
  layerLabelsScroll.style.flex = "1";
  layerLabelsScroll.style.minHeight = "0";
  layerLabelsScroll.style.overflowY = "auto";
  layerLabelsScroll.style.overflowX = "hidden";

  const layerLabelsList = document.createElement("div");
  layerLabelsList.className = "custom-timeline-layer-labels-list";

  leftCol.appendChild(rulerSpacer);
  leftCol.appendChild(layerLabelsScroll);
  layerLabelsScroll.appendChild(layerLabelsList);

  // —— Right column: ruler + layers
  const rightCol = document.createElement("div");
  rightCol.className = "custom-timeline-right";
  rightCol.style.flex = "1";
  rightCol.style.minWidth = "0";
  rightCol.style.height = "100%";
  rightCol.style.display = "flex";
  rightCol.style.flexDirection = "column";
  rightCol.style.overflow = "hidden";

  const rightScroll = document.createElement("div");
  rightScroll.className = "custom-timeline-right-scroll";
  rightScroll.style.flex = "1";
  rightScroll.style.minHeight = "0";
  rightScroll.style.overflow = "auto";

  const rightContent = document.createElement("div");
  rightContent.className = "custom-timeline-right-content";
  rightContent.style.position = "relative";

  const rulerWrap = document.createElement("div");
  rulerWrap.className = "custom-timeline-ruler-wrap";
  rulerWrap.style.height = `${RULER_HEIGHT_PX}px`;
  rulerWrap.style.minHeight = `${RULER_HEIGHT_PX}px`;
  rulerWrap.style.flexShrink = "0";
  rulerWrap.style.background = "var(--bg-elevated)";
  rulerWrap.style.borderBottom = "1px solid var(--border)";

  const rulerCanvas = document.createElement("div");
  rulerCanvas.className = "custom-timeline-ruler";
  rulerCanvas.style.position = "relative";
  rulerCanvas.style.height = "100%";
  rulerCanvas.style.minWidth = "0";

  const layersContent = document.createElement("div");
  layersContent.className = "custom-timeline-layers";
  layersContent.style.position = "relative";
  layersContent.style.minWidth = "0";

  const readheadLine = document.createElement("div");
  readheadLine.className = "custom-timeline-readhead";
  readheadLine.setAttribute("aria-hidden", "true");

  rightCol.appendChild(rightScroll);
  rightScroll.appendChild(rightContent);
  rightContent.appendChild(rulerWrap);
  rulerWrap.appendChild(rulerCanvas);
  rightContent.appendChild(layersContent);
  layersContent.appendChild(readheadLine);

  root.appendChild(leftCol);
  root.appendChild(rightCol);

  // Sync vertical scroll: right drives left
  rightScroll.addEventListener("scroll", () => {
    layerLabelsScroll.scrollTop = rightScroll.scrollTop;
  });
  layerLabelsScroll.addEventListener("scroll", () => {
    rightScroll.scrollTop = layerLabelsScroll.scrollTop;
  });

  function buildLayerLabelRow(layer: { id: string; label: string }, onlyOne: boolean): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "timeline-layer-label custom-timeline-layer-label-row";
    wrap.style.height = `${LAYER_ROW_HEIGHT_PX}px`;
    wrap.style.minHeight = `${LAYER_ROW_HEIGHT_PX}px`;
    const label = String(layer.label ?? "");
    wrap.innerHTML = `
      <span class="timeline-layer-label-name" title="Double-click to rename">${escapeHtml(label)}</span>
      <button type="button" class="timeline-layer-label-remove" title="Remove layer" aria-label="Remove layer">${trashIcon}</button>
    `;
    if (onlyOne) wrap.classList.add("timeline-layer-label--only-one");
    const nameEl = wrap.querySelector(".timeline-layer-label-name") as HTMLElement;
    const btn = wrap.querySelector(".timeline-layer-label-remove") as HTMLButtonElement;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (onlyOne) return;
      if (confirm("Remove this layer and all its items?")) {
        callbacks.onRemoveLayer(layer.id);
      }
    });

    nameEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.type = "text";
      input.className = "timeline-layer-label-input";
      input.value = nameEl.textContent ?? "";
      input.setAttribute("aria-label", "Layer name");
      const commit = () => {
        const val = input.value.trim();
        if (val) callbacks.onRenameLayer(layer.id, val);
        wrap.replaceChild(nameEl, input);
        nameEl.textContent = val || label;
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          input.blur();
        }
        if (ev.key === "Escape") {
          wrap.replaceChild(nameEl, input);
        }
      });
      wrap.replaceChild(input, nameEl);
      input.focus();
      input.select();
    });

    return wrap;
  }

  function renderRuler(): void {
    const rangeSec = endSec - startSec;
    const width = totalWidth();
    rulerCanvas.style.width = `${width}px`;
    rulerCanvas.innerHTML = "";
    const step = chooseTickStep(rangeSec, pixelsPerSec);
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
      rulerCanvas.appendChild(tick);
      rulerCanvas.appendChild(label);
    }
  }

  function renderReadhead(): void {
    const state = getState();
    const x = (state.readheadSec - startSec) * pixelsPerSec;
    readheadLine.style.left = `${x}px`;
    readheadLine.style.position = "absolute";
    readheadLine.style.top = "0";
    readheadLine.style.width = "2px";
    readheadLine.style.background = "var(--accent)";
    readheadLine.style.pointerEvents = "none";
    readheadLine.style.zIndex = "10";
  }

  function renderLayers(): void {
    const state = getState();
    const width = totalWidth();
    const totalHeight = RULER_HEIGHT_PX + state.layers.length * LAYER_ROW_HEIGHT_PX;
    rightContent.style.width = `${width}px`;
    rightContent.style.minHeight = `${totalHeight}px`;
    layersContent.style.width = `${width}px`;
    layersContent.style.height = `${state.layers.length * LAYER_ROW_HEIGHT_PX}px`;
    readheadLine.style.height = `${totalHeight}px`;

    // Clear layer rows (except readhead)
    const toRemove: Element[] = [];
    layersContent.querySelectorAll(".custom-timeline-layer-row-wrap").forEach((el) => toRemove.push(el));
    toRemove.forEach((el) => el.remove());

    state.layers.forEach((layer, index) => {
      const rowWrap = document.createElement("div");
      rowWrap.className = "custom-timeline-layer-row-wrap";
      rowWrap.style.position = "absolute";
      rowWrap.style.left = "0";
      rowWrap.style.top = `${index * LAYER_ROW_HEIGHT_PX}px`;
      rowWrap.style.height = `${LAYER_ROW_HEIGHT_PX}px`;
      rowWrap.style.width = `${width}px`;
      rowWrap.style.borderBottom = "1px solid var(--border)";

      const layerItems = state.items.filter((it) => it.layerId === layer.id);
      layerItems.forEach((it) => {
        if (it.kind === "event") {
          const left = (it.startSec - startSec) * pixelsPerSec;
          if (left < -20 || left > width + 20) return; // clip to visible
          const point = document.createElement("div");
          point.className = "custom-timeline-point";
          point.style.position = "absolute";
          point.style.left = `${left}px`;
          point.style.top = "50%";
          point.style.transform = "translate(-50%, -50%)";
          point.style.width = "8px";
          point.style.height = "16px";
          point.style.borderRadius = "2px";
          point.style.background = "var(--accent)";
          point.style.opacity = "0.8";
          point.dataset.itemId = it.id;
          rowWrap.appendChild(point);
        } else {
          // clip: range
          const left = (it.startSec - startSec) * pixelsPerSec;
          const endSecItem = it.endSec ?? it.startSec + 1;
          const w = (endSecItem - it.startSec) * pixelsPerSec;
          if (left + w < 0 || left > width) return;
          const range = document.createElement("div");
          range.className = "custom-timeline-range";
          range.style.position = "absolute";
          range.style.left = `${Math.max(0, left)}px`;
          range.style.top = "4px";
          range.style.height = "24px";
          range.style.width = `${Math.min(w, width - Math.max(0, left))}px`;
          range.style.borderRadius = "4px";
          range.style.background = "rgba(74, 125, 199, 0.35)";
          range.style.border = "1px solid var(--accent)";
          range.dataset.itemId = it.id;
          rowWrap.appendChild(range);
        }
      });

      layersContent.appendChild(rowWrap);
    });

    layersContent.appendChild(readheadLine);
    renderReadhead();
  }

  function update(): void {
    const state = getState();
    const onlyOne = state.layers.length <= 1;

    // Layer labels (left)
    layerLabelsList.innerHTML = "";
    state.layers.forEach((layer) => {
      layerLabelsList.appendChild(buildLayerLabelRow(layer, onlyOne));
    });

    renderRuler();
    renderLayers();
  }

  mountEl.innerHTML = "";
  mountEl.appendChild(root);
  update();

  return {
    update,
    getVisibleRange: () => ({ startSec, endSec }),
  };
}
