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

/** Default track assignments tree: Split Users Randomly with two 50% Set Track children. */
export function getDefaultTrackAssignments(): TrackAssignmentsRoot {
  return {
    root: {
      type: "random",
      children: [
        { percent: 50, node: { type: "setTrack", trackId: "1" } },
        { percent: 50, node: { type: "setTrack", trackId: "2" } },
      ],
    },
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
