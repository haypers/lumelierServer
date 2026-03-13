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
import { buildLayerLabelRow } from "./layer-labels";
import { createReadheadElement, renderReadhead as renderReadheadUpdate } from "./readhead";
import { setupTimelineInteractions } from "./interactions";
import {
  LAYER_LABELS_WIDTH_PX,
  RULER_HEIGHT_PX,
  LAYER_ROW_HEIGHT_PX,
  DEFAULT_PIXELS_PER_SEC,
  ZOOM_MIN_PX_PER_SEC,
  ZOOM_MAX_PX_PER_SEC,
  READHEAD_HIT_WIDTH_PX,
  WHEEL_DELTA_PER_CLICK,
  HORIZONTAL_SCROLLBAR_HEIGHT_PX,
} from "./constants";

export interface CustomTimelineState {
  layers: TimelineStateJSON["layers"];
  items: TimelineStateJSON["items"];
  readheadSec: number;
  selectedItemId: string | null;
  draggingRangeId: string | null;
  readheadDraggable: boolean;
}

export interface CustomTimelineCallbacks {
  onAddLayer: () => void;
  onRemoveLayer: (id: string) => void;
  onRenameLayer: (id: string, label: string) => void;
  onSelectItem: (id: string | null) => void;
  onReadheadChange: (sec: number) => void;
  onMoveEvent?: (itemId: string, startSec: number) => void;
  onMoveRange?: (itemId: string, newStartSec: number) => void;
  onResizeRange?: (itemId: string, startSec: number, endSec: number) => void;
  onRangeDragStart?: (id: string) => void;
  onRangeDragEnd?: () => void;
}

export interface CustomTimelineView {
  update: () => void;
  /** Schedule at most one update on the next frame (use for scroll, drag, resize to avoid jitter). */
  scheduleUpdate: () => void;
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

