import { openModal } from "../../../../components/modal";
import trashIcon from "../../../../icons/trash.svg?raw";
import type { TrackAssignmentNode, TrackAssignmentsRoot } from "./types";
import {
  type TrackAssignmentPath,
  type TrackAssignmentNodeAttributes,
  deepCloneTrackAssignmentsRoot,
  getDefaultTrackAssignments,
  getAttributesForPath,
} from "./types";
import { attachRandomPercentValidation, hasInvalidPercentGroups } from "./random-percent-validation";
import { createLayerTrackPicker } from "../layer-track-picker";

export type { TrackAssignmentNode, TrackAssignmentsRoot } from "./types";
export { getDefaultTrackAssignments } from "./types";

let trackAssignmentsRoot: TrackAssignmentsRoot | null = null;
/** Working copy used only while the modal is open; cleared on close. Save commits this to trackAssignmentsRoot. */
let trackAssignmentsWorkingRoot: TrackAssignmentsRoot | null = null;
let trackAssignmentsModalClose: (() => void) | null = null;
/** Set when opening the modal so Set Track rows can read timeline layers. */
let getLayersRef: (() => { id: string; label: string }[]) | null = null;

/** Convert stored trackId (1-based index string) to layer id for the picker value. */
function layerIdForTrackId(trackId: string, layers: { id: string; label: string }[]): string {
  const n = parseInt(trackId, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= layers.length) return layers[n - 1]?.id ?? "1";
  return layers[0]?.id ?? "1";
}

/** Convert layer id to 1-based track index for storage. */
function trackIndexForLayerId(layerId: string, layers: { id: string; label: string }[]): number {
  const idx = layers.findIndex((l) => l.id === layerId);
  return idx >= 0 ? idx + 1 : 1;
}

/** Ensure every setTrack.trackId is a 1-based index string in range (for saving). */
function normalizeTrackIdsInRoot(
  root: TrackAssignmentsRoot,
  getLayers: () => { id: string; label: string }[]
): TrackAssignmentsRoot {
  const layers = getLayers();
  const maxIndex = Math.max(1, layers.length);
  const out = deepCloneTrackAssignmentsRoot(root);
  function walk(node: TrackAssignmentNode): void {
    if (node.type === "setTrack") {
      const n = parseInt(node.trackId, 10);
      node.trackId = String(
        !Number.isNaN(n) && n >= 1 && n <= maxIndex ? n : 1
      );
      return;
    }
    if (node.type === "random") node.children.forEach((c) => walk(c.node));
    if (node.type === "gps") {
      walk(node.compatible);
      walk(node.incompatible);
    }
  }
  walk(out.root);
  return out;
}

export function getTrackAssignmentsRoot(): TrackAssignmentsRoot {
  return trackAssignmentsRoot ?? getDefaultTrackAssignments();
}

export function setTrackAssignmentsRoot(root: TrackAssignmentsRoot | null): void {
  trackAssignmentsRoot = root;
}

export function isTrackAssignmentsDropdownOpen(): boolean {
  return trackAssignmentsModalClose != null;
}

export function closeTrackAssignmentsDropdown(): void {
  if (trackAssignmentsModalClose) {
    trackAssignmentsModalClose();
  }
}


function getNodeAtPath(root: TrackAssignmentNode, path: TrackAssignmentPath): TrackAssignmentNode | null {
  let current: TrackAssignmentNode = root;
  for (const key of path) {
    if (current.type === "random" && typeof key === "number" && current.children[key]) {
      current = current.children[key].node;
    } else if (current.type === "gps" && (key === "compatible" || key === "incompatible")) {
      current = key === "compatible" ? current.compatible : current.incompatible;
    } else {
      return null;
    }
  }
  return current;
}

function getParentPath(path: TrackAssignmentPath): TrackAssignmentPath | null {
  if (path.length === 0) return null;
  return path.slice(0, -1);
}

function getRoot(): TrackAssignmentsRoot {
  return trackAssignmentsWorkingRoot ?? trackAssignmentsRoot ?? getDefaultTrackAssignments();
}

