import "./styles.css";
import { openModal } from "../../../components/modal";
import trashIcon from "../../../icons/trash.svg?raw";
import type { TrackAssignmentNode, TrackAssignmentsRoot } from "./types";
import { deepCloneTrackAssignmentsRoot, getDefaultTrackAssignments } from "./types";

export type { TrackAssignmentNode, TrackAssignmentsRoot } from "./types";
export { getDefaultTrackAssignments } from "./types";

let trackAssignmentsRoot: TrackAssignmentsRoot | null = null;
/** Working copy used only while the modal is open; cleared on close. Save commits this to trackAssignmentsRoot. */
let trackAssignmentsWorkingRoot: TrackAssignmentsRoot | null = null;
let trackAssignmentsModalClose: (() => void) | null = null;

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

function saveTrackAssignmentsAndClose(): void {
  if (trackAssignmentsWorkingRoot) {
    setTrackAssignmentsRoot(trackAssignmentsWorkingRoot);
  }
  trackAssignmentsWorkingRoot = null;
  trackAssignmentsModalClose?.();
}

/** Path into track assignment tree: [] = root, [0] = first random child, ["compatible"] = gps compatible. */
type TrackAssignmentPath = (string | number)[];

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

interface FlattenRowRoot {
  depth: number;
  kind: "root";
  node: TrackAssignmentNode;
}
interface FlattenRowRandomChild {
  depth: number;
  kind: "randomChild";
  node: TrackAssignmentNode;
  percent: number;
  indexInParent: number;
  isLastChild: boolean;
  /** Number of siblings (parent's children). Trash shows only when siblingCount > 1. */
  siblingCount: number;
  parentPath: TrackAssignmentPath;
}
interface FlattenRowGps {
  depth: number;
  kind: "gpsCompatible" | "gpsIncompatible";
  node: TrackAssignmentNode;
  parentPath: TrackAssignmentPath;
}
interface FlattenRowAddBranch {
  depth: number;
  kind: "addBranch";
  parentPath: TrackAssignmentPath;
}
type FlattenRow = FlattenRowRoot | FlattenRowRandomChild | FlattenRowGps | FlattenRowAddBranch;

function flattenTrackAssignments(node: TrackAssignmentNode, depth: number, parentPath: TrackAssignmentPath): FlattenRow[] {
  const rows: FlattenRow[] = [];
  if (depth === 0) {
    rows.push({ depth: 0, kind: "root", node });
  }

  if (node.type === "random") {
    const siblingCount = node.children.length;
    node.children.forEach((c, i) => {
      const path = [...parentPath, i];
      rows.push({
        depth,
        kind: "randomChild",
        node: c.node,
        percent: c.percent,
        indexInParent: i,
        isLastChild: i === node.children.length - 1,
        siblingCount,
        parentPath: [...parentPath],
      });
      rows.push(...flattenTrackAssignments(c.node, depth + 1, path));
    });
    rows.push({ depth, kind: "addBranch", parentPath: [...parentPath] });
  } else if (node.type === "gps") {
    rows.push({
      depth,
      kind: "gpsCompatible",
      node: node.compatible,
      parentPath: [...parentPath],
    });
    rows.push(...flattenTrackAssignments(node.compatible, depth + 1, [...parentPath, "compatible"]));
    rows.push({
      depth,
      kind: "gpsIncompatible",
      node: node.incompatible,
      parentPath: [...parentPath],
    });
    rows.push(...flattenTrackAssignments(node.incompatible, depth + 1, [...parentPath, "incompatible"]));
  }
  return rows;
}

function flattenRoot(root: TrackAssignmentNode): FlattenRow[] {
  const rows: FlattenRow[] = [];
  rows.push({ depth: 0, kind: "root", node: root });
  if (root.type === "random") {
    const siblingCount = root.children.length;
    root.children.forEach((c, i) => {
      const path = [i];
      rows.push({
        depth: 1,
        kind: "randomChild",
        node: c.node,
        percent: c.percent,
        indexInParent: i,
        isLastChild: i === root.children.length - 1,
        siblingCount,
        parentPath: [],
      });
      rows.push(...flattenTrackAssignments(c.node, 2, path));
    });
    rows.push({ depth: 1, kind: "addBranch", parentPath: [] });
  } else if (root.type === "gps") {
    rows.push({ depth: 1, kind: "gpsCompatible", node: root.compatible, parentPath: [] });
    rows.push(...flattenTrackAssignments(root.compatible, 2, ["compatible"]));
    rows.push({ depth: 1, kind: "gpsIncompatible", node: root.incompatible, parentPath: [] });
    rows.push(...flattenTrackAssignments(root.incompatible, 2, ["incompatible"]));
  }
  return rows;
}

const TRACK_ASSIGNMENT_SUFFIX_OPTIONS = [
  { value: "random", label: "Split Users Randomly" },
  { value: "gps", label: "Split Users by GPS Compatibility" },
  { value: "setTrack", label: "Set Track" },
] as const;

