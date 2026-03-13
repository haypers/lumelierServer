import type { TimelineStateJSON } from "../types";
import { renderRangeElement, type RangeItem } from "./range/render-range";
import { RANGE_HANDLE_ZONE_WIDTH_PX } from "./range/constants";
import { renderEventElement, type EventItem } from "./event/render-event";

/**
 * Render virtualized layer rows: only items in visibleItems are in the DOM.
 * Positions are (item.startSec - startSec) * pixelsPerSec.
 * Ranges are rendered first, then events on top, so when they overlap the event receives the click/drag.
 * Click/drag is handled by the parent (custom-timeline) via delegated listeners on the layer content.
 */
export function renderVirtualizedLayers(
  container: HTMLElement,
  layers: TimelineStateJSON["layers"],
  visibleItems: TimelineStateJSON["items"],
  startSec: number,
  pixelsPerSec: number,
  viewportWidthPx: number,
  rowHeightPx: number,
  selectedItemId: string | null
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
    const ranges = layerItems.filter((it): it is typeof it & { kind: "range" } => it.kind === "range");
    const events = layerItems.filter((it): it is typeof it & { kind: "event" } => it.kind === "event");

    ranges.forEach((it) => {
      const item = it as RangeItem;
      const left = (item.startSec - startSec) * pixelsPerSec;
      const endSecItem = item.endSec ?? item.startSec + 1;
      const w = (endSecItem - item.startSec) * pixelsPerSec;
      const halfZone = RANGE_HANDLE_ZONE_WIDTH_PX / 2;

      rowWrap.appendChild(
        renderRangeElement(item, startSec, pixelsPerSec, selectedItemId)
      );

      const zoneLeft = document.createElement("div");
      zoneLeft.className = "custom-timeline-range-handle-zone custom-timeline-range-handle-zone-left";
      zoneLeft.dataset.itemId = item.id;
      zoneLeft.dataset.handle = "left";
      zoneLeft.style.position = "absolute";
      zoneLeft.style.left = `${left - halfZone}px`;
      zoneLeft.style.top = "4px";
      zoneLeft.style.width = `${RANGE_HANDLE_ZONE_WIDTH_PX}px`;
      zoneLeft.style.height = "24px";
      zoneLeft.style.zIndex = "1";
      rowWrap.appendChild(zoneLeft);

      const zoneRight = document.createElement("div");
      zoneRight.className = "custom-timeline-range-handle-zone custom-timeline-range-handle-zone-right";
      zoneRight.dataset.itemId = item.id;
      zoneRight.dataset.handle = "right";
      zoneRight.style.position = "absolute";
      zoneRight.style.left = `${left + w - halfZone}px`;
      zoneRight.style.top = "4px";
      zoneRight.style.width = `${RANGE_HANDLE_ZONE_WIDTH_PX}px`;
      zoneRight.style.height = "24px";
      zoneRight.style.zIndex = "1";
      rowWrap.appendChild(zoneRight);
    });
    events.forEach((it, i) => {
      rowWrap.appendChild(
        renderEventElement(
          it as EventItem,
          startSec,
          pixelsPerSec,
          events[i + 1] as EventItem | undefined,
          viewportWidthPx,
          selectedItemId
        )
      );
    });

    container.appendChild(rowWrap);
  });
}
