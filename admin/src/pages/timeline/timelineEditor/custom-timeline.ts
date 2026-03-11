import trashIcon from "../../../icons/trash.svg?raw";
import type { TimelineStateJSON } from "../types";
import {
  createViewportState,
  getVisibleRange,
  getViewportDurationSec,
  getScrollRangeRightSec,
  setStartSec,
  setViewportWidthPx,
  zoomAtCursor,
  type ViewportItem,
} from "./timeline-viewport";
import { renderRuler as renderRulerTicks, getTickStepForRange } from "./timeline-ruler";
import { getVisibleItems } from "./timeline-visible-events";
import { renderVirtualizedLayers } from "./timeline-layers-render";
import { createCustomScrollbar } from "./timeline-custom-scrollbar";

const LAYER_LABELS_WIDTH_PX = 180;
const RULER_HEIGHT_PX = 40;
const LAYER_ROW_HEIGHT_PX = 32;
const DEFAULT_PIXELS_PER_SEC = 20;
const ZOOM_MIN_PX_PER_SEC = 5;
const ZOOM_MAX_PX_PER_SEC = 200;
const READHEAD_HIT_WIDTH_PX = 10;
const WHEEL_DELTA_PER_CLICK = 100;
const HORIZONTAL_SCROLLBAR_HEIGHT_PX = 18;

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export interface CustomTimelineState {
  layers: TimelineStateJSON["layers"];
  items: TimelineStateJSON["items"];
  readheadSec: number;
  selectedItemId: string | null;
  readheadDraggable: boolean;
}

export interface CustomTimelineCallbacks {
  onAddLayer: () => void;
  onRemoveLayer: (id: string) => void;
  onRenameLayer: (id: string, label: string) => void;
  onSelectItem: (id: string | null) => void;
  onReadheadChange: (sec: number) => void;
  onMoveEvent?: (itemId: string, startSec: number) => void;
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
  const viewport = createViewportState(DEFAULT_PIXELS_PER_SEC);
  const itemsAsViewportItems = (): ViewportItem[] =>
    getState().items.map((it) => ({ startSec: it.startSec, endSec: it.endSec }));

  const root = document.createElement("div");
  root.className = "custom-timeline";
  root.style.display = "flex";
  root.style.flexDirection = "row";
  root.style.height = "100%";
  root.style.minHeight = "0";
  root.style.overflow = "hidden";
  root.style.userSelect = "none";
  root.style.webkitUserSelect = "none";

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

  const labelsScrollbarSpacer = document.createElement("div");
  labelsScrollbarSpacer.className = "custom-timeline-labels-scrollbar-spacer";
  labelsScrollbarSpacer.style.height = `${HORIZONTAL_SCROLLBAR_HEIGHT_PX}px`;
  labelsScrollbarSpacer.style.minHeight = `${HORIZONTAL_SCROLLBAR_HEIGHT_PX}px`;
  labelsScrollbarSpacer.style.flexShrink = "0";

  leftCol.appendChild(rulerSpacer);
  leftCol.appendChild(layerLabelsScroll);
  layerLabelsScroll.appendChild(layerLabelsList);
  leftCol.appendChild(labelsScrollbarSpacer);

  // —— Right column: viewport (ruler + layers) + custom scrollbar; no native horizontal scroll
  const rightCol = document.createElement("div");
  rightCol.className = "custom-timeline-right";
  rightCol.style.flex = "1";
  rightCol.style.minWidth = "0";
  rightCol.style.height = "100%";
  rightCol.style.display = "flex";
  rightCol.style.flexDirection = "column";
  rightCol.style.overflow = "hidden";
  rightCol.style.userSelect = "none";
  rightCol.style.webkitUserSelect = "none";

  const viewportWrap = document.createElement("div");
  viewportWrap.className = "custom-timeline-viewport-wrap";
  viewportWrap.style.flex = "1";
  viewportWrap.style.minHeight = "0";
  viewportWrap.style.overflow = "hidden";
  viewportWrap.style.display = "flex";
  viewportWrap.style.flexDirection = "column";

