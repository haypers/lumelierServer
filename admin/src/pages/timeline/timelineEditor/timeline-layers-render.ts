import type { TimelineStateJSON } from "../types";
import { renderRangeElement, type RangeItem, type RangeRenderState } from "./range/render-range";
import { renderEventElement, type EventItem } from "./event/render-event";
import type { HoverState } from "./interactions";
import {
  type EngulfedRange,
  rangesOverlap,
  isEngulfed,
  createEngulfedOverlay,
  getPartialOverlapSegments,
} from "./range-overlap";
import { createPartialOverlapOverlay } from "./range-overlap/partial-overlap";

export interface ResizeState {
  rangeId: string | null;
  edge: "left" | "right" | null;
}

/**
 * Render virtualized layer rows: only items in visibleItems are in the DOM.
 * Positions are (item.startSec - startSec) * pixelsPerSec.
 * Ranges are rendered first, then events on top, so when they overlap the event receives the click/drag.
 * Click/drag is handled by the parent (timeline widget) via delegated listeners on the layer content.
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
  draggingRangeId: string | null,
  hoverState: HoverState,
  resizeState: ResizeState,
  editingRangeId: string | null
): void {
  container.innerHTML = "";
  container.style.width = `${viewportWidthPx}px`;

  layers.forEach((layer, index) => {
    const rowWrap = document.createElement("div");
    rowWrap.className = "timeline-layer-row-wrap";
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

    const editingRange = editingRangeId
      ? (ranges.find((r) => r.id === editingRangeId) as RangeItem | undefined)
      : undefined;
    const editStart = editingRange ? editingRange.startSec : 0;
    const editEnd = editingRange
      ? (editingRange.endSec ?? editingRange.startSec + 1)
      : 0;

    let hasOverlap = false;
    const engulfed: EngulfedRange[] = [];
    const partialOverlaps = editingRange
      ? getPartialOverlapSegments(
          editStart,
          editEnd,
          ranges.filter((r) => r.id !== editingRange.id)
        )
      : [];
    if (editingRange) {
      for (const other of ranges) {
        if (other.id === editingRange.id) continue;
        const oEnd = (other as RangeItem).endSec ?? other.startSec + 1;
        if (rangesOverlap(editStart, editEnd, other.startSec, oEnd)) hasOverlap = true;
        if (isEngulfed(editStart, editEnd, other.startSec, oEnd))
          engulfed.push({ id: other.id, startSec: other.startSec, endSec: oEnd });
      }
    }

    ranges.forEach((it) => {
      const item = it as RangeItem;
      const edgeState: RangeRenderState = {
        highlightLeftEdge:
          hoverState.hoveredRangeEdge?.rangeId === item.id && hoverState.hoveredRangeEdge?.side === "left",
        highlightRightEdge:
          hoverState.hoveredRangeEdge?.rangeId === item.id && hoverState.hoveredRangeEdge?.side === "right",
        resizeEdge: resizeState.rangeId === item.id ? resizeState.edge : null,
        isEditingWithOverlap: item.id === editingRangeId && hasOverlap,
      };
      rowWrap.appendChild(
        renderRangeElement(item, startSec, pixelsPerSec, selectedItemId, draggingRangeId, edgeState)
      );
    });

    if (editingRangeId && engulfed.length > 0) {
      rowWrap.appendChild(
        createEngulfedOverlay(engulfed, startSec, pixelsPerSec, viewportWidthPx, rowHeightPx)
      );
    }
    if (editingRangeId && partialOverlaps.length > 0) {
      rowWrap.appendChild(
        createPartialOverlapOverlay(
          partialOverlaps,
          startSec,
          pixelsPerSec,
          viewportWidthPx,
          rowHeightPx
        )
      );
    }

    const eventInsideEditingRange =
      editingRange != null
        ? (ev: { startSec: number }) =>
            ev.startSec >= editStart && ev.startSec < editEnd
        : () => false;

    events.forEach((it, i) => {
      rowWrap.appendChild(
        renderEventElement(
          it as EventItem,
          startSec,
          pixelsPerSec,
          events[i + 1] as EventItem | undefined,
          viewportWidthPx,
          selectedItemId,
          hoverState.hoveredEventId === (it as EventItem).id,
          ranges.map((r) => ({ startSec: r.startSec, endSec: (r as RangeItem).endSec ?? r.startSec + 1 })),
          eventInsideEditingRange(it)
        )
      );
    });

    container.appendChild(rowWrap);
  });
}
