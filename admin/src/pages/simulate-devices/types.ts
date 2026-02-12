export interface DistributionAnchor {
  x: number;
  y: number;
  /** Chart units, ≥ 0. Used in clone modal for mutation range rect. */
  xMutationRange?: number;
  /** 0–100. Used in clone modal for mutation range rect. */
  yMutationRange?: number;
  /** 0–100 integer. Used for presets later. */
  destructionChance?: number;
}

export interface DistributionCurve {
  anchors: DistributionAnchor[];
}

export type SimulatedClientDistKey =
  | "pingsEverySecDist"
  | "clientToServerDelayDist"
  | "serverToClientDelayDist"
  | "timeBetweenLagSpikesDist"
  | "lagSpikeDurationDist";

export interface SimulatedClient {
  id: string;
  deviceId: string;
  connectionEnabled: boolean;
  serverTimeEstimate: number | null;
  currentDisplayColor: string | null;
  pingsEverySecDist: DistributionCurve;
  clientToServerDelayDist: DistributionCurve;
  serverToClientDelayDist: DistributionCurve;
  timeBetweenLagSpikesDist: DistributionCurve;
  lagSpikeDurationDist: DistributionCurve;
}

/** Response from GET /clients/:id — full client plus per-chart sample history. */
export interface SimulatedClientWithSampleHistory extends SimulatedClient {
  sampleHistory: Record<SimulatedClientDistKey, { x: number; y: number }[]>;
}
