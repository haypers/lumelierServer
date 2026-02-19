import type { SimulatedClientDistKey, DistributionCurve } from "./types";

/** Reserved name for the built-in "Realistic bad device" profile. Saving with this name is not allowed. */
export const SYSTEM_PRESET_REALISTIC_BAD_DEVICE = "realistic-bad-device";

/** Display label for the system preset in the dropdown. */
export const SYSTEM_PRESET_REALISTIC_BAD_DEVICE_LABEL = "Realistic bad device (system)";

/** Reserved name for the built-in "Stadium uplink congestion" profile. */
export const SYSTEM_PRESET_STADIUM_UPLINK_CONGESTION = "stadium-uplink-congestion";

/** Display label for the system preset in the dropdown. */
export const SYSTEM_PRESET_STADIUM_UPLINK_CONGESTION_LABEL =
  "Stadium uplink congestion (system)";

/**
 * Static system preset: realistic bad device.
 * Bundled in the frontend; always available and cannot be overwritten by user saves.
 */
export const REALISTIC_BAD_DEVICE_PROFILE: Record<SimulatedClientDistKey, DistributionCurve> = {
  clientToServerDelayDist: {
    anchors: [
      { destructionChance: 0, x: 17.26421759095727, xMutationRange: 0, y: 0, yMutationRange: 0 },
      { destructionChance: 0, x: 105.57223595902508, xMutationRange: 65, y: 12.244127516778514, yMutationRange: 13 },
      { destructionChance: 25, x: 187.25715294948785, xMutationRange: 72, y: 0, yMutationRange: 0 },
      { destructionChance: 0, x: 277.77287177675737, xMutationRange: 0, y: 0, yMutationRange: 0 },
    ],
  },
  lagSpikeDurationDist: {
    anchors: [
      { destructionChance: 0, x: 2.0289429530201346, xMutationRange: 2, y: 38.04825732153751, yMutationRange: 47 },
      { destructionChance: 0, x: 2.721057046979866, xMutationRange: 4, y: 48.11537141549725, yMutationRange: 95 },
      { destructionChance: 0, x: 2.9098154362416113, xMutationRange: 4, y: 36.21787294081757, yMutationRange: 63 },
    ],
  },
  pingsEverySecDist: {
    anchors: [
      { destructionChance: 0, x: 1.9901095019427768, xMutationRange: 1, y: 0, yMutationRange: 0 },
      { destructionChance: 0, x: 3.3588837866478274, xMutationRange: 1.5, y: 25.607363483831605, yMutationRange: 19 },
      { destructionChance: 0, x: 4.264040974920523, xMutationRange: 0, y: 4.557943105552159, yMutationRange: 14 },
    ],
  },
  serverToClientDelayDist: {
    anchors: [
      { destructionChance: 0, x: 28.302719886965743, xMutationRange: 42, y: 0, yMutationRange: 0 },
      { destructionChance: 0, x: 98.94913458142, xMutationRange: 75, y: 15.354350976205003, yMutationRange: 13 },
      { destructionChance: 25, x: 169.59554927587428, xMutationRange: 44, y: 0, yMutationRange: 0 },
      { destructionChance: 0, x: 253.4881667255387, xMutationRange: 0, y: 0, yMutationRange: 0 },
    ],
  },
  clientProcessingDelayMsDist: {
    anchors: [
      { destructionChance: 0, x: 0, xMutationRange: 0, y: 0, yMutationRange: 0 },
      { destructionChance: 0, x: 20, xMutationRange: 10, y: 18, yMutationRange: 25 },
      { destructionChance: 0, x: 80, xMutationRange: 20, y: 0, yMutationRange: 0 },
      { destructionChance: 0, x: 110, xMutationRange: 0, y: 0, yMutationRange: 0 },
    ],
  },
  timeBetweenLagSpikesDist: {
    anchors: [
      { destructionChance: 0, x: 12.01739667961851, xMutationRange: 11, y: 0, yMutationRange: 0 },
      { destructionChance: 50, x: 49.08468738961498, xMutationRange: 23, y: 2.9063071995118928, yMutationRange: 11 },
      { destructionChance: 50, x: 75.99655598728366, xMutationRange: 20, y: 7.024672056131788, yMutationRange: 11 },
      { destructionChance: 0, x: 95.79962910632288, xMutationRange: 12, y: 20.294958816351425, yMutationRange: 15 },
      { destructionChance: 0, x: 108.4939067467326, xMutationRange: 9, y: 3.363903294691875, yMutationRange: 23 },
    ],
  },
};

