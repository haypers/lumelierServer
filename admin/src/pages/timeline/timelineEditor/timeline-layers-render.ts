import type { TimelineStateJSON } from "../types";

/** Bar background color by range type (match asset tab pills). */
const RANGE_TYPE_BG: Record<"Audio" | "Video" | "Image", string> = {
  Audio: "var(--asset-pill-audio)",
  Video: "var(--asset-pill-video)",
  Image: "var(--asset-pill-image)",
};

const EVENT_POINT_SIZE_PX = 12;
const MIN_PX_BEFORE_NEXT_TO_SHOW_LABEL = 40;
const LABEL_DOT_GAP_PX = 4;
const LABEL_MAX_WIDTH_PX = 120;

export interface RenderLayersCallbacks {
  onSelectItem: (id: string) => void;
}

/**
 * Render virtualized layer rows: only items in visibleItems are in the DOM.
 * Positions are (item.startSec - startSec) * pixelsPerSec.
 * Events: circle marker + label; selected: white 1px outline. Ranges: bars with label inside.
 */
export function renderVirtualizedLayers(
  container: HTMLElement,
  layers: TimelineStateJSON["layers"],
  visibleItems: TimelineStateJSON["items"],
  startSec: number,
  pixelsPerSec: number,
  viewportWidthPx: number,
  rowHeightPx: number,
  selectedItemId: string | null,
  callbacks: RenderLayersCallbacks
): void {
  container.innerHTML = "";
  container.style.width = `${viewportWidthPx}px`;

  layers.forEach((layer, index) => {
    const rowWrap = document.createElement("div");
    rowWrap.className = "custom-timeline-layer-row-wrap";
    rowWrap.style.position = "absolute";
    rowWrap.style.left = "0";
    rowWrap.style.top = `${index * rowHeightPx}px`;
    rowWrap.style.height = `${rowHeightPx}px`;
    rowWrap.style.width = `${viewportWidthPx}px`;
    rowWrap.style.borderBottom = "1px solid var(--border)";

    const layerItems = visibleItems
      .filter((it) => it.layerId === layer.id)
      .sort((a, b) => a.startSec - b.startSec);
    layerItems.forEach((it, i) => {
      const selected = it.id === selectedItemId;
      const nextItem = layerItems[i + 1];
      if (it.kind === "event") {
        const left = (it.startSec - startSec) * pixelsPerSec;
        const gapPx = nextItem
          ? (nextItem.startSec - it.startSec) * pixelsPerSec
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
        eventWrap.dataset.itemId = it.id;
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
          labelSpan.textContent = it.label ?? it.id;
          labelSpan.style.maxWidth = `${maxLabelWidthPx}px`;
          eventWrap.appendChild(labelSpan);
        }
        rowWrap.appendChild(eventWrap);
      } else if (it.kind === "range") {
        const left = (it.startSec - startSec) * pixelsPerSec;
        const endSecItem = it.endSec ?? it.startSec + 1;
        const w = (endSecItem - it.startSec) * pixelsPerSec;
        const rangeType = it.rangeType ?? "Audio";
        const bgColor = RANGE_TYPE_BG[rangeType];
        const range = document.createElement("div");
        range.className = "custom-timeline-range" + (selected ? " custom-timeline-range--selected" : "");
        range.style.position = "absolute";
        range.style.left = `${Math.max(0, left)}px`;
        range.style.top = "4px";
        range.style.height = "24px";
        range.style.width = `${Math.min(w, viewportWidthPx - Math.max(0, left))}px`;
        range.style.borderRadius = "4px";
        range.style.background = bgColor;
        range.style.border = `1px solid ${bgColor}`;
        range.style.cursor = "pointer";
        range.style.display = "flex";
        range.style.alignItems = "center";
        range.style.overflow = "hidden";
        range.style.paddingLeft = "6px";
        range.style.paddingRight = "6px";
        range.dataset.itemId = it.id;
        const labelSpan = document.createElement("span");
        labelSpan.className = "custom-timeline-range-label";
        labelSpan.textContent = it.label ?? it.id;
        labelSpan.style.overflow = "hidden";
        labelSpan.style.textOverflow = "ellipsis";
        labelSpan.style.whiteSpace = "nowrap";
        labelSpan.style.minWidth = "0";
        range.appendChild(labelSpan);
        range.addEventListener("click", (e) => {
          e.stopPropagation();
          callbacks.onSelectItem(it.id);
        });
        rowWrap.appendChild(range);
      }
    });

    container.appendChild(rowWrap);
  });
}
