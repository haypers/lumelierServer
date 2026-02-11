import { createClient } from "./client-store";
import {
  DIST_KEYS_BY_PRESET_INDEX,
  DISTRIBUTION_CHART_PRESETS,
} from "./details-pane";
import type {
  DistributionCurve,
  DistributionAnchor,
  SimulatedClient,
} from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Generate one client from profile curves using the 3-wave algorithm (destruction, x-mutation, y-mutation).
 * Returns null if any chart ends up with 0 points.
 */
export function generateClientFromProfile(
  curves: DistributionCurve[]
): SimulatedClient | null {
  const client = createClient();

  for (let i = 0; i < DIST_KEYS_BY_PRESET_INDEX.length; i++) {
    const key = DIST_KEYS_BY_PRESET_INDEX[i];
    const xMax = DISTRIBUTION_CHART_PRESETS[i].xAxis.max;
    const inputAnchors = curves[i]?.anchors ?? [];
    if (inputAnchors.length === 0) return null;

    // Copy anchors so we don't mutate input
    let anchors: DistributionAnchor[] = inputAnchors.map((a) => ({
      x: a.x,
      y: a.y,
      xMutationRange: a.xMutationRange,
      yMutationRange: a.yMutationRange,
      destructionChance: a.destructionChance,
    }));

    // Wave 1: destruction
    anchors = anchors.filter((a) => {
      const chance = a.destructionChance ?? 0;
      if (chance === 0) return true;
      return Math.random() * 100 >= chance;
    });
    if (anchors.length === 0) return null;

    // Wave 2: x mutation (mutate in place, we'll output clean anchors later)
    // Half-range: min = x - range/2, max = x + range/2 (total span = range)
    for (const a of anchors) {
      const range = a.xMutationRange ?? 0;
      if (range !== 0) {
        const half = range / 2;
        a.x = clamp(a.x + (Math.random() * 2 - 1) * half, 0, xMax);
      }
    }

    // Wave 3: y mutation (half-range: min = y - range/2, max = y + range/2)
    for (const a of anchors) {
      const range = a.yMutationRange ?? 0;
      if (range !== 0) {
        const half = range / 2;
        a.y = clamp(a.y + (Math.random() * 2 - 1) * half, 0, 100);
      }
    }

    // Output anchors with only x, y
    client[key] = {
      anchors: anchors.map((a) => ({ x: a.x, y: a.y })),
    };
  }

  return client;
}