function replaceNodeAtPath(path: TrackAssignmentPath, node: TrackAssignmentNode): void {
  const root = getRoot();
  if (path.length === 0) {
    root.root = node;
    return;
  }
  const parentPath = getParentPath(path)!;
  const parent = getNodeAtPath(root.root, parentPath)!;
  const key = path[path.length - 1];
  if (parent.type === "random" && typeof key === "number") {
    parent.children[key] = { ...parent.children[key], node };
  } else if (parent.type === "gps" && (key === "compatible" || key === "incompatible")) {
    if (key === "compatible") parent.compatible = node;
    else parent.incompatible = node;
  }
}

function deleteChildAtPath(path: TrackAssignmentPath): void {
  if (path.length === 0) return;
  const root = getRoot();
  const parentPath = getParentPath(path)!;
  const parent = getNodeAtPath(root.root, parentPath)!;
  const index = path[path.length - 1];
  if (parent.type === "random" && typeof index === "number") {
    parent.children.splice(index, 1);
  }
}

function addRandomChildAtPath(parentPath: TrackAssignmentPath): void {
  const root = getRoot();
  const parent = getNodeAtPath(root.root, parentPath)!;
  if (parent.type !== "random") return;
  parent.children.push({ percent: 0, node: { type: "setTrack", trackId: "1" } });
}

const TRACK_ASSIGNMENT_SUFFIX_OPTIONS: {
  value: "random" | "gps" | "setTrack";
  label: string;
  /** If present, option is only shown when this returns true. */
  available?: (attrs: TrackAssignmentNodeAttributes) => boolean;
}[] = [
  { value: "random", label: "Split Devices Randomly" },
  { value: "gps", label: "Split Devices by GPS Compatibility", available: (a) => !a.absolute },
  { value: "setTrack", label: "Set Track" },
];

function defaultNodeForType(type: "random" | "gps" | "setTrack"): TrackAssignmentNode {
  if (type === "random") {
    return {
      type: "random",
      children: [
        { percent: 50, node: { type: "setTrack", trackId: "1" } },
        { percent: 50, node: { type: "setTrack", trackId: "1" } },
      ],
    };
  }
  if (type === "gps") {
    return {
      type: "gps",
      compatible: { type: "setTrack", trackId: "1" },
      incompatible: { type: "setTrack", trackId: "1" },
    };
  }
  return { type: "setTrack", trackId: "1" };
}

const TRACK_ASSIGNMENTS_DOT_RADIUS_PX = 3;
const GAP_AFTER_DOT_PX = 2;

/** Row context for building one node row (prefix, select, trash). */
type RowContext =
  | { kind: "root" }
  | {
      kind: "randomChild";
      parentPath: TrackAssignmentPath;
      indexInParent: number;
      percent: number;
      siblingCount: number;
    }
  | { kind: "gpsCompatible"; parentPath: TrackAssignmentPath }
  | { kind: "gpsIncompatible"; parentPath: TrackAssignmentPath };

