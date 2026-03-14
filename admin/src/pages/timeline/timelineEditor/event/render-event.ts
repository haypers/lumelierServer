import {
  EVENT_POINT_SIZE_PX,
  MIN_PX_BEFORE_NEXT_TO_SHOW_LABEL,
  LABEL_DOT_GAP_PX,
  LABEL_MAX_WIDTH_PX,
} from "./constants";

export interface EventItem {
  id: string;
  layerId: string;
  kind: "event";
  startSec: number;
  label?: string;
  effectType?: string;
  color?: string;
}

export interface LayerRangeBound {
  startSec: number;
  endSec: number;
}

export function renderEventElement(
  item: EventItem,
  startSec: number,
  pixelsPerSec: number,
  nextEvent: EventItem | undefined,
  viewportWidthPx: number,
  selectedItemId: string | null,
  hovered = false,
  layerRanges: LayerRangeBound[] = [],
  insideEditingRange = false
): HTMLElement {
  const selected = item.id === selectedItemId;
  const left = (item.startSec - startSec) * pixelsPerSec;
  const isInsideRange = layerRanges.some(
    (r) => item.startSec >= r.startSec && item.startSec < r.endSec
  );
  const viewportRightSec = startSec + viewportWidthPx / pixelsPerSec;
  const nextEventSec = nextEvent ? nextEvent.startSec : Infinity;
  const firstRangeStartAfterEvent = layerRanges
    .filter((r) => r.startSec > item.startSec)
    .map((r) => r.startSec);
  const firstObstacleSec = Math.min(nextEventSec, viewportRightSec, ...firstRangeStartAfterEvent);
  const gapPx =
    firstObstacleSec === Infinity
      ? viewportWidthPx - left
      : (firstObstacleSec - item.startSec) * pixelsPerSec;
  const showLabel = !isInsideRange && gapPx >= MIN_PX_BEFORE_NEXT_TO_SHOW_LABEL;
  const maxLabelWidthPx = showLabel
    ? Math.min(LABEL_MAX_WIDTH_PX, Math.max(0, gapPx - EVENT_POINT_SIZE_PX - LABEL_DOT_GAP_PX - 2))
    : 0;

  const eventWrap = document.createElement("div");
  eventWrap.className = "timeline-event";
  if (selected) eventWrap.classList.add("timeline-point--selected");
  if (hovered) eventWrap.classList.add("timeline-event--hovered");
  if (insideEditingRange) eventWrap.classList.add("timeline-event--inside-editing-range");
  eventWrap.style.position = "absolute";
  eventWrap.style.left = `${left - EVENT_POINT_SIZE_PX / 2}px`;
  eventWrap.style.top = "50%";
  eventWrap.style.transform = "translateY(-50%)";
  eventWrap.style.display = "flex";
  eventWrap.style.alignItems = "center";
  eventWrap.style.gap = `${LABEL_DOT_GAP_PX}px`;
  eventWrap.style.zIndex = "1";
  eventWrap.dataset.itemId = item.id;

  const point = document.createElement("div");
  point.className = "timeline-point";
  point.style.width = `${EVENT_POINT_SIZE_PX}px`;
  point.style.height = `${EVENT_POINT_SIZE_PX}px`;
  point.style.borderRadius = "50%";
  point.style.background = insideEditingRange ? "#c00" : "var(--accent)";
  point.style.opacity = "0.8";
  point.style.flexShrink = "0";
  eventWrap.appendChild(point);

  if (showLabel && maxLabelWidthPx > 0) {
    const labelSpan = document.createElement("span");
    labelSpan.className = "timeline-event-label";
    labelSpan.textContent = item.label ?? item.id;
    labelSpan.style.maxWidth = `${maxLabelWidthPx}px`;
    eventWrap.appendChild(labelSpan);
  }

  return eventWrap;
}
