import {
  getScrollRangeRightSec,
  getViewportDurationSec,
  setStartSec,
  type ViewportItem,
  type TimelineViewportState,
} from "./timeline-viewport";

export interface TimelineInteractionsState {
  items: { id: string; kind: string; startSec: number; endSec?: number }[];
}

export interface TimelineInteractionsCallbacks {
  onSelectItem: (id: string | null) => void;
  onMoveEvent?: (itemId: string, startSec: number) => void;
  onMoveRange?: (itemId: string, newStartSec: number) => void;
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
  } = options;

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

  viewportWrap.addEventListener("mousedown", (e) => {
    const eventEl = (e.target as HTMLElement)?.closest?.(".custom-timeline-event");
    const eventItemId = eventEl instanceof HTMLElement ? eventEl.dataset.itemId : undefined;
    if (eventItemId) {
      eventDragItemId = eventItemId;
      eventDragStartX = e.clientX;
      didEventDrag = false;
      return;
    }
    const rangeEl = (e.target as HTMLElement)?.closest?.(".custom-timeline-range");
    const rangeItemId = rangeEl instanceof HTMLElement ? rangeEl.dataset.itemId : undefined;
    if (rangeItemId && callbacks.onMoveRange) {
      const item = getState().items.find((it) => it.id === rangeItemId);
      if (item && item.kind === "range") {
        const endSec = item.endSec ?? item.startSec + 1;
        rangeDragItemId = rangeItemId;
        rangeDragStartX = e.clientX;
        rangeDragStartSec = item.startSec;
        rangeDragDurationSec = endSec - item.startSec;
        didRangeDrag = false;
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
    if (rangeDragItemId != null && callbacks.onMoveRange) {
      if (!rangeDragging && Math.abs(e.clientX - rangeDragStartX) >= 5) {
        rangeDragging = true;
        callbacks.onSelectItem(rangeDragItemId);
      }
      if (rangeDragging) {
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
    scheduleUpdate();
  });

  document.addEventListener("mouseup", () => {
    if (eventDragItemId != null) {
      if (eventDragging) didEventDrag = true;
      eventDragItemId = null;
      eventDragging = false;
    }
    if (rangeDragItemId != null) {
      if (rangeDragging) didRangeDrag = true;
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
    if (eventDragItemId != null) {
      if (eventDragging) didEventDrag = true;
      eventDragItemId = null;
      eventDragging = false;
    }
    if (rangeDragItemId != null) {
      if (rangeDragging) didRangeDrag = true;
      rangeDragItemId = null;
      rangeDragging = false;
    }
    if (panning) {
      panning = false;
      rulerWrap.classList.remove("custom-timeline-pan-cursor");
      viewportWrap.classList.remove("custom-timeline-pan-cursor");
    }
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
      if (didRangeDrag) {
        didRangeDrag = false;
        return;
      }
      callbacks.onSelectItem(rangeItemId);
    }
  });
}
