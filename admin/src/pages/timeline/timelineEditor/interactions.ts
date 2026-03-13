import {
  getScrollRangeRightSec,
  getViewportDurationSec,
  setStartSec,
  type ViewportItem,
  type TimelineViewportState,
} from "./timeline-viewport";
import { RANGE_MIN_WIDTH_PX, RANGE_HANDLE_HOVER_RADIUS_PX } from "./range/constants";
import { getLayerIdUnderClientY } from "./layer-from-position";

export interface HoverState {
  hoveredEventId: string | null;
  hoveredRangeEdge: { rangeId: string; side: "left" | "right" } | null;
}

export interface TimelineInteractionsState {
  layers: { id: string; label?: string }[];
  items: { id: string; kind: string; layerId?: string; startSec: number; endSec?: number }[];
}

export interface TimelineInteractionsCallbacks {
  onSelectItem: (id: string | null) => void;
  onMoveEvent?: (itemId: string, startSec: number) => void;
  onMoveRange?: (itemId: string, newStartSec: number) => void;
  onResizeRange?: (itemId: string, startSec: number, endSec: number) => void;
  onRangeDragStart?: (id: string) => void;
  onRangeDragEnd?: () => void;
  /** Move the dragged item to another layer (event or range body drag). */
  onMoveItemToLayer?: (itemId: string, layerId: string) => void;
}

export interface SetupTimelineInteractionsOptions {
  viewportWrap: HTMLElement;
  rightContent: HTMLElement;
  rulerWrap: HTMLElement;
  layersContent: HTMLElement;
  viewport: TimelineViewportState;
  itemsAsViewportItems: () => ViewportItem[];
  getState: () => TimelineInteractionsState;
  callbacks: TimelineInteractionsCallbacks;
  scheduleUpdate: () => void;
  getHoverState: () => HoverState;
  setHoverState: (state: HoverState) => void;
  onResizeStart: (rangeId: string, side: "left" | "right") => void;
  onResizeEnd: () => void;
  setEditingRangeId: (id: string | null) => void;
  /** Height in px of one layer row; used to map client Y to layer. */
  layerRowHeightPx: number;
  /** Called when viewport position/zoom changes (e.g. pan by drag). Use to persist viewport to storage. */
  onViewportChange?: () => void;
  /** Called once with startExternalRangeDrag so the view can hand off asset-drag to timeline range drag. */
  onRegisterExternalRangeDrag?: (fn: (itemId: string, clientX: number, clientY: number) => void) => void;
}

/** Find the nearest range edge (left or right) in the row under clientY; 1D X distance only. */
function getNearestRangeEdgeInRow(
  clientX: number,
  clientY: number,
  layersContent: HTMLElement
): { rangeId: string; side: "left" | "right"; distance: number } | null {
  const rows = layersContent.querySelectorAll(".custom-timeline-layer-row-wrap");
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (clientY < rect.top || clientY > rect.bottom) continue;
    const ranges = row.querySelectorAll(".custom-timeline-range");
    let best: { rangeId: string; side: "left" | "right"; distance: number } | null = null;
    for (const rangeEl of ranges) {
      const r = (rangeEl as HTMLElement).getBoundingClientRect();
      const rangeId = (rangeEl as HTMLElement).dataset.itemId;
      if (!rangeId) continue;
      const distLeft = Math.abs(clientX - r.left);
      const distRight = Math.abs(clientX - r.right);
      const candidate =
        distLeft <= distRight
          ? { rangeId, side: "left" as const, distance: distLeft }
          : { rangeId, side: "right" as const, distance: distRight };
      if (best === null || candidate.distance < best.distance) best = candidate;
    }
    return best;
  }
  return null;
}