/**
 * Static system preset: stadium uplink congestion.
 * Designed to reproduce RTT/2 symmetry failure modes (slow uplink, faster downlink).
 */
export const STADIUM_UPLINK_CONGESTION_PROFILE: Record<
  SimulatedClientDistKey,
  DistributionCurve
> = {
  pingsEverySecDist: {
    anchors: [
      { destructionChance: 0, x: 1.0, xMutationRange: 0.5, y: 5, yMutationRange: 10 },
      { destructionChance: 0, x: 2.5, xMutationRange: 1.5, y: 20, yMutationRange: 20 },
      { destructionChance: 0, x: 4.0, xMutationRange: 0, y: 0, yMutationRange: 0 },
    ],
  },
  clientToServerDelayDist: {
    anchors: [
      { destructionChance: 0, x: 250, xMutationRange: 100, y: 0, yMutationRange: 0 },
      { destructionChance: 0, x: 420, xMutationRange: 180, y: 25, yMutationRange: 20 },
      { destructionChance: 0, x: 650, xMutationRange: 0, y: 0, yMutationRange: 0 },
    ],
  },
  serverToClientDelayDist: {
    anchors: [
      { destructionChance: 0, x: 30, xMutationRange: 40, y: 0, yMutationRange: 0 },
      { destructionChance: 0, x: 90, xMutationRange: 80, y: 18, yMutationRange: 15 },
      { destructionChance: 0, x: 160, xMutationRange: 0, y: 0, yMutationRange: 0 },
    ],
  },
  clientProcessingDelayMsDist: {
    anchors: [
      { destructionChance: 0, x: 0, xMutationRange: 20, y: 20, yMutationRange: 15 },
      { destructionChance: 0, x: 40, xMutationRange: 80, y: 10, yMutationRange: 20 },
      { destructionChance: 0, x: 120, xMutationRange: 0, y: 0, yMutationRange: 0 },
    ],
  },
  timeBetweenLagSpikesDist: {
    anchors: [
      { destructionChance: 0, x: 30, xMutationRange: 20, y: 0, yMutationRange: 0 },
      { destructionChance: 0, x: 90, xMutationRange: 30, y: 5, yMutationRange: 10 },
      { destructionChance: 0, x: 120, xMutationRange: 0, y: 0, yMutationRange: 0 },
    ],
  },
  lagSpikeDurationDist: {
    anchors: [
      { destructionChance: 0, x: 0.5, xMutationRange: 0.5, y: 10, yMutationRange: 20 },
      { destructionChance: 0, x: 1.5, xMutationRange: 1.0, y: 5, yMutationRange: 15 },
      { destructionChance: 0, x: 3.0, xMutationRange: 0, y: 0, yMutationRange: 0 },
    ],
  },
};

/** Normalize profile name for comparison (lowercase, no .json). */
export function normalizedProfileName(name: string): string {
  return name.trim().replace(/\.json$/i, "").toLowerCase();
}

export function isReservedSystemPresetName(name: string): boolean {
  const n = normalizedProfileName(name);
  return (
    n === SYSTEM_PRESET_REALISTIC_BAD_DEVICE ||
    n === SYSTEM_PRESET_STADIUM_UPLINK_CONGESTION
  );
}