function defaultNodeForType(type: "random" | "gps" | "setTrack"): TrackAssignmentNode {
  if (type === "random") {
    return {
      type: "random",
      children: [
        { percent: 50, node: { type: "setTrack", trackId: "1" } },
        { percent: 50, node: { type: "setTrack", trackId: "2" } },
      ],
    };
  }
  if (type === "gps") {
    return {
      type: "gps",
      compatible: { type: "setTrack", trackId: "3" },
      incompatible: { type: "setTrack", trackId: "4" },
    };
  }
  return { type: "setTrack", trackId: "1" };
}

const TRACK_ASSIGNMENTS_INDENT_PX = 26;
const TRACK_ASSIGNMENTS_ROW_HEIGHT_PX = 28;

function rowHasChildren(row: FlattenRow): boolean {
  if (row.kind === "addBranch") return false;
  const node = row.node;
  return node.type === "random" || node.type === "gps";
}

function computeLastDescendantByRow(rows: FlattenRow[]): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < rows.length; i++) {
    if (!rowHasChildren(rows[i])) continue;
    const depth = rows[i].depth;
    let j = i + 1;
    while (j < rows.length && rows[j].depth > depth) j++;
    let lastDesc = j - 1;
    if (lastDesc >= 0 && rows[lastDesc].kind === "addBranch") lastDesc--;
    map.set(i, lastDesc);
  }
  return map;
}