  const { element: readheadLine, innerLine: readheadLineInner } = createReadheadElement();

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
    scheduleUpdate();
  }

  // Pan by wheel (no shift): vertical = 1/6 tick step per click; horizontal = deltaX pixels; zoom with shift+wheel
  viewportWrap.addEventListener("wheel", (e) => {
    if (e.shiftKey) {
      e.preventDefault();
      const rect = viewportWrap.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      zoomAtCursor(viewport, cursorX, e.deltaY, ZOOM_MIN_PX_PER_SEC, ZOOM_MAX_PX_PER_SEC);
      scheduleUpdate();
      return;
    }
    const viewportDurationSec = getViewportDurationSec(viewport);
    const tickStep = getTickStepForRange(viewportDurationSec);
    const deltaSecY = (tickStep / 6) * (e.deltaY / WHEEL_DELTA_PER_CLICK);
    const deltaSecX = -e.deltaX / viewport.pixelsPerSec;
    const deltaSec = deltaSecY + deltaSecX;
    if (deltaSec === 0) return;
    e.preventDefault();
    const scrollRange = getScrollRangeRightSec(viewport, itemsAsViewportItems());
    const duration = getViewportDurationSec(viewport);
    const maxStart = Math.max(0, scrollRange - duration);
    const newStart = Math.max(0, Math.min(maxStart, viewport.startSec - deltaSec));
    setStartSec(viewport, newStart);
    scheduleUpdate();
  }, { passive: false });

  const hoverStateRef: { current: { hoveredEventId: string | null; hoveredRangeEdge: { rangeId: string; side: "left" | "right" } | null } } = {
    current: { hoveredEventId: null, hoveredRangeEdge: null },
  };
  const resizeStateRef: { current: { rangeId: string | null; edge: "left" | "right" | null } } = {
    current: { rangeId: null, edge: null },
  };

  setupTimelineInteractions({
    viewportWrap,
    rightContent,
    rulerWrap,
    layersContent,
    viewport,
    itemsAsViewportItems,
    getState,
    callbacks: {
      onSelectItem: callbacks.onSelectItem,
      onMoveEvent: callbacks.onMoveEvent,
      onMoveRange: callbacks.onMoveRange,
      onResizeRange: callbacks.onResizeRange,
      onRangeDragStart: callbacks.onRangeDragStart,
      onRangeDragEnd: callbacks.onRangeDragEnd,
    },
    scheduleUpdate,
    getHoverState: () => hoverStateRef.current,
    setHoverState: (state) => {
      hoverStateRef.current = state;
      scheduleUpdate();
    },
    onResizeStart: (rangeId, side) => {
      resizeStateRef.current = { rangeId, edge: side };
      scheduleUpdate();
    },
    onResizeEnd: () => {
      resizeStateRef.current = { rangeId: null, edge: null };
      scheduleUpdate();
    },
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
    const deltaSec = (e.clientX - readheadDragStartX) / viewport.pixelsPerSec;
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

  function renderRuler(startSec: number, endSec: number, viewportWidthPx: number): void {
    if (viewportWidthPx <= 0) return;
    renderRulerTicks(rulerCanvas, startSec, endSec, viewport.pixelsPerSec, viewportWidthPx);
  }

  function renderReadhead(): void {
    renderReadheadUpdate(readheadLine, readheadLineInner, getState, viewport, READHEAD_HIT_WIDTH_PX);
  }

  let lastRulerKey: { startSec: number; endSec: number; pixelsPerSec: number; viewportWidthPx: number } | null = null;
  let lastLayersKey: {
    startSec: number;
    endSec: number;
    viewportWidthPx: number;
    visibleIds: string;
    contentKey: string;
    selectedItemId: string | null;
    draggingRangeId: string | null;
    layersLength: number;
    hoverKey: string;
    resizeKey: string;
  } | null = null;

  function update(): void {
    const state = getState();
    const onlyOne = state.layers.length <= 1;

    // Use parent width as source of truth so we pick up new size when column grows (rightContent has fixed width from last run)
    let viewportWidthPx = viewportWrap.clientWidth || rightCol.clientWidth;
    if (viewportWidthPx <= 0) viewportWidthPx = rightContent.clientWidth;
    setViewportWidthPx(viewport, viewportWidthPx);

    rightContent.style.width = viewportWidthPx > 0 ? `${viewportWidthPx}px` : "100%";

    layerLabelsList.innerHTML = "";
    state.layers.forEach((layer) => {
      layerLabelsList.appendChild(
        buildLayerLabelRow(layer, onlyOne, LAYER_ROW_HEIGHT_PX, {
          onRemoveLayer: callbacks.onRemoveLayer,
          onRenameLayer: callbacks.onRenameLayer,
        })
      );
    });

    const { startSec, endSec } = getVisibleRange(viewport);
    const viewportDurationSec = endSec - startSec;
    const marginSec = Math.min(10, Math.max(2, viewportDurationSec * 0.15));
    const visibleItems = getVisibleItems(state.items, startSec, endSec, marginSec);

    const rulerChanged =
      lastRulerKey === null ||
      lastRulerKey.startSec !== startSec ||
      lastRulerKey.endSec !== endSec ||
      lastRulerKey.pixelsPerSec !== viewport.pixelsPerSec ||
      lastRulerKey.viewportWidthPx !== viewportWidthPx;
    if (rulerChanged) {
      renderRuler(startSec, endSec, viewportWidthPx);
      lastRulerKey = { startSec, endSec, pixelsPerSec: viewport.pixelsPerSec, viewportWidthPx };
    }

    const totalHeight = state.layers.length * LAYER_ROW_HEIGHT_PX;
    layerLabelsList.style.minHeight = `${totalHeight}px`;
    layersContent.style.height = `${totalHeight}px`;
    readheadLine.style.height = `${RULER_HEIGHT_PX + totalHeight}px`;

    const visibleIds = visibleItems.map((i) => i.id).sort().join(",");
    const contentKey = visibleItems
      .map((i) => `${i.id}:${i.startSec}:${i.endSec ?? i.startSec}:${i.layerId}`)
      .sort()
      .join(",");
    const hoverState = hoverStateRef.current;
    const resizeState = resizeStateRef.current;
    const hoverKey = `${hoverState.hoveredEventId ?? ""}|${hoverState.hoveredRangeEdge?.rangeId ?? ""}|${hoverState.hoveredRangeEdge?.side ?? ""}`;
    const resizeKey = `${resizeState.rangeId ?? ""}|${resizeState.edge ?? ""}`;
    const layersChanged =
      lastLayersKey === null ||
      lastLayersKey.startSec !== startSec ||
      lastLayersKey.endSec !== endSec ||
      lastLayersKey.viewportWidthPx !== viewportWidthPx ||
      lastLayersKey.visibleIds !== visibleIds ||
      lastLayersKey.contentKey !== contentKey ||
      lastLayersKey.selectedItemId !== state.selectedItemId ||
      lastLayersKey.draggingRangeId !== state.draggingRangeId ||
      lastLayersKey.layersLength !== state.layers.length ||
      lastLayersKey.hoverKey !== hoverKey ||
      lastLayersKey.resizeKey !== resizeKey;
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
        state.draggingRangeId,
        hoverState,
        resizeState
      );
      lastLayersKey = {
        startSec,
        endSec,
        viewportWidthPx,
        visibleIds,
        contentKey,
        selectedItemId: state.selectedItemId,
        draggingRangeId: state.draggingRangeId,
        layersLength: state.layers.length,
        hoverKey,
        resizeKey,
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

  const resizeObserver = new ResizeObserver(() => scheduleUpdate());
  resizeObserver.observe(rightContent);
  resizeObserver.observe(viewportWrap);
  resizeObserver.observe(rightCol);

  return {
    update,
    scheduleUpdate,
    getVisibleRange: () => getVisibleRange(viewport),
  };
}