  const rightContent = document.createElement("div");
  rightContent.className = "custom-timeline-right-content";
  rightContent.style.position = "relative";
  rightContent.style.flex = "1";
  rightContent.style.minHeight = "0";
  rightContent.style.overflow = "hidden";

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

  const layersContent = document.createElement("div");
  layersContent.className = "custom-timeline-layers";
  layersContent.style.position = "relative";
  layersContent.style.flex = "1";
  layersContent.style.minHeight = "0";
  layersContent.style.overflowY = "auto";
  layersContent.style.overflowX = "hidden";

  const readheadLine = document.createElement("div");
  readheadLine.className = "custom-timeline-readhead";
  readheadLine.setAttribute("aria-hidden", "true");
  const readheadLineInner = document.createElement("div");
  readheadLineInner.className = "custom-timeline-readhead-line";
  readheadLineInner.style.position = "absolute";
  readheadLineInner.style.left = "50%";
  readheadLineInner.style.top = "0";
  readheadLineInner.style.bottom = "0";
  readheadLineInner.style.width = "2px";
  readheadLineInner.style.transform = "translateX(-50%)";
  readheadLineInner.style.background = "var(--accent)";
  readheadLineInner.style.pointerEvents = "none";
  readheadLine.appendChild(readheadLineInner);

  const scrollbarContainer = document.createElement("div");
  scrollbarContainer.className = "custom-timeline-scrollbar-container";
  scrollbarContainer.style.flexShrink = "0";
  scrollbarContainer.style.padding = "4px 0";

  viewportWrap.appendChild(rightContent);
  rightContent.appendChild(rulerWrap);
  rulerWrap.appendChild(rulerCanvas);
  rightContent.appendChild(layersContent);
  rightContent.appendChild(readheadLine);
  rightCol.appendChild(viewportWrap);
  rightCol.appendChild(scrollbarContainer);

  root.appendChild(leftCol);
  root.appendChild(rightCol);

  // Sync vertical scroll: layers scroll drives left labels
  layersContent.addEventListener("scroll", () => {
    layerLabelsScroll.scrollTop = layersContent.scrollTop;
  });
  layerLabelsScroll.addEventListener("scroll", () => {
    layersContent.scrollTop = layerLabelsScroll.scrollTop;
  });

  let scrollbarApi: { update: (opts: Partial<Parameters<typeof createCustomScrollbar>[1]>) => void } | null = null;

  let updateScheduled = false;
  function scheduleUpdate(): void {
    if (updateScheduled) return;
    updateScheduled = true;
    requestAnimationFrame(() => {
      updateScheduled = false;
      update();
    });
  }

  function handleScroll(sec: number): void {
    const scrollRange = getScrollRangeRightSec(viewport, itemsAsViewportItems());
    const duration = getViewportDurationSec(viewport);
    const maxStart = Math.max(0, scrollRange - duration);
    setStartSec(viewport, Math.max(0, Math.min(maxStart, sec)));
    update();
  }

  // Pan by wheel (no shift): one "click" = 1/6 tick step in time; zoom with shift+wheel
  viewportWrap.addEventListener("wheel", (e) => {
    if (e.shiftKey) {
      e.preventDefault();
      const rect = viewportWrap.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      zoomAtCursor(viewport, cursorX, e.deltaY, ZOOM_MIN_PX_PER_SEC, ZOOM_MAX_PX_PER_SEC);
      scheduleUpdate();
      return;
    }
    e.preventDefault();
    const viewportDurationSec = getViewportDurationSec(viewport);
    const tickStep = getTickStepForRange(viewportDurationSec);
    const deltaSec = (tickStep / 6) * (e.deltaY / WHEEL_DELTA_PER_CLICK);
    const scrollRange = getScrollRangeRightSec(viewport, itemsAsViewportItems());
    const duration = getViewportDurationSec(viewport);
    const maxStart = Math.max(0, scrollRange - duration);
    const newStart = Math.max(0, Math.min(maxStart, viewport.startSec - deltaSec));
    setStartSec(viewport, newStart);
    scheduleUpdate();
  }, { passive: false });