function renderTrackAssignmentsHierarchy(container: HTMLElement): void {
  const root = getRoot().root;
  const rows = flattenRoot(root);
  const lastDescendantByRow = computeLastDescendantByRow(rows);
  const maxDepth = rows.reduce((m, r) => Math.max(m, r.depth), 0);
  const indentPx = TRACK_ASSIGNMENTS_INDENT_PX;
  const connectorX = (d: number) => d * indentPx + indentPx / 2;
  const centerY = TRACK_ASSIGNMENTS_ROW_HEIGHT_PX / 2;
  const treeSvgWidth = (maxDepth + 1) * indentPx;

  container.innerHTML = "";
  const viewerContent = document.createElement("div");
  viewerContent.className = "track-assignments-viewer-content";

  const rowsContainer = document.createElement("div");
  rowsContainer.className = "track-assignments-rows-container";

  rows.forEach((row, rowIndex) => {
    const rowWrapper = document.createElement("div");
    rowWrapper.className = "track-assignments-row-wrapper";

    if (row.kind !== "addBranch") {
      const hasChildren = rowHasChildren(row);
      const lastDesc = hasChildren ? lastDescendantByRow.get(rowIndex) ?? rowIndex : rowIndex;
      const svgHeight = hasChildren ? (lastDesc - rowIndex + 1) * TRACK_ASSIGNMENTS_ROW_HEIGHT_PX : TRACK_ASSIGNMENTS_ROW_HEIGHT_PX;
      const rowSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      rowSvg.setAttribute("class", "track-assignments-tree-svg track-assignments-tree-svg--row");
      rowSvg.setAttribute("width", String(treeSvgWidth));
      rowSvg.setAttribute("height", String(svgHeight));
      rowSvg.setAttribute("viewBox", `0 0 ${treeSvgWidth} ${svgHeight}`);
      if (row.depth > 0) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(connectorX(row.depth - 1)));
        line.setAttribute("y1", String(centerY));
        line.setAttribute("x2", String(connectorX(row.depth)));
        line.setAttribute("y2", String(centerY));
        line.setAttribute("stroke", "currentColor");
        line.setAttribute("stroke-width", "1");
        rowSvg.appendChild(line);
      }
      if (hasChildren) {
        const vert = document.createElementNS("http://www.w3.org/2000/svg", "line");
        vert.setAttribute("x1", String(connectorX(row.depth)));
        vert.setAttribute("y1", String(centerY));
        vert.setAttribute("x2", String(connectorX(row.depth)));
        /* Stop at center of last child row so stem doesn't extend past the last horizontal */
        const lastRowCenterY = (lastDesc - rowIndex) * TRACK_ASSIGNMENTS_ROW_HEIGHT_PX + centerY ;
        vert.setAttribute("y2", String(lastRowCenterY));
        vert.setAttribute("stroke", "currentColor");
        vert.setAttribute("stroke-width", "1");
        rowSvg.appendChild(vert);
      }
      rowWrapper.appendChild(rowSvg);
    }

    const rowEl = document.createElement("div");
    rowEl.className = "track-assignments-row";
    rowEl.style.paddingLeft = `${row.depth * indentPx + indentPx / 2}px`;
    rowEl.style.whiteSpace = "nowrap";

    if (row.kind === "addBranch") {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "track-assignments-add-branch";
      addBtn.textContent = "+ Add branch";
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        addRandomChildAtPath(row.parentPath);
        renderTrackAssignmentsHierarchy(container);
      });
      rowEl.appendChild(addBtn);
      rowWrapper.appendChild(rowEl);
      rowsContainer.appendChild(rowWrapper);
      return;
    }

    const prefixSpan = document.createElement("span");
    prefixSpan.className = "track-assignments-row-prefix";

    if (row.kind === "root") {
      prefixSpan.textContent = "When users join - ";
    } else if (row.kind === "randomChild") {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "track-assignments-percent-input";
      input.value = String(row.percent);
      input.min = "0";
      input.max = "100";
      input.addEventListener("change", () => {
        const rootState = getRoot();
        const parent = getNodeAtPath(rootState.root, row.parentPath) as {
          type: "random";
          children: { percent: number; node: TrackAssignmentNode }[];
        } | null;
        if (parent?.type === "random") {
          const n = Number(input.value);
          if (!Number.isNaN(n)) parent.children[row.indexInParent].percent = n;
        }
      });
      prefixSpan.appendChild(input);
      prefixSpan.appendChild(document.createTextNode("% - "));
    } else if (row.kind === "gpsCompatible") {
      prefixSpan.textContent = "Compatible - ";
    } else if (row.kind === "gpsIncompatible") {
      prefixSpan.textContent = "Incompatible - ";
    }
    rowEl.appendChild(prefixSpan);

    if (
      row.kind !== "root" &&
      row.kind !== "randomChild" &&
      row.kind !== "gpsCompatible" &&
      row.kind !== "gpsIncompatible"
    ) {
      rowWrapper.appendChild(rowEl);
      rowsContainer.appendChild(rowWrapper);
      return;
    }

    const node = row.kind === "root" ? row.node : row.node;
    const typeValue = node.type === "random" ? "random" : node.type === "gps" ? "gps" : "setTrack";

    const select = document.createElement("select");
    select.className = "track-assignments-suffix-select";
    select.setAttribute("aria-label", "Assignment type");
    TRACK_ASSIGNMENT_SUFFIX_OPTIONS.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === typeValue) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener("change", () => {
      const newType = select.value as "random" | "gps" | "setTrack";
      const path: TrackAssignmentPath =
        row.kind === "root"
          ? []
          : row.kind === "randomChild"
            ? [...row.parentPath, row.indexInParent]
            : row.kind === "gpsCompatible"
              ? [...row.parentPath, "compatible"]
              : [...row.parentPath, "incompatible"];
      replaceNodeAtPath(path, defaultNodeForType(newType));
      renderTrackAssignmentsHierarchy(container);
    });
    rowEl.appendChild(select);

    if (node.type === "setTrack") {
      const trackInput = document.createElement("input");
      trackInput.type = "text";
      trackInput.className = "track-assignments-track-id-input";
      trackInput.value = node.trackId;
      trackInput.placeholder = "Track";
      trackInput.addEventListener("change", () => {
        const path: TrackAssignmentPath =
          row.kind === "root"
            ? []
            : row.kind === "randomChild"
              ? [...row.parentPath, row.indexInParent]
              : row.kind === "gpsCompatible"
                ? [...row.parentPath, "compatible"]
                : [...row.parentPath, "incompatible"];
        const n = getNodeAtPath(getRoot().root, path);
        if (n?.type === "setTrack") n.trackId = trackInput.value;
      });
      rowEl.appendChild(document.createTextNode(": "));
      rowEl.appendChild(trackInput);
    }

    const trashWrap = document.createElement("span");
    trashWrap.className = "track-assignments-trash-wrap";
    if (row.kind === "root") {
      // no trash
    } else if (row.kind === "gpsCompatible" || row.kind === "gpsIncompatible") {
      // no trash for GPS fixed children
    } else if (row.kind === "randomChild" && row.siblingCount > 1) {
      const trashBtn = document.createElement("button");
      trashBtn.type = "button";
      trashBtn.className = "track-assignments-trash-btn";
      trashBtn.innerHTML = trashIcon;
      trashBtn.setAttribute("aria-label", "Delete branch");
      trashBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const path: TrackAssignmentPath = [...row.parentPath, row.indexInParent];
        deleteChildAtPath(path);
        renderTrackAssignmentsHierarchy(container);
      });
      trashWrap.appendChild(trashBtn);
    }
    rowEl.appendChild(trashWrap);
    rowWrapper.appendChild(rowEl);
    rowsContainer.appendChild(rowWrapper);
  });
  viewerContent.appendChild(rowsContainer);
  container.appendChild(viewerContent);
}

export function openTrackAssignmentsDropdown(_anchorBtn: HTMLElement): void {
  trackAssignmentsWorkingRoot = deepCloneTrackAssignmentsRoot(
    trackAssignmentsRoot ?? getDefaultTrackAssignments()
  );
  const container = document.createElement("div");
  container.className = "track-assignments-hierarchy-viewer";
  renderTrackAssignmentsHierarchy(container);
  const { close } = openModal({
    size: "large",
    clickOutsideToClose: true,
    title: "How users are split into tracks: ",
    info: "This hierarchy will be used by the server to assign tracks to clients when they join the show.",
    content: container,
    cancel: {},
    actions: [{ preset: "save", label: "Save", onClick: saveTrackAssignmentsAndClose }],
    onClose: () => {
      trackAssignmentsModalClose = null;
      trackAssignmentsWorkingRoot = null;
    },
  });
  trackAssignmentsModalClose = close;
}
