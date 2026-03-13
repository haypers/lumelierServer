import type { TimelineStateJSON } from "../types";
import { renderRangeElement, type RangeItem } from "./range/render-range";
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
      rowWrap.appendChild(
        renderRangeElement(it as RangeItem, startSec, pixelsPerSec, selectedItemId)
      );
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