export function setupTimelineInteractions(options: SetupTimelineInteractionsOptions): void {
  const {
    viewportWrap,
    rightContent,
    rulerWrap,
    layersContent,
    viewport,
    itemsAsViewportItems,
    getState,
    callbacks,
    scheduleUpdate,
    getHoverState,
    setHoverState,
    onResizeStart,
    onResizeEnd,
    setEditingRangeId,
    layerRowHeightPx,
    onViewportChange,
    onRegisterExternalRangeDrag,
  } = options;

  function startExternalRangeDrag(itemId: string, clientX: number, _clientY: number): void {
    const item = getState().items.find((i) => i.id === itemId);
    if (!item || item.kind !== "range") return;
    const endSec = item.endSec ?? item.startSec + 1;
    const durationSec = endSec - item.startSec;
    const rect = rightContent.getBoundingClientRect();
    const startSec = viewport.startSec + (clientX - rect.left) / viewport.pixelsPerSec;
    const scrollRange = getScrollRangeRightSec(viewport, itemsAsViewportItems());
    const clampedStartSec = Math.max(0, Math.min(scrollRange - durationSec, startSec));
    rangeDragItemId = itemId;
    rangeDragStartX = clientX;
    rangeDragStartSec = clampedStartSec;
    rangeDragDurationSec = durationSec;
    rangeDragging = true;
    didRangeDrag = false;
    callbacks.onSelectItem(itemId);
    callbacks.onRangeDragStart?.(itemId);
    setEditingRangeId(itemId);
    if (callbacks.onMoveRange) {
      callbacks.onMoveRange(itemId, clampedStartSec);
    }
    scheduleUpdate();
  }

  onRegisterExternalRangeDrag?.(startExternalRangeDrag);

  let panning = false;
  let panStartClientX = 0;
  let panStartSec = 0;
  let eventDragItemId: string | null = null;
  let eventDragStartX = 0;
  let eventDragging = false;
  let didEventDrag = false;
  let rangeDragItemId: string | null = null;
  let rangeDragStartX = 0;
  let rangeDragStartSec = 0;
  let rangeDragDurationSec = 0;
  let rangeDragging = false;
  let didRangeDrag = false;
  let resizeHandleSide: "left" | "right" | null = null;
  let resizeItemId: string | null = null;
  let resizeStartX = 0;
  let resizeStartSec = 0;
  let resizeEndSec = 0;
  let didRangeResize = false;

  viewportWrap.addEventListener("mousedown", (e) => {
    const eventEl = (e.target as HTMLElement)?.closest?.(".custom-timeline-event");
    const eventItemId = eventEl instanceof HTMLElement ? eventEl.dataset.itemId : undefined;
    if (eventItemId) {
      eventDragItemId = eventItemId;
      eventDragStartX = e.clientX;
      didEventDrag = false;
      return;
    }
    if (!eventItemId && callbacks.onResizeRange) {
      const nearest = getNearestRangeEdgeInRow(e.clientX, e.clientY, layersContent);
      if (
        nearest &&
        nearest.distance <= RANGE_HANDLE_HOVER_RADIUS_PX
      ) {
        const item = getState().items.find((it) => it.id === nearest.rangeId);
        if (item && item.kind === "range") {
          const endSec = item.endSec ?? item.startSec + 1;
          e.preventDefault();
          resizeHandleSide = nearest.side;
          resizeItemId = nearest.rangeId;
          resizeStartX = e.clientX;
          resizeStartSec = item.startSec;
          resizeEndSec = endSec;
          didRangeResize = false;
          callbacks.onSelectItem(nearest.rangeId);
          callbacks.onRangeDragStart?.(nearest.rangeId);
          onResizeStart(nearest.rangeId, nearest.side);
          setEditingRangeId(nearest.rangeId);
          return;
        }
      }
    }
    const rangeEl = (e.target as HTMLElement)?.closest?.(".custom-timeline-range");
    const rangeItemId = rangeEl instanceof HTMLElement ? rangeEl.dataset.itemId : undefined;
    if (rangeItemId && callbacks.onMoveRange) {
      const item = getState().items.find((it) => it.id === rangeItemId);
      if (item && item.kind === "range") {
        const endSec = item.endSec ?? item.startSec + 1;
        callbacks.onSelectItem(rangeItemId);
        setEditingRangeId(rangeItemId);
        rangeDragItemId = rangeItemId;
        rangeDragStartX = e.clientX;
        rangeDragStartSec = item.startSec;
        rangeDragDurationSec = endSec - item.startSec;
        didRangeDrag = false;
        callbacks.onRangeDragStart?.(rangeItemId);
        return;
      }
    }
    const onRuler = (e.target as HTMLElement)?.closest?.(".custom-timeline-ruler-wrap");
    if (!onRuler) return;
    e.preventDefault();
    panning = true;
    panStartClientX = e.clientX;
    panStartSec = viewport.startSec;
    rulerWrap.classList.add("custom-timeline-pan-cursor");
    viewportWrap.classList.add("custom-timeline-pan-cursor");
  });

  document.addEventListener("mousemove", (e) => {
    const minDurationSec = RANGE_MIN_WIDTH_PX / viewport.pixelsPerSec;
    if (resizeHandleSide !== null && resizeItemId != null && callbacks.onResizeRange) {
      const deltaPx = e.clientX - resizeStartX;
      const deltaSec = deltaPx / viewport.pixelsPerSec;
      if (resizeHandleSide === "left") {
        let newStartSec = resizeStartSec + deltaSec;
        newStartSec = Math.max(0, Math.min(resizeEndSec - minDurationSec, newStartSec));
        callbacks.onResizeRange(resizeItemId, newStartSec, resizeEndSec);
      } else {
        const scrollRange = getScrollRangeRightSec(viewport, itemsAsViewportItems());
        let newEndSec = resizeEndSec + deltaSec;
        newEndSec = Math.max(resizeStartSec + minDurationSec, Math.min(scrollRange, newEndSec));
        callbacks.onResizeRange(resizeItemId, resizeStartSec, newEndSec);
      }
      return;
    }
    if (eventDragItemId != null && callbacks.onMoveEvent) {
      if (!eventDragging && Math.abs(e.clientX - eventDragStartX) >= 5) {
        eventDragging = true;
        callbacks.onSelectItem(eventDragItemId);
      }
      if (eventDragging) {
        const state = getState();
        const targetLayerId = getLayerIdUnderClientY(
          e.clientY,
          layersContent,
          state.layers,
          layerRowHeightPx
        );
        if (
          targetLayerId != null &&
          callbacks.onMoveItemToLayer &&
          state.items.find((i) => i.id === eventDragItemId)?.layerId !== targetLayerId
        ) {
          callbacks.onMoveItemToLayer(eventDragItemId, targetLayerId);
          scheduleUpdate();
        }
        const rect = rightContent.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const newStartSec = viewport.startSec + x / viewport.pixelsPerSec;
        const scrollRange = getScrollRangeRightSec(viewport, itemsAsViewportItems());
        const clamped = Math.max(0, Math.min(scrollRange, newStartSec));
        callbacks.onMoveEvent(eventDragItemId, clamped);
      }
      return;
    }
    if (rangeDragItemId != null && callbacks.onMoveRange) {
      if (!rangeDragging && Math.abs(e.clientX - rangeDragStartX) >= 5) {
        rangeDragging = true;
        callbacks.onSelectItem(rangeDragItemId);
      }
      if (rangeDragging) {
        const state = getState();
        const targetLayerId = getLayerIdUnderClientY(
          e.clientY,
          layersContent,
          state.layers,
          layerRowHeightPx
        );
        if (
          targetLayerId != null &&
          callbacks.onMoveItemToLayer &&
          state.items.find((i) => i.id === rangeDragItemId)?.layerId !== targetLayerId
        ) {
          callbacks.onMoveItemToLayer(rangeDragItemId, targetLayerId);
          scheduleUpdate();
        }
        const deltaPx = e.clientX - rangeDragStartX;
        const deltaSec = deltaPx / viewport.pixelsPerSec;
        const scrollRange = getScrollRangeRightSec(viewport, itemsAsViewportItems());
        const maxStart = Math.max(0, scrollRange - rangeDragDurationSec);
        const newStartSec = Math.max(0, Math.min(maxStart, rangeDragStartSec + deltaSec));
        callbacks.onMoveRange(rangeDragItemId, newStartSec);
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
    onViewportChange?.();
    scheduleUpdate();
  });

  document.addEventListener("mouseup", () => {
    if (resizeHandleSide !== null) {
      if (resizeItemId != null) didRangeResize = true;
      callbacks.onRangeDragEnd?.();
      onResizeEnd();
      setEditingRangeId(null);
      resizeHandleSide = null;
      resizeItemId = null;
    }
    if (eventDragItemId != null) {
      if (eventDragging) didEventDrag = true;
      eventDragItemId = null;
      eventDragging = false;
    }
    if (rangeDragItemId != null) {
      if (rangeDragging) didRangeDrag = true;
      callbacks.onRangeDragEnd?.();
      setEditingRangeId(null);
      rangeDragItemId = null;
      rangeDragging = false;
    }
    if (panning) {
      panning = false;
      rulerWrap.classList.remove("custom-timeline-pan-cursor");
      viewportWrap.classList.remove("custom-timeline-pan-cursor");
    }
  });

  document.addEventListener("mouseleave", () => {
    if (resizeHandleSide !== null) {
      if (resizeItemId != null) didRangeResize = true;
      callbacks.onRangeDragEnd?.();
      onResizeEnd();
      setEditingRangeId(null);
      resizeHandleSide = null;
      resizeItemId = null;
    }
    if (eventDragItemId != null) {
      if (eventDragging) didEventDrag = true;
      eventDragItemId = null;
      eventDragging = false;
    }
    if (rangeDragItemId != null) {
      if (rangeDragging) didRangeDrag = true;
      callbacks.onRangeDragEnd?.();
      setEditingRangeId(null);
      rangeDragItemId = null;
      rangeDragging = false;
    }
    if (panning) {
      panning = false;
      rulerWrap.classList.remove("custom-timeline-pan-cursor");
      viewportWrap.classList.remove("custom-timeline-pan-cursor");
    }
  });

  layersContent.addEventListener("mousemove", (e) => {
    if (resizeHandleSide != null || rangeDragItemId != null || eventDragItemId != null) return;
    const under = document.elementsFromPoint(e.clientX, e.clientY);
    const eventEl = under.find((el) => el instanceof HTMLElement && el.classList?.contains("custom-timeline-event"));
    if (eventEl instanceof HTMLElement) {
      const eventId = eventEl.dataset.itemId ?? null;
      const cur = getHoverState();
      if (cur.hoveredEventId !== eventId || cur.hoveredRangeEdge !== null) {
        setHoverState({ hoveredEventId: eventId, hoveredRangeEdge: null });
        scheduleUpdate();
      }
      viewportWrap.style.cursor = "pointer";
      return;
    }
    const nearest = getNearestRangeEdgeInRow(e.clientX, e.clientY, layersContent);
    if (nearest && nearest.distance <= RANGE_HANDLE_HOVER_RADIUS_PX) {
      const nextHover = { hoveredEventId: null as string | null, hoveredRangeEdge: { rangeId: nearest.rangeId, side: nearest.side } };
      const cur = getHoverState();
      if (
        cur.hoveredEventId !== null ||
        cur.hoveredRangeEdge?.rangeId !== nextHover.hoveredRangeEdge?.rangeId ||
        cur.hoveredRangeEdge?.side !== nextHover.hoveredRangeEdge?.side
      ) {
        setHoverState(nextHover);
        scheduleUpdate();
      }
      viewportWrap.style.cursor = "ew-resize";
      return;
    }
    const rangeEl = under.find((el) => el instanceof HTMLElement && el.classList?.contains("custom-timeline-range"));
    if (rangeEl instanceof HTMLElement) {
      const cur = getHoverState();
      if (cur.hoveredEventId !== null || cur.hoveredRangeEdge !== null) {
        setHoverState({ hoveredEventId: null, hoveredRangeEdge: null });
        scheduleUpdate();
      }
      viewportWrap.style.cursor = "pointer";
      return;
    }
    const cur = getHoverState();
    if (cur.hoveredEventId !== null || cur.hoveredRangeEdge !== null) {
      setHoverState({ hoveredEventId: null, hoveredRangeEdge: null });
      scheduleUpdate();
    }
    viewportWrap.style.cursor = "default";
  });

  layersContent.addEventListener("mouseleave", () => {
    setHoverState({ hoveredEventId: null, hoveredRangeEdge: null });
    viewportWrap.style.cursor = "";
    scheduleUpdate();
  });

  layersContent.addEventListener("click", (e) => {
    const eventEl = (e.target as HTMLElement)?.closest?.(".custom-timeline-event");
    const eventItemId = eventEl instanceof HTMLElement ? eventEl.dataset.itemId : undefined;
    if (eventItemId) {
      e.preventDefault();
      e.stopPropagation();
      if (didEventDrag) {
        didEventDrag = false;
        return;
      }
      callbacks.onSelectItem(eventItemId);
      return;
    }
    const rangeEl = (e.target as HTMLElement)?.closest?.(".custom-timeline-range");
    const rangeItemId = rangeEl instanceof HTMLElement ? rangeEl.dataset.itemId : undefined;
    if (rangeItemId) {
      e.preventDefault();
      e.stopPropagation();
      if (didRangeDrag || didRangeResize) {
        didRangeDrag = false;
        didRangeResize = false;
        return;
      }
      callbacks.onSelectItem(rangeItemId);
      return;
    }
    callbacks.onSelectItem(null);
  });
}