function buildRowContent(
  node: TrackAssignmentNode,
  ctx: RowContext,
  path: TrackAssignmentPath,
  rowEl: HTMLElement
): void {
  const prefixSpan = document.createElement("span");
  prefixSpan.className = "track-assignments-row-prefix";
  if (ctx.kind === "root") {
    prefixSpan.textContent = "When devices join - ";
  } else if (ctx.kind === "randomChild") {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "track-assignments-percent-input";
    input.value = String(ctx.percent);
    input.min = "0";
    input.max = "100";
    input.addEventListener("change", () => {
      const rootState = getRoot();
      const parent = getNodeAtPath(rootState.root, ctx.parentPath) as {
        type: "random";
        children: { percent: number; node: TrackAssignmentNode }[];
      } | null;
      if (parent?.type === "random") {
        const n = Number(input.value);
        if (!Number.isNaN(n)) parent.children[ctx.indexInParent].percent = n;
      }
    });
    prefixSpan.appendChild(input);
    prefixSpan.appendChild(document.createTextNode("% - "));
  } else if (ctx.kind === "gpsCompatible") {
    prefixSpan.textContent = "Compatible - ";
  } else {
    prefixSpan.textContent = "Incompatible - ";
  }
  rowEl.appendChild(prefixSpan);

  const root = getRoot().root;
  const attrs = getAttributesForPath(root, path);
  const typeValue = node.type === "random" ? "random" : node.type === "gps" ? "gps" : "setTrack";
  const select = document.createElement("select");
  select.className = "track-assignments-suffix-select";
  select.setAttribute("aria-label", "Assignment type");
  TRACK_ASSIGNMENT_SUFFIX_OPTIONS.filter((opt) => opt.available == null || opt.available(attrs)).forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === typeValue) o.selected = true;
    select.appendChild(o);
  });
  select.addEventListener("change", () => {
    replaceNodeAtPath(path, defaultNodeForType(select.value as "random" | "gps" | "setTrack"));
    renderTrackAssignmentsHierarchy(containerRef);
  });
  rowEl.appendChild(select);

  if (node.type === "setTrack") {
    const layers = getLayersRef?.() ?? [];
    const picker = createLayerTrackPicker({
      layers,
      value: layerIdForTrackId(node.trackId, layers),
      onChange: (layerId) => {
        const n = getNodeAtPath(getRoot().root, path);
        if (n?.type === "setTrack") n.trackId = String(trackIndexForLayerId(layerId, layers));
      },
      ariaLabel: "Track",
    });
    rowEl.appendChild(document.createTextNode(": "));
    rowEl.appendChild(picker);
  }

  const trashWrap = document.createElement("span");
  trashWrap.className = "track-assignments-trash-wrap";
  if (ctx.kind === "randomChild" && ctx.siblingCount > 1) {
    const trashBtn = document.createElement("button");
    trashBtn.type = "button";
    trashBtn.className = "track-assignments-trash-btn";
    trashBtn.innerHTML = trashIcon;
    trashBtn.setAttribute("aria-label", "Delete branch");
    trashBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteChildAtPath(path);
      renderTrackAssignmentsHierarchy(containerRef);
    });
    trashWrap.appendChild(trashBtn);
  } else if (path.length > 0 && node.type === "gps") {
    const trashBtn = document.createElement("button");
    trashBtn.type = "button";
    trashBtn.className = "track-assignments-trash-btn";
    trashBtn.innerHTML = trashIcon;
    trashBtn.setAttribute("aria-label", "Delete branch");
    trashBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      replaceNodeAtPath(path, defaultNodeForType("setTrack"));
      renderTrackAssignmentsHierarchy(containerRef);
    });
    trashWrap.appendChild(trashBtn);
  }
  rowEl.appendChild(trashWrap);
}

/** Container element we're rendering into; set before calling renderTrackAssignmentsHierarchy. */
let containerRef: HTMLElement;

