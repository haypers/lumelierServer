/**
 * Asset row drag handle and floating "dragging-clip" while dragging.
 * Used when dragging an asset toward the timeline (no drop target yet).
 */

import dragHandleIcon from "../../../../icons/drag-handle.svg?raw";

export const DRAGGING_CLIP_WIDTH_PX = 120;
export const DRAGGING_CLIP_HEIGHT_PX = 20;

export type ExtensionKind = "audio" | "video" | "image" | null;

export type AssetDragRangeType = "Image" | "Video" | "Audio";

export interface AssetDragFileInfo {
  fileName: string;
  filePath: string;
  rangeType: AssetDragRangeType;
  /** Duration in seconds (e.g. from media file); used for audio/video. Omit for images or unknown. */
  durationSec?: number;
}

function extensionKindToRangeType(kind: ExtensionKind): AssetDragRangeType {
  if (kind === "audio") return "Audio";
  if (kind === "video") return "Video";
  if (kind === "image") return "Image";
  return "Audio";
}

const DRAG_OFFSET_X_PX = 12;
const DRAG_OFFSET_Y_PX = 10;

function createDraggingClip(fileName: string, extensionKind: ExtensionKind): HTMLElement {
  const el = document.createElement("div");
  el.className = "assets-dragging-clip";

  const borderLayer = document.createElement("div");
  borderLayer.className = "assets-dragging-clip__border";

  const fillLayer = document.createElement("div");
  fillLayer.className = "assets-dragging-clip__fill";
  if (extensionKind) {
    fillLayer.classList.add(`assets-dragging-clip__fill--${extensionKind}`);
  } else {
    fillLayer.classList.add("assets-dragging-clip__fill--other");
  }

  const label = document.createElement("span");
  label.className = "assets-dragging-clip__label";
  label.textContent = fileName;

  fillLayer.appendChild(label);
  el.appendChild(borderLayer);
  el.appendChild(fillLayer);
  return el;
}

export type AssetDragMoveResult = "continue" | "commit";

export type AssetDragCallbacks = {
  onMove: (
    clientX: number,
    clientY: number,
    fileInfo: AssetDragFileInfo
  ) => AssetDragMoveResult;
};

function startDrag(
  initialClientX: number,
  initialClientY: number,
  fileName: string,
  extensionKind: ExtensionKind,
  getDragCallbacks?: () => AssetDragCallbacks,
  durationSec?: number
): void {
  const clip = createDraggingClip(fileName, extensionKind);
  clip.style.left = `${initialClientX - DRAG_OFFSET_X_PX}px`;
  clip.style.top = `${initialClientY - DRAG_OFFSET_Y_PX}px`;
  document.body.appendChild(clip);

  const fileInfo: AssetDragFileInfo = {
    fileName,
    filePath: fileName,
    rangeType: extensionKindToRangeType(extensionKind),
    durationSec,
  };

  const onMove = (e: MouseEvent): void => {
    if (getDragCallbacks) {
      const callbacks = getDragCallbacks();
      const result = callbacks.onMove(e.clientX, e.clientY, fileInfo);
      if (result === "commit") {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        clip.remove();
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        return;
      }
    }
    clip.style.left = `${e.clientX - DRAG_OFFSET_X_PX}px`;
    clip.style.top = `${e.clientY - DRAG_OFFSET_Y_PX}px`;
  };

  const onUp = (): void => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    clip.remove();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";
}

/**
 * Returns a cell containing the drag handle for an asset row.
 * When not uploading, mousedown on the handle starts a drag (floating clip follows mouse; destroyed on release).
 * If getDragCallbacks is provided, onMove can return "commit" to hand off to timeline (clip removed, caller drives placement).
 * durationSec is passed through to fileInfo for audio/video (optional for images/unknown).
 */
export function createDragHandleCell(
  isUploading: boolean,
  fileName: string,
  extensionKind: ExtensionKind,
  getDragCallbacks?: () => AssetDragCallbacks,
  durationSec?: number
): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "assets-file-drag-cell";

  const wrap = document.createElement("span");
  wrap.className = "assets-file-drag-handle-wrap";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = dragHandleIcon;

  if (!isUploading) {
    wrap.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      startDrag(e.clientX, e.clientY, fileName, extensionKind, getDragCallbacks, durationSec);
    });
  } else {
    wrap.style.opacity = "0.5";
    wrap.style.pointerEvents = "none";
  }

  cell.appendChild(wrap);
  return cell;
}
