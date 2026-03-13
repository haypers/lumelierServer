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

export function renderEventElement(
  item: EventItem,
  startSec: number,
  pixelsPerSec: number,
  nextEvent: EventItem | undefined,
  viewportWidthPx: number,
  selectedItemId: string | null
): HTMLElement {
  const selected = item.id === selectedItemId;
  const left = (item.startSec - startSec) * pixelsPerSec;
  const gapPx = nextEvent
    ? (nextEvent.startSec - item.startSec) * pixelsPerSec
    : viewportWidthPx - left;
  const showLabel = gapPx >= MIN_PX_BEFORE_NEXT_TO_SHOW_LABEL;
  const maxLabelWidthPx = showLabel
    ? Math.min(LABEL_MAX_WIDTH_PX, Math.max(0, gapPx - EVENT_POINT_SIZE_PX - LABEL_DOT_GAP_PX - 2))
    : 0;

  const eventWrap = document.createElement("div");
  eventWrap.className = "custom-timeline-event";
  if (selected) eventWrap.classList.add("custom-timeline-point--selected");
  eventWrap.style.position = "absolute";
  eventWrap.style.left = `${left - EVENT_POINT_SIZE_PX / 2}px`;
  eventWrap.style.top = "50%";
  eventWrap.style.transform = "translateY(-50%)";
  eventWrap.style.display = "flex";
  eventWrap.style.alignItems = "center";
  eventWrap.style.gap = `${LABEL_DOT_GAP_PX}px`;
  eventWrap.style.cursor = "pointer";
  eventWrap.style.zIndex = "1";
  eventWrap.dataset.itemId = item.id;

  const point = document.createElement("div");
  point.className = "custom-timeline-point";
  point.style.width = `${EVENT_POINT_SIZE_PX}px`;
  point.style.height = `${EVENT_POINT_SIZE_PX}px`;
  point.style.borderRadius = "50%";
  point.style.background = "var(--accent)";
  point.style.opacity = "0.8";
  point.style.flexShrink = "0";
  eventWrap.appendChild(point);

  if (showLabel && maxLabelWidthPx > 0) {
    const labelSpan = document.createElement("span");
    labelSpan.className = "custom-timeline-event-label";
    labelSpan.textContent = item.label ?? item.id;
    labelSpan.style.maxWidth = `${maxLabelWidthPx}px`;
    eventWrap.appendChild(labelSpan);
  }

  return eventWrap;
}