/** Recursively render one node as a row (with dot + content) and its children in a nested container. */
function renderNode(node: TrackAssignmentNode, path: TrackAssignmentPath, depth: number, ctx: RowContext): HTMLElement {
  const rowWrapper = document.createElement("div");
  rowWrapper.className = "track-assignments-row-wrapper";
  if (ctx.kind === "gpsCompatible" || ctx.kind === "gpsIncompatible") {
    rowWrapper.classList.add("track-assignments-row-wrapper--no-trash");
  }

  const rowLine = document.createElement("div");
  rowLine.className = "track-assignments-row-line";
  rowLine.style.gap = `${GAP_AFTER_DOT_PX}px`;

  const dotColumn = document.createElement("div");
  dotColumn.className = "track-assignments-dot-column";
  const dot = document.createElement("div");
  dot.className = "track-assignments-dot";
  const dotSize = TRACK_ASSIGNMENTS_DOT_RADIUS_PX * 2;
  dot.style.width = dot.style.height = `${dotSize}px`;
  dotColumn.appendChild(dot);
  rowLine.appendChild(dotColumn);

  const rowContent = document.createElement("div");
  rowContent.className = "track-assignments-row";
  buildRowContent(node, ctx, path, rowContent);
  rowLine.appendChild(rowContent);
  rowWrapper.appendChild(rowLine);

  if (node.type === "random") {
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "track-assignments-children-container";
    node.children.forEach((c, i) => {
      const childPath = [...path, i];
      const childCtx: RowContext = {
        kind: "randomChild",
        parentPath: path,
        indexInParent: i,
        percent: c.percent,
        siblingCount: node.children.length,
      };
      childrenContainer.appendChild(renderNode(c.node, childPath, depth + 1, childCtx));
    });
    const addBranchRow = document.createElement("div");
    addBranchRow.className = "track-assignments-row-wrapper track-assignments-add-branch-row";
    const addBranchLine = document.createElement("div");
    addBranchLine.className = "track-assignments-row-line";
    addBranchLine.style.gap = `${GAP_AFTER_DOT_PX}px`;
    const addBranchDotColumn = document.createElement("div");
    addBranchDotColumn.className = "track-assignments-dot-column track-assignments-dot-column--hidden";
    const addBranchDot = document.createElement("div");
    addBranchDot.className = "track-assignments-dot";
    addBranchDot.style.width = addBranchDot.style.height = `${TRACK_ASSIGNMENTS_DOT_RADIUS_PX * 2}px`;
    addBranchDotColumn.appendChild(addBranchDot);
    addBranchLine.appendChild(addBranchDotColumn);
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "track-assignments-add-branch";
    addBtn.textContent = "+ Add branch";
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      addRandomChildAtPath(path);
      renderTrackAssignmentsHierarchy(containerRef);
    });
    addBranchLine.appendChild(addBtn);
    addBranchRow.appendChild(addBranchLine);
    childrenContainer.appendChild(addBranchRow);
    rowWrapper.appendChild(childrenContainer);
  } else if (node.type === "gps") {
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "track-assignments-children-container";
    childrenContainer.appendChild(
      renderNode(node.compatible, [...path, "compatible"], depth + 1, { kind: "gpsCompatible", parentPath: path })
    );
    childrenContainer.appendChild(
      renderNode(node.incompatible, [...path, "incompatible"], depth + 1, { kind: "gpsIncompatible", parentPath: path })
    );
    rowWrapper.appendChild(childrenContainer);
  }

  return rowWrapper;
}

/** Get dot center coordinates relative to container. */
function getDotCenter(dotEl: HTMLElement, containerRect: DOMRect): { x: number; y: number } {
  const r = dotEl.getBoundingClientRect();
  return {
    x: r.left - containerRect.left + r.width / 2,
    y: r.top - containerRect.top + r.height / 2,
  };
}

/** Get dot bounds (top/bottom y, center x) relative to container for connector line endpoints. */
function getDotBounds(dotEl: HTMLElement, containerRect: DOMRect): { centerX: number; topY: number; bottomY: number } {
  const r = dotEl.getBoundingClientRect();
  return {
    centerX: r.left - containerRect.left + r.width / 2,
    topY: r.top - containerRect.top,
    bottomY: r.bottom - containerRect.top,
  };
}

/** Draw connector lines between dots using their measured positions; call after layout. */
function drawConnectorLines(viewerContent: HTMLElement): void {
  const existing = viewerContent.querySelector(".track-assignments-tree-svg");
  existing?.remove();
  const containerRect = viewerContent.getBoundingClientRect();
  const width = containerRect.width;
  const height = containerRect.height;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "track-assignments-tree-svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const rowsContainer = viewerContent.querySelector(".track-assignments-rows-container");
  if (!rowsContainer) {
    viewerContent.insertBefore(svg, viewerContent.firstChild);
    return;
  }

  const rootWrapper = rowsContainer.querySelector(":scope > .track-assignments-row-wrapper");
  if (!rootWrapper) {
    viewerContent.insertBefore(svg, viewerContent.firstChild);
    return;
  }

  function walk(rowWrapper: Element): void {
    const dot = rowWrapper.querySelector(".track-assignments-dot") as HTMLElement | null;
    const childrenContainer = rowWrapper.querySelector(":scope > .track-assignments-children-container");
    if (!dot) return;
    const parentCenter = getDotCenter(dot, containerRect);
    const parentBounds = getDotBounds(dot, containerRect);

    if (childrenContainer) {
      const childWrappers = Array.from(
        childrenContainer.querySelectorAll(":scope > .track-assignments-row-wrapper")
      ).filter(
        (w) => !w.classList.contains("track-assignments-add-branch-row") && w.querySelector(".track-assignments-dot")
      ) as HTMLElement[];
      if (childWrappers.length > 0) {
        const lastChild = childWrappers[childWrappers.length - 1];
        const lastChildDot = lastChild.querySelector(".track-assignments-dot") as HTMLElement;
        const lastChildBounds = getDotBounds(lastChildDot, containerRect);
        const strokeWidth = 1;
        const stemExtension = strokeWidth * 2;
        const vert = document.createElementNS("http://www.w3.org/2000/svg", "line");
        vert.setAttribute("x1", String(parentBounds.centerX));
        vert.setAttribute("y1", String(parentBounds.bottomY));
        vert.setAttribute("x2", String(parentBounds.centerX));
        vert.setAttribute("y2", String(lastChildBounds.topY + stemExtension));
        vert.setAttribute("stroke", "currentColor");
        vert.setAttribute("stroke-width", String(strokeWidth));
        svg.appendChild(vert);
      }
      for (const childWrapper of childWrappers) {
        const childDot = childWrapper.querySelector(".track-assignments-dot") as HTMLElement;
        const childCenter = getDotCenter(childDot, containerRect);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(parentCenter.x));
        line.setAttribute("y1", String(childCenter.y));
        line.setAttribute("x2", String(childCenter.x));
        line.setAttribute("y2", String(childCenter.y));
        line.setAttribute("stroke", "currentColor");
        line.setAttribute("stroke-width", "1");
        svg.appendChild(line);
        walk(childWrapper);
      }
    }
  }
  walk(rootWrapper);
  viewerContent.insertBefore(svg, viewerContent.firstChild);
}

