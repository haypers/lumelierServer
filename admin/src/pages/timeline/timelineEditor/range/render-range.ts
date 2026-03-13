import type { RangeType } from "../../types";
import { RANGE_TYPE_BG } from "./constants";

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

export function renderRangeElement(
  item: RangeItem,
  startSec: number,
  pixelsPerSec: number,
  selectedItemId: string | null
): HTMLElement {
  const selected = item.id === selectedItemId;
  const left = (item.startSec - startSec) * pixelsPerSec;
  const endSecItem = item.endSec ?? item.startSec + 1;
  const w = (endSecItem - item.startSec) * pixelsPerSec;
  const rangeType = item.rangeType ?? "Audio";
  const bgColor = RANGE_TYPE_BG[rangeType];

  const range = document.createElement("div");
  range.className = "custom-timeline-range" + (selected ? " custom-timeline-range--selected" : "");
  range.style.position = "absolute";
  range.style.left = `${left}px`;
  range.style.top = "4px";
  range.style.height = "24px";
  range.style.width = `${w}px`;
  range.style.borderRadius = "4px";
  range.style.background = bgColor;
  range.style.border = `1px solid ${bgColor}`;
  range.style.cursor = "pointer";
  range.style.display = "flex";
  range.style.alignItems = "center";
  range.style.overflow = "hidden";
  range.style.paddingLeft = "6px";
  range.style.paddingRight = "6px";
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