  // Pan by drag on background; preventDefault to avoid text selection
  let panning = false;
  let panStartClientX = 0;
  let panStartSec = 0;
  function isPanTarget(el: EventTarget | null): boolean {
    if (!el || !(el instanceof HTMLElement)) return true;
    const t = el as HTMLElement;
    return !t.closest(".custom-timeline-event, .custom-timeline-range, .custom-timeline-readhead, .custom-timeline-scrollbar-track");
  }
  // Event drag: mousedown on event starts drag; do not start pan
  let eventDragItemId: string | null = null;
  let eventDragStartX = 0;
  let eventDragging = false;
  let didEventDrag = false;

  viewportWrap.addEventListener("mousedown", (e) => {
    const eventEl = (e.target as HTMLElement)?.closest?.(".custom-timeline-event");
    const itemId = eventEl instanceof HTMLElement ? eventEl.dataset.itemId : undefined;
    if (itemId) {
      eventDragItemId = itemId;
      eventDragStartX = e.clientX;
      didEventDrag = false;
      return;
    }
    if (!isPanTarget(e.target)) return;
    e.preventDefault();
    panning = true;
    panStartClientX = e.clientX;
    panStartSec = viewport.startSec;
    viewportWrap.classList.add("custom-timeline-pan-cursor");
  });
  document.addEventListener("mousemove", (e) => {
    if (eventDragItemId != null && callbacks.onMoveEvent) {
      if (!eventDragging && Math.abs(e.clientX - eventDragStartX) >= 5) {
        eventDragging = true;
        callbacks.onSelectItem(eventDragItemId);
      }
      if (eventDragging) {
        const rect = rightContent.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const newStartSec = viewport.startSec + x / viewport.pixelsPerSec;
        const scrollRange = getScrollRangeRightSec(viewport, itemsAsViewportItems());
        const clamped = Math.max(0, Math.min(scrollRange, newStartSec));
        callbacks.onMoveEvent(eventDragItemId, clamped);
      }
      return;
    }
    if (!panning) return;
    const deltaPx = panStartClientX - e.clientX;
    const deltaSec = deltaPx / viewport.pixelsPerSec;
    const scrollRange = getScrollRangeRightSec(viewport, itemsAsViewportItems());
    const duration = getViewportDurationSec(viewport);
    const maxStart = Math.max(0, scrollRange - duration);
    const newStart = Math.max(0, Math.min(maxStart, panStartSec + deltaSec));
    setStartSec(viewport, newStart);
    scheduleUpdate();
  });
  document.addEventListener("mouseup", () => {
    if (eventDragItemId != null) {
      if (eventDragging) didEventDrag = true;
      eventDragItemId = null;
      eventDragging = false;
    }
    if (panning) {
      panning = false;
      viewportWrap.classList.remove("custom-timeline-pan-cursor");
    }
  });
  document.addEventListener("mouseleave", () => {
    if (eventDragItemId != null) {
      if (eventDragging) didEventDrag = true;
      eventDragItemId = null;
      eventDragging = false;
    }
    if (panning) {
      panning = false;
      viewportWrap.classList.remove("custom-timeline-pan-cursor");
    }
  });

  layersContent.addEventListener("click", (e) => {
    const eventEl = (e.target as HTMLElement)?.closest?.(".custom-timeline-event");
    const itemId = eventEl instanceof HTMLElement ? eventEl.dataset.itemId : undefined;
    if (!itemId) return;
    e.preventDefault();
    e.stopPropagation();
    if (didEventDrag) {
      didEventDrag = false;
      return;
    }
    callbacks.onSelectItem(itemId);
  });