function renderTrackAssignmentsHierarchy(
  container: HTMLElement,
  onValidationChange?: (container: HTMLElement) => void
): void {
  containerRef = container;
  const root = getRoot().root;

  container.innerHTML = "";
  const viewerContent = document.createElement("div");
  viewerContent.className = "track-assignments-viewer-content";

  const rowsContainer = document.createElement("div");
  rowsContainer.className = "track-assignments-rows-container";
  rowsContainer.appendChild(renderNode(root, [], 0, { kind: "root" }));
  viewerContent.appendChild(rowsContainer);
  container.appendChild(viewerContent);
  attachRandomPercentValidation(container, onValidationChange);

  requestAnimationFrame(() => {
    drawConnectorLines(viewerContent);
  });
}

function updateSaveButtonDisabled(container: HTMLElement): void {
  const dialog = container.closest("[role=\"dialog\"]");
  const saveBtn = dialog?.querySelector(".global-modal-btn-primary");
  if (saveBtn instanceof HTMLButtonElement) {
    saveBtn.disabled = hasInvalidPercentGroups(container);
  }
}

export function openTrackAssignmentsDropdown(
  _anchorBtn: HTMLElement,
  getLayers: () => { id: string; label: string }[] = () => [],
  onSave?: (root: TrackAssignmentsRoot) => Promise<void>
): void {
  trackAssignmentsWorkingRoot = deepCloneTrackAssignmentsRoot(
    trackAssignmentsRoot ?? getDefaultTrackAssignments()
  );
  getLayersRef = getLayers;
  const container = document.createElement("div");
  container.className = "track-assignments-hierarchy-viewer";
  renderTrackAssignmentsHierarchy(container, updateSaveButtonDisabled);
  let closeRef: (() => void) | null = null;
  const { close } = openModal({
    size: "large",
    clickOutsideToClose: true,
    title: "How devices are split into tracks: ",
    info: "This hierarchy will be used by the server to assign tracks to clients when they join the show.",
    content: container,
    cancel: {},
    actions: [
      {
        preset: "save",
        label: "Save",
        onClick: async () => {
          if (trackAssignmentsWorkingRoot) {
            setTrackAssignmentsRoot(trackAssignmentsWorkingRoot);
          }
          trackAssignmentsWorkingRoot = null;
          if (onSave) {
            const root = normalizeTrackIdsInRoot(
              getTrackAssignmentsRoot(),
              getLayersRef ?? (() => [])
            );
            await onSave(root);
          }
          closeRef?.();
        },
      },
    ],
    onClose: () => {
      trackAssignmentsModalClose = null;
      trackAssignmentsWorkingRoot = null;
      getLayersRef = null;
    },
  });
  closeRef = close;
  trackAssignmentsModalClose = close;
  updateSaveButtonDisabled(container);
}
