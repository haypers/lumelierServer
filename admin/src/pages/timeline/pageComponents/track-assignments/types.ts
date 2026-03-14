/** Path into track assignment tree: [] = root, [0] = first random child, ["compatible"] = gps compatible. */
export type TrackAssignmentPath = (string | number)[];

/** Track assignment: random split (children with %), GPS split (compatible/incompatible), or set track (leaf). */
export type TrackAssignmentNode =
  | {
      type: "random";
      children: { percent: number; node: TrackAssignmentNode }[];
    }
  | {
      type: "gps";
      compatible: TrackAssignmentNode;
      incompatible: TrackAssignmentNode;
    }
  | {
      type: "setTrack";
      trackId: string;
    };

export interface TrackAssignmentsRoot {
  root: TrackAssignmentNode;
}

/** Path-derived attributes for a node (e.g. used to filter dropdown options). Extensible for future rules. */
export interface TrackAssignmentNodeAttributes {
  /** True if this node is a descendant of a GPS node (branch already determined). */
  absolute?: boolean;
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

/** Compute attributes for the node at the given path (e.g. absolute when any ancestor is GPS). */
export function getAttributesForPath(
  root: TrackAssignmentNode,
  path: TrackAssignmentPath
): TrackAssignmentNodeAttributes {
  const attrs: TrackAssignmentNodeAttributes = {};
  for (let i = 0; i < path.length; i++) {
    const ancestor = getNodeAtPath(root, path.slice(0, i));
    if (ancestor?.type === "gps") {
      attrs.absolute = true;
      return attrs;
    }
  }
  return attrs;
}

/** Default track assignments tree: When devices join, Set Track 1. */
export function getDefaultTrackAssignments(): TrackAssignmentsRoot {
  return {
    root: { type: "setTrack", trackId: "1" },
  };
}

function deepCloneNode(node: TrackAssignmentNode): TrackAssignmentNode {
  if (node.type === "setTrack") return { type: "setTrack", trackId: node.trackId };
  if (node.type === "random") {
    return {
      type: "random",
      children: node.children.map((c) => ({ percent: c.percent, node: deepCloneNode(c.node) })),
    };
  }
  return {
    type: "gps",
    compatible: deepCloneNode(node.compatible),
    incompatible: deepCloneNode(node.incompatible),
  };
}

/** Deep clone for use as modal working copy; only Save commits to the real root. */
export function deepCloneTrackAssignmentsRoot(root: TrackAssignmentsRoot): TrackAssignmentsRoot {
  return { root: deepCloneNode(root.root) };
}