  // Readhead drag
  let readheadDragging = false;
  let readheadDragStartX = 0;
  let readheadDragStartSec = 0;
  readheadLine.addEventListener("mousedown", (e) => {
    const state = getState();
    if (!state.readheadDraggable) return;
    e.stopPropagation();
    readheadDragging = true;
    readheadDragStartX = e.clientX;
    readheadDragStartSec = state.readheadSec;
  });
  document.addEventListener("mousemove", (e) => {
    if (!readheadDragging) return;
    const deltaSec = (readheadDragStartX - e.clientX) / viewport.pixelsPerSec;
    const scrollRange = getScrollRangeRightSec(viewport, itemsAsViewportItems());
    let newSec = readheadDragStartSec + deltaSec;
    newSec = Math.max(0, Math.min(scrollRange, newSec));
    callbacks.onReadheadChange(newSec);
  });
  document.addEventListener("mouseup", () => {
    readheadDragging = false;
  });
  document.addEventListener("mouseleave", () => {
    readheadDragging = false;
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
        removeClickOutsideListener();
      };
      const removeClickOutsideListener = () => {
        document.removeEventListener("mousedown", clickOutsideHandler);
      };
      const clickOutsideHandler = (ev: MouseEvent) => {
        if (document.activeElement !== input) return;
        if (wrap.contains(ev.target as Node)) return;
        commit();
        input.blur();
      };
      document.addEventListener("mousedown", clickOutsideHandler);
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          input.blur();
        }
        if (ev.key === "Escape") {
          removeClickOutsideListener();
          wrap.replaceChild(nameEl, input);
        }
      });
      wrap.replaceChild(input, nameEl);
      input.focus();
      input.select();
    });

    return wrap;
  }

  function renderRuler(startSec: number, endSec: number, viewportWidthPx: number): void {
    if (viewportWidthPx <= 0) return;
    renderRulerTicks(rulerCanvas, startSec, endSec, viewport.pixelsPerSec, viewportWidthPx);
  }

  function renderReadhead(): void {
    const state = getState();
    const { startSec, endSec } = getVisibleRange(viewport);
    const viewportWidthPx = viewport.viewportWidthPx || 0;
    if (viewportWidthPx <= 0) return;
    const x = (state.readheadSec - startSec) * viewport.pixelsPerSec;
    const inView = state.readheadSec >= startSec && state.readheadSec <= endSec;
    readheadLine.style.left = `${x}px`;
    readheadLine.style.position = "absolute";
    readheadLine.style.top = "0";
    readheadLine.style.width = "2px";
    readheadLine.style.background = "var(--accent)";
    readheadLine.style.zIndex = "10";
    readheadLine.style.visibility = inView ? "visible" : "hidden";
    if (state.readheadDraggable) {
      readheadLine.classList.add("custom-timeline-readhead--draggable");
      readheadLine.style.pointerEvents = "auto";
      readheadLine.style.cursor = "ew-resize";
      readheadLine.style.width = `${READHEAD_HIT_WIDTH_PX}px`;
      readheadLine.style.marginLeft = `${-READHEAD_HIT_WIDTH_PX / 2}px`;
      readheadLine.style.background = "transparent";
      readheadLineInner.style.display = "";
    } else {
      readheadLine.classList.remove("custom-timeline-readhead--draggable");
      readheadLine.style.pointerEvents = "none";
      readheadLine.style.cursor = "";
      readheadLine.style.width = "2px";
      readheadLine.style.marginLeft = "0";
      readheadLine.style.background = "var(--accent)";
      readheadLineInner.style.display = "none";
    }
  }

  let lastRulerKey: { startSec: number; endSec: number; pixelsPerSec: number } | null = null;
  let lastLayersKey: {
    startSec: number;
    endSec: number;
    viewportWidthPx: number;
    visibleIds: string;
    contentKey: string;
    selectedItemId: string | null;
    layersLength: number;
  } | null = null;

  function update(): void {
    const state = getState();
    const onlyOne = state.layers.length <= 1;

    // Use rightContent width when available; fallback to parent widths so we don't collapse to 0 on first paint
    let viewportWidthPx = rightContent.clientWidth;
    if (viewportWidthPx <= 0) viewportWidthPx = viewportWrap.clientWidth;
    if (viewportWidthPx <= 0) viewportWidthPx = rightCol.clientWidth;
    setViewportWidthPx(viewport, viewportWidthPx);

    rightContent.style.width = viewportWidthPx > 0 ? `${viewportWidthPx}px` : "100%";

    layerLabelsList.innerHTML = "";
    state.layers.forEach((layer) => {
      layerLabelsList.appendChild(buildLayerLabelRow(layer, onlyOne));
    });

    const { startSec, endSec } = getVisibleRange(viewport);
    const viewportDurationSec = endSec - startSec;
    const marginSec = Math.min(10, Math.max(2, viewportDurationSec * 0.15));
    const visibleItems = getVisibleItems(state.items, startSec, endSec, marginSec);

    const rulerChanged =
      lastRulerKey === null ||
      lastRulerKey.startSec !== startSec ||
      lastRulerKey.endSec !== endSec ||
      lastRulerKey.pixelsPerSec !== viewport.pixelsPerSec;
    if (rulerChanged) {
      renderRuler(startSec, endSec, viewportWidthPx);
      lastRulerKey = { startSec, endSec, pixelsPerSec: viewport.pixelsPerSec };
    }

    const totalHeight = state.layers.length * LAYER_ROW_HEIGHT_PX;
    layerLabelsList.style.minHeight = `${totalHeight}px`;
    layersContent.style.height = `${totalHeight}px`;
    readheadLine.style.height = `${RULER_HEIGHT_PX + totalHeight}px`;

    const visibleIds = visibleItems.map((i) => i.id).sort().join(",");
    const contentKey = visibleItems
      .map((i) => `${i.id}:${i.startSec}:${i.layerId}`)
      .sort()
      .join(",");
    const layersChanged =
      lastLayersKey === null ||
      lastLayersKey.startSec !== startSec ||
      lastLayersKey.endSec !== endSec ||
      lastLayersKey.viewportWidthPx !== viewportWidthPx ||
      lastLayersKey.visibleIds !== visibleIds ||
      lastLayersKey.contentKey !== contentKey ||
      lastLayersKey.selectedItemId !== state.selectedItemId ||
      lastLayersKey.layersLength !== state.layers.length;
    if (layersChanged && viewportWidthPx > 0) {
      renderVirtualizedLayers(
        layersContent,
        state.layers,
        visibleItems,
        startSec,
        viewport.pixelsPerSec,
        viewportWidthPx,
        LAYER_ROW_HEIGHT_PX,
        state.selectedItemId,
        { onSelectItem: (id) => callbacks.onSelectItem(id) }
      );
      lastLayersKey = {
        startSec,
        endSec,
        viewportWidthPx,
        visibleIds,
        contentKey,
        selectedItemId: state.selectedItemId,
        layersLength: state.layers.length,
      };
    }

    renderReadhead();

    const scrollRange = getScrollRangeRightSec(viewport, itemsAsViewportItems());
    const duration = getViewportDurationSec(viewport);
    const trackWidth = scrollbarContainer.clientWidth || viewportWidthPx;

    if (!scrollbarApi) {
      scrollbarApi = createCustomScrollbar(scrollbarContainer, {
        trackWidthPx: trackWidth,
        scrollRangeRightSec: scrollRange,
        startSec: viewport.startSec,
        viewportDurationSec: duration,
        onScroll: handleScroll,
      });
    } else {
      scrollbarApi.update({
        trackWidthPx: trackWidth,
        scrollRangeRightSec: scrollRange,
        startSec: viewport.startSec,
        viewportDurationSec: duration,
      });
    }
  }

  mountEl.innerHTML = "";
  mountEl.appendChild(root);
  update();
  requestAnimationFrame(() => update());

  const resizeObserver = new ResizeObserver(() => update());
  resizeObserver.observe(rightContent);
  resizeObserver.observe(viewportWrap);

  return {
    update,
    getVisibleRange: () => getVisibleRange(viewport),
  };
}
