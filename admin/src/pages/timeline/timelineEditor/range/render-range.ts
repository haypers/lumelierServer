import type { RangeType } from "../../types";
import { RANGE_TYPE_BG } from "./constants";

const RANGE_LEFT_PADDING_PX = 4;
const RANGE_RIGHT_PADDING_PX = 6;

export interface RangeItem {
  id: string;
  layerId: string;
  kind: "range";
  startSec: number;
  endSec?: number;
  label?: string;
  rangeType?: RangeType;
  filePath?: string;
}

export interface RangeRenderState {
  highlightLeftEdge?: boolean;
  highlightRightEdge?: boolean;
  resizeEdge?: "left" | "right" | null;
}

export function renderRangeElement(
  item: RangeItem,
  startSec: number,
  pixelsPerSec: number,
  selectedItemId: string | null,
  _draggingRangeId: string | null,
  edgeState?: RangeRenderState
): HTMLElement {
  const selected = item.id === selectedItemId;
  const left = (item.startSec - startSec) * pixelsPerSec;
  const endSecItem = item.endSec ?? item.startSec + 1;
  const w = (endSecItem - item.startSec) * pixelsPerSec;
  const rangeType = item.rangeType ?? "Audio";
  const bgColor = RANGE_TYPE_BG[rangeType];

  const resizeLeft = edgeState?.resizeEdge === "left";
  const resizeRight = edgeState?.resizeEdge === "right";
  const highlightLeft = edgeState?.highlightLeftEdge && !resizeLeft;
  const highlightRight = edgeState?.highlightRightEdge && !resizeRight;

  const range = document.createElement("div");
  range.className = "custom-timeline-range" + (selected ? " custom-timeline-range--selected" : "");
  if (highlightLeft) range.classList.add("custom-timeline-range--edge-left-highlight");
  if (highlightRight) range.classList.add("custom-timeline-range--edge-right-highlight");
  if (resizeLeft) range.classList.add("custom-timeline-range--resize-left");
  if (resizeRight) range.classList.add("custom-timeline-range--resize-right");
  range.style.position = "absolute";
  range.style.left = `${left}px`;
  range.style.top = "4px";
  range.style.height = "24px";
  range.style.width = `${w}px`;
  range.style.borderRadius = "4px";
  range.style.background = bgColor;
  range.style.border = `1px solid ${bgColor}`;
  range.style.display = "flex";
  range.style.alignItems = "center";
  range.style.overflow = "hidden";
  range.style.paddingLeft = `${RANGE_LEFT_PADDING_PX}px`;
  range.style.paddingRight = `${RANGE_RIGHT_PADDING_PX}px`;
  range.dataset.itemId = item.id;

  const labelSpan = document.createElement("span");
  labelSpan.className = "custom-timeline-range-label";
  labelSpan.textContent = item.label ?? item.id;
  labelSpan.style.overflow = "hidden";
  labelSpan.style.textOverflow = "ellipsis";
  labelSpan.style.whiteSpace = "nowrap";
  labelSpan.style.minWidth = "0";
  range.appendChild(labelSpan);

  return range;
}
