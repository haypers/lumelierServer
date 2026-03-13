import trashIcon from "../../../../icons/trash.svg?raw";

export interface EngulfedRange {
  id: string;
  startSec: number;
  endSec: number;
}

/** Ranges A and B overlap iff A.start < B.end && B.start < A.end (same layer, A !== B). */
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** B is engulfed by A iff A.start <= B.start && A.end >= B.end (A !== B). */
export function isEngulfed(
  editStart: number,
  editEnd: number,
  otherStart: number,
  otherEnd: number
): boolean {
  return editStart <= otherStart && editEnd >= otherEnd;
}

export type PartialOverlapVariant = "coverEnd" | "coverStart";

export interface PartialOverlapSegment {
  startSec: number;
  endSec: number;
  variant: PartialOverlapVariant;
}

/**
 * Partial overlap: we cover the other range's end (they extend left of us) or we cover their start (they extend right of us).
 * Excludes engulfed (full containment).
 */
export function getPartialOverlapSegments(
  editStart: number,
  editEnd: number,
  ranges: { id: string; startSec: number; endSec?: number }[]
): PartialOverlapSegment[] {
  const out: PartialOverlapSegment[] = [];
  for (const other of ranges) {
    const oEnd = other.endSec ?? other.startSec + 1;
    if (editStart >= editEnd || other.startSec >= oEnd) continue;
    const engulfed = isEngulfed(editStart, editEnd, other.startSec, oEnd);
    if (engulfed) continue;
    if (!rangesOverlap(editStart, editEnd, other.startSec, oEnd)) continue;
    if (other.startSec < editStart && editStart < oEnd && oEnd <= editEnd) {
      out.push({ startSec: editStart, endSec: oEnd, variant: "coverEnd" });
    }
    if (editStart <= other.startSec && other.startSec < editEnd && oEnd > editEnd) {
      out.push({ startSec: other.startSec, endSec: editEnd, variant: "coverStart" });
    }
  }
  return out;
}

export interface OverlapTrim {
  id: string;
  newStartSec?: number;
  newEndSec?: number;
}

export interface OverlapResolution {
  engulfedIds: string[];
  trims: OverlapTrim[];
}

/**
 * Returns ids to delete (engulfed by editing range) and trim actions for partially overlapped ranges.
 * Call with other ranges on the same layer (excluding the editing range).
 */
export function getOverlapResolution(
  editStart: number,
  editEnd: number,
  otherRanges: { id: string; startSec: number; endSec?: number }[]
): OverlapResolution {
  const engulfedIds: string[] = [];
  const trims: OverlapTrim[] = [];
  for (const other of otherRanges) {
    const oEnd = other.endSec ?? other.startSec + 1;
    if (isEngulfed(editStart, editEnd, other.startSec, oEnd)) {
      engulfedIds.push(other.id);
      continue;
    }
    if (!rangesOverlap(editStart, editEnd, other.startSec, oEnd)) continue;
    if (other.startSec < editStart && editStart < oEnd && oEnd <= editEnd) {
      trims.push({ id: other.id, newEndSec: editStart });
    }
    if (editStart <= other.startSec && other.startSec < editEnd && oEnd > editEnd) {
      trims.push({ id: other.id, newStartSec: editEnd });
    }
  }
  return { engulfedIds, trims };
}

/** True if the editing range (editStart, editEnd) is fully inside another range (otherStart, otherEnd). */
export function isEditingRangeEngulfed(
  editStart: number,
  editEnd: number,
  otherStart: number,
  otherEnd: number
): boolean {
  return otherStart <= editStart && otherEnd >= editEnd;
}

/** Minimum width (px) of an engulfed box to show the trash icon; below this show only the red shape. */
const ENGULFED_BOX_MIN_WIDTH_FOR_ICON_PX = 24;

/**
 * Create the overlay container and red boxes for engulfed ranges.
 * Trash icon is only rendered when the box width is at least ENGULFED_BOX_MIN_WIDTH_FOR_ICON_PX.
 */
export function createEngulfedOverlay(
  engulfed: EngulfedRange[],
  startSec: number,
  pixelsPerSec: number,
  viewportWidthPx: number,
  rowHeightPx: number
): HTMLElement {
  const overlayWrap = document.createElement("div");
  overlayWrap.className = "custom-timeline-range-engulfed-overlay";
  overlayWrap.style.position = "absolute";
  overlayWrap.style.left = "0";
  overlayWrap.style.top = "0";
  overlayWrap.style.width = `${viewportWidthPx}px`;
  overlayWrap.style.height = `${rowHeightPx}px`;
  overlayWrap.style.pointerEvents = "none";
  overlayWrap.style.zIndex = "3";

  for (const eng of engulfed) {
    const left = (eng.startSec - startSec) * pixelsPerSec;
    const wPx = (eng.endSec - eng.startSec) * pixelsPerSec;
    const box = document.createElement("div");
    box.className = "custom-timeline-range-engulfed-box";
    box.style.position = "absolute";
    box.style.left = `${left}px`;
    box.style.width = `${Math.max(0, wPx)}px`;
    box.style.top = "6px";
    box.style.height = "20px";
    box.style.background = "#e00";
    box.style.border = "1px solid #c00";
    box.style.borderRadius = "4px";
    box.style.display = "flex";
    box.style.alignItems = "center";
    box.style.justifyContent = "center";
    box.style.color = "white";
    box.style.overflow = "hidden";

    if (wPx >= ENGULFED_BOX_MIN_WIDTH_FOR_ICON_PX) {
      const iconWrap = document.createElement("span");
      iconWrap.innerHTML = trashIcon;
      iconWrap.style.display = "flex";
      iconWrap.style.alignItems = "center";
      iconWrap.style.justifyContent = "center";
      iconWrap.style.minWidth = "0";
      const svg = iconWrap.querySelector("svg");
      if (svg) {
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
      }
      box.appendChild(iconWrap);
    }

    overlayWrap.appendChild(box);
  }

  return overlayWrap;
}
