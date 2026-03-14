import leftCarrotIcon from "../../../../../icons/left-carrot.svg?raw";
import rightCarrotIcon from "../../../../../icons/right-carrot.svg?raw";
import type { PartialOverlapSegment } from "../index";

const PARTIAL_OVERLAP_HEIGHT_PX = 20;
const PARTIAL_OVERLAP_TOP_PX = 6;
const CARROT_SIZE_PX = 12;

/**
 * Create the overlay container and partial-overlap-body elements for partially overlapped ranges.
 */
export function createPartialOverlapOverlay(
  segments: PartialOverlapSegment[],
  startSec: number,
  pixelsPerSec: number,
  viewportWidthPx: number,
  rowHeightPx: number
): HTMLElement {
  const overlayWrap = document.createElement("div");
  overlayWrap.className = "timeline-partial-overlap-overlay";
  overlayWrap.style.position = "absolute";
  overlayWrap.style.left = "0";
  overlayWrap.style.top = "0";
  overlayWrap.style.width = `${viewportWidthPx}px`;
  overlayWrap.style.height = `${rowHeightPx}px`;
  overlayWrap.style.pointerEvents = "none";
  overlayWrap.style.zIndex = "3";

  for (const seg of segments) {
    const left = (seg.startSec - startSec) * pixelsPerSec;
    const wPx = (seg.endSec - seg.startSec) * pixelsPerSec;
    if (wPx <= 0) continue;

    const box = document.createElement("div");
    box.className =
      seg.variant === "coverEnd"
        ? "timeline-partial-overlap-body timeline-partial-overlap-body--cover-end"
        : "timeline-partial-overlap-body timeline-partial-overlap-body--cover-start";
    box.style.position = "absolute";
    box.style.left = `${left}px`;
    box.style.width = `${wPx}px`;
    box.style.top = `${PARTIAL_OVERLAP_TOP_PX}px`;
    box.style.height = `${PARTIAL_OVERLAP_HEIGHT_PX}px`;
    box.style.display = "flex";
    box.style.alignItems = "stretch";
    box.style.overflow = "hidden";

    const patternRow = document.createElement("div");
    patternRow.className = "timeline-partial-overlap-pattern";
    patternRow.style.display = "flex";
    patternRow.style.flexDirection = "row";
    patternRow.style.alignItems = "center";
    patternRow.style.height = "100%";
    patternRow.style.minWidth = "0";

    const iconSvg = seg.variant === "coverEnd" ? leftCarrotIcon : rightCarrotIcon;
    const count = Math.max(1, Math.ceil(wPx / CARROT_SIZE_PX));
    for (let i = 0; i < count; i++) {
      const iconWrap = document.createElement("span");
      iconWrap.innerHTML = iconSvg;
      iconWrap.style.display = "flex";
      iconWrap.style.alignItems = "center";
      iconWrap.style.justifyContent = "center";
      iconWrap.style.flexShrink = "0";
      iconWrap.style.width = `${CARROT_SIZE_PX}px`;
      iconWrap.style.height = `${CARROT_SIZE_PX}px`;
      iconWrap.style.color = "white";
      const svg = iconWrap.querySelector("svg");
      if (svg) {
        svg.setAttribute("width", String(CARROT_SIZE_PX));
        svg.setAttribute("height", String(CARROT_SIZE_PX));
      }
      patternRow.appendChild(iconWrap);
    }

    box.appendChild(patternRow);
    overlayWrap.appendChild(box);
  }

  return overlayWrap;
}
