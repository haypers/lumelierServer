/**
 * Asset row drag handle and floating "dragging-clip" while dragging.
 * Used when dragging an asset toward the timeline (no drop target yet).
 */

import dragHandleIcon from "../../../icons/drag-handle.svg?raw";

export const DRAGGING_CLIP_WIDTH_PX = 120;
export const DRAGGING_CLIP_HEIGHT_PX = 32;

export type ExtensionKind = "audio" | "video" | "image" | null;

const DRAG_OFFSET_X_PX = 12;
const DRAG_OFFSET_Y_PX = 16;

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

function startDrag(
  initialClientX: number,
  initialClientY: number,
  fileName: string,
  extensionKind: ExtensionKind
): void {
  const clip = createDraggingClip(fileName, extensionKind);
  clip.style.left = `${initialClientX - DRAG_OFFSET_X_PX}px`;
  clip.style.top = `${initialClientY - DRAG_OFFSET_Y_PX}px`;
  document.body.appendChild(clip);

  const onMove = (e: MouseEvent): void => {
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
 */
export function createDragHandleCell(
  isUploading: boolean,
  fileName: string,
  extensionKind: ExtensionKind
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
      startDrag(e.clientX, e.clientY, fileName, extensionKind);
    });
  } else {
    wrap.style.opacity = "0.5";
    wrap.style.pointerEvents = "none";
  }

  cell.appendChild(wrap);
  return cell;
}
